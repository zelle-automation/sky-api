// Demo data for services: package itineraries & departures, Umrah (hotels, rates, flexible
// packages, group departures), transfers, vehicles, car fleet and chauffeurs. Safe to re-run.
import type { Client } from "pg";

const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function id(c: Client, sql: string, params: unknown[]): Promise<string | null> {
  return (await c.query(sql, params)).rows[0]?.id ?? null;
}

/* ---------- vehicles ---------- */
const VEH: [string, string, number, number, number, string, string][] = [
  ["Sedan", "Toyota Camry or similar", 3, 2, 14, "All transfers", "car"],
  ["SUV", "GMC Yukon or similar", 6, 5, 9, "All transfers", "car"],
  ["Van", "Toyota Hiace", 10, 8, 7, "All transfers", "van"],
  ["Coaster", "Toyota Coaster", 22, 16, 3, "Groups and Umrah", "van"],
];

/* ---------- routes: [from, code, to, prices sedan/suv/van/coaster] ---------- */
const AIRPORT: [string, string, string, number[]][] = [
  ["Jeddah (JED)", "JED", "Makkah hotels", [18000, 32000, 38000, 72000]],
  ["Madinah (MED)", "MED", "Madinah hotels", [9000, 16000, 22000, 45000]],
  ["Dubai (DXB)", "DXB", "Dubai hotels", [14000, 24000, 30000, 0]],
  ["Islamabad (ISB)", "ISB", "Islamabad & Rawalpindi", [4500, 8000, 12000, 22000]],
  ["Lahore (LHE)", "LHE", "Lahore city", [3500, 7000, 10000, 18000]],
  ["Karachi (KHI)", "KHI", "Karachi city", [3500, 7000, 10000, 18000]],
  ["Skardu (KDU)", "KDU", "Skardu hotels", [4000, 7500, 11000, 0]],
];
const INTERCITY: [string, string, number, number, number[]][] = [
  ["Jeddah", "Makkah", 85, 75, [15000, 26000, 32000, 60000]],
  ["Makkah", "Madinah", 450, 270, [38000, 62000, 75000, 140000]],
  ["Madinah", "Jeddah Airport", 420, 255, [36000, 60000, 72000, 135000]],
  ["Dubai", "Abu Dhabi", 140, 100, [22000, 36000, 42000, 0]],
  ["Islamabad", "Murree", 60, 90, [9000, 14000, 18000, 32000]],
  ["Islamabad", "Naran", 245, 360, [28000, 42000, 48000, 85000]],
  ["Islamabad", "Hunza (Karimabad)", 600, 840, [65000, 95000, 110000, 0]],
  ["Islamabad", "Skardu", 620, 900, [68000, 98000, 115000, 0]],
  ["Lahore", "Islamabad", 375, 270, [24000, 38000, 45000, 80000]],
];

/* ---------- car rental ---------- */
const CARS: [string, string, number, string, number, number | null, string[], number][] = [
  ["Toyota Corolla GLi", "Sedan", 5, "automatic", 9000, 7000, ["Karachi", "Lahore", "Islamabad"], 6],
  ["Honda Civic RS", "Sedan", 5, "automatic", 12000, 10000, ["Karachi", "Lahore", "Islamabad"], 4],
  ["Toyota Fortuner", "SUV", 7, "automatic", 22000, null, ["Islamabad", "Lahore"], 3],
  ["Toyota Land Cruiser Prado", "4x4", 7, "automatic", 28000, null, ["Islamabad", "Skardu", "Hunza"], 2],
  ["Toyota Hiace Grand Cabin", "Van", 13, "manual", 18000, null, ["All cities"], 4],
  ["Toyota Coaster", "Bus", 29, "manual", 32000, null, ["All cities"], 2],
];
const DRIVERS: [string, string, string, string, string, string, string[], string[], string, number, string][] = [
  ["Muhammad Arif", "+92 300 5551201", "35202-4518832-1", "LHR-HTV-208811", "LTV + HTV", "2028-03-31", ["Urdu", "English"], ["Lahore", "Islamabad"], "Hiace, Coaster", 4.9, "available"],
  ["Shahid Iqbal", "+92 321 4410982", "35201-9927314-5", "LHR-LTV-551203", "LTV", "2027-08-15", ["Urdu", "Punjabi"], ["Lahore"], "Corolla, Civic", 4.8, "on_trip"],
  ["Gul Khan", "+92 345 9012233", "71503-2281946-7", "GLT-LTV-030771", "LTV", "2029-01-10", ["Urdu", "Pashto", "Shina"], ["Islamabad", "Gilgit", "Hunza", "Skardu"], "Prado, Fortuner", 4.9, "available"],
  ["Abdul Rehman", "+966 55 812 4471", "42101-6634502-3", "KSA-PRV-7781020", "LTV", "2027-02-28", ["Urdu", "Arabic"], ["Makkah", "Madinah", "Jeddah"], "GMC (Saudi)", 4.7, "off"],
];

