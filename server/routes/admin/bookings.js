// Bookings for every service: list per status tab, the booking drawer (detail, travellers,
// payments ledger, history), status changes, modify, cancel & refund, CSV export.
import { Router } from "express";

import { z } from "zod";
import { allowed } from "../../../shared/admin-nav.js";
import { audit } from "../../lib/audit.js";
import { canAny, me } from "../../lib/auth.js";
import { one, query, tx } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";
import { getSetting } from "../../lib/settings.js";
import { notifyStaff, sendTemplate } from "../../lib/mailer.js";

const r = Router();

export const STATUSES = ["pending", "supplier", "confirmed", "travelling", "completed", "refund", "cancelled"];

export const TYPES = ["hotel", "excursion", "package", "umrah", "transfer", "car", "visa", "flight", "other"];
export const STATUS_LABEL = {
  pending: "Awaiting payment",
  supplier: "Awaiting supplier",
  confirmed: "Confirmed",
  travelling: "Travelling",
  completed: "Completed",
  refund: "Refund pending",
  cancelled: "Cancelled",
};
/** Today's date in Pakistan, as SQL. */
export const TODAY = "(now() AT TIME ZONE 'Asia/Karachi')::date";

const q1 = async (c, sql, p = []) => (await c.query(sql, p)).rows[0] ?? null;

/** Tells the team (Settings → Notifications) without ever failing the request. */
export function notify(req, event, message, path) {
  const origin = `${req.protocol}://${req.get("host")}`;
  notifyStaff(event, message, origin + path).catch((e) => console.warn("notifyStaff failed:", e.message));
}

/* ---------- visibility ---------- */

/** SQL condition limiting bookings (alias `a`) to what this user may see; pushes params. */
export function bookingScope(req, params, a = "b") {
  const m = me(req);
  const conds = [];
  if (!allowed(m, "bookings.all")) {
    params.push(STATUSES.filter((s) => allowed(m, `bookings.${s}`)));
    conds.push(`${a}.status = ANY($${params.length})`);
  }
  if (m.limits.ownBookingsOnly) {
    params.push(m.id);
    conds.push(`(${a}.assigned_to = $${params.length} OR ${a}.created_by = $${params.length})`);
  }
  return conds.length ? conds.join(" AND ") : "true";
}

function mayAct(req, b, action) {
  const m = me(req);
  if (m.limits.ownBookingsOnly && b.assigned_to !== m.id && b.created_by !== m.id) return false;
  return canAny(req, ["bookings.all", `bookings.${b.status}`], action);
}

/** Loads a booking by id or ref and checks the user may `action` it. */
export async function loadBooking(req, idOrRef, action = "view", c) {
  const isId = /^[0-9a-f-]{36}$/i.test(idOrRef);
  const sql = `SELECT id, ref, status, assigned_to, created_by FROM travel.bookings WHERE ${isId ? "id = $1" : "upper(ref) = upper($1)"}`;
  const b = c ? await q1(c, sql, [idOrRef]) : await one(sql, [idOrRef]);
  if (!b || !mayAct(req, b, "view")) throw notFound("Booking not found");
  if (action !== "view" && !mayAct(req, b, action)) throw new HttpError(403, "Your role does not allow changing this booking");
  return b;
}

/* ---------- money helpers ---------- */

/** Recomputes paid_amount and payment_status from the payments ledger. */
export async function recomputePayment(c, bookingId) {
  const s = await q1(
    c,
    `SELECT coalesce(sum(p.amount) FILTER (WHERE p.kind='payment' AND p.status='verified'),0)::float AS paid,
            coalesce(sum(p.amount) FILTER (WHERE p.kind='refund' AND p.status='verified'),0)::float AS refunded,
            count(*) FILTER (WHERE p.kind='payment' AND p.status='pending')::int AS pending,
            (SELECT total_amount FROM travel.bookings WHERE id=$1)::float AS total
       FROM travel.booking_payments p WHERE p.booking_id=$1`,
    [bookingId],
  );
  if (!s) return;
  const net = s.paid - s.refunded;
  const status =
    s.refunded > 0 && net <= 0
      ? "refunded"
      : s.pending > 0
        ? "verify"
        : net >= s.total && s.total > 0
          ? "paid"
          : net > 0
            ? "deposit"
            : "unpaid";
  await c.query("UPDATE travel.bookings SET paid_amount=$2, payment_status=$3, updated_at=now() WHERE id=$1", [
    bookingId,
    Math.max(net, 0),
    status,
  ]);
}

export async function addEvent(c, bookingId, kind, message, userId) {
  await c.query("INSERT INTO travel.booking_events (booking_id, kind, message, user_id) VALUES ($1,$2,$3,$4)", [
    bookingId,
    kind,
    message,
    userId,
  ]);
}

/** Verifies (or rejects) a pending payment row; shared with the Payments page. */
export async function verifyPayment(req, paymentId, approve, note) {
  const out = await verifyPaymentTx(req, paymentId, approve, note);
  if (approve) await sendReceipt(out.booking_id, out.amount, out.method);
  return { booking_id: out.booking_id, ref: out.ref };
}

