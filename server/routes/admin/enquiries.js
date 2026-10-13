// Enquiries board: website / WhatsApp / phone / email questions moving through
// New → Contacted → Quoted → Converted / Closed, with notes, replies and conversion to a booking.
import { Router } from "express";
import { z } from "zod";
import { allowed } from "../../../shared/admin-nav.js";
import { audit } from "../../lib/audit.js";
import { canAny, me } from "../../lib/auth.js";
import { one, query, tx } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";
import { sendRaw } from "../../lib/mailer.js";
import { addEvent, createBooking, notify, TYPES } from "./bookings.js";

const r = Router();

export const STAGES = ["new", "contacted", "quoted", "converted", "closed"];

const STAGE_LABEL = { new: "New", contacted: "Contacted", quoted: "Quoted", converted: "Converted", closed: "Closed" };

/** SQL condition limiting enquiries (alias `a`) to the stages this user may see. */
export function enquiryScope(req, params, a = "e") {
  const m = me(req);
  if (allowed(m, "enquiries.board")) return "true";
  params.push(STAGES.filter((s) => allowed(m, `enquiries.${s}`)));
  return `${a}.status = ANY($${params.length})`;
}

const COLS = `e.id, e.service, e.ref_type, e.ref_id, e.name, e.email, e.phone, e.travel_date, e.travellers, e.message, e.status, e.channel,
  e.quote_amount, e.close_reason, e.assigned_to, e.booking_id, e.budget, e.follow_up_at, e.created_at, e.updated_at,
  u.name AS assigned_name, b.ref AS booking_ref`;
const FROM = `travel.enquiries e LEFT JOIN travel.admin_users u ON u.id = e.assigned_to LEFT JOIN travel.bookings b ON b.id = e.booking_id`;

r.get("/", async (req, res) => {
  const tab = String(req.query.tab ?? "board");
  if (tab !== "board" && !STAGES.includes(tab)) throw new HttpError(400, "Unknown tab");
  if (!canAny(req, [`enquiries.${tab}`])) throw new HttpError(403, "Your role does not allow this");
  const params = [];
  const where = [enquiryScope(req, params)];
  if (tab !== "board") {
    params.push(tab);
    where.push(`e.status = $${params.length}`);
  }
  const term = String(req.query.q ?? "").trim();
  if (term) {
    params.push(`%${term}%`);
    where.push(
      `(e.name ILIKE $${params.length} OR e.phone ILIKE $${params.length} OR e.email ILIKE $${params.length} OR e.message ILIKE $${params.length} OR e.service ILIKE $${params.length})`,
    );
  }
  const rows = await query(
    `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(" AND ")} ORDER BY e.created_at DESC LIMIT 500`,
    params,
  );
  res.json({ data: rows });
});

async function loadEnquiry(req, id, action = "view") {
  const e = await one("SELECT id, status, name FROM travel.enquiries WHERE id = $1", [id]);
  if (!e || !canAny(req, ["enquiries.board", `enquiries.${e.status}`])) throw notFound("Enquiry not found");
  if (action === "edit" && !canAny(req, ["enquiries.board", `enquiries.${e.status}`], "edit"))
    throw new HttpError(403, "Your role does not allow changing this enquiry");
  return e;
}

async function detail(req, id) {
  const e = await one(`SELECT ${COLS} FROM ${FROM} WHERE e.id = $1`, [id]);
  if (!e) throw notFound("Enquiry not found");
  let product = null;
  if (e.ref_id && e.ref_type) {
    const t = String(e.ref_type);
    const sql = t.startsWith("hotel")
      ? "SELECT name AS n FROM travel.hotels WHERE id=$1"
      : t.startsWith("excursion")
        ? "SELECT title AS n FROM travel.excursions WHERE id=$1"
        : t.startsWith("package")
          ? "SELECT title AS n FROM travel.packages WHERE id=$1"
          : null;
    if (sql) product = (await one(sql, [e.ref_id]))?.n ?? null;
  }
  const notes = await query(
    `SELECT n.id, n.kind, n.body, n.created_at, u.name AS user_name FROM travel.enquiry_notes n LEFT JOIN travel.admin_users u ON u.id = n.user_id
    WHERE n.enquiry_id = $1 ORDER BY n.created_at DESC, n.id DESC`,
    [id],
  );
  const st = e.status;
  return {
    ...e,
    product,
    notes,
    can: {
      edit: canAny(req, ["enquiries.board", `enquiries.${st}`], "edit"),
      convert:
        canAny(req, ["enquiries.board", `enquiries.${st}`], "edit") &&
        canAny(req, ["bookings.all", "bookings.pending"], "create"),
    },
  };
}

r.get("/:id", async (req, res) => {
  const e = await loadEnquiry(req, String(req.params.id));
  res.json({ data: await detail(req, e.id) });
});

const optText = z
  .string()
  .trim()
  .max(4000)
  .nullish()
  .transform((v) => (v ? v : null));