/* ---------- Umrah hotels: [city, name, stars, distance m, label, base rates q/t/d/s] ---------- */
const UHOTELS: [string, string, number, number, string, number[]][] = [
  ["makkah", "Swissôtel Makkah", 5, 0, "Haram view, 0 m", [24000, 27000, 32000, 44000]],
  ["makkah", "Le Méridien Towers", 5, 1600, "Shuttle, 1.6 km", [9500, 11000, 13500, 19000]],
  ["makkah", "Elaf Al Mashaer", 4, 250, "3 min walk", [13000, 15000, 18000, 25000]],
  ["makkah", "Saja Makkah", 4, 1400, "Shuttle, 1.4 km", [6500, 7500, 9000, 13000]],
  ["madinah", "Pullman ZamZam Madinah", 5, 150, "2 min walk", [15000, 17000, 20000, 28000]],
  ["madinah", "Dar Al Taqwa", 4, 80, "1 min walk", [11000, 12500, 15000, 21000]],
  ["madinah", "Al Eiman Royal", 3, 400, "5 min walk", [6000, 7000, 8500, 12000]],
];

type Flex = {
  slug: string; title: string; kind: string; tier: string | null; note: string; total: number; mk: number; md: number; lead: number;
  uplift: number; visa: number; transport: number; tlabel: string; ziyarat: number; fee: number; live: boolean; hotels: string[]; summary: string;
};
const FLEX: Flex[] = [
  { slug: "umrah-any-date-economy", title: "Umrah any date · Economy", kind: "flexible", tier: "economy", note: "3★ and 4★, shuttle or short walk", total: 10, mk: 5, md: 4, lead: 14, uplift: 35, visa: 72000, transport: 21000, tlabel: "GMC shared", ziyarat: 6000, fee: 12000, live: true, hotels: ["Saja Makkah", "Le Méridien Towers", "Elaf Al Mashaer", "Al Eiman Royal", "Dar Al Taqwa"], summary: "Pick your own dates and hotels on a budget." },
  { slug: "umrah-any-date-standard", title: "Umrah any date · Standard", kind: "flexible", tier: "standard", note: "4★, 3 minutes or less", total: 10, mk: 5, md: 4, lead: 14, uplift: 35, visa: 72000, transport: 21000, tlabel: "GMC shared", ziyarat: 6000, fee: 12000, live: true, hotels: ["Elaf Al Mashaer", "Dar Al Taqwa"], summary: "Walk to the Haram from 4★ hotels." },
  { slug: "umrah-any-date-premium", title: "Umrah any date · Premium", kind: "flexible", tier: "premium", note: "5★, Haram view in Makkah", total: 7, mk: 4, md: 3, lead: 7, uplift: 35, visa: 72000, transport: 38000, tlabel: "Private GMC", ziyarat: 9000, fee: 18000, live: true, hotels: ["Swissôtel Makkah", "Pullman ZamZam Madinah"], summary: "Haram view rooms and private transport." },
  { slug: "umrah-visa-transport-only", title: "Umrah visa & transport only", kind: "visa_transport", tier: null, note: "Guest books their own hotels", total: 0, mk: 0, md: 0, lead: 7, uplift: 0, visa: 72000, transport: 12000, tlabel: "Shared coach", ziyarat: 6000, fee: 5000, live: true, hotels: [], summary: "Umrah visa with airport and Makkah–Madinah transport." },
  { slug: "ramadan-umrah-flexible", title: "Ramadan Umrah · flexible", kind: "ramadan", tier: "standard", note: "Last ten nights pricing applies", total: 10, mk: 6, md: 3, lead: 21, uplift: 35, visa: 72000, transport: 21000, tlabel: "GMC shared", ziyarat: 6000, fee: 15000, live: false, hotels: ["Elaf Al Mashaer", "Swissôtel Makkah", "Dar Al Taqwa", "Pullman ZamZam Madinah"], summary: "Spend the last ten nights of Ramadan in Makkah." },
];

