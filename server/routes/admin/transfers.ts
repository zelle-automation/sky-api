// Transfers: airport routes and city-to-city routes priced per vehicle type, their rules
// (settings rows), and the vehicle types shared with car rental.
import { Router, type Request } from "express";
import { z } from "zod";
import { assertCan, canAny, me } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { clearCatalogCache } from "../../lib/cache";
import { one, query, tx } from "../../lib/db";
import { HttpError, notFound, parse } from "../../lib/http";
import { getSetting, setSetting } from "../../lib/settings";

const r = Router();
const KINDS = ["airport", "intercity"] as const;
type Kind = (typeof KINDS)[number];
const kindOf = (v: unknown): Kind => {
  if (v === "airport" || v === "intercity") return v;
  throw new HttpError(400, "Unknown route type");
};
const optText = z.string().trim().max(2000).nullish().transform((v) => (v ? v : null));

export const AIRPORT_RULES = {
  free_wait_min: 60, night_surcharge_pct: 20, night_from: "22:00", night_to: "06:00", cutoff_hours: 12,
  child_seat_price: 2500, extra_stop_price: 3000, flight_tracking: true, name_board: true, whatsapp_driver: true,
};
export const INTERCITY_RULES = {
  return_discount_pct: 10, stopover_per_hour: 3000, driver_overnight: 4000, northern_suv_only: true, tolls_included: true,
};

/* ---------------- vehicles ---------------- */

r.get("/vehicles", async (req, res) => {
  if (!canAny(req, ["transfers.vehicles", "transfers.airport", "transfers.intercity", "cars.fleet"], "view")) throw new HttpError(403, "Your role does not allow this");
  res.json({
    data: await query(
      `SELECT v.*, (SELECT count(*) FROM travel.transfer_route_prices p WHERE p.vehicle_type_id = v.id) AS routes
         FROM travel.vehicle_types v ORDER BY v.sort_order, v.passengers`,
    ),
  });
});

const vehBody = z.object({
  name: z.string().trim().min(2).max(60),
  examples: optText,
  passengers: z.coerce.number().int().min(1).max(80),
  bags: z.coerce.number().int().min(0).max(80),
  units: z.coerce.number().int().min(0).max(1000),
  used_for: z.string().trim().max(120).default("All transfers"),
  photo_url: optText,
  is_active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});
const VEH_COLS = ["name", "examples", "passengers", "bags", "units", "used_for", "photo_url", "is_active", "sort_order"] as const;

