// Hotels: list by sub-tab, the full editor document (property, rooms, rate plans, policies,
// taxes, reviews, SEO), the nightly availability calendar, create and delete.
import { Router, type Request } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { audit } from "../../lib/audit";
import { assertCan, canAny, me } from "../../lib/auth";
import { clearCatalogCache } from "../../lib/cache";
import { one, query, tx } from "../../lib/db";
import { HttpError, notFound, parse } from "../../lib/http";
import {
  DEFAULT_POLICIES, hotelChecks, lowestRate, photoIssue, quality, SCORE_KEYS,
  type HotelDoc, type PhotoPair, type Policies, type RatePlan, type Review, type Room,
} from "../../../shared/catalog-model";

const r = Router();
const TABS = ["all", "published", "draft", "photos"] as const;
const KEYS = TABS.map((t) => `hotels.${t}`);

function need(req: Request, action: "view" | "create" | "edit" | "delete") {
  if (!canAny(req, KEYS, action)) throw new HttpError(403, "Your role does not allow this");
}

const slugify = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/* ---------- list ---------- */

type ListRow = {
  id: string; slug: string | null; name: string; kind: string | null; star_rating: number | null; area: string | null; address: string | null;
  destination: string | null; status: string; price_from: number | null; rating: number | null; review_count: number | null;
  photos: PhotoPair[]; image_day_url: string | null; voucher_image_url: string | null; summary: string | null; description: string | null;
  destination_id: string | null; lat: number | null; lng: number | null; facilities: string[]; check_in_time: string | null;
  policies: Partial<Policies>; phone: string | null; email: string | null; seo_title: string | null; rooms: number; live_rates: number; updated_at: string;
};

r.get("/", async (req, res) => {
  const tab = String(req.query.tab ?? "all");
  if (!(TABS as readonly string[]).includes(tab)) throw new HttpError(400, "Unknown tab");
  assertCan(req, `hotels.${tab}`, "view");
  const q = String(req.query.q ?? "").trim();
  const rows = await query<ListRow>(
    `SELECT h.id, h.slug, h.name, h.kind, h.star_rating, h.area, h.address, d.name AS destination, h.status, h.price_from, h.rating, h.review_count,
            h.photos, h.image_day_url, h.voucher_image_url, h.summary, h.description, h.destination_id, h.lat, h.lng, h.facilities,
            h.check_in_time::text, h.policies, h.phone, h.email, h.seo_title, h.updated_at,
            (SELECT count(*)::int FROM travel.hotel_rooms x WHERE x.hotel_id = h.id) AS rooms,
            (SELECT count(*)::int FROM travel.hotel_rate_plans x WHERE x.hotel_id = h.id AND x.is_live) AS live_rates
       FROM travel.hotels h LEFT JOIN travel.destinations d ON d.id = h.destination_id
      WHERE ($1 = '' OR h.name ILIKE '%' || $1 || '%' OR h.area ILIKE '%' || $1 || '%' OR h.address ILIKE '%' || $1 || '%' OR d.name ILIKE '%' || $1 || '%')
        AND ($2 NOT IN ('published','draft') OR h.status = $2)
      ORDER BY h.priority DESC, h.name`,
    [q, tab],
  );
  const out = rows.map((h) => {
    const checks = hotelChecks({
      name: h.name, summary: h.summary ?? "", description: h.description ?? "", star_rating: h.star_rating, address: h.address ?? "",
      destination_id: h.destination_id, lat: h.lat, lng: h.lng, photos: h.photos, voucher_image_url: h.voucher_image_url ?? "",
      facilities: h.facilities, check_in_time: h.check_in_time ?? "", phone: h.phone ?? "", email: h.email ?? "", slug: h.slug ?? "",
      seo_title: h.seo_title ?? "", policies: h.policies, rooms: h.rooms, rate_plans: h.live_rates,
    });
    return {
      id: h.id, slug: h.slug, name: h.name, kind: h.kind, star_rating: h.star_rating, area: h.area || h.address, destination: h.destination,
      status: h.status, price_from: h.price_from, rating: h.rating, review_count: h.review_count, rooms: h.rooms,
      thumb: h.photos[0]?.day ?? h.image_day_url, quality: quality(checks), photo_issue: photoIssue(h.photos, h.voucher_image_url ?? ""),
      updated_at: h.updated_at,
    };
  });
  res.json({ data: tab === "photos" ? out.filter((h) => h.photo_issue) : out });
});