/** Emails the "Payment received" template to the lead guest when Checkout rules say so; never throws. */
export async function sendReceipt(bookingId, amount, method) {
  try {
    const rules = await getSetting("checkout", { email_receipt: true });
    if (!rules.email_receipt) return;
    const b = await one(
      "SELECT ref, lead_name, lead_email, product_name, start_date, end_date, total_amount::float AS total, paid_amount::float AS paid, currency_code FROM travel.bookings WHERE id = $1",
      [bookingId],
    );
    if (!b?.lead_email) return;
    const f = (n) => `${b.currency_code} ${Math.round(n).toLocaleString("en-US")}`;
    const r = await sendTemplate("payment_received", b.lead_email, {
      guest_name: b.lead_name,
      booking_ref: b.ref,
      product_name: b.product_name,
      start_date: b.start_date,
      end_date: b.end_date ?? "",
      amount: f(amount),
      method: methodLabel(method),
      total: f(b.total),
      paid: f(b.paid),
      balance: f(Math.max(b.total - b.paid, 0)),
    });
    if (r.sent)
      await query("INSERT INTO travel.booking_events (booking_id, kind, message) VALUES ($1,'email',$2)", [
        bookingId,
        `Payment receipt emailed to ${b.lead_email}`,
      ]);
  } catch (e) {
    console.warn("receipt email failed:", e.message);
  }
}

async function verifyPaymentTx(req, paymentId, approve, note) {
  const m = me(req);
  return tx(async (c) => {
    const p = await q1(
      c,
      "SELECT id, booking_id, kind, status, amount, method, provider FROM travel.booking_payments WHERE id=$1 FOR UPDATE",
      [paymentId],
    );
    if (!p) throw notFound("Payment not found");
    const b = await loadBooking(req, p.booking_id, "view", c);
    const can = mayAct(req, b, "edit") || canAny(req, ["payments.verify", "payments.transactions"], "edit");
    if (!can) throw new HttpError(403, "Your role does not allow verifying payments");
    if (p.kind !== "payment") throw new HttpError(400, "Use “Mark refund paid” for refunds");
    if (p.status !== "pending") throw new HttpError(400, "This payment is already " + p.status);
    await c.query(
      "UPDATE travel.booking_payments SET status=$2, verified_by=$3, verified_at=now(), note=coalesce($4, note) WHERE id=$1",
      [p.id, approve ? "verified" : "rejected", m.id, note ?? null],
    );
    await recomputePayment(c, p.booking_id);
    await addEvent(
      c,
      p.booking_id,
      "payment",
      `${approve ? "Payment verified" : "Payment slip rejected"}: PKR ${Math.round(p.amount).toLocaleString("en-US")} (${methodLabel(p.method)}${p.provider ? " · " + p.provider : ""})`,
      m.id,
    );
    await audit(m.id, approve ? "payment.verify" : "payment.reject", "booking", b.id, { payment: p.id, amount: p.amount });
    if (approve)
      notify(
        req,
        "payment_verified",
        `Payment verified for ${b.ref}: PKR ${Math.round(p.amount).toLocaleString("en-US")} (${methodLabel(p.method)}) by ${m.name}`,
        `/admin/bookings/all?open=${b.ref}`,
      );
    return { booking_id: b.id, ref: b.ref, amount: Number(p.amount), method: p.method };
  });
}

export const methodLabel = (m) => ({ bank: "Bank transfer", card: "Card", wallet: "Mobile wallet", cash: "Cash" })[m] ?? m;

/** Marks a pending refund as paid out; the booking moves to Cancelled. */
export async function payRefund(req, paymentId, reference) {
  const m = me(req);
  return tx(async (c) => {
    const p = await q1(c, "SELECT id, booking_id, kind, status, amount FROM travel.booking_payments WHERE id=$1 FOR UPDATE", [
      paymentId,
    ]);
    if (!p || p.kind !== "refund") throw notFound("Refund not found");
    const b = await loadBooking(req, p.booking_id, "view", c);
    if (!(mayAct(req, b, "edit") || canAny(req, ["payments.refunds", "bookings.refund"], "edit")))
      throw new HttpError(403, "Your role does not allow paying refunds");
    if (p.status === "verified") throw new HttpError(400, "This refund is already paid");
    await c.query(
      "UPDATE travel.booking_payments SET status='verified', verified_by=$2, verified_at=now(), paid_at=now(), reference=coalesce($3, reference) WHERE id=$1",
      [p.id, m.id, reference || null],
    );
    await recomputePayment(c, p.booking_id);
    const left = await q1(
      c,
      "SELECT count(*)::int AS n FROM travel.booking_payments WHERE booking_id=$1 AND kind='refund' AND status='pending'",
      [p.booking_id],
    );
    if (!left?.n && b.status === "refund") {
      await c.query("UPDATE travel.bookings SET status='cancelled', updated_at=now() WHERE id=$1", [b.id]);
      await addEvent(c, b.id, "status", "Status changed to Cancelled (refund paid)", m.id);
    }
    await addEvent(c, b.id, "payment", `Refund paid: PKR ${Math.round(p.amount).toLocaleString("en-US")}`, m.id);
    await audit(m.id, "refund.paid", "booking", b.id, { payment: p.id, amount: p.amount });
    return { booking_id: b.id, ref: b.ref };
  });
}

/* ---------- masking ---------- */

export const maskCnic = (s) =>
  s
    ? s
        .replace(/^(\d{5})-?(\d{7})-?(\d)$/, "$1-•••••••-$3")
        .replace(/^(.{3}).+(.{2})$/, (all, a, b) => (all.includes("•") ? all : a + "•".repeat(Math.max(all.length - 5, 3)) + b))
    : s;
export const maskPassport = (s) => (s && s.length > 4 ? s.slice(0, 2) + "•".repeat(s.length - 4) + s.slice(-2) : s);

/* ---------- product image / link SQL ---------- */

