// Car rental: fleet with daily rates, rental rules (a settings row) and chauffeurs.
import { Router } from "express";
import { z } from "zod";
import { assertCan, me } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { clearCatalogCache } from "../../lib/cache";
import { one, query } from "../../lib/db";
import { HttpError, notFound, parse } from "../../lib/http";
import { getSetting, setSetting } from "../../lib/settings";

const r = Router();
const optText = z.string().trim().max(2000).nullish().transform((v) => (v ? v : null));
const optMoney = z.union([z.coerce.number().min(0).max(1e9), z.null()]).optional().transform((v) => v ?? null);
const strList = z.array(z.string().trim().min(1).max(80)).max(40).default([]);

/** "35202-1234567-1" → "35202-•••••••-1". */
export const maskCnic = (v: string | null) => {
  if (!v) return v;
  const d = v.replace(/\D/g, "");
  return d.length === 13 ? `${d.slice(0, 5)}-•••••••-${d.slice(12)}` : v.slice(0, 2) + "•".repeat(Math.max(0, v.length - 3)) + v.slice(-1);
};
/** "+92 300 5551201" → "+92 3•• ••••201": keeps the first three and last three digits. */
const maskPhone = (p: string | null) => {
  if (!p) return p;
  const n = p.replace(/\D/g, "").length;
  let i = 0;
  return p.replace(/\d/g, (d) => (i++ < 3 || i > n - 3 ? d : "•"));
};

/* ---------------- fleet ---------------- */

r.get("/fleet", async (req, res) => {
  assertCan(req, "cars.fleet", "view");
  res.json({ data: await query("SELECT * FROM travel.rental_cars ORDER BY sort_order, with_driver_daily NULLS LAST, name") });
});

const carBody = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(40),
  seats: z.coerce.number().int().min(1).max(80),
  transmission: z.enum(["automatic", "manual"]),
  with_driver_daily: optMoney,
  self_drive_daily: optMoney,
  cities: strList,
  units: z.coerce.number().int().min(0).max(1000),
  photo_url: optText,
  currency_code: z.string().trim().length(3).default("PKR"),
  is_live: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
}).refine((b) => b.with_driver_daily != null || b.self_drive_daily != null, { message: "Give at least one daily price", path: ["with_driver_daily"] });
const CAR_COLS = ["name", "category", "seats", "transmission", "with_driver_daily", "self_drive_daily", "cities", "units", "photo_url", "currency_code", "is_live", "sort_order"] as const;