/** Destinations for the editor's selects. */
r.get("/options", async (req, res) => {
  need(req, "view");
  const dest = await query(
    `SELECT d.id, d.name, d.slug, c.name AS country FROM travel.destinations d JOIN travel.countries c ON c.iso2 = d.country_iso2 ORDER BY d.sort_order, d.name`,
  );
  res.json({ data: { destinations: dest } });
});

/* ---------- one hotel ---------- */

const t5 = (v: string | null) => (v ? v.slice(0, 5) : "");

async function loadDoc(id: string) {
  const h = await one(
    `SELECT h.*, h.check_in_time::text AS cin, h.check_out_time::text AS cout, u.name AS updated_by_name
       FROM travel.hotels h LEFT JOIN travel.admin_users u ON u.id = h.updated_by WHERE h.id = $1`,
    [id],
  );
  if (!h) throw notFound("Hotel not found");
  const rooms = await query(`SELECT * FROM travel.hotel_rooms WHERE hotel_id = $1 ORDER BY position, created_at`, [id]);
  const plans = await query(`SELECT * FROM travel.hotel_rate_plans WHERE hotel_id = $1 ORDER BY position`, [id]);
  const reviews = await query(`SELECT id, guest_name, guest_city, score, title, body, stayed_on, is_published FROM travel.hotel_reviews WHERE hotel_id = $1 ORDER BY created_at DESC`, [id]);
  const stats = await one(
    `SELECT count(*)::int AS bookings,
            COALESCE(sum(GREATEST(COALESCE(end_date - start_date, 1), 1) * GREATEST(COALESCE((product_snapshot->>'rooms')::int, 1), 1)), 0)::int AS nights,
            COALESCE(sum(total_amount), 0)::float AS revenue
       FROM travel.bookings
      WHERE product_type = 'hotel' AND product_id = $1 AND status <> 'cancelled' AND created_at >= date_trunc('month', now())`,
    [id],
  );
  const doc: HotelDoc = {
    id: h.id, name: h.name, kind: h.kind ?? "Hotel", star_rating: h.star_rating, chain: h.chain ?? "", opened_year: h.opened_year,
    renovated_year: h.renovated_year, total_rooms: h.total_rooms, badge: h.badge ?? "", summary: h.summary ?? "", description: h.description ?? "",
    highlights: h.amenities ?? [], languages: h.languages ?? [], address: h.address ?? "", area: h.area ?? "", city: h.city ?? "",
    destination_id: h.destination_id, country: h.country ?? "", postcode: h.postcode ?? "", lat: h.lat, lng: h.lng, distances: h.distances ?? [],
    logo_url: h.logo_url, voucher_image_url: h.voucher_image_url, photos: h.photos ?? [],
    rooms: rooms.map((x): Room => ({
      id: x.id, key: x.id, name: x.name, size_m2: x.size_m2, beds: x.beds ?? "", max_adults: x.max_adults, max_children: x.max_children,
      units: x.units, view: x.view ?? "", smoking: x.smoking, extra_bed: x.extra_bed ?? "", amenities: x.amenities, photos: x.photos, base_price: x.base_price,
    })),
    rate_plans: plans.map((p): RatePlan => ({
      id: p.id, key: p.id, room_key: p.room_id, name: p.name, meal_plan: p.meal_plan, cancellation: p.cancellation, payment: p.payment,
      adjust_type: p.adjust_type, adjust_value: p.adjust_value, is_live: p.is_live,
    })),
    weekend_uplift: h.weekend_uplift, facilities: h.facilities ?? [], check_in_time: t5(h.cin), check_out_time: t5(h.cout),
    policies: { ...DEFAULT_POLICIES, ...(h.policies ?? {}) }, taxes: h.taxes ?? [],
    phone: h.phone ?? "", email: h.email ?? "", website: h.website ?? "", emergency_phone: h.emergency_phone ?? "",
    voucher_show_phone: h.voucher_show_phone, voucher_show_email: h.voucher_show_email,
    rating: h.rating, review_count: h.review_count, review_scores: h.review_scores ?? {},
    reviews: reviews.map((v): Review => ({
      id: v.id, guest_name: v.guest_name, guest_city: v.guest_city ?? "", score: v.score, title: v.title ?? "", body: v.body ?? "", stayed_on: v.stayed_on, is_published: v.is_published,
    })),
    status: h.status, priority: h.priority, slug: h.slug ?? "", seo_title: h.seo_title ?? "", seo_description: h.seo_description ?? "",
    supplier: h.supplier ?? "", supplier_hotel_id: h.supplier_hotel_id ?? "", is_featured: h.is_featured, in_deals: h.in_deals,
    pay_at_hotel: h.pay_at_hotel, currency_code: h.currency_code,
  };
  return { doc, meta: { updated_at: h.updated_at, updated_by: h.updated_by_name, price_from: h.price_from, stats } };
}

