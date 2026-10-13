// Overview: KPIs, revenue chart, service mix, what needs attention, next departures and
// recent activity; plus the rail counts and the Ctrl-K search used by the shell.
import { Router } from "express";
import { allowed } from "../../../shared/admin-nav.js";
import { can, me } from "../../lib/auth.js";
import { query } from "../../lib/db.js";
import { bookingScope, IMAGE_SQL, STATUSES, TODAY } from "./bookings.js";
import { enquiryScope, STAGES } from "./enquiries.js";

const r = Router();

const canSeeBookings = (req) => allowed(me(req), "bookings");
const canSeeEnquiries = (req) => allowed(me(req), "enquiries");

/* ---------- rail counts ---------- */

r.get("/counts", async (req, res) => {
  const m = me(req);
  const out = {};
  if (canSeeBookings(req)) {
    const p = [];
    const rows = await query(
      `SELECT b.status, count(*)::int AS n FROM travel.bookings b WHERE ${bookingScope(req, p)} GROUP BY b.status`,
      p,
    );
    const by = Object.fromEntries(rows.map((x) => [x.status, x.n]));
    const b = {};
    if (allowed(m, "bookings.all")) b.all = rows.reduce((s, x) => s + x.n, 0);
    for (const s of STATUSES) if (allowed(m, `bookings.${s}`)) b[s] = by[s] ?? 0;
    out.bookings = b;
  }
  if (canSeeEnquiries(req)) {
    const p = [];
    const rows = await query(
      `SELECT e.status, count(*)::int AS n FROM travel.enquiries e WHERE ${enquiryScope(req, p)} GROUP BY e.status`,
      p,
    );
    const by = Object.fromEntries(rows.map((x) => [x.status, x.n]));
    const e = {};
    if (allowed(m, "enquiries.board")) e.board = rows.reduce((s, x) => s + x.n, 0);
    for (const s of STAGES) if (allowed(m, `enquiries.${s}`)) e[s] = by[s] ?? 0;
    out.enquiries = e;
  }
  res.json({ data: out });
});

/* ---------- Ctrl-K search ---------- */

const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);

r.get("/search", async (req, res) => {
  const term = String(req.query.q ?? "")
    .trim()
    .slice(0, 80);
  const m = me(req);
  const hits = [];
  if (term.length < 2) return res.json({ data: hits });
  const like = `%${term}%`;
  const digits = term.replace(/\D/g, "").replace(/^0+/, "");
  if (canSeeBookings(req)) {
    const p = [like];
    const sc = bookingScope(req, p);
    p.push(digits.length >= 4 ? `%${digits}%` : "#");
    const dp = p.length;
    const rows = await query(
      `SELECT b.ref, b.lead_name, b.product_name, (b.ref ILIKE $1) AS by_ref
         FROM travel.bookings b
        WHERE ${sc} AND (b.ref ILIKE $1 OR b.lead_name ILIKE $1 OR b.lead_email ILIKE $1 OR regexp_replace(b.lead_phone, '\\D', '', 'g') LIKE $${dp}
              OR EXISTS (SELECT 1 FROM travel.booking_travellers t WHERE t.booking_id = b.id AND t.full_name ILIKE $1))
        ORDER BY b.created_at DESC LIMIT 6`,
      p,
    );
    for (const b of rows) {
      const href = `/admin/bookings/all?open=${b.ref}`;
      hits.push(
        b.by_ref
          ? { type: "Booking", label: b.ref, sub: `${b.lead_name} · ${b.product_name}`, href }
          : { type: "Guest", label: b.lead_name, sub: `${b.ref} · ${b.product_name}`, href },
      );
    }
  }
  if (canSeeEnquiries(req)) {
    const p = [like];
    const rows = await query(
      `SELECT e.id, e.name, e.service, e.status FROM travel.enquiries e WHERE ${enquiryScope(req, p)} AND (e.name ILIKE $1 OR e.phone ILIKE $1 OR e.email ILIKE $1 OR e.message ILIKE $1)
        ORDER BY e.created_at DESC LIMIT 4`,
      p,
    );
    for (const e of rows)
      hits.push({
        type: "Enquiry",
        label: e.name,
        sub: `${cap(e.service)} · ${cap(e.status)}`,
        href: `/admin/enquiries/board?open=${e.id}`,
      });
  }
  if (allowed(m, "hotels")) {
    const rows = await query(
      `SELECT h.id, h.name, d.name AS dest FROM travel.hotels h LEFT JOIN travel.destinations d ON d.id = h.destination_id WHERE h.name ILIKE $1 ORDER BY h.name LIMIT 4`,
      [like],
    );
    for (const h of rows) hits.push({ type: "Hotel", label: h.name, sub: h.dest ?? "Hotel", href: `/admin/hotels/edit/${h.id}` });
  }
  if (allowed(m, "excursions")) {
    const rows = await query(
      `SELECT x.id, x.title, d.name AS dest FROM travel.excursions x LEFT JOIN travel.destinations d ON d.id = x.destination_id WHERE x.title ILIKE $1 ORDER BY x.title LIMIT 4`,
      [like],
    );
    for (const x of rows)
      hits.push({ type: "Excursion", label: x.title, sub: x.dest ?? "Excursion", href: `/admin/excursions/edit/${x.id}` });
  }
  if (allowed(m, "packages")) {
    const rows = await query(`SELECT id, title, category FROM travel.packages WHERE title ILIKE $1 ORDER BY title LIMIT 4`, [
      like,
    ]);
    for (const x of rows)
      hits.push({ type: "Package", label: x.title, sub: x.category, href: `/admin/packages/all?open=${x.id}` });
  }
  res.json({ data: hits });
});

