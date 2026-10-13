// Documents: data for vouchers, invoices, quotations, visa letters and receipts, the editable
// texts and branding printed on them, saved quotations, and emailing a document to the guest.
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { DEFAULT_BRANDING, DEFAULT_TEXTS } from "../../../shared/doc-defaults.js";
import { assertCan, canAny, me } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { one, query } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";
import { sendTemplate } from "../../lib/mailer.js";
import { getSetting, setSetting } from "../../lib/settings.js";

const r = Router();

export const DOC_TABS = ["hotel-voucher", "transfer-voucher", "invoice", "quotation", "visa-letter", "receipt"];

const DOC_KEYS = DOC_TABS.map((t) => `documents.${t}`);
const anyDoc = (req) => {
  if (!canAny(req, [...DOC_KEYS, "documents.branding"])) throw new HttpError(403, "Your role does not allow this");
};
const tabOf = (v) => (DOC_TABS.includes(String(v)) ? v : null);

export async function loadBranding() {
  const b = await getSetting("branding", {});
  return {
    ...DEFAULT_BRANDING,
    ...b,
    pills: { ...DEFAULT_BRANDING.pills, ...b.pills },
    letterhead_on: { ...DEFAULT_BRANDING.letterhead_on, ...b.letterhead_on },
  };
}
const loadTexts = async () => ({ ...DEFAULT_TEXTS, ...(await getSetting("doc_texts", {})) });

/* ---------- branding, texts, shared config ---------- */

r.get("/config", async (req, res) => {
  anyDoc(req);
  const [branding, texts, business, bank] = await Promise.all([
    loadBranding(),
    loadTexts(),
    getSetting("business", {}),
    one(
      "SELECT bank_name, account_title, account_no, iban, branch FROM travel.payment_bank_accounts WHERE enabled ORDER BY position, created_at LIMIT 1",
    ).catch(() => null),
  ]);
  res.json({ data: { branding, texts, business, bank } });
});

const url = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((s) => s ?? "");
r.put("/branding", async (req, res) => {
  assertCan(req, "documents.branding", "edit");
  const b = parse(
    z.object({
      name: z.string().trim().min(1, "Add the company name").max(60),
      slogan: z.string().trim().max(80),
      phone: z.string().trim().max(40),
      email: z.string().trim().max(120),
      web: z.string().trim().max(120),
      cover_url: url,
      logo_url: url,
      logo_white_url: url,
      lh_header_url: url,
      lh_footer_url: url,
      stamp_url: url,
      pills: z.object({ phone: z.boolean(), email: z.boolean(), web: z.boolean() }),
      letterhead_on: z.object({ invoice: z.boolean(), quotation: z.boolean(), "visa-letter": z.boolean(), receipt: z.boolean() }),
      lh_space_mm: z.coerce.number().min(0).max(60),
      lh_side_mm: z.coerce.number().min(5).max(40),
    }),
    req.body,
  );
  await setSetting("branding", b, me(req).id);
  await audit(me(req).id, "documents.branding", "settings", "branding");
  res.json({ data: b });
});

const TEXT_KEYS = {
  "hotel-voucher": ["hotelInfo", "showHotelContact", "attachVoucher"],
  "transfer-voucher": ["transferInfo"],
  invoice: ["invoiceTerms"],
  quotation: ["quoteTerms", "quoteIncluded"],
  "visa-letter": ["visaBody", "signatory"],
  receipt: ["receiptNote", "signatory"],
};

r.put("/texts/:tab", async (req, res) => {
  const tab = tabOf(req.params.tab);
  if (!tab) throw notFound("Unknown document");
  assertCan(req, `documents.${tab}`, "edit");
  const b = parse(z.record(z.string(), z.union([z.string().max(6000), z.boolean()])), req.body);
  const cur = await loadTexts();
  const next = { ...cur };
  for (const k of TEXT_KEYS[tab]) {
    if (!(k in b)) continue;
    if (typeof DEFAULT_TEXTS[k] !== typeof b[k]) throw new HttpError(400, `${k}: wrong type`);
    next[k] = b[k];
  }
  await setSetting("doc_texts", next, me(req).id);
  await audit(me(req).id, "documents.texts", "settings", tab);
  res.json({ data: next });
});

/* ---------- bookings for the picker and the document data ---------- */

const mask = (v) => {
  if (!v) return v;
  const d = v.replace(/\s/g, "");
  if (/^\d{5}-?\d{7}-?\d$/.test(d)) return `${d.slice(0, 5)}-•••••••-${d.slice(-1)}`;
  return d.length <= 3 ? "•••" : `${d.slice(0, 2)}${"•".repeat(Math.max(3, d.length - 4))}${d.slice(-2)}`;
};

const TYPE_FOR = { "hotel-voucher": "hotel", "transfer-voucher": "transfer" };

