// Packages: list by sub-tab (all / international / domestic / weekly deals), full editor with
// day-by-day plan, linked destinations, price per room sharing and fixed departures.
import { Router } from "express";
import { z } from "zod";
import { assertCan, canAny, me } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { clearCatalogCache } from "../../lib/cache.js";
import { one, query, tx } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";

const r = Router();
const TABS = ["all", "international", "domestic", "deals"];

/** Sub-tabs a package shows up in. */
function tabsFor(p) {
  const t = ["packages.all"];
  if (p.category === "international" || p.category === "honeymoon") t.push("packages.international");
  if (p.category === "domestic") t.push("packages.domestic");
  if (p.is_deal) t.push("packages.deals");
  return t;
}
function assertPkg(req, p, action) {
  if (!canAny(req, tabsFor(p), action)) throw new HttpError(403, "Your role does not allow this");
}

r.get("/", async (req, res) => {
  const tab = TABS.includes(String(req.query.tab)) ? req.query.tab : "all";
  assertCan(req, `packages.${tab}`, "view");
  const where =
    tab === "international"
      ? "p.category IN ('international','honeymoon')"
      : tab === "domestic"
        ? "p.category = 'domestic'"
        : tab === "deals"
          ? "p.is_deal"
          : "true";
  const rows = await query(
    `SELECT p.id, p.slug, p.title, p.category, p.duration_days, p.nights, p.price_from, p.price_was, p.price_unit, p.currency_code,
            p.is_deal, p.deal_badge, p.is_featured, p.status, p.image_day_url, p.image_night_url, p.updated_at,
            (SELECT count(*) FROM travel.package_departures d WHERE d.package_id = p.id AND d.depart_date >= current_date) AS departures,
            (SELECT min(d.depart_date) FROM travel.package_departures d WHERE d.package_id = p.id AND d.depart_date >= current_date) AS next_departure
       FROM travel.packages p WHERE ${where}
      ORDER BY p.is_featured DESC, p.created_at`,
  );
  const counts = await one(
    `SELECT count(*) AS all, count(*) FILTER (WHERE category IN ('international','honeymoon')) AS international,
            count(*) FILTER (WHERE category = 'domestic') AS domestic, count(*) FILTER (WHERE is_deal) AS deals
       FROM travel.packages`,
  );
  res.json({ data: { rows, counts } });
});

/** Destinations to link, for the editor. */
r.get("/destinations", async (req, res) => {
  if (
    !canAny(
      req,
      TABS.map((t) => `packages.${t}`),
      "view",
    )
  )
    throw new HttpError(403, "Your role does not allow this");
  res.json({ data: await query("SELECT id, name, slug, category FROM travel.destinations ORDER BY sort_order, name") });
});

async function load(id) {
  const p = await one("SELECT * FROM travel.packages WHERE id = $1", [id]);
  if (!p) return null;
  p.destinations = await query(
    `SELECT pd.destination_id, pd.nights, d.name FROM travel.package_destinations pd
       JOIN travel.destinations d ON d.id = pd.destination_id WHERE pd.package_id = $1 ORDER BY pd.position`,
    [id],
  );
  p.departures = await query(
    `SELECT id, depart_date, return_date, seats_total, seats_sold, price_override, status
       FROM travel.package_departures WHERE package_id = $1 ORDER BY depart_date`,
    [id],
  );
  return p;
}

r.get("/:id", async (req, res) => {
  const p = await load(req.params.id);
  if (!p) throw notFound("Package not found");
  assertPkg(req, p, "view");
  res.json({ data: p });
});

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
const body = z.object({
  title: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, numbers and dashes")
    .max(100),
  category: z.enum(["international", "domestic", "umrah", "honeymoon"]),
  duration_days: z.coerce.number().int().min(1).max(90),
  nights: z.coerce.number().int().min(0).max(90),
  itinerary_label: optText,
  includes_label: optText,
  summary: z
    .string()
    .trim()
    .max(5000)
    .nullish()
    .transform((v) => v || null),
  inclusions: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  image_day_url: optText,
  image_night_url: optText,
  price_from: money,
  price_was: optMoney,
  price_unit: z.string().trim().min(1).max(40).default("per person"),
  currency_code: z.string().trim().length(3).default("PKR"),
  is_deal: z.boolean().default(false),
  deal_badge: optText,
  is_featured: z.boolean().default(false),
  status: z.enum(["published", "draft", "archived"]).default("published"),
  itinerary: z
    .array(
      z.object({
        day: z.string().trim().max(40),
        title: z.string().trim().max(200),
        text: z.string().trim().max(2000).default(""),
      }),
    )
    .max(60)
    .default([]),
  price_options: z
    .array(z.object({ label: z.string().trim().min(1).max(60), adult: optMoney, child: optMoney, infant: optMoney }))
    .max(10)
    .default([]),
  destinations: z
    .array(z.object({ destination_id: z.uuid(), nights: z.coerce.number().int().min(0).max(90).nullish() }))
    .max(20)
    .default([]),
  departures: z
    .array(
      z.object({
        id: z.uuid().optional(),
        depart_date: z.iso.date(),
        return_date: z.iso.date().nullish(),
        seats_total: z.coerce.number().int().min(0).max(5000),
        seats_sold: z.coerce.number().int().min(0).max(5000),
        price_override: optMoney,
        status: z.enum(["open", "full", "closed", "departed", "cancelled"]).default("open"),
      }),
    )
    .max(200)
    .default([]),
});

