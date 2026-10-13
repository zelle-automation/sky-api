// Public endpoints the website calls: catalogue reads, enquiries, newsletter, flight search.
import { Router } from "express";
import { z } from "zod";
import {
  excursionCards,
  findCard,
  getDestination,
  hotelCards,
  listDestinations,
  listVisas,
  packageCards,
} from "../lib/catalog.js";
import { query } from "../lib/db.js";
import { HttpError, ipOf, parse } from "../lib/http.js";
import { allow } from "../lib/redis.js";
import { getSetting } from "../lib/settings.js";
import { FlightSearch, searchFlights } from "../lib/providers/flights.js";
import { hotelsNear } from "../lib/providers/osm.js";
import { excursionIdeas } from "../lib/providers/opentripmap.js";

const r = Router();
const str = (v) => (typeof v === "string" && v ? v : undefined);

r.get("/destinations", async (req, res) => {
  res.json({ data: await listDestinations(str(req.query.category)) });
});

r.get("/destinations/:slug", async (req, res) => {
  const d = await getDestination(req.params.slug);
  if (!d) throw new HttpError(404, "Destination not found");
  res.json({ data: d });
});

// ?destination=dubai returns our bookable hotels; add &nearby=1 for OpenStreetMap hotels around it.
r.get("/hotels", async (req, res) => {
  const slug = str(req.query.destination);
  const data = await hotelCards(slug);
  let nearby = null;
  if (slug && req.query.nearby === "1") {
    const d = await getDestination(slug);
    if (d?.lat != null && d.lng != null) nearby = await hotelsNear(d.lat, d.lng).catch((e) => ({ error: e.message }));
  }
  res.json({ data, nearby });
});

// ?destination=istanbul returns our bookable excursions; add &ideas=1 for nearby sights from OpenTripMap/OSM.
r.get("/excursions", async (req, res) => {
  const slug = str(req.query.destination);
  const data = await excursionCards(slug);
  let ideas = null;
  if (slug && req.query.ideas === "1") {
    const d = await getDestination(slug);
    if (d?.lat != null && d.lng != null) ideas = await excursionIdeas(d.lat, d.lng).catch((e) => ({ error: e.message }));
  }
  res.json({ data, ideas });
});

r.get("/packages", async (req, res) => {
  res.json({
    data: await packageCards({
      category: str(req.query.category),
      deals: req.query.deals === "1",
      destination: str(req.query.destination),
    }),
  });
});

r.get("/cards/:type/:slug", async (req, res) => {
  const type = req.params.type;
  if (type !== "hotels" && type !== "excursions" && type !== "packages") throw new HttpError(404, "Unknown type");
  const card = await findCard(type, req.params.slug);
  if (!card) throw new HttpError(404, "Not found");
  res.json({ data: card });
});

r.get("/visas", async (_req, res) => {
  res.json({ data: await listVisas() });
});

r.get("/countries", async (req, res) => {
  const rows = await query(
    `SELECT iso2, iso3, name, region, subregion, capital, currency_code, calling_code, flag_emoji
       FROM travel.countries WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%') ORDER BY name`,
    [str(req.query.q) ?? null],
  );
  res.json({ data: rows });
});

/** Business details and homepage content the website shows (edited in the dashboard). */
r.get("/site", async (_req, res) => {
  const [business, homepage] = await Promise.all([getSetting("business", {}), getSetting("homepage", {})]);
  res.json({ data: { business, homepage } });
});

const Enquiry = z.object({
  service: z.enum(["hotels", "excursions", "packages", "umrah", "visa", "flights", "cars", "transfers", "general"]),
  refType: z.enum(["hotel", "excursion", "package", "destination", "visa"]).optional(),
  refId: z.uuid().optional(),
  name: z.string().trim().min(2, "Please enter your name").max(120),
  phone: z.string().trim().min(7, "Please enter a phone or WhatsApp number").max(30),
  email: z.union([z.email("Please check the email address"), z.literal("")]).optional(),
  travelDate: z.union([z.iso.date(), z.literal("")]).optional(),
  travellers: z.coerce.number().int().min(1).max(50).optional(),
  message: z.string().trim().max(2000).optional(),
});

r.post("/enquiries", async (req, res) => {
  const ip = ipOf(req);
  if (!(await allow(`enquiry:${ip ?? "unknown"}`, 5, 600))) {
    throw new HttpError(429, "Too many requests. Please call us on +92 311 11 33 020.");
  }
  const r0 = Enquiry.safeParse(req.body ?? {});
  if (!r0.success) throw new HttpError(400, r0.error.issues[0]?.message ?? "Please check the form");
  const e = r0.data;
  const rows = await query(
    `INSERT INTO travel.enquiries (service, ref_type, ref_id, name, email, phone, travel_date, travellers, message, source_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      e.service,
      e.refType ?? null,
      e.refId ?? null,
      e.name,
      e.email || null,
      e.phone,
      e.travelDate || null,
      e.travellers ?? null,
      e.message ?? null,
      ip,
    ],
  );
  res.status(201).json({ id: rows[0].id });
});

r.post("/newsletter", async (req, res) => {
  if (!(await allow(`newsletter:${ipOf(req) ?? "unknown"}`, 5, 600)))
    throw new HttpError(429, "Too many requests. Please try again later.");
  const { email } = parse(z.object({ email: z.email("Please check the email address") }), req.body ?? {});
  await query("INSERT INTO travel.newsletter_subscribers (email) VALUES (lower($1)) ON CONFLICT DO NOTHING", [email]);
  res.json({ ok: true });
});

r.post("/flights/search", async (req, res) => {
  const p = FlightSearch.safeParse(req.body ?? {});
  if (!p.success) {
    res.status(400).json({ error: "Check the airports and dates", issues: p.error.issues });
    return;
  }
  try {
    const offers = await searchFlights(p.data);
    if (offers === null) {
      res.json({ data: [], live: false, message: "Live fares are not connected yet. Our travel desk will quote this route." });
      return;
    }
    res.json({ data: offers, live: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default r;