r.get("/bookings", async (req, res) => {
  const tab = tabOf(req.query.tab);
  if (tab) assertCan(req, `documents.${tab}`);
  else anyDoc(req);
  const m = me(req);
  const term = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : null;
  const rows = await query(
    `SELECT b.id, b.ref, b.lead_name, b.product_type, b.product_name, b.start_date, b.end_date, b.status, b.payment_status, b.total_amount, b.currency_code
       FROM travel.bookings b
      WHERE ($1::text IS NULL OR b.ref ILIKE '%' || $1 || '%' OR b.lead_name ILIKE '%' || $1 || '%' OR b.product_name ILIKE '%' || $1 || '%' OR b.lead_phone ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR b.product_type = $2 OR ($2 = 'transfer' AND b.product_type IN ('package','umrah')))
        AND (NOT $3::boolean OR b.assigned_to = $4 OR b.created_by = $4)
      ORDER BY b.created_at DESC LIMIT 40`,
    [term, tab ? (TYPE_FOR[tab] ?? null) : null, m.limits.ownBookingsOnly, m.id],
  );
  res.json({ data: rows });
});

r.get("/booking/:id", async (req, res) => {
  const tab = tabOf(req.query.tab);
  if (tab) assertCan(req, `documents.${tab}`);
  else anyDoc(req);
  const m = me(req);
  const b = await one(
    `SELECT b.*, u.name AS assigned_name, c.name AS lead_nationality_name
       FROM travel.bookings b LEFT JOIN travel.admin_users u ON u.id = b.assigned_to LEFT JOIN travel.countries c ON c.iso2 = b.lead_nationality
      WHERE b.id = $1`,
    [req.params.id],
  );
  if (!b) throw notFound("Booking not found");
  if (m.limits.ownBookingsOnly && b.assigned_to !== m.id && b.created_by !== m.id)
    throw new HttpError(403, "This booking is assigned to someone else");
  if (m.limits.hideCosts) {
    delete b.supplier_cost;
  }
  delete b.internal_notes;
  if (m.limits.maskIds) b.lead_cnic = mask(b.lead_cnic);
  const [travellers, payments] = await Promise.all([
    query(
      `SELECT t.id, t.position, t.title, t.full_name, t.kind, t.date_of_birth, t.nationality, c.name AS nationality_name, t.passport_no, t.passport_expiry
         FROM travel.booking_travellers t LEFT JOIN travel.countries c ON c.iso2 = t.nationality WHERE t.booking_id = $1 ORDER BY t.position, t.full_name`,
      [b.id],
    ),
    query(
      `SELECT id, kind, method, provider, amount, currency_code, status, reference, received_at, verified_at
         FROM travel.booking_payments WHERE booking_id = $1 ORDER BY received_at`,
      [b.id],
    ),
  ]);
  if (m.limits.maskIds) for (const t of travellers) t.passport_no = mask(t.passport_no);
  // The hotel row the voucher prints: the booked hotel, or the hotel named in the snapshot (packages, Umrah).
  const snap = b.product_snapshot ?? {};
  const hotelId = b.product_type === "hotel" ? b.product_id : (snap.hotel_id ?? null);
  const hotel = hotelId
    ? await one(
        `SELECT h.id, h.slug, h.name, h.star_rating, h.address, h.description, h.phone, h.email, h.website, h.logo_url, h.voucher_image_url,
                h.image_day_url, h.image_night_url, h.image_url, to_char(h.check_in_time, 'HH24:MI') AS check_in_time, to_char(h.check_out_time, 'HH24:MI') AS check_out_time,
                d.name AS city, co.name AS country
           FROM travel.hotels h LEFT JOIN travel.destinations d ON d.id = h.destination_id LEFT JOIN travel.countries co ON co.iso2 = d.country_iso2
          WHERE h.id = $1`,
        [hotelId],
      ).catch(() => null)
    : null;
  // Destination of the trip (visa letters), from the hotel, excursion or package.
  const dest = hotel
    ? { city: hotel.city, country: hotel.country }
    : await one(
        `SELECT d.name AS city, co.name AS country FROM travel.destinations d JOIN travel.countries co ON co.iso2 = d.country_iso2
          WHERE d.id = COALESCE(
            (SELECT destination_id FROM travel.excursions WHERE id = $1),
            (SELECT destination_id FROM travel.package_destinations WHERE package_id = $1 ORDER BY 1 LIMIT 1))`,
        [b.product_id],
      ).catch(() => null);
  res.json({ data: { booking: b, travellers, payments, hotel, destination: dest } });
});

/* ---------- quotations ---------- */