export const IMAGE_SQL = (a = "b") => `CASE ${a}.product_type
  WHEN 'hotel' THEN (SELECT coalesce(image_url, image_day_url) FROM travel.hotels WHERE id = ${a}.product_id)
  WHEN 'excursion' THEN (SELECT coalesce(image_url, image_day_url) FROM travel.excursions WHERE id = ${a}.product_id)
  WHEN 'package' THEN (SELECT coalesce(image_url, image_day_url) FROM travel.packages WHERE id = ${a}.product_id) END`;

const LIST_COLS = `b.id, b.ref, b.product_type, b.product_id, b.product_name, b.status, b.payment_status, b.start_date, b.end_date,
  b.adults, b.children, b.infants, b.lead_name, b.lead_phone, b.lead_email, b.total_amount, b.paid_amount, b.currency_code,
  b.channel, b.payment_method, b.supplier_ref, b.created_at, ${IMAGE_SQL()} AS image`;

function searchCond(qs, params) {
  const t = qs.trim();
  if (!t) return "true";
  params.push(`%${t}%`);
  const n = params.length;
  const digits = t.replace(/\D/g, "").replace(/^0+/, "");
  let phone = "";
  if (digits.length >= 4) {
    params.push(`%${digits}%`);
    phone = ` OR regexp_replace(b.lead_phone, '\\D', '', 'g') LIKE $${params.length}`;
  }
  return `(b.ref ILIKE $${n} OR b.lead_name ILIKE $${n} OR b.lead_email ILIKE $${n} OR b.product_name ILIKE $${n} OR b.lead_cnic ILIKE $${n}
    OR b.supplier_ref ILIKE $${n} OR EXISTS (SELECT 1 FROM travel.booking_travellers t WHERE t.booking_id = b.id AND (t.full_name ILIKE $${n} OR t.passport_no ILIKE $${n}))${phone})`;
}

function tabKey(tab) {
  const t = String(tab ?? "all");
  if (t === "all" || STATUSES.includes(t)) return t;
  throw new HttpError(400, "Unknown tab");
}

/* ---------- list ---------- */

r.get("/", async (req, res) => {
  const tab = tabKey(req.query.tab);
  if (!canAny(req, [`bookings.${tab}`], "view")) throw new HttpError(403, "Your role does not allow this");
  const params = [];
  const where = [bookingScope(req, params), searchCond(String(req.query.q ?? ""), params)];
  if (tab !== "all") {
    params.push(tab);
    where.push(`b.status = $${params.length}`);
  }
  const rows = await query(
    `SELECT ${LIST_COLS} FROM travel.bookings b WHERE ${where.join(" AND ")} ORDER BY b.created_at DESC LIMIT 500`,
    params,
  );

  const kp = [];
  const scope = bookingScope(req, kp);
  const k = await one(
    `SELECT
      count(*) FILTER (WHERE b.start_date = ${TODAY} AND b.status NOT IN ('cancelled','refund'))::int AS checkins,
      string_agg(b.product_name, ', ') FILTER (WHERE b.start_date = ${TODAY} AND b.status NOT IN ('cancelled','refund')) AS checkin_names,
      coalesce(sum(b.total_amount - b.paid_amount) FILTER (WHERE b.status IN ('pending','supplier','confirmed','travelling') AND b.paid_amount < b.total_amount),0)::float AS balance,
      count(*) FILTER (WHERE b.status IN ('pending','supplier','confirmed','travelling') AND b.paid_amount > 0 AND b.paid_amount < b.total_amount)::int AS on_deposit,
      count(*) FILTER (WHERE b.status = 'supplier')::int AS supplier,
      min(b.created_at) FILTER (WHERE b.status = 'supplier') AS supplier_oldest,
      count(*) FILTER (WHERE b.created_at > now() - interval '90 days')::int AS recent,
      count(*) FILTER (WHERE b.created_at > now() - interval '90 days' AND b.status IN ('cancelled','refund'))::int AS recent_cancelled
    FROM travel.bookings b WHERE ${scope}`,
    kp,
  );
  res.json({ data: { rows, kpis: k } });
});

/* ---------- CSV export ---------- */

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

r.get("/export", async (req, res) => {
  const tab = tabKey(req.query.tab);
  if (!canAny(req, [`bookings.${tab}`], "view")) throw new HttpError(403, "Your role does not allow this");
  const m = me(req);
  if (!m.limits.canExport) throw new HttpError(403, "Your role does not allow exporting");
  const params = [];
  const where = [bookingScope(req, params), searchCond(String(req.query.q ?? ""), params)];
  if (tab !== "all") {
    params.push(tab);
    where.push(`b.status = $${params.length}`);
  }
  const rows = await query(
    `SELECT b.*, u.name AS assigned_name FROM travel.bookings b LEFT JOIN travel.admin_users u ON u.id = b.assigned_to
    WHERE ${where.join(" AND ")} ORDER BY b.created_at DESC`,
    params,
  );
  const cols = [
    ["Reference", (b) => b.ref],
    ["Created", (b) => b.created_at.toISOString().slice(0, 16).replace("T", " ")],
    ["Status", (b) => STATUS_LABEL[b.status]],
    ["Payment", (b) => b.payment_status],
    ["Product type", (b) => b.product_type],
    ["Product", (b) => b.product_name],
    ["Start", (b) => b.start_date],
    ["End", (b) => b.end_date],
    ["Adults", (b) => b.adults],
    ["Children", (b) => b.children],
    ["Infants", (b) => b.infants],
    ["Lead guest", (b) => b.lead_name],
    ["Phone", (b) => b.lead_phone],
    ["Email", (b) => b.lead_email],
    ["CNIC", (b) => (m.limits.maskIds ? maskCnic(b.lead_cnic) : b.lead_cnic)],
    ["Currency", (b) => b.currency_code],
    ["Total", (b) => b.total_amount],
    ["Paid", (b) => b.paid_amount],
    ["Balance", (b) => Number(b.total_amount) - Number(b.paid_amount)],
    ...(m.limits.hideCosts
      ? []
      : [
          ["Supplier cost", (b) => b.supplier_cost],
          ["Supplier", (b) => b.supplier_name],
        ]),
    ["Supplier ref", (b) => b.supplier_ref],
    ["Channel", (b) => b.channel],
    ["Assigned to", (b) => b.assigned_name],
  ];
  const csv = [cols.map((c) => c[0]).join(","), ...rows.map((b) => cols.map((c) => csvCell(c[1](b))).join(","))].join("\r\n");
  await audit(m.id, "booking.export", "booking", undefined, { tab, rows: rows.length });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sky-bookings-${tab}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + csv);
});