r.post("/vehicles", async (req, res) => {
  assertCan(req, "transfers.vehicles", "create");
  const b = parse(vehBody, req.body);
  const row = await one<{ id: string }>(`INSERT INTO travel.vehicle_types (${VEH_COLS.join(",")}) VALUES (${VEH_COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, VEH_COLS.map((k) => b[k]));
  await audit(me(req).id, "vehicle.create", "vehicle_type", row!.id, { name: b.name });
  await clearCatalogCache();
  res.status(201).json({ data: row });
});

r.put("/vehicles/:id", async (req, res) => {
  assertCan(req, "transfers.vehicles", "edit");
  const b = parse(vehBody, req.body);
  const row = await one(`UPDATE travel.vehicle_types SET ${VEH_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING id`, [req.params.id, ...VEH_COLS.map((k) => b[k])]);
  if (!row) throw notFound("Vehicle not found");
  await audit(me(req).id, "vehicle.update", "vehicle_type", req.params.id, { name: b.name });
  await clearCatalogCache();
  res.json({ data: row });
});

r.patch("/vehicles/:id", async (req, res) => {
  assertCan(req, "transfers.vehicles", "edit");
  const b = parse(z.object({ is_active: z.boolean() }), req.body);
  const row = await one("UPDATE travel.vehicle_types SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id, is_active", [req.params.id, b.is_active]);
  if (!row) throw notFound("Vehicle not found");
  await audit(me(req).id, "vehicle.update", "vehicle_type", req.params.id, b);
  await clearCatalogCache();
  res.json({ data: row });
});

r.delete("/vehicles/:id", async (req, res) => {
  assertCan(req, "transfers.vehicles", "delete");
  const row = await one("DELETE FROM travel.vehicle_types WHERE id = $1 RETURNING name", [req.params.id]);
  if (!row) throw notFound("Vehicle not found");
  await audit(me(req).id, "vehicle.delete", "vehicle_type", req.params.id, row);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

/* ---------------- routes ---------------- */

const can = (req: Request, kind: Kind, action: "view" | "create" | "edit" | "delete") => assertCan(req, `transfers.${kind}`, action);

r.get("/routes", async (req, res) => {
  const kind = kindOf(req.query.kind);
  can(req, kind, "view");
  const rows = await query(
    `SELECT t.*, COALESCE((SELECT json_object_agg(p.vehicle_type_id, p.price) FROM travel.transfer_route_prices p WHERE p.route_id = t.id), '{}') AS prices
       FROM travel.transfer_routes t WHERE t.kind = $1 ORDER BY t.sort_order, t.from_label, t.to_label`,
    [kind],
  );
  res.json({ data: rows });
});

const routeBody = z.object({
  kind: z.enum(KINDS),
  airport_code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter airport code").nullish().transform((v) => v ?? null),
  from_label: z.string().trim().min(2).max(120),
  to_label: z.string().trim().min(2).max(120),
  distance_km: z.coerce.number().int().min(0).max(5000).nullish().transform((v) => v ?? null),
  duration_min: z.coerce.number().int().min(0).max(5000).nullish().transform((v) => v ?? null),
  meet_greet: z.boolean().default(true),
  notes: optText,
  currency_code: z.string().trim().length(3).default("PKR"),
  is_live: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
  prices: z.record(z.uuid(), z.union([z.coerce.number().min(0).max(1e9), z.null()])).default({}),
}).refine((b) => b.kind !== "airport" || b.airport_code, { message: "Airport code is needed", path: ["airport_code"] });
const ROUTE_COLS = ["kind", "airport_code", "from_label", "to_label", "distance_km", "duration_min", "meet_greet", "notes", "currency_code", "is_live", "sort_order"] as const;

async function savePrices(c: import("pg").PoolClient, id: string, prices: Record<string, number | null>) {
  await c.query("DELETE FROM travel.transfer_route_prices WHERE route_id = $1", [id]);
  for (const [v, p] of Object.entries(prices)) {
    if (p == null) continue;
    await c.query("INSERT INTO travel.transfer_route_prices (route_id, vehicle_type_id, price) VALUES ($1,$2,$3)", [id, v, p]);
  }
}

r.post("/routes", async (req, res) => {
  const b = parse(routeBody, req.body);
  can(req, b.kind, "create");
  const id = await tx(async (c) => {
    const { rows } = await c.query(`INSERT INTO travel.transfer_routes (${ROUTE_COLS.join(",")}) VALUES (${ROUTE_COLS.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, ROUTE_COLS.map((k) => b[k]));
    await savePrices(c, rows[0].id, b.prices);
    return rows[0].id as string;
  });
  await audit(me(req).id, "transfer_route.create", "transfer_route", id, { from: b.from_label, to: b.to_label });
  await clearCatalogCache();
  res.status(201).json({ data: { id } });
});

r.put("/routes/:id", async (req, res) => {
  const cur = await one<{ kind: Kind }>("SELECT kind FROM travel.transfer_routes WHERE id = $1", [req.params.id]);
  if (!cur) throw notFound("Route not found");
  can(req, cur.kind, "edit");
  const b = parse(routeBody, { ...req.body, kind: cur.kind });
  await tx(async (c) => {
    await c.query(`UPDATE travel.transfer_routes SET ${ROUTE_COLS.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [req.params.id, ...ROUTE_COLS.map((k) => b[k])]);
    await savePrices(c, req.params.id, b.prices);
  });
  await audit(me(req).id, "transfer_route.update", "transfer_route", req.params.id, { from: b.from_label, to: b.to_label });
  await clearCatalogCache();
  res.json({ data: { id: req.params.id } });
});

r.patch("/routes/:id", async (req, res) => {
  const cur = await one<{ kind: Kind }>("SELECT kind FROM travel.transfer_routes WHERE id = $1", [req.params.id]);
  if (!cur) throw notFound("Route not found");
  can(req, cur.kind, "edit");
  const b = parse(z.object({ is_live: z.boolean() }), req.body);
  const row = await one("UPDATE travel.transfer_routes SET is_live = $2, updated_at = now() WHERE id = $1 RETURNING id, is_live", [req.params.id, b.is_live]);
  await audit(me(req).id, "transfer_route.update", "transfer_route", req.params.id, b);
  await clearCatalogCache();
  res.json({ data: row });
});

r.delete("/routes/:id", async (req, res) => {
  const cur = await one<{ kind: Kind; from_label: string; to_label: string }>("SELECT kind, from_label, to_label FROM travel.transfer_routes WHERE id = $1", [req.params.id]);
  if (!cur) throw notFound("Route not found");
  can(req, cur.kind, "delete");
  await query("DELETE FROM travel.transfer_routes WHERE id = $1", [req.params.id]);
  await audit(me(req).id, "transfer_route.delete", "transfer_route", req.params.id, cur);
  await clearCatalogCache();
  res.json({ data: { ok: true } });
});

/* ---------------- rules ---------------- */

const airportRules = z.object({
  free_wait_min: z.coerce.number().int().min(0).max(600),
  night_surcharge_pct: z.coerce.number().min(0).max(300),
  night_from: z.string().regex(/^\d{2}:\d{2}$/),
  night_to: z.string().regex(/^\d{2}:\d{2}$/),
  cutoff_hours: z.coerce.number().int().min(0).max(240),
  child_seat_price: z.coerce.number().min(0).max(1e6),
  extra_stop_price: z.coerce.number().min(0).max(1e6),
  flight_tracking: z.boolean(),
  name_board: z.boolean(),
  whatsapp_driver: z.boolean(),
});
const intercityRules = z.object({
  return_discount_pct: z.coerce.number().min(0).max(100),
  stopover_per_hour: z.coerce.number().min(0).max(1e6),
  driver_overnight: z.coerce.number().min(0).max(1e6),
  northern_suv_only: z.boolean(),
  tolls_included: z.boolean(),
});

r.get("/rules/:kind", async (req, res) => {
  const kind = kindOf(req.params.kind);
  can(req, kind, "view");
  res.json({ data: await getSetting(`transfers.${kind}`, kind === "airport" ? AIRPORT_RULES : INTERCITY_RULES) });
});

r.put("/rules/:kind", async (req, res) => {
  const kind = kindOf(req.params.kind);
  can(req, kind, "edit");
  const v = kind === "airport" ? parse(airportRules, req.body) : parse(intercityRules, req.body);
  await setSetting(`transfers.${kind}`, v, me(req).id);
  await audit(me(req).id, "settings.update", "settings", undefined, { key: `transfers.${kind}` });
  await clearCatalogCache();
  res.json({ data: v });
});

export default r;