r.get("/enquiries", async (req, res) => {
  assertCan(req, "documents.quotation");
  const term = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : null;
  const rows = await query(
    `SELECT id, name, phone, email, service, message, travellers, travel_date, status, quote_amount, budget, created_at
       FROM travel.enquiries
      WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%' OR message ILIKE '%' || $1 || '%')
        AND status <> 'closed'
      ORDER BY created_at DESC LIMIT 40`,
    [term],
  );
  res.json({ data: rows });
});

r.get("/quotations", async (req, res) => {
  assertCan(req, "documents.quotation");
  const rows = await query(
    `SELECT q.id, q.number, q.customer_name, q.summary, q.valid_until, q.created_at, q.enquiry_id, u.name AS created_by_name,
            (SELECT max((i->>'price')::numeric) FROM jsonb_array_elements(q.items) i WHERE i->>'price' ~ '^[0-9.]+$') AS top_price
       FROM travel.quotations q LEFT JOIN travel.admin_users u ON u.id = q.created_by ORDER BY q.created_at DESC LIMIT 60`,
  );
  res.json({ data: rows });
});

r.get("/quotations/:id", async (req, res) => {
  assertCan(req, "documents.quotation");
  const row = await one(
    `SELECT q.*, u.name AS created_by_name FROM travel.quotations q LEFT JOIN travel.admin_users u ON u.id = q.created_by WHERE q.id = $1`,
    [req.params.id],
  );
  if (!row) throw notFound("Quotation not found");
  res.json({ data: row });
});

const QuoteBody = z.object({
  enquiry_id: z.uuid().nullable().optional(),
  customer_name: z.string().trim().min(2, "Add who the quote is for").max(120),
  customer_phone: z.string().trim().max(40).nullable().optional(),
  customer_email: z
    .union([z.literal(""), z.email("Check the email address")])
    .nullable()
    .optional(),
  summary: z.string().trim().max(300).nullable().optional(),
  price_label: z.string().trim().max(40).default("Per person"),
  col1_label: z.string().trim().max(40).default("Details"),
  col2_label: z.string().trim().max(40).default(""),
  items: z
    .array(
      z.object({
        title: z.string().trim().max(120),
        details: z.string().trim().max(400),
        details2: z.string().trim().max(400).default(""),
        price: z.coerce.number().min(0).max(1e9),
      }),
    )
    .min(1, "Add at least one option")
    .max(8),
  included: z.string().trim().max(1000).nullable().optional(),
  valid_until: z
    .union([z.literal(""), z.iso.date()])
    .nullable()
    .optional(),
  currency_code: z.string().length(3).default("PKR"),
});

