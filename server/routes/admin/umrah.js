// Umrah: flexible any-date packages (tiers, hotel choices, rules, live price example),
// group departures (fixed dates of Umrah packages) and Makkah & Madinah hotel rates.
import { Router } from "express";

import { z } from "zod";
import { assertCan, canAny, me } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { clearCatalogCache } from "../../lib/cache.js";
import { one, query, tx } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";

const r = Router();

const money = z.coerce.number().min(0).max(1e9);
const optMoney = z
  .union([money, z.null()])
  .optional()
  .transform((v) => v ?? null);
const optText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null));
const SHARING = ["quad", "triple", "double", "single"];

/** "+92 300 5551201" → "+92 3•• ••••201": keeps the first three and last three digits. */
const maskPhone = (p) => {
  if (!p) return p;
  const n = p.replace(/\D/g, "").length;
  let i = 0;
  return p.replace(/\d/g, (d) => (i++ < 3 || i > n - 3 ? d : "•"));
};

/* ---------------- pricing ---------------- */

/** Rate for a night: a season covering the date wins, else the base rate (no dates). */
async function rateFor(hotelId, date, sharing) {
  const rows = await query(
    `SELECT * FROM travel.umrah_hotel_rates WHERE hotel_id = $1
      ORDER BY (starts_on IS NULL), starts_on DESC`,
    [hotelId],
  );
  const hit =
    (date && rows.find((x) => x.starts_on && x.ends_on && x.starts_on <= date && date <= x.ends_on)) ||
    rows.find((x) => !x.starts_on);
  return { rate: hit ? hit[sharing] : null, season: hit?.season ?? null };
}

const quoteBody = z.object({
  package_id: z.uuid(),
  date: z.iso.date().nullish(),
  sharing: z.enum(SHARING).default("quad"),
  guests: z.coerce.number().int().min(1).max(60).default(1),
  makkah_hotel_id: z.uuid().nullish(),
  makkah_nights: z.coerce.number().int().min(0).max(60).default(0),
  madinah_hotel_id: z.uuid().nullish(),
  madinah_nights: z.coerce.number().int().min(0).max(60).default(0),
  ziyarat: z.boolean().default(false),
  ramadan: z.boolean().default(false),
  madinah_first: z.boolean().default(false),
});

