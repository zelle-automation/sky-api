// Excursions: list by sub-tab, the full editor document (itinerary, schedule, age-band
// options, pickup zones, policies, SEO), create and delete. Supplier costs are left out
// for roles with "hide costs".
import { Router } from "express";

import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { assertCan, canAny, me } from "../../lib/auth.js";
import { clearCatalogCache } from "../../lib/cache.js";
import { one, query, tx } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";
import { excChecks, lowestAdult, photoIssue, quality } from "../../../shared/catalog-model.js";

const r = Router();
const TABS = ["all", "published", "seasonal", "draft"];
const KEYS = TABS.map((t) => `excursions.${t}`);

function need(req, action) {
  if (!canAny(req, KEYS, action)) throw new HttpError(403, "Your role does not allow this");
}
const slugify = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** "Daily · 15:00", "Tue, Thu, Sat · 08:00", "Jun–Sep · 07:00". */
function scheduleLabel(days, times, from, to) {
  const mon = (d) =>
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1];
  const when =
    from && to ? `${mon(from)}–${mon(to)}` : days.length === 7 ? "Daily" : days.length ? days.join(", ") : "No days set";
  const t = times.length > 2 ? `${times.length} times a day` : times.join(", ");
  return t ? `${when} · ${t}` : when;
}

/* ---------- list ---------- */

r.get("/", async (req, res) => {
  const tab = String(req.query.tab ?? "all");
  if (!TABS.includes(tab)) throw new HttpError(400, "Unknown tab");
  assertCan(req, `excursions.${tab}`, "view");
  const q = String(req.query.q ?? "").trim();
  const rows = await query(
    `SELECT e.id, e.slug, e.title, e.category, d.name AS destination, e.destination_id, e.status, e.price_from, e.price_unit, e.rating, e.review_count,
            e.photos, e.image_day_url, e.summary, e.description, e.days_of_week, e.start_times, e.capacity, e.inclusions, e.seo_title,
            e.cancellation_policy, e.season_from, e.season_to, e.duration_label, e.updated_at,
            jsonb_array_length(e.itinerary) AS stops,
            (SELECT count(*)::int FROM travel.excursion_options o WHERE o.excursion_id = e.id AND o.is_live) AS live_options
       FROM travel.excursions e LEFT JOIN travel.destinations d ON d.id = e.destination_id
      WHERE ($1 = '' OR e.title ILIKE '%' || $1 || '%' OR e.category ILIKE '%' || $1 || '%' OR d.name ILIKE '%' || $1 || '%' OR e.location_label ILIKE '%' || $1 || '%')
        AND ($2 = 'all' OR e.status = $2)
      ORDER BY e.is_featured DESC, e.title`,
    [q, tab],
  );
  res.json({
    data: rows.map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      category: e.category,
      destination: e.destination,
      status: e.status,
      price_from: e.price_from,
      price_unit: e.price_unit,
      rating: e.rating,
      review_count: e.review_count,
      thumb: e.photos[0]?.day ?? e.image_day_url,
      duration: e.duration_label,
      schedule: scheduleLabel(e.days_of_week, e.start_times, e.season_from, e.season_to),
      quality: quality(
        excChecks({
          title: e.title,
          summary: e.summary ?? "",
          description: e.description ?? "",
          destination_id: e.destination_id,
          days_of_week: e.days_of_week,
          start_times: e.start_times,
          capacity: e.capacity,
          inclusions: e.inclusions,
          photos: e.photos,
          slug: e.slug ?? "",
          seo_title: e.seo_title ?? "",
          cancellation_policy: e.cancellation_policy ?? "",
          itinerary: e.stops,
          options: e.live_options,
        }),
      ),
      photo_issue: photoIssue(e.photos),
    })),
  });
});

r.get("/options", async (req, res) => {
  need(req, "view");
  const dest = await query(
    `SELECT d.id, d.name, d.slug, c.name AS country FROM travel.destinations d JOIN travel.countries c ON c.iso2 = d.country_iso2 ORDER BY d.sort_order, d.name`,
  );
  res.json({ data: { destinations: dest } });
});

/* ---------- one excursion ---------- */