/* ---------- packages: itineraries, price options, departures ---------- */
type PkgDemo = { itinerary: [string, string, string][]; exclusions: string[]; options: [string, number, number, number][]; deps?: [string, string | null, number, number][] };
const day = (d: string, title: string, text = ""): [string, string, string] => [d, title, text];
const PKG: Record<string, PkgDemo> = {
  "economy-umrah-15-nights": {
    itinerary: [day("Day 1", "Fly Karachi to Jeddah", "Meet the group leader, transfer to Makkah"), day("Day 2–8", "Makkah", "Umrah with the group leader, stay near the Haram"), day("Day 9", "Train to Madinah", "Haramain train, standard class"), day("Day 10–15", "Madinah", "Ziyarat of Masjid Quba, Uhud and the Seven Mosques"), day("Day 16", "Fly Madinah to Karachi")],
    exclusions: ["Personal expenses", "Meals not listed", "Excess baggage"],
    options: [["Quad", 349000, 296650, 65000], ["Triple", 379000, 322150, 65000], ["Double", 429000, 364650, 65000]],
  },
  "dubai-family-escape": {
    itinerary: [day("Day 1", "Arrive in Dubai", "Airport pickup and hotel check-in"), day("Day 2", "City tour and Dubai Frame"), day("Day 3", "Desert safari with BBQ dinner"), day("Day 4", "Free day", "Optional Aquaventure or Global Village"), day("Day 5", "Transfer to the airport")],
    exclusions: ["UAE tourism dirham fee", "Lunches and dinners", "Visa (add it under Visa services)"],
    options: [["Twin share", 189000, 160000, 30000], ["Single", 274000, 0, 0]],
  },
  "turkish-delight": {
    itinerary: [day("Day 1", "Arrive in Istanbul"), day("Day 2", "Old City tour", "Blue Mosque, Hagia Sophia, Grand Bazaar"), day("Day 3", "Bosphorus cruise"), day("Day 4", "Fly to Cappadocia"), day("Day 5", "Balloon flight at sunrise (optional)", "Göreme open-air museum"), day("Day 6", "Underground city tour"), day("Day 7", "Fly back to Istanbul, free evening"), day("Day 8", "Transfer to the airport")],
    exclusions: ["Balloon flight", "Turkish visa", "Tips"],
    options: [["Twin share", 412000, 350000, 30000], ["Single", 597000, 0, 0]],
  },
  "northern-areas-grand-tour": {
    itinerary: [day("Day 1", "Islamabad to Naran", "Via Kaghan Valley"), day("Day 2", "Naran to Hunza", "Babusar Top and Chilas"), day("Day 3", "Hunza", "Baltit Fort, Eagle’s Nest at sunset"), day("Day 4", "Attabad Lake and Passu Cones"), day("Day 5", "Hunza to Skardu"), day("Day 6", "Shangrila and Upper Kachura lakes"), day("Day 7", "Fly Skardu to Islamabad")],
    exclusions: ["Lunches", "Jeep safaris not listed", "Personal expenses"],
    options: [["Twin share", 124000, 105000, 15000], ["Single", 168000, 0, 0]],
    deps: [["2026-10-24", "2026-10-30", 18, 14], ["2026-11-07", "2026-11-13", 18, 9], ["2027-04-17", "2027-04-23", 18, 2], ["2027-05-08", "2027-05-14", 18, 0]],
  },
  "maldives-overwater": {
    itinerary: [day("Day 1", "Arrive in Malé", "Seaplane to the resort"), day("Day 2", "Snorkelling on the house reef"), day("Day 3", "Sunset dolphin cruise"), day("Day 4", "Spa and free day"), day("Day 5", "Seaplane back to Malé")],
    exclusions: ["Green tax", "Drinks", "Excursions not listed"],
    options: [["Twin share", 689000, 0, 45000]],
  },
  "baku-city-break": {
    itinerary: [day("Day 1", "Arrive in Baku", "Old City walk at night"), day("Day 2", "Gobustan and mud volcanoes"), day("Day 3", "Gabala day trip", "Cable car in the Tufandag mountains"), day("Day 4", "Transfer to the airport")],
    exclusions: ["Azerbaijan e-visa", "Lunches"],
    options: [["Twin share", 159000, 135000, 25000], ["Single", 219000, 0, 0]],
  },
  "bali-island-escape": {
    itinerary: [day("Day 1", "Arrive in Bali"), day("Day 2", "Ubud tour", "Rice terraces and Monkey Forest"), day("Day 3", "Nusa Penida day trip"), day("Day 4", "Uluwatu temple and Kecak dance"), day("Day 5", "Free day"), day("Day 6", "Transfer to the airport")],
    exclusions: ["Indonesia visa", "Tourist levy"],
    options: [["Twin share", 239000, 203000, 30000], ["Single", 339000, 0, 0]],
  },
  "skardu-by-air": {
    itinerary: [day("Day 1", "Fly Islamabad to Skardu", "Check in, Shangrila Lake"), day("Day 2", "Deosai Plains by jeep"), day("Day 3", "Cold desert and Manthal Buddha rock"), day("Day 4", "Fly Skardu to Islamabad")],
    exclusions: ["Flight changes due to weather", "Lunches"],
    options: [["Twin share", 72000, 61000, 12000], ["Single", 96000, 0, 0]],
    deps: [["2026-10-31", "2026-11-03", 20, 12], ["2026-11-21", "2026-11-24", 20, 5]],
  },
};