async function quote(q) {
  const p = await one("SELECT * FROM travel.umrah_packages WHERE id = $1", [q.package_id]);
  if (!p) throw notFound("Package not found");
  const lines = [];
  const warnings = [];
  const ramadan = p.kind === "ramadan" || q.ramadan;
  const up = ramadan ? 1 + Number(p.ramadan_uplift_pct) / 100 : 1;
  if (p.kind !== "visa_transport") {
    const total = q.makkah_nights + q.madinah_nights;
    if (total < p.min_total_nights) warnings.push(`At least ${p.min_total_nights} nights in total`);
    if (q.makkah_nights < p.min_makkah_nights) warnings.push(`At least ${p.min_makkah_nights} nights in Makkah`);
    if (q.madinah_nights < p.min_madinah_nights) warnings.push(`At least ${p.min_madinah_nights} nights in Madinah`);
    if (q.madinah_first && !p.madinah_first) warnings.push("This package starts in Makkah");
    const allowed = new Set(
      (await query("SELECT hotel_id FROM travel.umrah_package_hotels WHERE umrah_package_id = $1", [p.id])).map(
        (x) => x.hotel_id,
      ),
    );
    const mkFirst = !q.madinah_first;
    const mkDate = q.date ?? null;
    const mdDate = q.date ? addDays(q.date, mkFirst ? q.makkah_nights : 0) : null;
    for (const [city, hid, n, d] of [
      ["Makkah", q.makkah_hotel_id, q.makkah_nights, mkFirst ? mkDate : addDaysN(q.date, q.madinah_nights)],
      ["Madinah", q.madinah_hotel_id, q.madinah_nights, mdDate],
    ]) {
      if (!n) continue;
      if (!hid) {
        warnings.push(`Choose a ${city} hotel`);
        continue;
      }
      if (allowed.size && !allowed.has(hid)) warnings.push(`That ${city} hotel isn’t offered in this package`);
      const h = await one("SELECT name FROM travel.hotels WHERE id = $1", [hid]);
      const { rate, season } = await rateFor(hid, d ?? null, q.sharing);
      if (rate == null) {
        warnings.push(`${h?.name ?? city} has no ${q.sharing} rate`);
        continue;
      }
      const each = Math.round(rate * up);
      lines.push({
        label: `${city} hotel, ${h?.name ?? ""} ${n} × ${each.toLocaleString("en-US")}${season && season !== "Base rate" ? ` (${season})` : ""}${ramadan && up !== 1 ? " incl. Ramadan" : ""}`,
        amount: each * n,
      });
    }
  }
  if (p.visa_included || p.kind === "visa_transport") lines.push({ label: "Umrah visa", amount: Number(p.visa_price) });
  if (p.transport_included || p.kind === "visa_transport")
    lines.push({ label: `Transport${p.transport_label ? ", " + p.transport_label : ""}`, amount: Number(p.transport_price) });
  if (q.ziyarat && p.ziyarat_optional) lines.push({ label: "Ziyarat", amount: Number(p.ziyarat_price) });
  if (Number(p.service_fee)) lines.push({ label: "Service fee", amount: Number(p.service_fee) });
  if (q.date) {
    const lead = Math.floor((Date.parse(q.date) - Date.now()) / 864e5);
    if (lead < p.lead_days) warnings.push(`Book at least ${p.lead_days} days before travel`);
  }
  const perPerson = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, perPerson, total: perPerson * q.guests, currency: p.currency_code, warnings };
}
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const addDaysN = (d, n) => (d ? addDays(d, n) : null);

/** "From, per person (quad)": cheapest chosen hotels at the minimum stay. */
async function computeFrom(c, id) {
  const run = c ? (t, v) => c.query(t, v).then((x) => x.rows) : query;
  const [p] = await run("SELECT * FROM travel.umrah_packages WHERE id = $1", [id]);
  if (!p) return;
  let from =
    Number(p.service_fee) +
    (p.visa_included || p.kind === "visa_transport" ? Number(p.visa_price) : 0) +
    (p.transport_included || p.kind === "visa_transport" ? Number(p.transport_price) : 0);
  if (p.kind !== "visa_transport") {
    const mins = await run(
      `SELECT uh.city, min(r.quad) AS quad FROM travel.umrah_package_hotels ph
         JOIN travel.umrah_hotels uh ON uh.hotel_id = ph.hotel_id
         JOIN travel.umrah_hotel_rates r ON r.hotel_id = uh.hotel_id AND r.starts_on IS NULL
        WHERE ph.umrah_package_id = $1 GROUP BY uh.city`,
      [id],
    );
    const mk = Math.max(p.min_makkah_nights, p.min_total_nights - p.min_madinah_nights);
    const md = Math.max(p.min_madinah_nights, p.min_total_nights - mk);
    const up = p.kind === "ramadan" ? 1 + Number(p.ramadan_uplift_pct) / 100 : 1;
    const rate = (city) => Number(mins.find((m) => m.city === city)?.quad ?? 0);
    from += Math.round(rate("makkah") * up) * mk + Math.round(rate("madinah") * up) * md;
  }
  await run("UPDATE travel.umrah_packages SET price_from = $2 WHERE id = $1", [id, from]);
}
async function recomputeAll() {
  for (const { id } of await query("SELECT id FROM travel.umrah_packages")) await computeFrom(null, id);
}

/* ---------------- flexible packages ---------------- */