r.get("/:id", async (req, res) => {
  need(req, "view");
  res.json({ data: await loadDoc(req.params.id) });
});

/* ---------- save ---------- */

const str = (max = 500) => z.string().trim().max(max);
const photo = z.object({ day: str(1000).min(1), night: str(1000).nullable(), tag: str(60) });
const time = z.string().regex(/^\d{2}:\d{2}$/, "use HH:MM");

const HotelSchema = z.object({
  name: str(160).min(2, "add the hotel name"),
  kind: str(60), star_rating: z.number().int().min(1).max(5).nullable(), chain: str(120), opened_year: z.number().int().min(1800).max(2100).nullable(),
  renovated_year: z.number().int().min(1800).max(2100).nullable(), total_rooms: z.number().int().min(0).max(100000).nullable(), badge: str(60),
  summary: str(160), description: str(6000), highlights: z.array(str(80)).max(12), languages: z.array(str(40)).max(30),
  address: str(300), area: str(120), city: str(120), destination_id: z.uuid().nullable(), country: str(80), postcode: str(20),
  lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable(),
  distances: z.array(z.object({ place: str(160).min(1), distance: str(40) })).max(30),
  logo_url: str(1000).nullable(), voucher_image_url: str(1000).nullable(), photos: z.array(photo).max(60),
  rooms: z.array(z.object({
    id: z.uuid().optional(), key: str(80), name: str(120).min(1, "every room type needs a name"), size_m2: z.number().int().min(0).max(5000).nullable(),
    beds: str(80), max_adults: z.number().int().min(1).max(20), max_children: z.number().int().min(0).max(20), units: z.number().int().min(0).max(5000),
    view: str(60), smoking: str(40), extra_bed: str(120), amenities: z.array(str(60)).max(40), photos: z.array(str(1000)).max(20),
    base_price: z.number().min(0).max(1e9),
  })).max(40),
  rate_plans: z.array(z.object({
    id: z.uuid().optional(), key: str(80), room_key: str(80).nullable(), name: str(120).min(1, "every rate plan needs a name"), meal_plan: str(60),
    cancellation: str(80), payment: z.enum(["pay_now", "pay_at_hotel", "deposit"]), adjust_type: z.enum(["percent", "fixed"]),
    adjust_value: z.number().min(-1e8).max(1e8), is_live: z.boolean(),
  })).max(40),
  weekend_uplift: z.number().min(-90).max(300),
  facilities: z.array(str(80)).max(120),
  check_in_time: time, check_out_time: time,
  policies: z.object({
    check_in_until: str(40), check_out_from: str(40), cancellation: str(2000), children: str(2000), min_age: str(40), pets: str(80),
    deposit: str(120), cards: z.array(str(40)).max(12), id_required: z.boolean(), marriage_cert: z.boolean(), smoking_areas: z.boolean(),
    no_parties: z.boolean(), quiet_hours: z.boolean(), min_stay: z.number().int().min(1).max(60), lead_days: z.number().int().min(0).max(60),
    child_free_age: z.number().int().min(0).max(17),
  }),
  taxes: z.array(z.object({
    name: str(80).min(1, "every tax needs a name"), type: z.enum(["percent", "fixed"]), amount: z.number().min(0).max(1e7), currency: str(3),
    per: z.enum(["stay", "night", "person", "room_night"]), included: z.boolean(),
  })).max(20),
  phone: str(40), email: z.union([z.literal(""), z.email("check the email").max(160)]), website: str(300), emergency_phone: str(40),
  voucher_show_phone: z.boolean(), voucher_show_email: z.boolean(),
  rating: z.number().min(0).max(10).nullable(), review_count: z.number().int().min(0).max(1e7).nullable(),
  review_scores: z.partialRecord(z.enum(SCORE_KEYS), z.number().min(0).max(10)),
  reviews: z.array(z.object({
    id: z.uuid().optional(), guest_name: str(80).min(1, "each review needs a guest name"), guest_city: str(80), score: z.number().min(1).max(10),
    title: str(160), body: str(3000), stayed_on: z.iso.date().nullable(), is_published: z.boolean(),
  })).max(200),
  status: z.enum(["published", "draft", "archived"]), priority: z.number().int().min(-100).max(100),
  slug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/, "use lowercase letters, numbers and dashes"),
  seo_title: str(70), seo_description: str(320), supplier: str(80), supplier_hotel_id: str(80),
  is_featured: z.boolean(), in_deals: z.boolean(), pay_at_hotel: z.boolean(), currency_code: z.string().length(3),
});
type HotelIn = z.infer<typeof HotelSchema>;