/* ---------- Umrah group departures ---------- */
type Group = [string, string, string, string, string, string, string, string, number, number, number, number, number, string, string, string];
// [package slug, depart, return, city, airline, flight, route, leader, seats sold, seats total, quad, triple, double, visa status, visa note, leader phone]
const GROUPS: Group[] = [
  ["economy-umrah-15-nights", "2026-11-14", "2026-11-29", "Karachi", "Saudia", "SV 701", "KHI→JED", "Maulana Faheem", 38, 45, 349000, 379000, 429000, "passports_missing", "6 passports missing", "+92 300 2234567"],
  ["economy-umrah-15-nights", "2026-11-21", "2026-12-06", "Lahore", "PIA", "PK 741", "LHE→JED", "Qari Usman", 29, 45, 349000, 379000, 429000, "filing_open", "", "+92 321 7788990"],
  ["premium-umrah-10-nights", "2026-12-05", "2026-12-15", "Islamabad", "Saudia", "SV 727", "ISB→MED", "Mufti Adnan", 18, 30, 529000, 569000, 639000, "filing_open", "", "+92 333 5123400"],
  ["economy-umrah-15-nights", "2026-12-19", "2027-01-03", "Karachi", "Saudia", "SV 701", "KHI→JED", "Maulana Faheem", 12, 45, 365000, 395000, 445000, "not_started", "", "+92 300 2234567"],
  ["family-umrah-21-nights", "2027-01-02", "2027-01-23", "Karachi", "Airblue", "PA 870", "KHI→JED", "Qari Usman", 6, 40, 455000, 489000, 549000, "not_started", "", "+92 321 7788990"],
  ["economy-umrah-15-nights", "2027-01-16", "2027-01-31", "Islamabad", "PIA", "PK 761", "ISB→JED", "Mufti Adnan", 3, 45, 349000, 379000, 429000, "not_started", "", "+92 333 5123400"],
];
const EXTRA_UMRAH_PKGS: [string, string, number, number, string, number, number | null, string[]][] = [
  ["premium-umrah-10-nights", "Premium Umrah, 10 Nights", 11, 10, "Makkah 5N · Madinah 5N", 529000, 569000, ["Umrah visa", "Return flights", "5★ hotels", "Private transport", "Ziyarat", "Group leader"]],
  ["family-umrah-21-nights", "Family Umrah, 21 Nights", 22, 21, "Makkah 12N · Madinah 9N", 455000, null, ["Umrah visa", "Return flights", "Hotels", "Saudia transport", "Ziyarat", "Group leader"]],
];