async function loadDoc(req, id) {
  const e = await one(
    `SELECT e.*, u.name AS updated_by_name FROM travel.excursions e LEFT JOIN travel.admin_users u ON u.id = e.updated_by WHERE e.id = $1`,
    [id],
  );
  if (!e) throw notFound("Excursion not found");
  const hide = me(req).limits.hideCosts;
  const opts = await query(`SELECT * FROM travel.excursion_options WHERE excursion_id = $1 ORDER BY position`, [id]);
  // Guests booked per day for the next 7 days (side panel).
  const week = await query(
    `SELECT g::date::text AS day, COALESCE(sum(b.adults + b.children), 0)::int AS guests
       FROM generate_series((now() AT TIME ZONE 'Asia/Karachi')::date, (now() AT TIME ZONE 'Asia/Karachi')::date + 6, interval '1 day') g
       LEFT JOIN travel.bookings b ON b.product_type = 'excursion' AND b.product_id = $1 AND b.start_date = g::date AND b.status NOT IN ('cancelled','refund')
      GROUP BY g ORDER BY g`,
    [id],
  );
  const doc = {
    id: e.id,
    title: e.title,
    category: e.category ?? "",
    destination_id: e.destination_id,
    location_label: e.location_label ?? "",
    duration_label: e.duration_label ?? e.raw?.duration_label ?? "",
    duration_minutes: e.duration_minutes,
    activity_level: e.activity_level,
    group_type: e.group_type,
    summary: e.summary ?? "",
    description: e.description ?? "",
    highlights: e.highlights ?? [],
    itinerary: e.itinerary ?? [],
    days_of_week: e.days_of_week,
    start_times: e.start_times,
    capacity: e.capacity,
    min_guests: e.min_guests,
    cutoff_hours: e.cutoff_hours,
    season_from: e.season_from,
    season_to: e.season_to,
    blackout_dates: e.blackout_dates,
    options: opts.map((o) => ({
      id: o.id,
      key: o.id,
      name: o.name,
      note: o.note ?? "",
      price_basis: o.price_basis,
      max_group: o.max_group,
      adult_price: o.adult_price,
      child_price: o.child_price,
      infant_price: o.infant_price,
      is_live: o.is_live,
      ...(hide ? {} : { supplier_cost: o.supplier_cost }),
    })),
    group_discount_pct: e.group_discount_pct,
    group_discount_min: e.group_discount_min,
    peak_uplift_pct: e.peak_uplift_pct,
    peak_from: e.peak_from,
    peak_to: e.peak_to,
    inclusions: e.inclusions,
    exclusions: e.exclusions,
    pickup_offered: e.pickup_offered,
    pickup_zones: e.pickup_zones ?? [],
    meeting_point: e.meeting_point ?? "",
    meeting_map_url: e.meeting_map_url ?? "",
    ends_at: e.ends_at ?? "",
    guide_type: e.guide_type ?? "",
    languages: e.languages,
    not_suitable: e.not_suitable,
    what_to_bring: e.what_to_bring,
    min_age: e.min_age,
    dress_code: e.dress_code ?? "",
    cancellation_policy: e.cancellation_policy ?? "",
    weather_policy: e.weather_policy ?? "",
    photos: e.photos ?? [],
    status: e.status,
    slug: e.slug ?? "",
    seo_title: e.seo_title ?? "",
    seo_description: e.seo_description ?? "",
    supplier: e.supplier ?? "",
    supplier_product_id: e.supplier_product_id ?? "",
    supplier_confirms: e.supplier_confirms ?? "",
    is_featured: e.is_featured,
    rating: e.rating,
    review_count: e.review_count,
    currency_code: e.currency_code,
    price_unit: e.price_unit,
  };
  return {
    doc,
    meta: { updated_at: e.updated_at, updated_by: e.updated_by_name, price_from: e.price_from, hide_costs: hide, week },
  };
}

r.get("/:id", async (req, res) => {
  need(req, "view");
  res.json({ data: await loadDoc(req, req.params.id) });
});

/* ---------- save ---------- */

const str = (max = 500) => z.string().trim().max(max);
const money = z.number().min(0).max(1e9);
const photo = z.object({ day: str(1000).min(1), night: str(1000).nullable(), tag: str(60) });
const date = z.iso.date().nullable();