async function uniqueSlug(c: PoolClient, base: string, id: string | null) {
  const root = base || "hotel";
  for (let i = 1; i < 50; i++) {
    const s = i === 1 ? root : `${root}-${i}`;
    const hit = await c.query("SELECT 1 FROM travel.hotels WHERE slug = $1 AND id IS DISTINCT FROM $2", [s, id]);
    if (!hit.rowCount) return s;
  }
  throw new HttpError(409, "That page address is taken");
}

async function writeHotel(c: PoolClient, d: HotelIn, id: string | null, userId: string, explicitSlug: boolean) {
  const slug = explicitSlug ? d.slug : await uniqueSlug(c, slugify(d.slug || d.name), id);
  if (explicitSlug) {
    const hit = await c.query("SELECT 1 FROM travel.hotels WHERE slug = $1 AND id IS DISTINCT FROM $2", [slug, id]);
    if (hit.rowCount) throw new HttpError(409, "Another hotel already uses that page address");
  }
  const cover = d.photos[0];
  const price = lowestRate(d.rooms, d.rate_plans);
  const vals = [
    d.name, d.kind, d.star_rating, d.chain || null, d.opened_year, d.renovated_year, d.total_rooms, d.badge || null, d.summary || null, d.description || null,
    d.highlights, d.languages, d.address || null, d.area || null, d.city || null, d.destination_id, d.country || null, d.postcode || null, d.lat, d.lng,
    JSON.stringify(d.distances), d.logo_url, d.voucher_image_url, JSON.stringify(d.photos), cover?.day ?? null, cover ? (cover.night ?? cover.day) : null,
    d.weekend_uplift, d.facilities, d.check_in_time, d.check_out_time, JSON.stringify(d.policies), JSON.stringify(d.taxes),
    d.phone || null, d.email || null, d.website || null, d.emergency_phone || null, d.voucher_show_phone, d.voucher_show_email,
    d.rating, d.review_count, JSON.stringify(d.review_scores), d.status, d.priority, slug, d.seo_title || null, d.seo_description || null,
    d.supplier || null, d.supplier_hotel_id || null, d.is_featured, d.in_deals, d.pay_at_hotel, d.currency_code, price, userId,
  ];
  const cols = `name, kind, star_rating, chain, opened_year, renovated_year, total_rooms, badge, summary, description,
    amenities, languages, address, area, city, destination_id, country, postcode, lat, lng,
    distances, logo_url, voucher_image_url, photos, image_day_url, image_night_url,
    weekend_uplift, facilities, check_in_time, check_out_time, policies, taxes,
    phone, email, website, emergency_phone, voucher_show_phone, voucher_show_email,
    rating, review_count, review_scores, status, priority, slug, seo_title, seo_description,
    supplier, supplier_hotel_id, is_featured, in_deals, pay_at_hotel, currency_code, price_from, updated_by`;
  const list = cols.split(",").map((s) => s.trim());
  let hotelId = id;
  if (!id) {
    const ins = await c.query(
      `INSERT INTO travel.hotels (source, ${list.join(", ")}) VALUES ('manual', ${list.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      vals,
    );
    hotelId = ins.rows[0].id;
  } else {
    const up = await c.query(
      `UPDATE travel.hotels SET ${list.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = now() WHERE id = $${vals.length + 1}`,
      [...vals, id],
    );
    if (!up.rowCount) throw notFound("Hotel not found");
  }

  // Room types: update by id, insert new ones, drop the rest (their nightly rows go with them).
  const keyToId = new Map<string, string>();
  const keep: string[] = [];
  for (const [i, rm] of d.rooms.entries()) {
    const v = [rm.name, rm.size_m2, rm.beds || null, rm.max_adults, rm.max_children, rm.units, rm.view || null, rm.smoking, rm.extra_bed || null, rm.amenities, rm.photos, rm.base_price, i];
    let rid = rm.id;
    if (rid) {
      const u = await c.query(
        `UPDATE travel.hotel_rooms SET name=$1, size_m2=$2, beds=$3, max_adults=$4, max_children=$5, units=$6, view=$7, smoking=$8, extra_bed=$9, amenities=$10, photos=$11, base_price=$12, position=$13
          WHERE id = $14 AND hotel_id = $15`, [...v, rid, hotelId]);
      if (!u.rowCount) rid = undefined;
    }
    if (!rid) {
      const ins = await c.query(
        `INSERT INTO travel.hotel_rooms (name, size_m2, beds, max_adults, max_children, units, view, smoking, extra_bed, amenities, photos, base_price, position, hotel_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [...v, hotelId]);
      rid = ins.rows[0].id as string;
    }
    keyToId.set(rm.key, rid!);
    if (rm.id) keyToId.set(rm.id, rid!);
    keep.push(rid!);
  }
  await c.query(`DELETE FROM travel.hotel_rooms WHERE hotel_id = $1 AND NOT (id = ANY($2::uuid[]))`, [hotelId, keep]);

  await c.query(`DELETE FROM travel.hotel_rate_plans WHERE hotel_id = $1`, [hotelId]);
  for (const [i, p] of d.rate_plans.entries()) {
    const roomId = p.room_key ? keyToId.get(p.room_key) ?? null : null;
    await c.query(
      `INSERT INTO travel.hotel_rate_plans (id, hotel_id, room_id, name, meal_plan, cancellation, payment, adjust_type, adjust_value, is_live, position)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.id ?? null, hotelId, roomId, p.name, p.meal_plan, p.cancellation, p.payment, p.adjust_type, p.adjust_value, p.is_live, i],
    );
  }

  const keepRev: string[] = [];
  for (const v of d.reviews) {
    const row = await c.query(
      `INSERT INTO travel.hotel_reviews (id, hotel_id, guest_name, guest_city, score, title, body, stayed_on, is_published)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET guest_name = EXCLUDED.guest_name, guest_city = EXCLUDED.guest_city, score = EXCLUDED.score, title = EXCLUDED.title,
         body = EXCLUDED.body, stayed_on = EXCLUDED.stayed_on, is_published = EXCLUDED.is_published
       WHERE travel.hotel_reviews.hotel_id = EXCLUDED.hotel_id RETURNING id`,
      [v.id ?? null, hotelId, v.guest_name, v.guest_city || null, v.score, v.title || null, v.body || null, v.stayed_on, v.is_published],
    );
    if (row.rows[0]) keepRev.push(row.rows[0].id);
  }
  await c.query(`DELETE FROM travel.hotel_reviews WHERE hotel_id = $1 AND NOT (id = ANY($2::uuid[]))`, [hotelId, keepRev]);
  return hotelId!;
}

r.post("/", async (req, res) => {
  need(req, "create");
  const d = parse(HotelSchema, req.body);
  const u = me(req);
  const id = await tx((c) => writeHotel(c, d, null, u.id, false));
  await audit(u.id, "hotel.create", "hotel", id, { name: d.name, status: d.status });
  await clearCatalogCache();
  res.status(201).json({ data: await loadDoc(id) });
});

r.put("/:id", async (req, res) => {
  need(req, "edit");
  const d = parse(HotelSchema, req.body);
  const u = me(req);
  const before = await one<{ status: string }>("SELECT status FROM travel.hotels WHERE id = $1", [req.params.id]);
  if (!before) throw notFound("Hotel not found");
  await tx((c) => writeHotel(c, d, req.params.id, u.id, !!d.slug));
  await audit(u.id, before.status !== d.status ? "hotel.status" : "hotel.update", "hotel", req.params.id, { name: d.name, status: d.status, from: before.status });
  await clearCatalogCache();
  res.json({ data: await loadDoc(req.params.id) });
});

r.delete("/:id", async (req, res) => {
  need(req, "delete");
  const row = await one<{ name: string }>("DELETE FROM travel.hotels WHERE id = $1 RETURNING name", [req.params.id]);
  if (!row) throw notFound("Hotel not found");
  await audit(me(req).id, "hotel.delete", "hotel", req.params.id, { name: row.name });
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

/* ---------- availability calendar ---------- */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const todayPk = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);

r.get("/:id/availability", async (req, res) => {
  need(req, "view");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : todayPk();
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 62);
  const h = await one<{ weekend_uplift: number }>("SELECT weekend_uplift FROM travel.hotels WHERE id = $1", [req.params.id]);
  if (!h) throw notFound("Hotel not found");
  const rooms = await query<{ id: string; name: string; units: number; base_price: number }>(
    "SELECT id, name, units, base_price FROM travel.hotel_rooms WHERE hotel_id = $1 ORDER BY position, created_at", [req.params.id]);
  const rows = await query<{ room_id: string; night: string; price: number | null; rooms_left: number | null; stop_sell: boolean }>(
    `SELECT a.room_id, a.night, a.price, a.rooms_left, a.stop_sell FROM travel.hotel_availability a JOIN travel.hotel_rooms r ON r.id = a.room_id
      WHERE r.hotel_id = $1 AND a.night BETWEEN $2::date AND $3::date`, [req.params.id, from, addDays(from, days - 1)]);
  const map = new Map(rows.map((x) => [x.room_id + x.night, x]));
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  res.json({
    data: {
      from, dates, weekend_uplift: h.weekend_uplift,
      rooms: rooms.map((rm) => ({
        id: rm.id, name: rm.name, units: rm.units, base_price: rm.base_price,
        cells: dates.map((dt) => {
          const wd = new Date(dt + "T00:00:00Z").getUTCDay();
          const weekend = wd === 5 || wd === 6;
          const o = map.get(rm.id + dt);
          const auto = Math.round(rm.base_price * (weekend ? 1 + h.weekend_uplift / 100 : 1));
          return { date: dt, weekend, price: o?.price ?? auto, custom_price: o?.price != null, rooms_left: o?.rooms_left ?? rm.units, stop_sell: o?.stop_sell ?? false };
        }),
      })),
    },
  });
});

const AvailSchema = z.object({
  room_ids: z.array(z.uuid()).min(1, "pick at least one room type"),
  from: z.iso.date(), to: z.iso.date(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  price: z.number().min(0).max(1e9).nullable().optional(),       // null = back to automatic price
  rooms_left: z.number().int().min(0).max(5000).nullable().optional(),
  stop_sell: z.boolean().optional(),
});

r.put("/:id/availability", async (req, res) => {
  need(req, "edit");
  const b = parse(AvailSchema, req.body);
  if (b.to < b.from) throw new HttpError(400, "The end date is before the start date");
  if (addDays(b.from, 366) < b.to) throw new HttpError(400, "Pick a range of a year or less");
  const valid = await query<{ id: string }>("SELECT id FROM travel.hotel_rooms WHERE hotel_id = $1 AND id = ANY($2::uuid[])", [req.params.id, b.room_ids]);
  if (valid.length !== b.room_ids.length) throw new HttpError(400, "Unknown room type");
  const days: string[] = [];
  for (let d = b.from; d <= b.to; d = addDays(d, 1)) {
    if (!b.weekdays || b.weekdays.includes(new Date(d + "T00:00:00Z").getUTCDay())) days.push(d);
  }
  const setPrice = b.price !== undefined, setLeft = b.rooms_left !== undefined, setStop = b.stop_sell !== undefined;
  await tx(async (c) => {
    for (const room of b.room_ids) {
      await c.query(
        `INSERT INTO travel.hotel_availability (room_id, night, price, rooms_left, stop_sell)
         SELECT $1, d::date, $3, $4, COALESCE($5, false) FROM unnest($2::date[]) d
         ON CONFLICT (room_id, night) DO UPDATE SET
           price = CASE WHEN $6 THEN EXCLUDED.price ELSE travel.hotel_availability.price END,
           rooms_left = CASE WHEN $7 THEN EXCLUDED.rooms_left ELSE travel.hotel_availability.rooms_left END,
           stop_sell = CASE WHEN $8 THEN EXCLUDED.stop_sell ELSE travel.hotel_availability.stop_sell END`,
        [room, days, setPrice ? b.price : null, setLeft ? b.rooms_left : null, setStop ? b.stop_sell : null, setPrice, setLeft, setStop],
      );
      await c.query(`DELETE FROM travel.hotel_availability WHERE room_id = $1 AND price IS NULL AND rooms_left IS NULL AND NOT stop_sell`, [room]);
    }
  });
  await audit(me(req).id, "hotel.availability", "hotel", req.params.id, { from: b.from, to: b.to, rooms: b.room_ids.length, price: b.price, rooms_left: b.rooms_left, stop_sell: b.stop_sell });
  res.json({ data: { nights: days.length } });
});

export default r;