r.get("/flexible", async (req, res) => {
  assertCan(req, "umrah.flexible", "view");
  const rows = await query(
    `SELECT p.*, COALESCE(array_agg(ph.hotel_id) FILTER (WHERE ph.hotel_id IS NOT NULL), '{}') AS hotel_ids
       FROM travel.umrah_packages p LEFT JOIN travel.umrah_package_hotels ph ON ph.umrah_package_id = p.id
      GROUP BY p.id ORDER BY p.sort_order, p.created_at`,
  );
  res.json({ data: rows });
});

const flexBody = z.object({
  title: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, numbers and dashes")
    .max(100),
  kind: z.enum(["flexible", "visa_transport", "ramadan"]),
  tier: z
    .enum(["economy", "standard", "premium"])
    .nullish()
    .transform((v) => v ?? null),
  hotels_note: optText,
  summary: optText,
  image_day_url: optText,
  image_night_url: optText,
  min_total_nights: z.coerce.number().int().min(0).max(60),
  min_makkah_nights: z.coerce.number().int().min(0).max(60),
  min_madinah_nights: z.coerce.number().int().min(0).max(60),
  lead_days: z.coerce.number().int().min(0).max(365),
  ramadan_uplift_pct: z.coerce.number().min(0).max(500),
  flights: z.enum(["quoted", "own", "either"]),
  visa_included: z.boolean(),
  transport_included: z.boolean(),
  ziyarat_optional: z.boolean(),
  madinah_first: z.boolean(),
  visa_price: money,
  transport_price: money,
  transport_label: optText,
  ziyarat_price: money,
  service_fee: money,
  currency_code: z.string().trim().length(3).default("PKR"),
  is_live: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
  hotel_ids: z.array(z.uuid()).max(100).default([]),
});
const FLEX_COLS = [
  "title",
  "slug",
  "kind",
  "tier",
  "hotels_note",
  "summary",
  "image_day_url",
  "image_night_url",
  "min_total_nights",
  "min_makkah_nights",
  "min_madinah_nights",
  "lead_days",
  "ramadan_uplift_pct",
  "flights",
  "visa_included",
  "transport_included",
  "ziyarat_optional",
  "madinah_first",
  "visa_price",
  "transport_price",
  "transport_label",
  "ziyarat_price",
  "service_fee",
  "currency_code",
  "is_live",
  "sort_order",
];

async function saveFlexHotels(c, id, ids) {
  await c.query("DELETE FROM travel.umrah_package_hotels WHERE umrah_package_id = $1", [id]);
  for (const h of new Set(ids))
    await c.query("INSERT INTO travel.umrah_package_hotels (umrah_package_id, hotel_id) VALUES ($1,$2)", [id, h]);
}

r.post("/flexible", async (req, res) => {
  assertCan(req, "umrah.flexible", "create");
  const b = parse(flexBody, req.body);
  const id = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO travel.umrah_packages (${FLEX_COLS.join(",")}) VALUES (${FLEX_COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      FLEX_COLS.map((k) => b[k]),
    );
    await saveFlexHotels(c, rows[0].id, b.hotel_ids);
    await computeFrom(c, rows[0].id);
    return rows[0].id;
  });
  await audit(me(req).id, "umrah_package.create", "umrah_package", id, { title: b.title });
  await clearCatalogCache();
  res.status(201).json({ data: { id } });
});