const fields = {
  service: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2, "Enter the guest's name").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email("Enter a valid email").nullable()),
  phone: z.string().trim().min(6, "Enter a phone number").max(40),
  travel_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .or(z.literal("").transform(() => null)),
  travellers: z.coerce.number().int().min(0).max(1000).nullish(),
  message: optText,
  channel: z.string().trim().max(40).default("phone"),
  quote_amount: z.coerce.number().min(0).nullish(),
  budget: z.coerce.number().min(0).nullish(),
  follow_up_at: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null)),
  close_reason: optText,
  assigned_to: z
    .string()
    .uuid()
    .nullish()
    .or(z.literal("").transform(() => null)),
};

r.post("/", async (req, res) => {
  if (!canAny(req, ["enquiries.board", "enquiries.new"], "create"))
    throw new HttpError(403, "Your role does not allow logging enquiries");
  const d = parse(z.object(fields), req.body);
  const m = me(req);
  const row = await one(
    `INSERT INTO travel.enquiries (service, name, email, phone, travel_date, travellers, message, channel, quote_amount, budget, follow_up_at, assigned_to, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new') RETURNING id`,
    [
      d.service,
      d.name,
      d.email,
      d.phone,
      d.travel_date ?? null,
      d.travellers ?? null,
      d.message,
      d.channel,
      d.quote_amount ?? null,
      d.budget ?? null,
      d.follow_up_at,
      d.assigned_to ?? null,
    ],
  );
  await query("INSERT INTO travel.enquiry_notes (enquiry_id, kind, body, user_id) VALUES ($1,'status',$2,$3)", [
    row.id,
    `Logged by ${m.name} (${d.channel})`,
    m.id,
  ]);
  await audit(m.id, "enquiry.create", "enquiry", row.id, { name: d.name });
  notify(
    req,
    "new_enquiry",
    `New ${d.service} enquiry from ${d.name} (${d.channel}), logged by ${m.name}${d.message ? `: ${d.message.slice(0, 200)}` : ""}`,
    `/admin/enquiries/board?open=${row.id}`,
  );
  res.status(201).json({ data: await detail(req, row.id) });
});