/* ---------- lookups for the forms ---------- */

r.get("/staff", async (req, res) => {
  if (!canAny(req, ["bookings", "enquiries"], "view")) throw new HttpError(403, "Your role does not allow this");
  res.json({
    data: await query(
      `SELECT u.id, u.name, r.name AS role FROM travel.admin_users u JOIN travel.admin_roles r ON r.id = u.role_id WHERE u.is_active ORDER BY u.name`,
    ),
  });
});

/** Catalogue tables per product type; tables built by other areas are used when they exist. */
const PRODUCT_TABLES = {
  hotel: ["hotels"],
  excursion: ["excursions"],
  package: ["packages"],
  umrah: ["umrah_packages", "packages:umrah"],
  transfer: ["transfer_routes"],
  car: ["rental_cars"],
  visa: ["visa_services"],
};

r.get("/products", async (req, res) => {
  if (!canAny(req, ["bookings"], "create") && !canAny(req, ["bookings"], "edit") && !canAny(req, ["enquiries"], "edit"))
    throw new HttpError(403, "Your role does not allow this");
  const type = String(req.query.type ?? "hotel");
  const term = `%${String(req.query.q ?? "").trim()}%`;
  const tables = PRODUCT_TABLES[type] ?? [];
  const out = [];
  for (const spec of tables) {
    const [t, onlyCat] = spec.split(":");
    const cols = await query("SELECT column_name FROM information_schema.columns WHERE table_schema='travel' AND table_name=$1", [
      t,
    ]);
    if (!cols.length) continue;
    const has = (c) => cols.some((x) => x.column_name === c);
    if (t === "visa_services") {
      out.push(
        ...(await query(
          `SELECT v.id, c.name || ' · ' || v.visa_type AS name, v.processing_days AS sub, v.price_from::float AS price
           FROM travel.visa_services v JOIN travel.countries c ON c.iso2 = v.country_iso2
          WHERE c.name || ' ' || v.visa_type ILIKE $1 ORDER BY c.name LIMIT 30`,
          [term],
        )),
      );
      continue;
    }
    const nameCol = has("name")
      ? "name"
      : has("title")
        ? "title"
        : has("from_label")
          ? "from_label || ' → ' || x.to_label"
          : null;
    if (!nameCol) continue;
    const priceCol = has("price_from")
      ? "x.price_from::float"
      : has("with_driver_daily")
        ? "x.with_driver_daily::float"
        : "NULL::float";
    const destJoin = has("destination_id") ? "LEFT JOIN travel.destinations d ON d.id = x.destination_id" : "";
    const sub = has("destination_id") ? "d.name" : has("category") ? "x.category::text" : "NULL";
    out.push(
      ...(await query(
        `SELECT x.id, x.${nameCol} AS name, ${sub} AS sub, ${priceCol} AS price FROM travel.${t} x ${destJoin}
        WHERE x.${nameCol} ILIKE $1 ${onlyCat ? `AND x.category = '${onlyCat}'` : ""} ORDER BY x.${nameCol} LIMIT 30`,
        [term],
      )),
    );
  }
  res.json({ data: out });
});

/* ---------- detail ---------- */