const ExcSchema = z.object({
  title: str(160).min(2, "add the title"),
  category: str(60),
  destination_id: z.uuid().nullable(),
  location_label: str(160),
  duration_label: str(60),
  duration_minutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 14)
    .nullable(),
  activity_level: str(30),
  group_type: str(40),
  summary: str(200),
  description: str(6000),
  highlights: z.array(str(80)).max(12),
  itinerary: z
    .array(
      z.object({ time: str(10), title: str(120).min(1, "each stop needs a title"), duration: str(40), description: str(600) }),
    )
    .max(40),
  days_of_week: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).max(7),
  start_times: z.array(z.string().regex(/^\d{2}:\d{2}$/, "start times look like 15:00")).max(48),
  capacity: z.number().int().min(1).max(100000).nullable(),
  min_guests: z.number().int().min(1).max(1000),
  cutoff_hours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30),
  season_from: date,
  season_to: date,
  blackout_dates: z.array(str(60)).max(60),
  options: z
    .array(
      z.object({
        id: z.uuid().optional(),
        key: str(80),
        name: str(120).min(1, "each option needs a name"),
        note: str(300),
        price_basis: z.enum(["person", "group"]),
        max_group: z.number().int().min(1).max(500).nullable(),
        adult_price: money,
        child_price: money.nullable(),
        infant_price: money.nullable(),
        supplier_cost: money.nullable().optional(),
        is_live: z.boolean(),
      }),
    )
    .max(30),
  group_discount_pct: z.number().min(0).max(90).nullable(),
  group_discount_min: z.number().int().min(2).max(1000).nullable(),
  peak_uplift_pct: z.number().min(0).max(300).nullable(),
  peak_from: date,
  peak_to: date,
  inclusions: z.array(str(120)).max(40),
  exclusions: z.array(str(120)).max(40),
  pickup_offered: z.boolean(),
  pickup_zones: z
    .array(z.object({ zone: str(120).min(1, "each pickup zone needs a name"), window: str(40), fee: money }))
    .max(40),
  meeting_point: str(300),
  meeting_map_url: z.union([z.literal(""), z.url("the map link must start with https://").max(1000)]),
  ends_at: str(200),
  guide_type: str(60),
  languages: z.array(str(40)).max(20),
  not_suitable: z.array(str(120)).max(30),
  what_to_bring: z.array(str(120)).max(30),
  min_age: z.number().int().min(0).max(99).nullable(),
  dress_code: str(200),
  cancellation_policy: str(300),
  weather_policy: str(200),
  photos: z.array(photo).max(60),
  status: z.enum(["published", "seasonal", "draft", "archived"]),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9-]*$/, "use lowercase letters, numbers and dashes"),
  seo_title: str(70),
  seo_description: str(320),
  supplier: str(80),
  supplier_product_id: str(80),
  supplier_confirms: str(40),
  is_featured: z.boolean(),
  rating: z.number().min(0).max(10).nullable(),
  review_count: z.number().int().min(0).max(1e7).nullable(),
  currency_code: z.string().length(3),
  price_unit: str(40),
});