r.patch("/:id", async (req, res) => {
  const e = await loadEnquiry(req, String(req.params.id), "edit");
  const d = parse(z.object({ ...fields, status: z.enum(STAGES) }).partial(), req.body);
  const m = me(req);
  if (d.status && d.status !== e.status) {
    // Moving into a stage needs edit rights there too.
    if (!canAny(req, ["enquiries.board", `enquiries.${d.status}`], "edit"))
      throw new HttpError(403, "Your role does not allow moving enquiries to this stage");
    if (d.status === "converted") {
      const linked = await one("SELECT booking_id FROM travel.enquiries WHERE id=$1", [e.id]);
      if (!linked?.booking_id) throw new HttpError(400, "Use “Convert to booking” to mark an enquiry as converted");
    }
  }
  const sets = [];
  const params = [e.id];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (sets.length) {
    await query(`UPDATE travel.enquiries SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    const notes = [];
    if (d.status && d.status !== e.status)
      notes.push(`Moved to ${STAGE_LABEL[d.status]}${d.status === "closed" && d.close_reason ? ` · ${d.close_reason}` : ""}`);
    if (d.assigned_to !== undefined) {
      const who = d.assigned_to ? (await one("SELECT name FROM travel.admin_users WHERE id=$1", [d.assigned_to]))?.name : null;
      notes.push(who ? `Assigned to ${who}` : "Unassigned");
    }
    if (d.quote_amount != null) notes.push(`Quote set to PKR ${Math.round(d.quote_amount).toLocaleString("en-US")}`);
    for (const n of notes)
      await query("INSERT INTO travel.enquiry_notes (enquiry_id, kind, body, user_id) VALUES ($1,'status',$2,$3)", [
        e.id,
        n,
        m.id,
      ]);
    await audit(m.id, d.status && d.status !== e.status ? "enquiry.stage" : "enquiry.update", "enquiry", e.id, d);
  }
  res.json({ data: await detail(req, e.id) });
});

r.post("/:id/notes", async (req, res) => {
  const e = await loadEnquiry(req, String(req.params.id), "edit");
  const { body } = parse(z.object({ body: z.string().trim().min(1, "Write a note").max(4000) }), req.body);
  await query("INSERT INTO travel.enquiry_notes (enquiry_id, kind, body, user_id) VALUES ($1,'note',$2,$3)", [
    e.id,
    body,
    me(req).id,
  ]);
  await audit(me(req).id, "enquiry.note", "enquiry", e.id);
  res.status(201).json({ data: await detail(req, e.id) });
});

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

r.post("/:id/reply", async (req, res) => {
  const e = await loadEnquiry(req, String(req.params.id), "edit");
  const d = parse(
    z.object({
      body: z.string().trim().min(2, "Write your reply").max(8000),
      subject: z.string().trim().max(200).optional(),
      via: z.enum(["email", "whatsapp"]).default("email"),
    }),
    req.body,
  );
  const m = me(req);
  const full = await one("SELECT email, name, status FROM travel.enquiries WHERE id=$1", [e.id]);
  if (d.via === "email") {
    if (!full?.email) throw new HttpError(400, "This enquiry has no email address. Reply on WhatsApp instead.");
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${escapeHtml(d.body).replace(/\n/g, "<br>")}</div>`;
    const result = await sendRaw(full.email, d.subject || "Your enquiry with Sky Holidays", html);
    if (!result.sent) throw new HttpError(422, result.error || "The email could not be sent");
  }
  await query("INSERT INTO travel.enquiry_notes (enquiry_id, kind, body, user_id) VALUES ($1,'reply',$2,$3)", [
    e.id,
    `${d.via === "email" ? "Email" : "WhatsApp"} reply: ${d.body}`,
    m.id,
  ]);
  if (full?.status === "new") {
    await query("UPDATE travel.enquiries SET status='contacted', updated_at=now() WHERE id=$1", [e.id]);
    await query(
      "INSERT INTO travel.enquiry_notes (enquiry_id, kind, body, user_id) VALUES ($1,'status','Moved to Contacted',$2)",
      [e.id, m.id],
    );
  }
  await audit(m.id, "enquiry.reply", "enquiry", e.id, { via: d.via });
  res.json({ data: await detail(req, e.id) });
});

const SERVICE_TYPE = {
  hotels: "hotel",
  hotel: "hotel",
  excursions: "excursion",
  excursion: "excursion",
  packages: "package",
  package: "package",
  umrah: "umrah",
  transfers: "transfer",
  transfer: "transfer",
  cars: "car",
  "car rental": "car",
  car: "car",
  visa: "visa",
  flights: "flight",
};

r.post("/:id/convert", async (req, res) => {
  const e = await loadEnquiry(req, String(req.params.id), "edit");
  if (!canAny(req, ["bookings.all", "bookings.pending"], "create"))
    throw new HttpError(403, "Your role does not allow creating bookings");
  const d = parse(
    z.object({
      product_type: z.enum(TYPES).optional(),
      product_id: z.string().uuid().nullish(),
      product_name: z.string().trim().max(200).optional(),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullish(),
      adults: z.coerce.number().int().min(0).optional(),
      children: z.coerce.number().int().min(0).optional(),
      total_amount: z.coerce.number().min(0).optional(),
    }),
    req.body ?? {},
  );
  const m = me(req);
  const q = await one("SELECT * FROM travel.enquiries WHERE id=$1", [e.id]);
  if (q.booking_id) throw new HttpError(400, "This enquiry is already linked to a booking");
  const type = d.product_type ?? SERVICE_TYPE[String(q.service).toLowerCase()] ?? "other";
  let productName = d.product_name;
  let productId = d.product_id ?? null;
  if (!productName && q.ref_id) {
    const t = String(q.ref_type ?? "");
    const sql = t.startsWith("hotel")
      ? "SELECT name AS n FROM travel.hotels WHERE id=$1"
      : t.startsWith("excursion")
        ? "SELECT title AS n FROM travel.excursions WHERE id=$1"
        : t.startsWith("package")
          ? "SELECT title AS n FROM travel.packages WHERE id=$1"
          : null;
    if (sql) {
      productName = (await one(sql, [q.ref_id]))?.n;
      productId = productId ?? q.ref_id;
    }
  }
  const start = d.start_date ?? q.travel_date ?? new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const booking = await tx(async (c) => {
    const b = await createBooking(c, m.id, {
      product_type: type,
      product_id: productId,
      product_name: productName || `${String(q.service)} enquiry`,
      product_snapshot: {},
      start_date: start,
      end_date: d.end_date ?? null,
      adults: d.adults ?? Math.max(1, Number(q.travellers ?? 1)),
      children: d.children ?? 0,
      infants: 0,
      lead_name: q.name,
      lead_email: q.email ?? null,
      lead_phone: q.phone,
      lead_cnic: null,
      lead_nationality: null,
      total_amount: d.total_amount ?? Number(q.quote_amount ?? 0),
      base_amount: d.total_amount ?? Number(q.quote_amount ?? 0),
      supplier_name: null,
      supplier_ref: null,
      payment_method: null,
      channel: String(q.channel ?? "website").toLowerCase(),
      assigned_to: q.assigned_to ?? m.id,
      enquiry_id: e.id,
      special_requests: q.message ?? null,
      internal_notes: null,
      cancellation_policy: null,
      status: "pending",
    });
    await c.query("UPDATE travel.enquiries SET status='converted', booking_id=$2, updated_at=now() WHERE id=$1", [e.id, b.id]);
    await c.query("INSERT INTO travel.enquiry_notes (enquiry_id, kind, body, user_id) VALUES ($1,'status',$2,$3)", [
      e.id,
      `Converted to booking ${b.ref}`,
      m.id,
    ]);
    await addEvent(c, b.id, "created", `Converted from enquiry (${q.name})`, m.id);
    return b;
  });
  await audit(m.id, "enquiry.convert", "enquiry", e.id, { booking: booking.ref });
  notify(
    req,
    "new_booking",
    `New booking ${booking.ref} from ${String(q.name)}'s ${String(q.service)} enquiry, converted by ${m.name}`,
    `/admin/bookings/all?open=${booking.ref}`,
  );
  res.status(201).json({ data: { booking, enquiry: await detail(req, e.id) } });
});

export default r;