export async function bookingDetail(req, id) {
  const m = me(req);
  const b = await one(
    `SELECT b.*, ${IMAGE_SQL()} AS image, au.name AS assigned_name, cu.name AS created_by_name, nc.name AS nationality_name
       FROM travel.bookings b
       LEFT JOIN travel.admin_users au ON au.id = b.assigned_to
       LEFT JOIN travel.admin_users cu ON cu.id = b.created_by
       LEFT JOIN travel.countries nc ON nc.iso2 = b.lead_nationality
      WHERE b.id = $1`,
    [id],
  );
  if (!b) throw notFound("Booking not found");
  let product = null;
  if (b.product_id && b.product_type === "hotel") {
    product = await one(
      `SELECT h.id, h.name, h.address, h.phone, h.email, to_char(h.check_in_time,'HH24:MI') AS check_in, to_char(h.check_out_time,'HH24:MI') AS check_out,
        d.name AS destination, c.name AS country FROM travel.hotels h LEFT JOIN travel.destinations d ON d.id = h.destination_id LEFT JOIN travel.countries c ON c.iso2 = d.country_iso2 WHERE h.id = $1`,
      [b.product_id],
    );
  } else if (b.product_id && b.product_type === "excursion") {
    product = await one(
      `SELECT x.id, x.title AS name, x.location_label AS address, d.name AS destination, c.name AS country, x.duration_minutes
        FROM travel.excursions x LEFT JOIN travel.destinations d ON d.id = x.destination_id LEFT JOIN travel.countries c ON c.iso2 = d.country_iso2 WHERE x.id = $1`,
      [b.product_id],
    );
  } else if (b.product_id && b.product_type === "package") {
    product = await one(
      `SELECT p.id, p.title AS name, p.itinerary_label AS address,
        (SELECT string_agg(d.name, ', ' ORDER BY pd.position) FROM travel.package_destinations pd JOIN travel.destinations d ON d.id = pd.destination_id WHERE pd.package_id = p.id) AS destination,
        (SELECT string_agg(DISTINCT c.name, ', ') FROM travel.package_destinations pd JOIN travel.destinations d ON d.id = pd.destination_id JOIN travel.countries c ON c.iso2 = d.country_iso2 WHERE pd.package_id = p.id) AS country
        FROM travel.packages p WHERE p.id = $1`,
      [b.product_id],
    );
  }
  const travellers = await query(
    `SELECT t.*, c.name AS nationality_name FROM travel.booking_travellers t LEFT JOIN travel.countries c ON c.iso2 = t.nationality WHERE t.booking_id = $1 ORDER BY t.position, t.full_name`,
    [id],
  );
  const payments = await query(
    `SELECT p.*, vu.name AS verified_by_name, cu.name AS created_by_name FROM travel.booking_payments p
      LEFT JOIN travel.admin_users vu ON vu.id = p.verified_by LEFT JOIN travel.admin_users cu ON cu.id = p.created_by
     WHERE p.booking_id = $1 ORDER BY p.received_at`,
    [id],
  );
  const events = await query(
    `SELECT e.id, e.kind, e.message, e.created_at, u.name AS user_name FROM travel.booking_events e LEFT JOIN travel.admin_users u ON u.id = e.user_id WHERE e.booking_id = $1 ORDER BY e.created_at DESC, e.id DESC`,
    [id],
  );
  const enquiry = b.enquiry_id
    ? await one("SELECT id, name, service, status FROM travel.enquiries WHERE id = $1", [b.enquiry_id])
    : null;

  if (m.limits.hideCosts) {
    delete b.supplier_cost;
    delete b.supplier_name;
  } else b.margin = b.supplier_cost == null ? null : Number(b.total_amount) - Number(b.supplier_cost);
  if (m.limits.maskIds) {
    b.lead_cnic = maskCnic(b.lead_cnic);
    for (const t of travellers) t.passport_no = maskPassport(t.passport_no);
  }
  const st = b.status;
  const canEdit =
    (!m.limits.ownBookingsOnly || b.assigned_to === m.id || b.created_by === m.id) &&
    canAny(req, ["bookings.all", `bookings.${st}`], "edit");
  return {
    ...b,
    product,
    travellers,
    payments,
    events,
    enquiry,
    can: {
      edit: canEdit,
      verify: canEdit || canAny(req, ["payments.verify", "payments.transactions"], "edit"),
      record: canEdit || canAny(req, ["payments.transactions"], "create"),
      refund: canEdit || canAny(req, ["payments.refunds", "bookings.refund"], "edit"),
      voucher: allowed(m, "documents.hotel-voucher") || allowed(m, "documents.transfer-voucher"),
      invoice: allowed(m, "documents.invoice"),
      seeCosts: !m.limits.hideCosts,
    },
  };
}

/* ---------- create ---------- */

const money = z.coerce.number().min(0).max(1e10);
const optText = z
  .string()
  .trim()
  .max(4000)
  .nullish()
  .transform((v) => (v ? v : null));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const bookingFields = {
  product_type: z.enum(TYPES),
  product_id: z.string().uuid().nullish(),
  product_name: z.string().trim().min(1, "Pick or type a product").max(200),
  product_snapshot: z.record(z.string(), z.unknown()).optional(),
  start_date: dateStr,
  end_date: dateStr.nullish(),
  adults: z.coerce.number().int().min(0).max(500),
  children: z.coerce.number().int().min(0).max(500).optional(),
  infants: z.coerce.number().int().min(0).max(500).optional(),
  lead_name: z.string().trim().min(2, "Enter the guest's name").max(120),
  lead_email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email("Enter a valid email").nullable()),
  lead_phone: z.string().trim().min(6, "Enter a phone number").max(40),
  lead_cnic: optText,
  lead_nationality: z
    .string()
    .length(2)
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  currency_code: z.string().length(3).optional(),
  base_amount: money.optional(),
  tax_amount: money.optional(),
  fee_amount: money.optional(),
  discount_amount: money.optional(),
  total_amount: money.optional(),
  supplier_cost: money.nullish(),
  supplier_name: optText,
  supplier_ref: optText,
  payment_method: optText,
  channel: z.string().trim().max(40).optional(),
  assigned_to: z.string().uuid().nullish(),
  special_requests: optText,
  internal_notes: optText,
  cancellation_policy: optText,
};
const createSchema = z.object({ ...bookingFields, status: z.enum(STATUSES).optional(), enquiry_id: z.string().uuid().nullish() });
const patchSchema = z.object(bookingFields).partial();

export async function nextRef(c) {
  const r = await q1(
    c,
    "SELECT nextval('travel.booking_ref_seq')::int AS n, to_char(now() AT TIME ZONE 'Asia/Karachi', 'YY') AS yy",
  );
  return `SKY-${r.yy}-${String(r.n).padStart(5, "0")}`;
}

const totalOf = (d) =>
  d.total_amount && d.total_amount > 0
    ? d.total_amount
    : (d.base_amount ?? 0) + (d.tax_amount ?? 0) + (d.fee_amount ?? 0) - (d.discount_amount ?? 0);