export async function run(c: Client) {
  /* vehicles */
  const veh: string[] = [];
  for (const [i, [name, ex, pax, bags, units, used]] of VEH.entries()) {
    veh.push((await c.query(
      `INSERT INTO travel.vehicle_types (name, examples, passengers, bags, units, used_for, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (name) DO UPDATE SET examples = EXCLUDED.examples, passengers = EXCLUDED.passengers, bags = EXCLUDED.bags,
         units = EXCLUDED.units, used_for = EXCLUDED.used_for, sort_order = EXCLUDED.sort_order RETURNING id`,
      [name, ex, pax, bags, units, used, i],
    )).rows[0].id);
  }

  /* transfer routes */
  const route = async (kind: string, code: string | null, from: string, to: string, km: number | null, min: number | null, prices: number[], pos: number) => {
    const rid = (await c.query(
      `INSERT INTO travel.transfer_routes (kind, airport_code, from_label, to_label, distance_km, duration_min, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (kind, from_label, to_label) DO UPDATE SET airport_code = EXCLUDED.airport_code, distance_km = EXCLUDED.distance_km,
         duration_min = EXCLUDED.duration_min, sort_order = EXCLUDED.sort_order RETURNING id`,
      [kind, code, from, to, km, min, pos],
    )).rows[0].id;
    await c.query("DELETE FROM travel.transfer_route_prices WHERE route_id = $1", [rid]);
    for (const [i, p] of prices.entries()) if (p) await c.query("INSERT INTO travel.transfer_route_prices (route_id, vehicle_type_id, price) VALUES ($1,$2,$3)", [rid, veh[i], p]);
  };
  for (const [i, [from, code, to, p]] of AIRPORT.entries()) await route("airport", code, from, to, null, null, p, i);
  for (const [i, [from, to, km, min, p]] of INTERCITY.entries()) await route("intercity", null, from, to, km, min, p, i);

  /* car rental */
  for (const [i, [name, cat, seats, tr, wd, sd, cities, units]] of CARS.entries()) {
    await c.query(
      `INSERT INTO travel.rental_cars (name, category, seats, transmission, with_driver_daily, self_drive_daily, cities, units, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category, seats = EXCLUDED.seats, transmission = EXCLUDED.transmission,
         with_driver_daily = EXCLUDED.with_driver_daily, self_drive_daily = EXCLUDED.self_drive_daily, cities = EXCLUDED.cities, units = EXCLUDED.units, sort_order = EXCLUDED.sort_order`,
      [name, cat, seats, tr, wd, sd, cities, units, i],
    );
  }
  for (const [name, phone, cnic, lic, ltype, exp, langs, cities, drives, rating, status] of DRIVERS) {
    await c.query(
      `INSERT INTO travel.chauffeurs (name, phone, cnic, licence_no, licence_type, licence_expiry, languages, cities, drives, rating, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (name, phone) DO UPDATE SET cnic = EXCLUDED.cnic, licence_no = EXCLUDED.licence_no, licence_type = EXCLUDED.licence_type,
         licence_expiry = EXCLUDED.licence_expiry, languages = EXCLUDED.languages, cities = EXCLUDED.cities, drives = EXCLUDED.drives, rating = EXCLUDED.rating, status = EXCLUDED.status`,
      [name, phone, cnic, lic, ltype, exp, langs, cities, drives, rating, status],
    );
  }

  /* Umrah hotels and rates */
  const hotelId: Record<string, string> = {};
  for (const [i, [city, name, stars, dist, label, rates]] of UHOTELS.entries()) {
    const dest = await id(c, "SELECT id FROM travel.destinations WHERE slug = $1", [city]);
    let hid = await id(c, "SELECT id FROM travel.hotels WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 1", [name]);
    if (!hid) {
      hid = (await c.query(
        `INSERT INTO travel.hotels (name, slug, destination_id, kind, star_rating, price_from, price_unit, status, address)
         VALUES ($1,$2,$3,'Haram hotel',$4,$5,'per night','published',$6) ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [name, slug(name), dest, stars, rates[2] * 2, city === "makkah" ? "Makkah, Saudi Arabia" : "Madinah, Saudi Arabia"],
      )).rows[0].id as string;
    }
    hotelId[name] = hid;
    await c.query(
      `INSERT INTO travel.umrah_hotels (hotel_id, city, distance_m, distance_label, sort_order) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (hotel_id) DO UPDATE SET city = EXCLUDED.city, distance_m = EXCLUDED.distance_m, distance_label = EXCLUDED.distance_label, sort_order = EXCLUDED.sort_order`,
      [hid, city, dist, label, i],
    );
    await c.query("DELETE FROM travel.umrah_hotel_rates WHERE hotel_id = $1", [hid]);
    const [q, t, d, s] = rates;
    await c.query("INSERT INTO travel.umrah_hotel_rates (hotel_id, season, quad, triple, double, single) VALUES ($1,'Base rate',$2,$3,$4,$5)", [hid, q, t, d, s]);
    const up = (n: number, f: number) => Math.round((n * f) / 500) * 500;
    await c.query(
      "INSERT INTO travel.umrah_hotel_rates (hotel_id, season, starts_on, ends_on, quad, triple, double, single) VALUES ($1,'Ramadan 2027','2027-02-08','2027-03-09',$2,$3,$4,$5)",
      [hid, up(q, 1.35), up(t, 1.35), up(d, 1.35), up(s, 1.35)],
    );
    if (stars === 5) {
      await c.query(
        "INSERT INTO travel.umrah_hotel_rates (hotel_id, season, starts_on, ends_on, quad, triple, double, single) VALUES ($1,'Winter holidays','2026-12-18','2027-01-04',$2,$3,$4,$5)",
        [hid, up(q, 1.15), up(t, 1.15), up(d, 1.15), up(s, 1.15)],
      );
    }
  }

  /* flexible Umrah packages */
  for (const [i, f] of FLEX.entries()) {
    const pid = (await c.query(
      `INSERT INTO travel.umrah_packages (slug, title, kind, tier, hotels_note, summary, min_total_nights, min_makkah_nights, min_madinah_nights, lead_days,
         ramadan_uplift_pct, visa_price, transport_price, transport_label, ziyarat_price, service_fee, is_live, sort_order, flights)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'either')
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind, tier = EXCLUDED.tier, hotels_note = EXCLUDED.hotels_note,
         summary = EXCLUDED.summary, min_total_nights = EXCLUDED.min_total_nights, min_makkah_nights = EXCLUDED.min_makkah_nights,
         min_madinah_nights = EXCLUDED.min_madinah_nights, lead_days = EXCLUDED.lead_days, ramadan_uplift_pct = EXCLUDED.ramadan_uplift_pct,
         visa_price = EXCLUDED.visa_price, transport_price = EXCLUDED.transport_price, transport_label = EXCLUDED.transport_label,
         ziyarat_price = EXCLUDED.ziyarat_price, service_fee = EXCLUDED.service_fee, is_live = EXCLUDED.is_live, sort_order = EXCLUDED.sort_order
       RETURNING id`,
      [f.slug, f.title, f.kind, f.tier, f.note, f.summary, f.total, f.mk, f.md, f.lead, f.uplift, f.visa, f.transport, f.tlabel, f.ziyarat, f.fee, f.live, i],
    )).rows[0].id;
    await c.query("DELETE FROM travel.umrah_package_hotels WHERE umrah_package_id = $1", [pid]);
    for (const h of f.hotels) await c.query("INSERT INTO travel.umrah_package_hotels (umrah_package_id, hotel_id) VALUES ($1,$2)", [pid, hotelId[h]]);
    // Same sum the API works out on save: cheapest chosen hotels (quad) at the minimum stay plus add-ons.
    const quad = (city: string) => Math.min(...f.hotels.map((h) => UHOTELS.find((x) => x[1] === h)!).filter((x) => x[0] === city).map((x) => x[5][0]), Infinity);
    const mk = Math.max(f.mk, f.total - f.md), md = Math.max(f.md, f.total - mk);
    const upl = f.kind === "ramadan" ? 1 + f.uplift / 100 : 1;
    const hotels = f.kind === "visa_transport" ? 0 : Math.round((quad("makkah") === Infinity ? 0 : quad("makkah")) * upl) * mk + Math.round((quad("madinah") === Infinity ? 0 : quad("madinah")) * upl) * md;
    await c.query("UPDATE travel.umrah_packages SET price_from = $2 WHERE id = $1", [pid, hotels + f.visa + f.transport + f.fee]);
  }

  /* extra Umrah packages used by group departures */
  const mk = await id(c, "SELECT id FROM travel.destinations WHERE slug = 'makkah'", []);
  const md = await id(c, "SELECT id FROM travel.destinations WHERE slug = 'madinah'", []);
  for (const [s, title, days, nights, label, from, was, inc] of EXTRA_UMRAH_PKGS) {
    const pid = (await c.query(
      `INSERT INTO travel.packages (slug, title, category, duration_days, nights, itinerary_label, includes_label, summary, inclusions, price_from, price_was, image_day_url, image_night_url)
       VALUES ($1,$2,'umrah',$3,$4,$5,'Visa + flights + hotels',$6,$7,$8,$9,'/art/domes-morning-8.svg','/art/domes-night-8.svg')
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
      [s, title, days, nights, label, `Group Umrah with a scholar from Pakistan. ${label}.`, inc, from, was],
    )).rows[0].id;
    const [a, b] = label.match(/\d+/g)!.map(Number);
    for (const [pos, [d, n]] of [[mk, a], [md, b]].entries()) {
      if (d) await c.query("INSERT INTO travel.package_destinations (package_id, destination_id, nights, position) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [pid, d, n, pos]);
    }
  }

  /* package itineraries, options and departures */
  for (const [s, p] of Object.entries(PKG)) {
    const pid = await id(c, "SELECT id FROM travel.packages WHERE slug = $1", [s]);
    if (!pid) continue;
    await c.query("UPDATE travel.packages SET itinerary = $2, exclusions = $3, price_options = $4 WHERE id = $1", [
      pid,
      JSON.stringify(p.itinerary.map(([d, title, text]) => ({ day: d, title, text }))),
      p.exclusions,
      JSON.stringify(p.options.map(([label, adult, child, infant]) => ({ label, adult, child: child || null, infant: infant || null }))),
    ]);
    for (const [dd, ret, total, sold] of p.deps ?? []) {
      const ex = await id(c, "SELECT id FROM travel.package_departures WHERE package_id = $1 AND depart_date = $2", [pid, dd]);
      if (ex) await c.query("UPDATE travel.package_departures SET return_date=$2, seats_total=$3, seats_sold=$4 WHERE id=$1", [ex, ret, total, sold]);
      else await c.query("INSERT INTO travel.package_departures (package_id, depart_date, return_date, seats_total, seats_sold) VALUES ($1,$2,$3,$4,$5)", [pid, dd, ret, total, sold]);
    }
  }
  for (const [s, dep, ret, city, airline, flight, rt, leader, sold, total, q, t, d, visa, note, phone] of GROUPS) {
    const pid = await id(c, "SELECT id FROM travel.packages WHERE slug = $1", [s]);
    if (!pid) continue;
    const vals = [ret, city, airline, flight, rt, leader, sold, total, q, t, d, visa, note || null, phone];
    const ex = await id(c, "SELECT id FROM travel.package_departures WHERE package_id = $1 AND depart_date = $2", [pid, dep]);
    if (ex) {
      await c.query(
        `UPDATE travel.package_departures SET return_date=$2, departure_city=$3, airline=$4, flight_no=$5, route=$6, group_leader=$7, seats_sold=$8, seats_total=$9,
           price_quad=$10, price_triple=$11, price_double=$12, price_override=$10, visa_status=$13, visa_note=$14, leader_phone=$15 WHERE id=$1`,
        [ex, ...vals],
      );
    } else {
      await c.query(
        `INSERT INTO travel.package_departures (package_id, depart_date, return_date, departure_city, airline, flight_no, route, group_leader, seats_sold, seats_total,
           price_quad, price_triple, price_double, price_override, visa_status, visa_note, leader_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$11,$14,$15,$16)`,
        [pid, dep, ...vals],
      );
    }
  }

  /* Indonesia visa paused, as in the approved design */
  await c.query("UPDATE travel.visa_services SET is_published = (country_iso2 <> 'ID')");
}