r.post("/fleet", async (req, res) => {
  assertCan(req, "cars.fleet", "create");
  const b = parse(carBody, req.body);
  const row = await one<{ id: string }>(`INSERT INTO travel.rental_cars (${CAR_COLS.join(",")}) VALUES (${CAR_COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, CAR_COLS.map((k) => b[k]));
  await audit(me(req).id, "car.create", "rental_car", row!.id, { name: b.name });
  await clearCatalogCache();
  res.status(201).json({ data: row });
});

r.put("/fleet/:id", async (req, res) => {
  assertCan(req, "cars.fleet", "edit");
  const b = parse(carBody, req.body);
  const row = await one(`UPDATE travel.rental_cars SET ${CAR_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`, [req.params.id, ...CAR_COLS.map((k) => b[k])]);
  if (!row) throw notFound("Car not found");
  await audit(me(req).id, "car.update", "rental_car", req.params.id, { name: b.name });
  await clearCatalogCache();
  res.json({ data: row });
});

r.patch("/fleet/:id", async (req, res) => {
  assertCan(req, "cars.fleet", "edit");
  const b = parse(z.object({ is_live: z.boolean() }), req.body);
  const row = await one("UPDATE travel.rental_cars SET is_live = $2, updated_at = now() WHERE id = $1 RETURNING id, is_live", [req.params.id, b.is_live]);
  if (!row) throw notFound("Car not found");
  await audit(me(req).id, "car.update", "rental_car", req.params.id, b);
  await clearCatalogCache();
  res.json({ data: row });
});

r.delete("/fleet/:id", async (req, res) => {
  assertCan(req, "cars.fleet", "delete");
  const row = await one("DELETE FROM travel.rental_cars WHERE id = $1 RETURNING name", [req.params.id]);
  if (!row) throw notFound("Car not found");
  await audit(me(req).id, "car.delete", "rental_car", req.params.id, row);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

/* ---------------- rates & rules ---------------- */

export const CAR_RULES = {
  km_per_day: 250, extra_km_rate: 45, fuel_policy: "customer", outstation_pct: 20, driver_allowance_night: 3000, driver_hours: 10,
  security_deposit: 50000, min_age: 23, documents: ["CNIC", "Valid driving licence", "Utility bill"],
  self_drive_outstation: false, northern_4x4_driver: true, tolls_by_customer: true,
};
const rulesBody = z.object({
  km_per_day: z.coerce.number().int().min(0).max(5000),
  extra_km_rate: z.coerce.number().min(0).max(1e5),
  fuel_policy: z.enum(["customer", "included", "full_to_full"]),
  outstation_pct: z.coerce.number().min(0).max(300),
  driver_allowance_night: z.coerce.number().min(0).max(1e6),
  driver_hours: z.coerce.number().int().min(1).max(24),
  security_deposit: z.coerce.number().min(0).max(1e8),
  min_age: z.coerce.number().int().min(16).max(80),
  documents: strList,
  self_drive_outstation: z.boolean(),
  northern_4x4_driver: z.boolean(),
  tolls_by_customer: z.boolean(),
});

r.get("/rules", async (req, res) => {
  assertCan(req, "cars.rates", "view");
  res.json({ data: await getSetting("cars.rules", CAR_RULES) });
});

r.put("/rules", async (req, res) => {
  assertCan(req, "cars.rates", "edit");
  const v = parse(rulesBody, req.body);
  await setSetting("cars.rules", v, me(req).id);
  await audit(me(req).id, "settings.update", "settings", undefined, { key: "cars.rules" });
  await clearCatalogCache();
  res.json({ data: v });
});

/* ---------------- chauffeurs ---------------- */

type Driver = { id: string; cnic: string | null; phone: string | null; [k: string]: unknown };

r.get("/drivers", async (req, res) => {
  assertCan(req, "cars.drivers", "view");
  const rows = await query<Driver>("SELECT * FROM travel.chauffeurs ORDER BY (status = 'inactive'), name");
  const mask = me(req).limits.maskIds;
  res.json({ data: { rows: mask ? rows.map((d) => ({ ...d, cnic: maskCnic(d.cnic), phone: maskPhone(d.phone) })) : rows, masked: mask } });
});

const driverBody = z.object({
  name: z.string().trim().min(2).max(120),
  phone: optText,
  cnic: z.string().trim().max(20).nullish().transform((v) => (v ? v : null)),
  licence_no: optText,
  licence_type: optText,
  licence_expiry: z.iso.date().nullish().transform((v) => v ?? null),
  languages: strList,
  cities: strList,
  drives: optText,
  rating: z.coerce.number().min(0).max(5).nullish().transform((v) => v ?? null),
  photo_url: optText,
  status: z.enum(["available", "on_trip", "off", "inactive"]),
  notes: optText,
});
const DRV_COLS = ["name", "phone", "cnic", "licence_no", "licence_type", "licence_expiry", "languages", "cities", "drives", "rating", "photo_url", "status", "notes"] as const;

r.post("/drivers", async (req, res) => {
  assertCan(req, "cars.drivers", "create");
  const b = parse(driverBody, req.body);
  if (me(req).limits.maskIds && (b.cnic?.includes("•") || b.phone?.includes("•"))) throw new HttpError(400, "Type the full CNIC and phone");
  const row = await one<{ id: string }>(`INSERT INTO travel.chauffeurs (${DRV_COLS.join(",")}) VALUES (${DRV_COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, DRV_COLS.map((k) => b[k]));
  await audit(me(req).id, "chauffeur.create", "chauffeur", row!.id, { name: b.name });
  res.status(201).json({ data: row });
});

r.put("/drivers/:id", async (req, res) => {
  assertCan(req, "cars.drivers", "edit");
  const b = parse(driverBody, req.body);
  const cur = await one<{ cnic: string | null; phone: string | null }>("SELECT cnic, phone FROM travel.chauffeurs WHERE id = $1", [req.params.id]);
  if (!cur) throw notFound("Chauffeur not found");
  // A masked value sent back unchanged keeps what is stored.
  if (b.cnic?.includes("•")) b.cnic = cur.cnic;
  if (b.phone?.includes("•")) b.phone = cur.phone;
  await query(`UPDATE travel.chauffeurs SET ${DRV_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [req.params.id, ...DRV_COLS.map((k) => b[k])]);
  await audit(me(req).id, "chauffeur.update", "chauffeur", req.params.id, { name: b.name, status: b.status });
  res.json({ data: { id: req.params.id } });
});

r.patch("/drivers/:id", async (req, res) => {
  assertCan(req, "cars.drivers", "edit");
  const b = parse(z.object({ status: z.enum(["available", "on_trip", "off", "inactive"]) }), req.body);
  const row = await one("UPDATE travel.chauffeurs SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status", [req.params.id, b.status]);
  if (!row) throw notFound("Chauffeur not found");
  await audit(me(req).id, "chauffeur.update", "chauffeur", req.params.id, b);
  res.json({ data: row });
});

r.delete("/drivers/:id", async (req, res) => {
  assertCan(req, "cars.drivers", "delete");
  const row = await one("DELETE FROM travel.chauffeurs WHERE id = $1 RETURNING name", [req.params.id]);
  if (!row) throw notFound("Chauffeur not found");
  await audit(me(req).id, "chauffeur.delete", "chauffeur", req.params.id, row);
  res.json({ data: { ok: true } });
});

export default r;