async function writeExc(c, req, d, id) {
  const u = me(req);
  let slug = slugify(d.slug || d.title) || "excursion";
  if (d.slug && id) {
    const hit = await c.query("SELECT 1 FROM travel.excursions WHERE slug = $1 AND id <> $2", [slug, id]);
    if (hit.rowCount) throw new HttpError(409, "Another excursion already uses that page address");
  } else {
    for (
      let i = 2;
      (await c.query("SELECT 1 FROM travel.excursions WHERE slug = $1 AND id IS DISTINCT FROM $2", [slug, id])).rowCount;
      i++
    ) {
      slug = `${slugify(d.slug || d.title) || "excursion"}-${i}`;
    }
  }
  if (d.season_from && d.season_to && d.season_to < d.season_from) throw new HttpError(400, "The season ends before it starts");
  const cover = d.photos[0];
  const price = lowestAdult(d.options);
  const vals = [
    d.title,
    d.category || null,
    d.destination_id,
    d.location_label || null,
    d.duration_label || null,
    d.duration_minutes,
    d.activity_level,
    d.group_type,
    d.summary || null,
    d.description || null,
    d.highlights,
    JSON.stringify(d.itinerary),
    d.days_of_week,
    d.start_times,
    d.capacity,
    d.min_guests,
    d.cutoff_hours,
    d.season_from,
    d.season_to,
    d.blackout_dates,
    d.group_discount_pct,
    d.group_discount_min,
    d.peak_uplift_pct,
    d.peak_from,
    d.peak_to,
    d.inclusions,
    d.exclusions,
    d.pickup_offered,
    JSON.stringify(d.pickup_zones),
    d.meeting_point || null,
    d.meeting_map_url || null,
    d.ends_at || null,
    d.guide_type || null,
    d.languages,
    d.not_suitable,
    d.what_to_bring,
    d.min_age,
    d.dress_code || null,
    d.cancellation_policy || null,
    d.weather_policy || null,
    JSON.stringify(d.photos),
    cover?.day ?? null,
    cover ? (cover.night ?? cover.day) : null,
    d.status,
    slug,
    d.seo_title || null,
    d.seo_description || null,
    d.supplier || null,
    d.supplier_product_id || null,
    d.supplier_confirms || null,
    d.is_featured,
    d.rating,
    d.review_count,
    d.currency_code,
    d.price_unit,
    price,
    u.id,
  ];
  const list = `title, category, destination_id, location_label, duration_label, duration_minutes, activity_level, group_type,
    summary, description, highlights, itinerary, days_of_week, start_times, capacity, min_guests, cutoff_hours,
    season_from, season_to, blackout_dates, group_discount_pct, group_discount_min, peak_uplift_pct, peak_from, peak_to,
    inclusions, exclusions, pickup_offered, pickup_zones, meeting_point, meeting_map_url, ends_at,
    guide_type, languages, not_suitable, what_to_bring, min_age, dress_code, cancellation_policy, weather_policy,
    photos, image_day_url, image_night_url, status, slug, seo_title, seo_description,
    supplier, supplier_product_id, supplier_confirms, is_featured, rating, review_count, currency_code, price_unit,
    price_from, updated_by`
    .split(",")
    .map((s) => s.trim());
  // raw.duration_label feeds the public card's detail line.
  const rawSet = `raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('duration_label', $5::text)`;
  let excId = id;
  if (!id) {
    const ins = await c.query(
      `INSERT INTO travel.excursions (source, raw, ${list.join(", ")}) VALUES ('manual', jsonb_build_object('duration_label', $5::text), ${list.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      vals,
    );
    excId = ins.rows[0].id;
  } else {
    const up = await c.query(
      `UPDATE travel.excursions SET ${list.map((k, i) => `${k} = $${i + 1}`).join(", ")}, ${rawSet}, updated_at = now() WHERE id = $${vals.length + 1}`,
      [...vals, id],
    );
    if (!up.rowCount) throw notFound("Excursion not found");
  }

  // Options: keep supplier costs untouched when the editor can't see them.
  const prevCost = new Map(
    (await c.query("SELECT id, supplier_cost FROM travel.excursion_options WHERE excursion_id = $1", [excId])).rows.map((o) => [
      o.id,
      o.supplier_cost,
    ]),
  );
  const hide = u.limits.hideCosts;
  await c.query("DELETE FROM travel.excursion_options WHERE excursion_id = $1", [excId]);
  for (const [i, o] of d.options.entries()) {
    const cost = hide ? (o.id ? (prevCost.get(o.id) ?? null) : null) : (o.supplier_cost ?? null);
    await c.query(
      `INSERT INTO travel.excursion_options (id, excursion_id, name, note, price_basis, max_group, adult_price, child_price, infant_price, supplier_cost, is_live, position)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        o.id ?? null,
        excId,
        o.name,
        o.note || null,
        o.price_basis,
        o.max_group,
        o.adult_price,
        o.child_price,
        o.infant_price,
        cost,
        o.is_live,
        i,
      ],
    );
  }
  return excId;
}

r.post("/", async (req, res) => {
  need(req, "create");
  const d = parse(ExcSchema, req.body);
  const id = await tx((c) => writeExc(c, req, d, null));
  await audit(me(req).id, "excursion.create", "excursion", id, { title: d.title, status: d.status });
  await clearCatalogCache();
  res.status(201).json({ data: await loadDoc(req, id) });
});

r.put("/:id", async (req, res) => {
  need(req, "edit");
  const d = parse(ExcSchema, req.body);
  const before = await one("SELECT status FROM travel.excursions WHERE id = $1", [req.params.id]);
  if (!before) throw notFound("Excursion not found");
  await tx((c) => writeExc(c, req, d, req.params.id));
  await audit(me(req).id, before.status !== d.status ? "excursion.status" : "excursion.update", "excursion", req.params.id, {
    title: d.title,
    status: d.status,
    from: before.status,
  });
  await clearCatalogCache();
  res.json({ data: await loadDoc(req, req.params.id) });
});

r.delete("/:id", async (req, res) => {
  need(req, "delete");
  const row = await one("DELETE FROM travel.excursions WHERE id = $1 RETURNING title", [req.params.id]);
  if (!row) throw notFound("Excursion not found");
  await audit(me(req).id, "excursion.delete", "excursion", req.params.id, { title: row.title });
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

export default r;
