// Visa services shown on the site's Visa page.
import { Router } from "express";
import { z } from "zod";
import { assertCan, me } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { clearCatalogCache } from "../../lib/cache";
import { one, query, tx } from "../../lib/db";
import { notFound, parse } from "../../lib/http";

const r = Router();

r.get("/", async (req, res) => {
  assertCan(req, "visa.main", "view");
  const rows = await query(
    `SELECT v.*, c.name AS country, c.flag_emoji,
            (SELECT count(*) FROM travel.bookings b WHERE b.product_type = 'visa' AND b.product_id = v.id
               AND b.status NOT IN ('completed','cancelled','refund')) AS in_progress
       FROM travel.visa_services v JOIN travel.countries c ON c.iso2 = v.country_iso2
      ORDER BY v.sort_order, c.name`,
  );
  res.json({ data: rows });
});

r.get("/countries", async (req, res) => {
  assertCan(req, "visa.main", "view");
  res.json({ data: await query("SELECT iso2, name, flag_emoji FROM travel.countries ORDER BY name") });
});

const body = z.object({
  country_iso2: z.string().trim().toUpperCase().length(2),
  visa_type: z.string().trim().min(2).max(120),
  entry: z.enum(["single", "multiple"]),
  stay_days: z.coerce.number().int().min(0).max(3650).nullish().transform((v) => v ?? null),
  processing_days: z.string().trim().max(60).nullish().transform((v) => v || null),
  price_from: z.union([z.coerce.number().min(0).max(1e9), z.null()]).optional().transform((v) => v ?? null),
  currency_code: z.string().trim().length(3).default("PKR"),
  is_evisa: z.boolean(),
  requirements: z.array(z.string().trim().min(1).max(300)).max(40).default([]),
  is_published: z.boolean().default(true),
});
const COLS = ["country_iso2", "visa_type", "entry", "stay_days", "processing_days", "price_from", "currency_code", "is_evisa", "requirements", "is_published"] as const;

r.post("/", async (req, res) => {
  assertCan(req, "visa.main", "create");
  const b = parse(body, req.body);
  const row = await one<{ id: string }>(
    `INSERT INTO travel.visa_services (${COLS.join(",")}, sort_order) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(",")},
       (SELECT COALESCE(max(sort_order), -1) + 1 FROM travel.visa_services)) RETURNING id`,
    COLS.map((k) => b[k]),
  );
  await audit(me(req).id, "visa.create", "visa_service", row!.id, { country: b.country_iso2, type: b.visa_type });
  await clearCatalogCache();
  res.status(201).json({ data: row });
});

r.put("/:id", async (req, res) => {
  assertCan(req, "visa.main", "edit");
  const b = parse(body, req.body);
  const row = await one(`UPDATE travel.visa_services SET ${COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING id`, [req.params.id, ...COLS.map((k) => b[k])]);
  if (!row) throw notFound("Visa not found");
  await audit(me(req).id, "visa.update", "visa_service", req.params.id, { type: b.visa_type });
  await clearCatalogCache();
  res.json({ data: row });
});

r.patch("/:id", async (req, res) => {
  assertCan(req, "visa.main", "edit");
  const b = parse(z.object({ is_published: z.boolean() }), req.body);
  const row = await one("UPDATE travel.visa_services SET is_published = $2 WHERE id = $1 RETURNING id, is_published", [req.params.id, b.is_published]);
  if (!row) throw notFound("Visa not found");
  await audit(me(req).id, "visa.update", "visa_service", req.params.id, b);
  await clearCatalogCache();
  res.json({ data: row });
});

r.put("/order/all", async (req, res) => {
  assertCan(req, "visa.main", "edit");
  const { ids } = parse(z.object({ ids: z.array(z.uuid()).min(1).max(1000) }), req.body);
  await tx(async (c) => {
    for (const [i, id] of ids.entries()) await c.query("UPDATE travel.visa_services SET sort_order = $2 WHERE id = $1", [id, i]);
  });
  await audit(me(req).id, "visa.reorder", "visa_service", undefined, { count: ids.length });
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

r.delete("/:id", async (req, res) => {
  assertCan(req, "visa.main", "delete");
  const row = await one("DELETE FROM travel.visa_services WHERE id = $1 RETURNING visa_type", [req.params.id]);
  if (!row) throw notFound("Visa not found");
  await audit(me(req).id, "visa.delete", "visa_service", req.params.id, row);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

export default r;