/* ---------- dashboard ---------- */

const LIVE = "b.status NOT IN ('cancelled','refund')";

r.get("/", can("overview.main"), async (req, res) => {
  const m = me(req);
  const range = ["7", "30", "year"].includes(String(req.query.range)) ? String(req.query.range) : "30";
  const seeB = canSeeBookings(req);
  const seeE = canSeeEnquiries(req);
  const p = [];
  const sc = seeB ? bookingScope(req, p) : "false";

  const month = (
    await query(
      `SELECT
      count(*) FILTER (WHERE b.created_at >= date_trunc('month', now()))::int AS bookings,
      count(*) FILTER (WHERE b.created_at >= date_trunc('month', now()) - interval '1 month' AND b.created_at < date_trunc('month', now()))::int AS bookings_prev,
      coalesce(sum(b.total_amount) FILTER (WHERE ${LIVE} AND b.created_at >= date_trunc('month', now())),0)::float AS revenue,
      coalesce(sum(b.total_amount) FILTER (WHERE ${LIVE} AND b.created_at >= date_trunc('month', now()) - interval '1 month' AND b.created_at < date_trunc('month', now())),0)::float AS revenue_prev,
      coalesce(sum(b.total_amount) FILTER (WHERE ${LIVE} AND b.created_at >= date_trunc('month', now()) AND b.supplier_cost IS NOT NULL),0)::float AS costed_total,
      coalesce(sum(b.supplier_cost) FILTER (WHERE ${LIVE} AND b.created_at >= date_trunc('month', now())),0)::float AS cost,
      coalesce(sum(b.total_amount - b.paid_amount) FILTER (WHERE b.status = 'pending'),0)::float AS awaiting,
      count(*) FILTER (WHERE b.status = 'pending')::int AS awaiting_n,
      count(*) FILTER (WHERE b.payment_status = 'verify')::int AS slips
    FROM travel.bookings b WHERE ${sc}`,
      p,
    )
  )[0];

  // Weekly sparklines (last 9 weeks).
  const weeks = await query(
    `SELECT
      count(b.id)::int AS n, coalesce(sum(b.total_amount) FILTER (WHERE ${LIVE}),0)::float AS rev,
      coalesce(sum(b.total_amount - b.paid_amount) FILTER (WHERE b.status = 'pending'),0)::float AS awaiting
    FROM generate_series(date_trunc('week', now()) - interval '8 weeks', date_trunc('week', now()), interval '1 week') w
    LEFT JOIN travel.bookings b ON b.created_at >= w AND b.created_at < w + interval '1 week' AND ${sc}
    GROUP BY w ORDER BY w`,
    p,
  );

  // Revenue chart.
  const series =
    range === "year"
      ? await query(
          `SELECT to_char(g, 'Mon') AS d, coalesce(sum(b.total_amount),0)::float AS v
        FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') g
        LEFT JOIN travel.bookings b ON b.created_at >= g AND b.created_at < g + interval '1 month' AND ${LIVE} AND ${sc}
        GROUP BY g ORDER BY g`,
          p,
        )
      : await query(
          `SELECT to_char(g, 'YYYY-MM-DD') AS d, coalesce(sum(b.total_amount),0)::float AS v
        FROM generate_series(${TODAY} - ${Number(range) - 1}, ${TODAY}, interval '1 day') g
        LEFT JOIN travel.bookings b ON (b.created_at AT TIME ZONE 'Asia/Karachi')::date = g::date AND ${LIVE} AND ${sc}
        GROUP BY g ORDER BY g`,
          p,
        );

  // Mix by service (this month; falls back to the last 90 days when the month is empty).
  let mix = await query(
    `SELECT b.product_type AS type, count(*)::int AS n, sum(b.total_amount)::float AS v
      FROM travel.bookings b WHERE ${LIVE} AND b.created_at >= date_trunc('month', now()) AND ${sc} GROUP BY 1 ORDER BY 3 DESC`,
    p,
  );
  let mixLabel = "This month";
  if (!mix.length) {
    mix = await query(
      `SELECT b.product_type AS type, count(*)::int AS n, sum(b.total_amount)::float AS v
      FROM travel.bookings b WHERE ${LIVE} AND b.created_at >= now() - interval '90 days' AND ${sc} GROUP BY 1 ORDER BY 3 DESC`,
      p,
    );
    mixLabel = "90 days";
  }

  const upcoming = seeB
    ? await query(
        `SELECT b.id, b.ref, b.lead_name, b.product_name, b.product_type, b.start_date, b.end_date, b.status, ${IMAGE_SQL()} AS image
      FROM travel.bookings b WHERE ${sc} AND b.status IN ('pending','supplier','confirmed','travelling') AND coalesce(b.end_date, b.start_date) >= ${TODAY}
      ORDER BY b.start_date LIMIT 5`,
        p,
      )
    : [];

  // Needs you.
  const needs = [];
  const pk = (n) => `PKR ${Math.round(n).toLocaleString("en-US")}`;
  const allSlips = allowed(m, "payments.verify") && !m.limits.ownBookingsOnly;
  const allRefunds = allowed(m, "payments.refunds") && !m.limits.ownBookingsOnly;
  if (seeB || allowed(m, "payments.verify")) {
    const slips = (
      await query(
        `SELECT count(*)::int AS n, coalesce(sum(p.amount),0)::float AS v FROM travel.booking_payments p JOIN travel.bookings b ON b.id = p.booking_id
      WHERE p.kind='payment' AND p.status='pending' AND ${allSlips ? "true" : sc}`,
        allSlips ? [] : p,
      )
    )[0];
    if (slips.n)
      needs.push({
        icon: "shield",
        tone: "p-sig",
        title: `${slips.n} payment slip${slips.n > 1 ? "s" : ""} to verify`,
        sub: `${pk(slips.v)} waiting`,
        href: allowed(m, "payments.verify") ? "/admin/payments/verify" : "/admin/bookings/pending",
      });
  }
  if (seeB) {
    const pass = (
      await query(
        `SELECT count(*) OVER ()::int AS n, b.ref, b.product_name
      FROM travel.booking_travellers t JOIN travel.bookings b ON b.id = t.booking_id
      WHERE t.passport_status = 'missing' AND b.product_type IN ('package','umrah','visa','flight') AND b.status IN ('pending','supplier','confirmed')
        AND b.start_date BETWEEN ${TODAY} AND ${TODAY} + 45 AND ${sc} ORDER BY b.start_date LIMIT 1`,
        p,
      )
    )[0];
    if (pass)
      needs.push({
        icon: "passport",
        tone: "p-warn",
        title: `${pass.n} passport${pass.n > 1 ? "s" : ""} missing for upcoming trips`,
        sub: `Earliest: ${pass.product_name}`,
        href: `/admin/bookings/all?open=${pass.ref}`,
      });
    const sup = (
      await query(
        `SELECT count(*)::int AS n, string_agg(b.product_name, ', ') AS names FROM travel.bookings b WHERE b.status = 'supplier' AND ${sc}`,
        p,
      )
    )[0];
    if (sup.n && allowed(m, "bookings.supplier"))
      needs.push({
        icon: "bed",
        tone: "p-info",
        title: `${sup.n} confirmation${sup.n > 1 ? "s" : ""} pending from supplier`,
        sub: sup.names ?? "",
        href: "/admin/bookings/supplier",
      });
  }
  if (seeB || allowed(m, "payments.refunds")) {
    const refs = await query(
      `SELECT b.ref, p.amount::float AS amount, p.method FROM travel.booking_payments p JOIN travel.bookings b ON b.id = p.booking_id
      WHERE p.kind = 'refund' AND p.status = 'pending' AND ${allRefunds ? "true" : sc} ORDER BY p.created_at LIMIT 2`,
      allRefunds ? [] : p,
    );
    for (const x of refs)
      needs.push({
        icon: "refresh",
        tone: "p-bad",
        title: `Refund due: ${x.ref}`,
        sub: `${pk(x.amount)} by ${{ bank: "bank transfer", card: "card", wallet: "wallet", cash: "cash" }[x.method] ?? x.method}`,
        href: allowed(m, "payments.refunds") ? "/admin/payments/refunds" : `/admin/bookings/all?open=${x.ref}`,
      });
  }
  let enq = { n: 0, old: 0, conv: 0, total: 0 };
  let enqSpark = [];
  if (seeE) {
    const ep = [];
    const es = enquiryScope(req, ep);
    enq = (
      await query(
        `SELECT count(*) FILTER (WHERE e.status='new')::int AS n,
        count(*) FILTER (WHERE e.status='new' AND e.created_at < now() - interval '4 hours')::int AS old,
        count(*) FILTER (WHERE e.status='converted' AND e.created_at > now() - interval '90 days')::int AS conv,
        count(*) FILTER (WHERE e.created_at > now() - interval '90 days')::int AS total
      FROM travel.enquiries e WHERE ${es}`,
        ep,
      )
    )[0];
    enqSpark = (
      await query(
        `SELECT count(e.id)::int AS n FROM generate_series(date_trunc('week', now()) - interval '8 weeks', date_trunc('week', now()), interval '1 week') w
      LEFT JOIN travel.enquiries e ON e.created_at >= w AND e.created_at < w + interval '1 week' AND ${es} GROUP BY w ORDER BY w`,
        ep,
      )
    ).map((x) => x.n);
    if (enq.old && allowed(m, "enquiries.new"))
      needs.push({
        icon: "inbox",
        tone: "p-warn",
        title: `${enq.old} enquir${enq.old > 1 ? "ies" : "y"} waiting longer than 4 hours`,
        sub: "Reply or assign them",
        href: "/admin/enquiries/new",
      });
  }

  // Recent activity.
  const activity = [];
  if (seeB) {
    const ev = await query(
      `SELECT e.kind, e.message, e.created_at, b.ref, b.product_name, b.lead_name FROM travel.booking_events e JOIN travel.bookings b ON b.id = e.booking_id
        WHERE ${sc} ORDER BY e.created_at DESC, e.id DESC LIMIT 8`,
      p,
    );
    for (const e of ev)
      activity.push({
        kind: e.kind,
        title: e.message.split(":")[0],
        sub: `${e.ref} · ${e.message.includes(":") ? e.message.split(":").slice(1).join(":").trim() : e.lead_name}`,
        at: e.created_at,
        href: `/admin/bookings/all?open=${e.ref}`,
      });
  }
  if (seeE) {
    const ep = [];
    const ev = await query(
      `SELECT e.id, e.name, e.service, e.channel, e.created_at FROM travel.enquiries e WHERE ${enquiryScope(req, ep)} ORDER BY e.created_at DESC LIMIT 5`,
      ep,
    );
    for (const e of ev)
      activity.push({
        kind: "enquiry",
        title: `New enquiry from ${e.channel}`,
        sub: `${e.name} · ${e.service}`,
        at: e.created_at,
        href: `/admin/enquiries/board?open=${e.id}`,
      });
  }
  activity.sort((a, b) => +new Date(b.at) - +new Date(a.at));

  res.json({
    data: {
      kpis: {
        bookings: month.bookings,
        bookings_prev: month.bookings_prev,
        revenue: month.revenue,
        revenue_prev: month.revenue_prev,
        margin: m.limits.hideCosts || !month.costed_total ? null : ((month.costed_total - month.cost) / month.costed_total) * 100,
        awaiting: month.awaiting,
        awaiting_n: month.awaiting_n,
        slips: month.slips,
        enquiries_new: enq.n,
        enquiries_old: enq.old,
        conversion: enq.total ? (enq.conv / enq.total) * 100 : null,
      },
      spark: {
        bookings: weeks.map((w) => w.n),
        revenue: weeks.map((w) => w.rev),
        awaiting: weeks.map((w) => w.awaiting),
        enquiries: enqSpark,
      },
      series,
      range,
      mix,
      mixLabel,
      upcoming,
      needs,
      activity: activity.slice(0, 6),
      can: {
        bookings: seeB,
        enquiries: seeE,
        newBooking: allowed(m, "bookings.all", "create") || allowed(m, "bookings.pending", "create"),
      },
    },
  });
});

export default r;