r.post("/quotations", async (req, res) => {
  assertCan(req, "documents.quotation", "create");
  const b = parse(QuoteBody, req.body);
  const row = await one(
    `INSERT INTO travel.quotations (number, enquiry_id, customer_name, customer_phone, customer_email, summary, price_label, items, included, valid_until, currency_code, created_by, col1_label, col2_label)
     VALUES ('QUO-' || to_char(now(), 'YY') || '-' || lpad(nextval('travel.quotation_no_seq')::text, 5, '0'), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      b.enquiry_id ?? null,
      b.customer_name,
      b.customer_phone || null,
      b.customer_email || null,
      b.summary || null,
      b.price_label,
      JSON.stringify(b.items),
      b.included || null,
      b.valid_until || null,
      b.currency_code,
      me(req).id,
      b.col1_label,
      b.col2_label,
    ],
  );
  await audit(me(req).id, "quotation.create", "quotation", row.id, { enquiry_id: b.enquiry_id });
  res.status(201).json({ data: { ...row, created_by_name: me(req).name } });
});

r.put("/quotations/:id", async (req, res) => {
  assertCan(req, "documents.quotation", "edit");
  const b = parse(QuoteBody, req.body);
  const row = await one(
    `UPDATE travel.quotations SET enquiry_id = $2, customer_name = $3, customer_phone = $4, customer_email = $5, summary = $6, price_label = $7,
            items = $8, included = $9, valid_until = $10, currency_code = $11, col1_label = $12, col2_label = $13, updated_at = now() WHERE id = $1 RETURNING *`,
    [
      req.params.id,
      b.enquiry_id ?? null,
      b.customer_name,
      b.customer_phone || null,
      b.customer_email || null,
      b.summary || null,
      b.price_label,
      JSON.stringify(b.items),
      b.included || null,
      b.valid_until || null,
      b.currency_code,
      b.col1_label,
      b.col2_label,
    ],
  );
  if (!row) throw notFound("Quotation not found");
  await audit(me(req).id, "quotation.update", "quotation", String(req.params.id));
  res.json({ data: row });
});

r.delete("/quotations/:id", async (req, res) => {
  assertCan(req, "documents.quotation", "delete");
  const row = await one("DELETE FROM travel.quotations WHERE id = $1 RETURNING id", [req.params.id]);
  if (!row) throw notFound("Quotation not found");
  await audit(me(req).id, "quotation.delete", "quotation", String(req.params.id));
  res.json({ ok: true });
});

/* ---------- email a document ---------- */

const TEMPLATE_FOR = {
  "hotel-voucher": "voucher",
  "transfer-voucher": "voucher",
  invoice: "invoice",
  quotation: "quotation",
  "visa-letter": "visa_letter",
  receipt: "receipt",
};
const fmtMoney = (n, cur = "PKR") => `${cur} ${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) =>
  d
    ? new Date(String(d).length === 10 ? `${d}T00:00:00Z` : String(d)).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

export function siteBase(req) {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  const host = req.get("x-forwarded-host") || req.get("host");
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return `${proto}://${host}`;
}

r.post("/email", async (req, res) => {
  const b = parse(
    z.object({
      tab: z.enum(DOC_TABS),
      booking_id: z.uuid().optional(),
      quotation_id: z.uuid().optional(),
      to: z.email("Enter the guest’s email").optional(),
      title: z.string().trim().min(1).max(160),
      html: z.string().min(100).max(1_800_000),
      amount: z.string().max(60).optional(),
    }),
    req.body,
  );
  assertCan(req, `documents.${b.tab}`, "create");
  let vars = {};
  let to = b.to ?? "";
  if (b.booking_id) {
    const bk = await one("SELECT * FROM travel.bookings WHERE id = $1", [b.booking_id]);
    if (!bk) throw notFound("Booking not found");
    const m = me(req);
    if (m.limits.ownBookingsOnly && bk.assigned_to !== m.id && bk.created_by !== m.id)
      throw new HttpError(403, "This booking is assigned to someone else");
    const cur = String(bk.currency_code || "PKR");
    vars = {
      guest_name: String(bk.lead_name),
      booking_ref: String(bk.ref),
      product_name: String(bk.product_name),
      start_date: fmtDate(bk.start_date),
      end_date: fmtDate(bk.end_date),
      total: fmtMoney(bk.total_amount, cur),
      paid: fmtMoney(bk.paid_amount, cur),
      balance: fmtMoney(Number(bk.total_amount) - Number(bk.paid_amount), cur),
      amount: b.amount ?? "",
    };
    to = to || String(bk.lead_email ?? "");
  } else if (b.quotation_id) {
    const q = await one("SELECT * FROM travel.quotations WHERE id = $1", [b.quotation_id]);
    if (!q) throw notFound("Quotation not found");
    vars = { guest_name: String(q.customer_name), quote_no: String(q.number), valid_until: fmtDate(q.valid_until) };
    to = to || String(q.customer_email ?? "");
  } else throw new HttpError(400, "Pick a booking or save the quotation first");
  if (!to) throw new HttpError(400, "This guest has no email address. Type one in to send it.");
  const token = randomBytes(18).toString("base64url");
  await query(
    "INSERT INTO travel.document_shares (token, doc_type, booking_id, quotation_id, title, html, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [token, b.tab, b.booking_id ?? null, b.quotation_id ?? null, b.title, b.html, me(req).id],
  );
  const link = `${siteBase(req)}/api/docs/${token}`;
  const file = `${b.title.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-")}.html`;
  const result = await sendTemplate(TEMPLATE_FOR[b.tab], to, { ...vars, link }, [
    { filename: file, content: b.html, contentType: "text/html; charset=utf-8" },
  ]);
  if (b.booking_id) {
    await query("INSERT INTO travel.booking_events (booking_id, kind, message, user_id) VALUES ($1,'email',$2,$3)", [
      b.booking_id,
      result.sent ? `${b.title} emailed to ${to}` : `${b.title} email failed: ${result.error}`,
      me(req).id,
    ]).catch(() => {});
  }
  await audit(me(req).id, "document.email", b.booking_id ? "booking" : "quotation", b.booking_id ?? b.quotation_id, {
    tab: b.tab,
    to,
    sent: result.sent,
  });
  if (!result.sent) throw new HttpError(502, result.error ?? "The email could not be sent");
  res.json({ data: { sent: true, to, link } });
});

export default r;

/**
 * Public route for links in emailed documents: GET /api/docs/:token returns the saved page.
 * Mount outside /api/admin (no sign-in): app.use("/api/docs", publicDocs).
 */
export const publicDocs = Router();
publicDocs.get("/:token", async (req, res) => {
  const row = await one("SELECT html FROM travel.document_shares WHERE token = $1 AND expires_at > now()", [req.params.token]);
  if (!row) {
    res
      .status(404)
      .type("html")
      .send(
        "<!doctype html><title>Link expired</title><p style='font-family:sans-serif;padding:40px'>This document link has expired. Please contact Sky Holidays on +92 311 11 33 020.</p>",
      );
    return;
  }
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src * data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
  );
  res.setHeader("X-Robots-Tag", "noindex");
  res.type("html").send(row.html);
});