/** Inserts a booking (used by "New booking" and "Convert to booking"). */
export async function createBooking(c, userId, d) {
  if (d.end_date && d.end_date < d.start_date) throw new HttpError(400, "The end date is before the start date");
  const ref = await nextRef(c);
  const row = await q1(
    c,
    `INSERT INTO travel.bookings (ref, product_type, product_id, product_name, product_snapshot, status, start_date, end_date, adults, children, infants,
       lead_name, lead_email, lead_phone, lead_cnic, lead_nationality, currency_code, base_amount, tax_amount, fee_amount, discount_amount, total_amount,
       supplier_cost, supplier_name, supplier_ref, payment_method, channel, assigned_to, enquiry_id, special_requests, internal_notes, cancellation_policy, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
     RETURNING id, ref`,
    [
      ref,
      d.product_type,
      d.product_id ?? null,
      d.product_name,
      JSON.stringify(d.product_snapshot ?? {}),
      d.status ?? "pending",
      d.start_date,
      d.end_date ?? null,
      d.adults,
      d.children ?? 0,
      d.infants ?? 0,
      d.lead_name,
      d.lead_email ?? null,
      d.lead_phone,
      d.lead_cnic ?? null,
      d.lead_nationality ?? null,
      d.currency_code ?? "PKR",
      d.base_amount ?? 0,
      d.tax_amount ?? 0,
      d.fee_amount ?? 0,
      d.discount_amount ?? 0,
      totalOf(d),
      d.supplier_cost ?? null,
      d.supplier_name ?? null,
      d.supplier_ref ?? null,
      d.payment_method ?? null,
      d.channel ?? "phone",
      d.assigned_to ?? null,
      d.enquiry_id ?? null,
      d.special_requests ?? null,
      d.internal_notes ?? null,
      d.cancellation_policy ?? null,
      userId,
    ],
  );
  await addEvent(c, row.id, "created", `Booking created by staff (${d.channel ?? "phone"})`, userId);
  return row;
}

r.post("/", async (req, res) => {
  if (!canAny(req, ["bookings.all", "bookings.pending"], "create"))
    throw new HttpError(403, "Your role does not allow creating bookings");
  const d = parse(createSchema, req.body);
  const m = me(req);
  if (m.limits.hideCosts) {
    d.supplier_cost = null;
  }
  const row = await tx((c) => createBooking(c, m.id, { ...d, status: "pending" }));
  await audit(m.id, "booking.create", "booking", row.id, { ref: row.ref });
  notify(
    req,
    "new_booking",
    `New booking ${row.ref}: ${d.lead_name} · ${d.product_name} (${d.start_date}), PKR ${Math.round(totalOf(d)).toLocaleString("en-US")}, added by ${m.name}`,
    `/admin/bookings/all?open=${row.ref}`,
  );
  res.status(201).json({ data: row });
});

r.get("/:ref", async (req, res) => {
  const b = await loadBooking(req, String(req.params.ref));
  res.json({ data: await bookingDetail(req, b.id) });
});

/* ---------- modify ---------- */

r.patch("/:id", async (req, res) => {
  const b = await loadBooking(req, String(req.params.id), "edit");
  const d = parse(patchSchema, req.body);
  const m = me(req);
  if (m.limits.hideCosts) {
    delete d.supplier_cost;
    delete d.supplier_name;
  }
  if (m.limits.maskIds && d.lead_cnic?.includes("•")) delete d.lead_cnic;
  const sets = [];
  const params = [b.id];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    params.push(k === "product_snapshot" ? JSON.stringify(v) : v);
    sets.push(`${k} = $${params.length}`);
  }
  const amountKeys = ["base_amount", "tax_amount", "fee_amount", "discount_amount"];
  if (d.total_amount === undefined && amountKeys.some((k) => k in d)) {
    sets.push(`total_amount = greatest(base_amount + tax_amount + fee_amount - discount_amount, 0)`);
  }
  if (!sets.length) return res.json({ data: await bookingDetail(req, b.id) });
  await tx(async (c) => {
    // Amount columns referenced in the total expression are the old values, so apply in two steps.
    const plain = sets.filter((s) => !s.startsWith("total_amount = greatest"));
    if (plain.length) await c.query(`UPDATE travel.bookings SET ${plain.join(", ")}, updated_at = now() WHERE id = $1`, params);
    if (plain.length !== sets.length)
      await c.query(
        "UPDATE travel.bookings SET total_amount = greatest(base_amount + tax_amount + fee_amount - discount_amount, 0) WHERE id = $1",
        [b.id],
      );
    const after = await q1(c, "SELECT start_date, end_date FROM travel.bookings WHERE id=$1", [b.id]);
    if (after?.end_date && after.end_date < after.start_date) throw new HttpError(400, "The end date is before the start date");
    await recomputePayment(c, b.id);
    const changed = Object.keys(d).filter((k) => d[k] !== undefined);
    const only = changed.length === 1 ? changed[0] : null;
    if (only !== "internal_notes")
      await addEvent(c, b.id, "edit", `Booking modified: ${changed.map((k) => k.replace(/_/g, " ")).join(", ")}`, m.id);
  });
  await audit(m.id, "booking.update", "booking", b.id, { fields: Object.keys(d) });
  res.json({ data: await bookingDetail(req, b.id) });
});

/* ---------- status ---------- */