const COLS = [
  "title",
  "slug",
  "category",
  "duration_days",
  "nights",
  "itinerary_label",
  "includes_label",
  "summary",
  "inclusions",
  "exclusions",
  "image_day_url",
  "image_night_url",
  "price_from",
  "price_was",
  "price_unit",
  "currency_code",
  "is_deal",
  "deal_badge",
  "is_featured",
  "status",
  "itinerary",
  "price_options",
];
const val = (b, c) => (c === "itinerary" || c === "price_options" ? JSON.stringify(b[c]) : b[c]);

async function saveChildren(c, id, b) {
  await c.query("DELETE FROM travel.package_destinations WHERE package_id = $1", [id]);
  const seen = new Set();
  let pos = 0;
  for (const d of b.destinations) {
    if (seen.has(d.destination_id)) continue;
    seen.add(d.destination_id);
    await c.query("INSERT INTO travel.package_destinations (package_id, destination_id, nights, position) VALUES ($1,$2,$3,$4)", [
      id,
      d.destination_id,
      d.nights ?? null,
      pos++,
    ]);
  }
  const keep = b.departures.filter((d) => d.id).map((d) => d.id);
  await c.query("DELETE FROM travel.package_departures WHERE package_id = $1 AND NOT (id = ANY($2::uuid[]))", [id, keep]);
  for (const d of b.departures) {
    if (d.return_date && d.return_date < d.depart_date) throw new HttpError(400, "A return date is before its departure date");
    if (d.seats_sold > d.seats_total) throw new HttpError(400, "Seats sold can’t be more than seats in total");
    if (d.id) {
      await c.query(
        `UPDATE travel.package_departures SET depart_date=$3, return_date=$4, seats_total=$5, seats_sold=$6, price_override=$7, status=$8, updated_at=now()
          WHERE id=$1 AND package_id=$2`,
        [d.id, id, d.depart_date, d.return_date ?? null, d.seats_total, d.seats_sold, d.price_override, d.status],
      );
    } else {
      await c.query(
        `INSERT INTO travel.package_departures (package_id, depart_date, return_date, seats_total, seats_sold, price_override, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, d.depart_date, d.return_date ?? null, d.seats_total, d.seats_sold, d.price_override, d.status],
      );
    }
  }
}

r.post("/", async (req, res) => {
  const b = parse(body, req.body);
  assertPkg(req, b, "create");
  const id = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO travel.packages (${COLS.join(",")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      COLS.map((k) => val(b, k)),
    );
    await saveChildren(c, rows[0].id, b);
    return rows[0].id;
  });
  await audit(me(req).id, "package.create", "package", id, { title: b.title });
  await clearCatalogCache();
  res.status(201).json({ data: await load(id) });
});

r.put("/:id", async (req, res) => {
  const cur = await one("SELECT category, is_deal FROM travel.packages WHERE id = $1", [req.params.id]);
  if (!cur) throw notFound("Package not found");
  assertPkg(req, cur, "edit");
  const b = parse(body, req.body);
  assertPkg(req, b, "edit");
  await tx(async (c) => {
    await c.query(
      `UPDATE travel.packages SET ${COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
      [req.params.id, ...COLS.map((k) => val(b, k))],
    );
    await saveChildren(c, req.params.id, b);
  });
  await audit(me(req).id, "package.update", "package", req.params.id, { title: b.title });
  await clearCatalogCache();
  res.json({ data: await load(req.params.id) });
});

/** Quick toggles from the table: weekly deal, featured, status. */
r.patch("/:id", async (req, res) => {
  const cur = await one("SELECT category, is_deal FROM travel.packages WHERE id = $1", [req.params.id]);
  if (!cur) throw notFound("Package not found");
  const b = parse(
    z.object({
      is_deal: z.boolean().optional(),
      is_featured: z.boolean().optional(),
      status: z.enum(["published", "draft", "archived"]).optional(),
    }),
    req.body,
  );
  if (!canAny(req, [...tabsFor(cur), ...(b.is_deal !== undefined ? ["packages.deals"] : [])], "edit"))
    throw new HttpError(403, "Your role does not allow this");
  const sets = [];
  const vals = [req.params.id];
  for (const [k, v] of Object.entries(b))
    if (v !== undefined) {
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);
    }
  if (!sets.length) throw new HttpError(400, "Nothing to change");
  const row = await one(
    `UPDATE travel.packages SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, is_deal, is_featured, status`,
    vals,
  );
  await audit(me(req).id, "package.update", "package", req.params.id, b);
  await clearCatalogCache();
  res.json({ data: row });
});

r.delete("/:id", async (req, res) => {
  const cur = await one("SELECT category, is_deal, title FROM travel.packages WHERE id = $1", [req.params.id]);
  if (!cur) throw notFound("Package not found");
  assertPkg(req, cur, "delete");
  await query("DELETE FROM travel.packages WHERE id = $1", [req.params.id]);
  await audit(me(req).id, "package.delete", "package", req.params.id, { title: cur.title });
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

export default r;
