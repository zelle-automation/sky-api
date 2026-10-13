// Destinations: ordered cards (sort_order drives the site carousel), publish switch, editor.
import { Router } from "express";
import { z } from "zod";
import { assertCan, me } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { clearCatalogCache } from "../../lib/cache";
import { one, query, tx } from "../../lib/db";
import { HttpError, notFound, parse } from "../../lib/http";

const r = Router();
const optText = z.string().trim().max(5000).nullish().transform((v) => (v ? v : null));

r.get("/", async (req, res) => {
  assertCan(req, "destinations.main", "view");
  const rows = await query(
    `SELECT d.*, c.name AS country_name, c.flag_emoji,
            (SELECT count(*) FROM travel.hotels h WHERE h.destination_id = d.id) AS hotels,
            (SELECT count(*) FROM travel.excursions e WHERE e.destination_id = d.id) AS excursions,
            (SELECT count(*) FROM travel.package_destinations pd WHERE pd.destination_id = d.id) AS packages
       FROM travel.destinations d JOIN travel.countries c ON c.iso2 = d.country_iso2
      ORDER BY d.sort_order, d.name`,
  );
  res.json({ data: rows });
});

r.get("/countries", async (req, res) => {
  assertCan(req, "destinations.main", "view");
  res.json({ data: await query("SELECT iso2, name, flag_emoji FROM travel.countries ORDER BY name") });
});

const coord = (max: number) => z.union([z.coerce.number().min(-max).max(max), z.null()]).optional().transform((v) => v ?? null);
const body = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, numbers and dashes").max(100),
  country_iso2: z.string().trim().toUpperCase().length(2),
  category: z.enum(["international", "domestic", "umrah"]),
  tagline: optText,
  description: optText,
  best_time: optText,
  flight_note: optText,
  lat: coord(90),
  lng: coord(180),
  price_from: z.union([z.coerce.number().min(0).max(1e9), z.null()]).optional().transform((v) => v ?? null),
  currency_code: z.string().trim().length(3).default("PKR"),
  image_day_url: optText,
  image_night_url: optText,
  is_featured: z.boolean().default(false),
  is_published: z.boolean().default(true),
});
const COLS = ["name", "slug", "country_iso2", "category", "tagline", "description", "best_time", "flight_note", "lat", "lng", "price_from",
  "currency_code", "image_day_url", "image_night_url", "is_featured", "is_published"] as const;

r.post("/", async (req, res) => {
  assertCan(req, "destinations.main", "create");
  const b = parse(body, req.body);
  const row = await one<{ id: string }>(
    `INSERT INTO travel.destinations (${COLS.join(",")}, cover_image_url, sort_order)
     VALUES (${COLS.map((_, i) => `$${i + 1}`).join(",")}, $${COLS.length + 1}, (SELECT COALESCE(max(sort_order), -1) + 1 FROM travel.destinations)) RETURNING id`,
    [...COLS.map((k) => b[k]), b.image_day_url],
  );
  await audit(me(req).id, "destination.create", "destination", row!.id, { name: b.name });
  await clearCatalogCache();
  res.status(201).json({ data: row });
});

r.put("/:id", async (req, res) => {
  assertCan(req, "destinations.main", "edit");
  const b = parse(body, req.body);
  const row = await one(
    `UPDATE travel.destinations SET ${COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, cover_image_url = COALESCE($${COLS.length + 2}, cover_image_url), updated_at = now()
      WHERE id = $1 RETURNING id`,
    [req.params.id, ...COLS.map((k) => b[k]), b.image_day_url],
  );
  if (!row) throw notFound("Destination not found");
  await audit(me(req).id, "destination.update", "destination", req.params.id, { name: b.name });
  await clearCatalogCache();
  res.json({ data: row });
});

r.patch("/:id", async (req, res) => {
  assertCan(req, "destinations.main", "edit");
  const b = parse(z.object({ is_published: z.boolean().optional(), is_featured: z.boolean().optional() }), req.body);
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) throw new HttpError(400, "Nothing to change");
  const row = await one(
    `UPDATE travel.destinations SET ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, is_published, is_featured`,
    [req.params.id, ...entries.map(([, v]) => v)],
  );
  if (!row) throw notFound("Destination not found");
  await audit(me(req).id, "destination.update", "destination", req.params.id, b);
  await clearCatalogCache();
  res.json({ data: row });
});

/** New order of every card, first to last. */
r.put("/order/all", async (req, res) => {
  assertCan(req, "destinations.main", "edit");
  const { ids } = parse(z.object({ ids: z.array(z.uuid()).min(1).max(1000) }), req.body);
  await tx(async (c) => {
    for (const [i, id] of ids.entries()) await c.query("UPDATE travel.destinations SET sort_order = $2 WHERE id = $1", [id, i]);
  });
  await audit(me(req).id, "destination.reorder", "destination", undefined, { count: ids.length });
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

r.delete("/:id", async (req, res) => {
  assertCan(req, "destinations.main", "delete");
  const row = await one("DELETE FROM travel.destinations WHERE id = $1 RETURNING name", [req.params.id]);
  if (!row) throw notFound("Destination not found");
  await audit(me(req).id, "destination.delete", "destination", req.params.id, row);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

export default r;