r.post("/:id/status", async (req, res) => {
  const { status, note } = parse(z.object({ status: z.enum(STATUSES), note: z.string().max(500).optional() }), req.body);
  const b = await loadBooking(req, String(req.params.id), "edit");
  if (status === "cancelled" || status === "refund") throw new HttpError(400, "Use Cancel & refund to cancel a booking");
  if (b.status === status) return res.json({ data: await bookingDetail(req, b.id) });
  if (!canAny(req, ["bookings.all", `bookings.${status}`], "edit"))
    throw new HttpError(403, "Your role does not allow moving bookings to this status");
  if (b.status === "cancelled" || b.status === "refund")
    throw new HttpError(400, "Cancelled bookings can’t be reopened. Create a new booking instead.");
  const m = me(req);
  await tx(async (c) => {
    await c.query("UPDATE travel.bookings SET status=$2, updated_at=now() WHERE id=$1", [b.id, status]);
    await addEvent(c, b.id, "status", `Status changed to ${STATUS_LABEL[status]}${note ? ` · ${note}` : ""}`, m.id);
  });
  await audit(m.id, "booking.status", "booking", b.id, { from: b.status, to: status });
  res.json({ data: await bookingDetail(req, b.id) });
});

/* ---------- cancel & refund ---------- */

r.post("/:id/cancel", async (req, res) => {
  const d = parse(
    z.object({
      reason: z.string().trim().min(2, "Give a reason").max(500),
      refund_amount: z.coerce.number().min(0).default(0),
      refund_method: z.string().trim().max(40).optional(),
    }),
    req.body,
  );
  const b = await loadBooking(req, String(req.params.id), "edit");
  if (b.status === "cancelled") throw new HttpError(400, "This booking is already cancelled");
  const m = me(req);
  await tx(async (c) => {
    const paid = await q1(c, "SELECT paid_amount::float AS paid, payment_method AS method FROM travel.bookings WHERE id=$1", [
      b.id,
    ]);
    if (d.refund_amount > (paid?.paid ?? 0)) throw new HttpError(400, "The refund is more than the guest has paid");
    const next = d.refund_amount > 0 ? "refund" : "cancelled";
    await c.query("UPDATE travel.bookings SET status=$2, cancelled_at=now(), cancel_reason=$3, updated_at=now() WHERE id=$1", [
      b.id,
      next,
      d.reason,
    ]);
    if (d.refund_amount > 0) {
      await c.query(
        `INSERT INTO travel.booking_payments (booking_id, kind, method, amount, status, note, created_by) VALUES ($1,'refund',$2,$3,'pending',$4,$5)`,
        [b.id, d.refund_method || paid?.method || "bank", d.refund_amount, d.reason, m.id],
      );
    }
    await addEvent(
      c,
      b.id,
      "status",
      `Cancelled: ${d.reason}${d.refund_amount > 0 ? ` · refund PKR ${Math.round(d.refund_amount).toLocaleString("en-US")} due` : ""}`,
      m.id,
    );
    await recomputePayment(c, b.id);
  });
  await audit(m.id, "booking.cancel", "booking", b.id, d);
  notify(
    req,
    "cancellation",
    `Booking ${b.ref} cancelled by ${m.name}: ${d.reason}${d.refund_amount > 0 ? ` · refund PKR ${Math.round(d.refund_amount).toLocaleString("en-US")} due` : ""}`,
    `/admin/bookings/all?open=${b.ref}`,
  );
  res.json({ data: await bookingDetail(req, b.id) });
});

/* ---------- travellers ---------- */

const travellerSchema = z.object({
  title: optText,
  full_name: z.string().trim().min(2, "Enter the traveller's name").max(120),
  kind: z.enum(["adult", "child", "infant"]).default("adult"),
  date_of_birth: dateStr.nullish(),
  nationality: z
    .string()
    .length(2)
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  passport_no: optText,
  passport_expiry: dateStr.nullish(),
  passport_status: z.enum(["missing", "received", "verified"]).default("missing"),
});