r.put("/flexible/:id", async (req, res) => {
  assertCan(req, "umrah.flexible", "edit");
  const b = parse(flexBody, req.body);
  await tx(async (c) => {
    const { rowCount } = await c.query(
      `UPDATE travel.umrah_packages SET ${FLEX_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
      [req.params.id, ...FLEX_COLS.map((k) => b[k])],
    );
    if (!rowCount) throw notFound("Package not found");
    await saveFlexHotels(c, req.params.id, b.hotel_ids);
    await computeFrom(c, req.params.id);
  });
  await audit(me(req).id, "umrah_package.update", "umrah_package", req.params.id, { title: b.title });
  await clearCatalogCache();
  res.json({ data: { id: req.params.id } });
});

/** Rules panel and the Live switch save only what they change. */
r.patch("/flexible/:id", async (req, res) => {
  assertCan(req, "umrah.flexible", "edit");
  const b = parse(flexBody.omit({ hotel_ids: true }).partial(), req.body);
  // Only keys the caller sent (defaults in the schema must not overwrite other fields).
  const sent = new Set(Object.keys(req.body ?? {}));
  const entries = Object.entries(b).filter(([k, v]) => v !== undefined && sent.has(k));
  if (!entries.length) throw new HttpError(400, "Nothing to change");
  const row = await one(
    `UPDATE travel.umrah_packages SET ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`,
    [req.params.id, ...entries.map(([, v]) => v)],
  );
  if (!row) throw notFound("Package not found");
  await computeFrom(null, req.params.id);
  await audit(me(req).id, "umrah_package.update", "umrah_package", req.params.id, b);
  await clearCatalogCache();
  res.json({ data: await one("SELECT * FROM travel.umrah_packages WHERE id = $1", [req.params.id]) });
});

r.delete("/flexible/:id", async (req, res) => {
  assertCan(req, "umrah.flexible", "delete");
  const row = await one("DELETE FROM travel.umrah_packages WHERE id = $1 RETURNING title", [req.params.id]);
  if (!row) throw notFound("Package not found");
  await audit(me(req).id, "umrah_package.delete", "umrah_package", req.params.id, row);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

r.post("/quote", async (req, res) => {
  assertCan(req, "umrah.flexible", "view");
  res.json({ data: await quote(parse(quoteBody, req.body)) });
});

/* ---------------- group departures ---------------- */

const GROUP_SQL = `
  SELECT d.*, p.title AS package_title, p.slug AS package_slug, p.nights AS package_nights,
         (SELECT count(*) FROM travel.bookings b WHERE b.product_snapshot->>'departure_id' = d.id::text AND b.status <> 'cancelled') AS bookings,
         (SELECT count(*) FROM travel.booking_travellers t JOIN travel.bookings b ON b.id = t.booking_id
           WHERE b.product_snapshot->>'departure_id' = d.id::text AND b.status <> 'cancelled' AND t.passport_status = 'missing') AS passports_missing
    FROM travel.package_departures d JOIN travel.packages p ON p.id = d.package_id
   WHERE p.category = 'umrah'`;

r.get("/groups", async (req, res) => {
  assertCan(req, "umrah.groups", "view");
  const past = req.query.past === "1";
  const rows = await query(
    `${GROUP_SQL} AND ${past ? "d.depart_date < current_date" : "d.depart_date >= current_date - 30"} ORDER BY d.depart_date`,
  );
  const packages = await query(
    "SELECT id, title, nights, price_from FROM travel.packages WHERE category = 'umrah' ORDER BY title",
  );
  const masked = me(req).limits.maskIds;
  res.json({ data: { rows: masked ? rows.map((x) => ({ ...x, leader_phone: maskPhone(x.leader_phone) })) : rows, packages } });
});

const groupBody = z
  .object({
    package_id: z.uuid(),
    depart_date: z.iso.date(),
    return_date: z.iso
      .date()
      .nullish()
      .transform((v) => v ?? null),
    departure_city: optText,
    airline: optText,
    flight_no: optText,
    route: optText,
    seats_total: z.coerce.number().int().min(0).max(5000),
    seats_sold: z.coerce.number().int().min(0).max(5000),
    price_quad: optMoney,
    price_triple: optMoney,
    price_double: optMoney,
    currency_code: z.string().trim().length(3).default("PKR"),
    group_leader: optText,
    leader_phone: optText,
    visa_status: z.enum(["not_started", "filing_open", "passports_missing", "submitted", "approved"]),
    visa_note: optText,
    status: z.enum(["open", "full", "closed", "departed", "cancelled"]).default("open"),
    notes: optText,
  })
  .refine((b) => !b.return_date || b.return_date >= b.depart_date, {
    message: "Return date is before departure",
    path: ["return_date"],
  })
  .refine((b) => b.seats_sold <= b.seats_total, { message: "More seats booked than in total", path: ["seats_sold"] });
const GROUP_COLS = [
  "package_id",
  "depart_date",
  "return_date",
  "departure_city",
  "airline",
  "flight_no",
  "route",
  "seats_total",
  "seats_sold",
  "price_quad",
  "price_triple",
  "price_double",
  "currency_code",
  "group_leader",
  "leader_phone",
  "visa_status",
  "visa_note",
  "status",
  "notes",
];

async function assertUmrahPackage(id) {
  const p = await one("SELECT 1 FROM travel.packages WHERE id = $1 AND category = 'umrah'", [id]);
  if (!p) throw new HttpError(400, "Pick an Umrah package");
}

r.post("/groups", async (req, res) => {
  assertCan(req, "umrah.groups", "create");
  const b = parse(groupBody, req.body);
  await assertUmrahPackage(b.package_id);
  const row = await one(
    `INSERT INTO travel.package_departures (${GROUP_COLS.join(",")}, price_override) VALUES (${GROUP_COLS.map((_, i) => `$${i + 1}`).join(",")}, $${GROUP_COLS.length + 1}) RETURNING id`,
    [...GROUP_COLS.map((k) => b[k]), b.price_quad],
  );
  await audit(me(req).id, "umrah_group.create", "package_departure", row.id, { date: b.depart_date });
  await clearCatalogCache();
  res.status(201).json({ data: row });
});

r.put("/groups/:id", async (req, res) => {
  assertCan(req, "umrah.groups", "edit");
  const b = parse(groupBody, req.body);
  await assertUmrahPackage(b.package_id);
  if (me(req).limits.maskIds && b.leader_phone?.includes("•")) {
    const cur = await one("SELECT leader_phone FROM travel.package_departures WHERE id = $1", [req.params.id]);
    b.leader_phone = cur?.leader_phone ?? null;
  }
  const row = await one(
    `UPDATE travel.package_departures SET ${GROUP_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, price_override = $${GROUP_COLS.length + 2}, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [req.params.id, ...GROUP_COLS.map((k) => b[k]), b.price_quad],
  );
  if (!row) throw notFound("Departure not found");
  await audit(me(req).id, "umrah_group.update", "package_departure", req.params.id, { date: b.depart_date, visa: b.visa_status });
  await clearCatalogCache();
  res.json({ data: row });
});

r.delete("/groups/:id", async (req, res) => {
  assertCan(req, "umrah.groups", "delete");
  const row = await one("DELETE FROM travel.package_departures WHERE id = $1 RETURNING depart_date", [req.params.id]);
  if (!row) throw notFound("Departure not found");
  await audit(me(req).id, "umrah_group.delete", "package_departure", req.params.id, row);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

/** Travellers booked on a departure, with passport progress. */
r.get("/groups/:id/manifest", async (req, res) => {
  assertCan(req, "umrah.groups", "view");
  const g = await one(`${GROUP_SQL} AND d.id = $1`, [req.params.id]);
  if (!g) throw notFound("Departure not found");
  const rows = await query(
    `SELECT b.id AS booking_id, b.ref, b.status, b.lead_name, b.lead_phone, b.product_snapshot->>'sharing' AS sharing,
            t.full_name, t.kind, t.passport_no, t.passport_expiry, t.passport_status, t.nationality
       FROM travel.bookings b LEFT JOIN travel.booking_travellers t ON t.booking_id = b.id
      WHERE b.product_snapshot->>'departure_id' = $1 AND b.status <> 'cancelled'
      ORDER BY b.created_at, t.position`,
    [req.params.id],
  );
  const mask = me(req).limits.maskIds;
  res.json({
    data: {
      group: mask ? { ...g, leader_phone: maskPhone(g.leader_phone) } : g,
      travellers: mask
        ? rows.map((x) => ({
            ...x,
            passport_no: x.passport_no ? x.passport_no.slice(0, 2) + "•••••" + x.passport_no.slice(-2) : null,
            lead_phone: maskPhone(x.lead_phone),
          }))
        : rows,
    },
  });
});

/* ---------------- Makkah & Madinah hotels ---------------- */

r.get("/hotels", async (req, res) => {
  if (!canAny(req, ["umrah.hotels", "umrah.flexible"], "view")) throw new HttpError(403, "Your role does not allow this");
  const rows = await query(
    `SELECT uh.*, h.name, h.star_rating, h.image_day_url, h.image_url, h.status AS hotel_status,
            COALESCE((SELECT json_agg(r ORDER BY r.starts_on NULLS FIRST) FROM travel.umrah_hotel_rates r WHERE r.hotel_id = uh.hotel_id), '[]') AS rates,
            (SELECT count(*) FROM travel.umrah_package_hotels ph WHERE ph.hotel_id = uh.hotel_id) AS packages
       FROM travel.umrah_hotels uh JOIN travel.hotels h ON h.id = uh.hotel_id
      ORDER BY (uh.city = 'madinah'), uh.sort_order, h.name`,
  );
  res.json({ data: rows });
});

/** Hotels in Makkah or Madinah destinations not yet set up for Umrah. */
r.get("/hotels/candidates", async (req, res) => {
  assertCan(req, "umrah.hotels", "create");
  res.json({
    data: await query(
      `SELECT h.id, h.name, h.star_rating, d.slug AS city FROM travel.hotels h JOIN travel.destinations d ON d.id = h.destination_id
        WHERE d.slug IN ('makkah','madinah') AND NOT EXISTS (SELECT 1 FROM travel.umrah_hotels u WHERE u.hotel_id = h.id)
        ORDER BY d.slug, h.name`,
    ),
  });
});

const rateRow = z
  .object({
    season: z.string().trim().min(1).max(60).default("Base rate"),
    starts_on: z.iso
      .date()
      .nullish()
      .transform((v) => v ?? null),
    ends_on: z.iso
      .date()
      .nullish()
      .transform((v) => v ?? null),
    quad: optMoney,
    triple: optMoney,
    double: optMoney,
    single: optMoney,
  })
  .refine((x) => (x.starts_on == null) === (x.ends_on == null), {
    message: "A season needs both a start and an end date",
    path: ["starts_on"],
  })
  .refine((x) => !x.starts_on || !x.ends_on || x.ends_on >= x.starts_on, {
    message: "Season ends before it starts",
    path: ["ends_on"],
  });
const hotelBody = z
  .object({
    hotel_id: z.uuid().nullish(),
    name: z.string().trim().min(2).max(200).nullish(),
    star_rating: z.coerce.number().int().min(1).max(5).nullish(),
    city: z.enum(["makkah", "madinah"]),
    distance_m: z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .nullish()
      .transform((v) => v ?? null),
    distance_label: optText,
    is_live: z.boolean().default(true),
    sort_order: z.coerce.number().int().default(0),
    rates: z.array(rateRow).max(30).default([]),
  })
  .refine((b) => b.hotel_id || b.name, { message: "Pick a hotel or type a new hotel name", path: ["name"] })
  .refine((b) => b.rates.filter((x) => !x.starts_on).length <= 1, {
    message: "Only one base rate (without dates)",
    path: ["rates"],
  });

async function saveRates(c, hotelId, rates) {
  await c.query("DELETE FROM travel.umrah_hotel_rates WHERE hotel_id = $1", [hotelId]);
  for (const x of rates) {
    await c.query(
      "INSERT INTO travel.umrah_hotel_rates (hotel_id, season, starts_on, ends_on, quad, triple, double, single) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [hotelId, x.season, x.starts_on, x.ends_on, x.quad, x.triple, x.double, x.single],
    );
  }
}

r.post("/hotels", async (req, res) => {
  assertCan(req, "umrah.hotels", "create");
  const b = parse(hotelBody, req.body);
  const hotelId = await tx(async (c) => {
    let id = b.hotel_id ?? null;
    if (!id) {
      // A new hotel row, kept as a draft in the Hotels catalogue until someone completes it.
      const d = await c.query("SELECT id FROM travel.destinations WHERE slug = $1", [b.city]);
      const ins = await c.query(
        "INSERT INTO travel.hotels (name, star_rating, destination_id, kind, status) VALUES ($1,$2,$3,'Umrah hotel','draft') RETURNING id",
        [b.name, b.star_rating ?? null, d.rows[0]?.id ?? null],
      );
      id = ins.rows[0].id;
    } else if (b.star_rating) {
      await c.query("UPDATE travel.hotels SET star_rating = $2 WHERE id = $1", [id, b.star_rating]);
    }
    await c.query(
      "INSERT INTO travel.umrah_hotels (hotel_id, city, distance_m, distance_label, is_live, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, b.city, b.distance_m, b.distance_label, b.is_live, b.sort_order],
    );
    await saveRates(c, id, b.rates);
    return id;
  });
  await recomputeAll();
  await audit(me(req).id, "umrah_hotel.create", "hotel", hotelId, { city: b.city });
  await clearCatalogCache();
  res.status(201).json({ data: { hotel_id: hotelId } });
});

r.put("/hotels/:hotelId", async (req, res) => {
  assertCan(req, "umrah.hotels", "edit");
  const b = parse(hotelBody, { ...req.body, hotel_id: req.params.hotelId });
  await tx(async (c) => {
    const { rowCount } = await c.query(
      "UPDATE travel.umrah_hotels SET city=$2, distance_m=$3, distance_label=$4, is_live=$5, sort_order=$6, updated_at=now() WHERE hotel_id=$1",
      [req.params.hotelId, b.city, b.distance_m, b.distance_label, b.is_live, b.sort_order],
    );
    if (!rowCount) throw notFound("Hotel not found");
    if (b.star_rating)
      await c.query("UPDATE travel.hotels SET star_rating = $2 WHERE id = $1", [req.params.hotelId, b.star_rating]);
    if (b.name) await c.query("UPDATE travel.hotels SET name = $2 WHERE id = $1", [req.params.hotelId, b.name]);
    await saveRates(c, req.params.hotelId, b.rates);
  });
  await recomputeAll();
  await audit(me(req).id, "umrah_hotel.update", "hotel", req.params.hotelId, { rates: b.rates.length });
  await clearCatalogCache();
  res.json({ data: { hotel_id: req.params.hotelId } });
});

r.patch("/hotels/:hotelId", async (req, res) => {
  assertCan(req, "umrah.hotels", "edit");
  const b = parse(z.object({ is_live: z.boolean() }), req.body);
  const row = await one(
    "UPDATE travel.umrah_hotels SET is_live = $2, updated_at = now() WHERE hotel_id = $1 RETURNING hotel_id, is_live",
    [req.params.hotelId, b.is_live],
  );
  if (!row) throw notFound("Hotel not found");
  await audit(me(req).id, "umrah_hotel.update", "hotel", req.params.hotelId, b);
  await clearCatalogCache();
  res.json({ data: row });
});

/** Removes the hotel from Umrah (rates and package choices); the hotel itself stays in the catalogue. */
r.delete("/hotels/:hotelId", async (req, res) => {
  assertCan(req, "umrah.hotels", "delete");
  const row = await one("DELETE FROM travel.umrah_hotels WHERE hotel_id = $1 RETURNING hotel_id", [req.params.hotelId]);
  if (!row) throw notFound("Hotel not found");
  await recomputeAll();
  await audit(me(req).id, "umrah_hotel.delete", "hotel", req.params.hotelId);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

export default r;