r.post("/:id/travellers", async (req, res) => {
  const b = await loadBooking(req, String(req.params.id), "edit");
  const d = parse(travellerSchema, req.body);
  const t = await one(
    `INSERT INTO travel.booking_travellers (booking_id, position, title, full_name, kind, date_of_birth, nationality, passport_no, passport_expiry, passport_status)
    VALUES ($1, (SELECT coalesce(max(position)+1,0) FROM travel.booking_travellers WHERE booking_id=$1), $2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      b.id,
      d.title,
      d.full_name,
      d.kind,
      d.date_of_birth ?? null,
      d.nationality,
      d.passport_no,
      d.passport_expiry ?? null,
      d.passport_status,
    ],
  );
  await query("INSERT INTO travel.booking_events (booking_id, kind, message, user_id) VALUES ($1,'edit',$2,$3)", [
    b.id,
    `Traveller added: ${d.full_name}`,
    me(req).id,
  ]);
  await audit(me(req).id, "booking.traveller.add", "booking", b.id, { traveller: t?.id });
  res.status(201).json({ data: await bookingDetail(req, b.id) });
});

r.patch("/:id/travellers/:tid", async (req, res) => {
  const b = await loadBooking(req, String(req.params.id), "edit");
  const d = parse(travellerSchema.partial(), req.body);
  if (me(req).limits.maskIds && d.passport_no?.includes("•")) delete d.passport_no;
  const sets = [];
  const params = [req.params.tid, b.id];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (sets.length) {
    const u = await query(
      `UPDATE travel.booking_travellers SET ${sets.join(", ")} WHERE id = $1 AND booking_id = $2 RETURNING id`,
      params,
    );
    if (!u.length) throw notFound("Traveller not found");
    await audit(me(req).id, "booking.traveller.update", "booking", b.id, { traveller: req.params.tid, fields: Object.keys(d) });
  }
  res.json({ data: await bookingDetail(req, b.id) });
});

r.delete("/:id/travellers/:tid", async (req, res) => {
  const b = await loadBooking(req, String(req.params.id), "edit");
  const t = await one("DELETE FROM travel.booking_travellers WHERE id = $1 AND booking_id = $2 RETURNING full_name", [
    req.params.tid,
    b.id,
  ]);
  if (!t) throw notFound("Traveller not found");
  await query("INSERT INTO travel.booking_events (booking_id, kind, message, user_id) VALUES ($1,'edit',$2,$3)", [
    b.id,
    `Traveller removed: ${t.full_name}`,
    me(req).id,
  ]);
  await audit(me(req).id, "booking.traveller.delete", "booking", b.id, { name: t.full_name });
  res.json({ data: await bookingDetail(req, b.id) });
});

/* ---------- payments ---------- */

r.post("/:id/payments", async (req, res) => {
  const b = await loadBooking(req, String(req.params.id));
  if (!(mayAct(req, b, "edit") || canAny(req, ["payments.transactions"], "create")))
    throw new HttpError(403, "Your role does not allow recording payments");
  const d = parse(
    z.object({
      method: z.enum(["bank", "card", "wallet", "cash"]),
      provider: optText,
      amount: z.coerce.number().positive("Enter the amount"),
      reference: optText,
      slip_url: optText,
      note: optText,
      verified: z.boolean().default(true),
      received_at: z.string().nullish(),
    }),
    req.body,
  );
  const m = me(req);
  await tx(async (c) => {
    await c.query(
      `INSERT INTO travel.booking_payments (booking_id, kind, method, provider, amount, status, reference, slip_url, note, received_at, verified_by, verified_at, created_by)
      VALUES ($1,'payment',$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now()),$10,$11,$12)`,
      [
        b.id,
        d.method,
        d.provider,
        d.amount,
        d.verified ? "verified" : "pending",
        d.reference,
        d.slip_url,
        d.note,
        d.received_at || null,
        d.verified ? m.id : null,
        d.verified ? new Date() : null,
        m.id,
      ],
    );
    await c.query("UPDATE travel.bookings SET payment_method = coalesce(payment_method, $2) WHERE id = $1", [b.id, d.method]);
    await recomputePayment(c, b.id);
    await addEvent(
      c,
      b.id,
      "payment",
      `${d.verified ? "Payment recorded" : "Payment slip added"}: PKR ${Math.round(d.amount).toLocaleString("en-US")} (${methodLabel(d.method)}${d.provider ? " · " + d.provider : ""})`,
      m.id,
    );
  });
  await audit(m.id, "payment.record", "booking", b.id, { amount: d.amount, method: d.method });
  if (d.verified) await sendReceipt(b.id, d.amount, d.method);
  if (!d.verified)
    notify(
      req,
      "slip_uploaded",
      `Payment slip to verify for ${b.ref}: PKR ${Math.round(d.amount).toLocaleString("en-US")} (${methodLabel(d.method)}${d.provider ? " · " + d.provider : ""})`,
      "/admin/payments/verify",
    );
  res.status(201).json({ data: await bookingDetail(req, b.id) });
});

r.post("/:id/payments/:pid/verify", async (req, res) => {
  const { approve, note } = parse(
    z.object({ approve: z.boolean().default(true), note: z.string().max(500).optional() }),
    req.body,
  );
  const out = await verifyPayment(req, String(req.params.pid), approve, note);
  res.json({ data: await bookingDetail(req, out.booking_id) });
});

r.post("/:id/payments/:pid/refund-paid", async (req, res) => {
  const { reference } = parse(z.object({ reference: z.string().max(120).optional() }), req.body);
  const out = await payRefund(req, String(req.params.pid), reference);
  res.json({ data: await bookingDetail(req, out.booking_id) });
});

/* ---------- email documents ---------- */

r.post("/:id/email", async (req, res) => {
  const b = await loadBooking(req, String(req.params.id));
  const full = await one(
    "SELECT id, ref, lead_name, lead_email, product_name, start_date, end_date, total_amount::float AS total, paid_amount::float AS paid, currency_code FROM travel.bookings WHERE id = $1",
    [b.id],
  );
  if (!full?.lead_email) throw new HttpError(400, "This booking has no guest email. Add one under Modify.");
  const cur = String(full.currency_code ?? "PKR");
  const f = (n) => `${cur} ${Math.round(Number(n)).toLocaleString("en-US")}`;
  const origin = `${req.protocol}://${req.get("host")}`;
  const result = await sendTemplate("booking_confirmed", String(full.lead_email), {
    guest_name: full.lead_name,
    booking_ref: full.ref,
    product_name: full.product_name,
    start_date: full.start_date,
    end_date: full.end_date ?? "",
    total: f(full.total),
    paid: f(full.paid),
    balance: f(Number(full.total) - Number(full.paid)),
    link: `${origin}/admin/bookings/all?open=${full.ref}`,
  });
  if (!result.sent) throw new HttpError(422, result.error || "The email could not be sent");
  await query("INSERT INTO travel.booking_events (booking_id, kind, message, user_id) VALUES ($1,'email',$2,$3)", [
    b.id,
    `Documents emailed to ${full.lead_email}`,
    me(req).id,
  ]);
  await audit(me(req).id, "booking.email", "booking", b.id, { to: full.lead_email });
  res.json({ data: await bookingDetail(req, b.id) });
});

export default r;
