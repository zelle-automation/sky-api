// Seeds countries (all 250, from the bundled world-countries dataset, same shape as REST Countries)
// plus the sample catalogue: destinations, hotels, excursions, packages and visa services.
// Prices are placeholders. Safe to re-run: every insert upserts. Usage: npm run db:seed
import worldCountries from "world-countries";
import { Client } from "pg";
import { mapCountry, type RestCountry } from "../server/lib/providers/countries";
import { artPair, type Flavor, type Kind } from "../shared/art";

type Art = [Kind, Flavor, number];
const img = (a: Art) => artPair(...a);

const DESTINATIONS: { slug: string; name: string; iso2: string; category: string; tagline: string; best: string; fly: string; lat: number; lng: number; price: number | null; desc: string; art: Art | "dubai" }[] = [
  { slug: "dubai", name: "Dubai", iso2: "AE", category: "international", tagline: "Visa in 3 days", best: "Nov – Mar", fly: "2h 45m from Karachi", lat: 25.1972, lng: 55.2744, price: 129000, desc: "Desert safaris, Burj Khalifa at sunset, Dubai Marina cruises and shopping that never sleeps.", art: "dubai" },
  { slug: "istanbul", name: "Istanbul", iso2: "TR", category: "international", tagline: "Trending", best: "Apr – Jun", fly: "5h 50m from Lahore", lat: 41.0082, lng: 28.9784, price: 219000, desc: "Where Europe meets Asia. Hagia Sophia, Bosphorus ferries and the Grand Bazaar.", art: ["domes", "dusk", 11] },
  { slug: "baku", name: "Baku", iso2: "AZ", category: "international", tagline: "E-visa", best: "May – Sep", fly: "3h 40m from Lahore", lat: 40.4093, lng: 49.8671, price: 159000, desc: "Flame Towers over the Caspian, the walled Old City and day trips to Gabala's mountains.", art: ["city", "night", 23] },
  { slug: "maldives", name: "Maldives", iso2: "MV", category: "international", tagline: "Honeymoon", best: "Dec – Apr", fly: "via Dubai or Colombo", lat: 3.2028, lng: 73.2207, price: 289000, desc: "Overwater villas, house reefs and sandbanks you'll have to yourselves.", art: ["villas", "teal", 5] },
  { slug: "hunza", name: "Hunza Valley", iso2: "PK", category: "domestic", tagline: "Domestic", best: "Apr – Oct", fly: "by road or via Gilgit", lat: 36.3167, lng: 74.65, price: 64000, desc: "Rakaposhi views, Attabad Lake and the 700-year-old forts of Altit and Baltit.", art: ["mountains", "gold", 31] },
  { slug: "kuala-lumpur", name: "Kuala Lumpur", iso2: "MY", category: "international", tagline: "Family", best: "Dec – Feb", fly: "5h 40m from Karachi", lat: 3.1579, lng: 101.7116, price: 174000, desc: "Petronas Towers, Batu Caves and easy hops to Langkawi and Genting Highlands.", art: ["twin", "night", 41] },
  { slug: "skardu", name: "Skardu", iso2: "PK", category: "domestic", tagline: "Domestic", best: "May – Sep", fly: "1h 05m from Islamabad", lat: 35.2971, lng: 75.6333, price: 72000, desc: "Shangrila Resort, Upper Kachura Lake and the cold desert of Katpana.", art: ["lake", "day", 17] },
  { slug: "makkah", name: "Makkah", iso2: "SA", category: "umrah", tagline: "Umrah", best: "Year round", fly: "4h 30m from Karachi", lat: 21.4225, lng: 39.8262, price: 349000, desc: "Umrah packages with Haram-view hotels, visa processing and Ziyarat in Makkah and Madinah.", art: ["tower", "gold", 3] },
  { slug: "bali", name: "Bali", iso2: "ID", category: "international", tagline: "Islands", best: "Apr – Oct", fly: "via Kuala Lumpur", lat: -8.3405, lng: 115.092, price: 239000, desc: "Ubud's rice terraces, Uluwatu cliff temples and slow sunsets on Seminyak beach.", art: ["island", "dusk", 9] },
  { slug: "madinah", name: "Madinah", iso2: "SA", category: "umrah", tagline: "Umrah", best: "Year round", fly: "4h 15m from Lahore", lat: 24.4672, lng: 39.6111, price: null, desc: "Masjid an-Nabawi, Quba and the Ziyarat sites of the Prophet's city.", art: ["domes", "gold", 8] },
];

const HOTELS: { slug: string; dest: string; name: string; kind: string; stars: number; address: string; rating: number; reviews: number; price: number; was: number | null; amenities: string[]; desc: string; art: Art }[] = [
  { slug: "atlantis-the-palm", dest: "dubai", name: "Atlantis The Palm", kind: "Luxury Resort", stars: 5, address: "Palm Jumeirah, Dubai", rating: 9.1, reviews: 2184, price: 84500, was: 98000, amenities: ["Free breakfast", "Aquaventure access", "Airport transfer"], desc: "Ocean-facing rooms on the Palm's crescent with the waterpark and private beach steps away.", art: ["villas", "dusk", 44] },
  { slug: "shangrila-resort-skardu", dest: "skardu", name: "Shangrila Resort", kind: "Lakeside Resort", stars: 4, address: "Lower Kachura, Skardu", rating: 8.7, reviews: 963, price: 38000, was: null, amenities: ["Lake view", "Breakfast & dinner", "Free parking"], desc: "Red-roofed chalets on the shore of Lower Kachura Lake, ringed by the Karakoram.", art: ["lake", "day", 61] },
  { slug: "swissotel-makkah", dest: "makkah", name: "Swissôtel Makkah", kind: "Haram View", stars: 5, address: "Abraj Al Bait, Makkah", rating: 9.0, reviews: 4512, price: 61000, was: 72000, amenities: ["Haram view", "2 min walk", "Suhoor buffet"], desc: "Direct access to the Haram plaza from the Abraj Al Bait complex.", art: ["tower", "night", 52] },
  { slug: "pera-palace-hotel", dest: "istanbul", name: "Pera Palace Hotel", kind: "Heritage Hotel", stars: 5, address: "Beyoğlu, Istanbul", rating: 9.2, reviews: 1327, price: 52000, was: null, amenities: ["Historic landmark", "Free Wi-Fi", "Spa"], desc: "The 1892 grand hotel built for Orient Express passengers, steps from Istiklal Avenue.", art: ["domes", "night", 71] },
  { slug: "fairmont-baku-flame-towers", dest: "baku", name: "Fairmont Baku Flame Towers", kind: "City Landmark", stars: 5, address: "Mehdi Huseyn, Baku", rating: 8.9, reviews: 1045, price: 39500, was: 46000, amenities: ["Caspian view", "Indoor pool", "Breakfast"], desc: "Inside the city's landmark towers with sweeping views over the Caspian boulevard.", art: ["city", "dusk", 29] },
  { slug: "address-downtown", dest: "dubai", name: "Address Downtown", kind: "City View", stars: 5, address: "Downtown, Dubai", rating: 9.0, reviews: 3061, price: 71000, was: null, amenities: ["Burj Khalifa view", "Infinity pool", "Dubai Mall access"], desc: "Fountain-facing rooms next to Dubai Mall with the Burj Khalifa outside the window.", art: ["city", "night", 15] },
  { slug: "hunza-serena-inn", dest: "hunza", name: "Hunza Serena Inn", kind: "Mountain Lodge", stars: 4, address: "Karimabad, Hunza", rating: 8.8, reviews: 1184, price: 29500, was: null, amenities: ["Rakaposhi view", "Garden", "Breakfast"], desc: "Stone-and-timber cottages in Karimabad, a short walk from Baltit Fort.", art: ["mountains", "dusk", 72] },
  { slug: "pullman-zamzam-madinah", dest: "madinah", name: "Pullman ZamZam Madinah", kind: "Haram View", stars: 5, address: "Central Area, Madinah", rating: 8.9, reviews: 2775, price: 33500, was: 38000, amenities: ["Near Masjid an-Nabawi", "Family rooms", "Breakfast"], desc: "A few minutes on foot from the Prophet's Mosque, popular with Umrah families.", art: ["domes", "night", 83] },
];

const EXCURSIONS: { slug: string; dest: string; title: string; cat: string; loc: string; dur: string; mins: number; rating: number; reviews: number; price: number; was: number | null; unit: string; hl: string[]; sum: string; art: Art }[] = [
  { slug: "dubai-desert-safari-bbq", dest: "dubai", title: "Desert Safari with BBQ Dinner", cat: "Adventure", loc: "Lahbab Desert, Dubai", dur: "6 hours · Hotel pickup", mins: 360, rating: 9.4, reviews: 8920, price: 10500, was: 14000, unit: "per person", hl: ["Dune bashing", "Camel ride", "Tanoura show"], sum: "Red dunes at golden hour, then a Bedouin camp dinner under the stars.", art: ["desert", "gold", 14] },
  { slug: "bosphorus-sunset-cruise", dest: "istanbul", title: "Bosphorus Sunset Cruise", cat: "Cruise", loc: "Eminönü, Istanbul", dur: "2.5 hours · Live guide", mins: 150, rating: 9.1, reviews: 3410, price: 8900, was: null, unit: "per person", hl: ["Two continents", "Tea & snacks", "Audio guide"], sum: "Sail past Dolmabahçe Palace and the Rumeli Fortress as the minarets light up.", art: ["domes", "dusk", 18] },
  { slug: "attabad-lake-passu-cones", dest: "hunza", title: "Attabad Lake & Passu Cones", cat: "Day Trip", loc: "Gojal, Hunza", dur: "Full day · Private car", mins: 540, rating: 9.3, reviews: 1208, price: 18000, was: null, unit: "per vehicle", hl: ["Boat ride", "Hussaini Bridge", "Lunch stop"], sum: "Turquoise water, the swaying Hussaini suspension bridge and the jagged Passu Cathedral.", art: ["mountains", "day", 37] },
  { slug: "gabala-shamakhi-day-tour", dest: "baku", title: "Gabala & Shamakhi Day Tour", cat: "Mountain Tour", loc: "From Baku, Azerbaijan", dur: "10 hours · Small group", mins: 600, rating: 8.8, reviews: 742, price: 13900, was: 16500, unit: "per person", hl: ["Tufandag cable car", "Juma Mosque", "Lunch"], sum: "Caucasus foothills, the Seven Beauties waterfall and a ride up Tufandag.", art: ["lake", "gold", 26] },
  { slug: "ziyarat-of-madinah", dest: "madinah", title: "Ziyarat of Madinah", cat: "Ziyarat", loc: "Madinah, Saudi Arabia", dur: "4 hours · Scholar guide", mins: 240, rating: 9.6, reviews: 2036, price: 6500, was: null, unit: "per person", hl: ["Masjid Quba", "Uhud", "Masjid Qiblatain"], sum: "Visit the historic sites of Madinah with an Urdu-speaking guide.", art: ["domes", "gold", 8] },
  { slug: "burj-khalifa-at-the-top", dest: "dubai", title: "Burj Khalifa At the Top", cat: "Landmark", loc: "Downtown, Dubai", dur: "1.5 hours · Skip the line", mins: 90, rating: 9.2, reviews: 6320, price: 12900, was: null, unit: "per person", hl: ["Levels 124 & 125", "Sunset slot", "Mobile ticket"], sum: "Ride to the observation decks for views over the desert, the coast and the Palm.", art: ["city", "dusk", 95] },
  { slug: "deosai-plains-jeep-safari", dest: "skardu", title: "Deosai Plains Jeep Safari", cat: "Adventure", loc: "From Skardu", dur: "Full day · Private jeep", mins: 600, rating: 9.0, reviews: 688, price: 24000, was: null, unit: "per jeep", hl: ["Sheosar Lake", "Wildlife", "Packed lunch"], sum: "Cross the world's second-highest plateau to Sheosar Lake, with brown bear country on the way.", art: ["lake", "gold", 54] },
  { slug: "bali-swing-rice-terraces", dest: "bali", title: "Bali Swing & Rice Terraces", cat: "Day Trip", loc: "Ubud, Bali", dur: "8 hours · Hotel pickup", mins: 480, rating: 9.1, reviews: 2410, price: 15500, was: 19000, unit: "per person", hl: ["Tegallalang terraces", "Coffee plantation", "Lunch"], sum: "Swing over the jungle, walk the Tegallalang terraces and taste Bali coffee.", art: ["island", "day", 39] },
];

const PACKAGES: { slug: string; title: string; cat: string; days: number; nights: number; itin: string; inc: string; price: number; was: number | null; unit: string; incl: string[]; sum: string; dests: [string, number][]; deal?: string; rating: number | null; reviews: number | null; art: Art }[] = [
  { slug: "economy-umrah-15-nights", title: "Economy Umrah, 15 Nights", cat: "umrah", days: 16, nights: 15, itin: "Makkah 8N · Madinah 7N", inc: "Visa + flights + hotels", price: 349000, was: 389000, unit: "per person, quad", incl: ["Saudia return", "Ziyarat", "Transport"], sum: "Departures every Friday from Karachi, Lahore and Islamabad with group leaders.", dests: [["makkah", 8], ["madinah", 7]], rating: 9.2, reviews: 1870, art: ["tower", "gold", 33] },
  { slug: "dubai-family-escape", title: "Dubai Family Escape", cat: "international", days: 5, nights: 4, itin: "5 Days · 4 Nights", inc: "Flights + 4★ hotel", price: 189000, was: 229000, unit: "per person", incl: ["Desert safari", "Dhow cruise", "UAE visa"], sum: "Marina hotel, Global Village tickets and a desert safari, with visa processing.", dests: [["dubai", 4]], rating: 9.0, reviews: 1102, art: ["city", "dusk", 48] },
  { slug: "turkish-delight", title: "Turkish Delight", cat: "international", days: 8, nights: 7, itin: "8 Days · Istanbul & Cappadocia", inc: "Flights + hotels + tours", price: 412000, was: null, unit: "per person", incl: ["Balloon ride option", "Domestic flight", "Breakfast"], sum: "Four nights in Sultanahmet, three in a Cappadocia cave hotel.", dests: [["istanbul", 4]], rating: 9.3, reviews: 688, art: ["domes", "day", 91] },
  { slug: "northern-areas-grand-tour", title: "Northern Areas Grand Tour", cat: "domestic", days: 7, nights: 6, itin: "7 Days · Hunza & Skardu", inc: "Road + hotels + guide", price: 124000, was: 145000, unit: "per person", incl: ["Prado 4x4", "Deosai option", "All meals"], sum: "Islamabad to Hunza by the Karakoram Highway, then across to Skardu.", dests: [["hunza", 3], ["skardu", 3]], rating: 9.1, reviews: 944, art: ["mountains", "gold", 57] },
  { slug: "maldives-overwater", title: "Maldives Overwater", cat: "honeymoon", days: 5, nights: 4, itin: "5 Days · 4 Nights", inc: "Flights + villa + seaplane", price: 689000, was: null, unit: "per person", incl: ["Overwater villa", "Half board", "Seaplane"], sum: "A water villa on a coral atoll, seaplane transfers and a sunset dolphin cruise.", dests: [["maldives", 4]], rating: 9.5, reviews: 412, art: ["villas", "teal", 64] },
  { slug: "baku-city-break", title: "Baku City Break", cat: "international", days: 4, nights: 3, itin: "4 Days · 3 Nights", inc: "Flights + hotel + city tour", price: 159000, was: 189000, unit: "per person", incl: ["E-visa", "Old City tour", "Breakfast"], sum: "Limited group seats with hotel, transfers and a city tour.", dests: [["baku", 3]], deal: "Hot deal", rating: 8.9, reviews: 318, art: ["city", "night", 88] },
  { slug: "bali-island-escape", title: "Bali Island Escape", cat: "international", days: 6, nights: 5, itin: "6 Days · 5 Nights", inc: "Flights + hotel + tours", price: 239000, was: 279000, unit: "per person", incl: ["Ubud tour", "Uluwatu sunset", "Breakfast"], sum: "Limited group seats with hotel, transfers and island tours.", dests: [["bali", 5]], deal: "Best seller", rating: 9.1, reviews: 527, art: ["island", "dusk", 77] },
  { slug: "skardu-by-air", title: "Skardu by Air", cat: "domestic", days: 4, nights: 3, itin: "4 Days · 3 Nights", inc: "Flights + hotel + jeep", price: 72000, was: 84000, unit: "per person", incl: ["Return flights", "Shangrila stay", "Jeep tours"], sum: "Fly from Islamabad and see Kachura, Katpana and Manthokha in three days.", dests: [["skardu", 3]], deal: "New", rating: 8.8, reviews: 206, art: ["lake", "day", 66] },
];

const VISAS: { iso2: string; type: string; entry: "single" | "multiple"; stay: number; processing: string; price: number; evisa: boolean; req: string[] }[] = [
  { iso2: "AE", type: "30-day tourist", entry: "single", stay: 30, processing: "3–5 working days", price: 38000, evisa: true, req: ["Passport valid 6 months", "Passport-size photo", "CNIC copy", "Return ticket"] },
  { iso2: "SA", type: "Umrah visa", entry: "single", stay: 90, processing: "2–4 working days", price: 0, evisa: true, req: ["Passport valid 6 months", "Photo on white background", "Meningitis vaccine card", "Booked with an Umrah package"] },
  { iso2: "SA", type: "Tourist e-visa", entry: "multiple", stay: 90, processing: "1–3 working days", price: 62000, evisa: true, req: ["Passport valid 6 months", "Valid US, UK or Schengen visa", "Hotel booking"] },
  { iso2: "AZ", type: "ASAN e-visa", entry: "single", stay: 30, processing: "3 working days", price: 9500, evisa: true, req: ["Passport valid 6 months", "Hotel booking"] },
  { iso2: "TR", type: "Tourist sticker visa", entry: "single", stay: 30, processing: "10–15 working days", price: 42000, evisa: false, req: ["Bank statement (6 months)", "Employment letter or business documents", "Hotel and flight bookings", "Travel insurance"] },
  { iso2: "MY", type: "eVisa", entry: "single", stay: 30, processing: "3–5 working days", price: 14500, evisa: true, req: ["Passport valid 6 months", "Return ticket", "Hotel booking", "Bank statement"] },
  { iso2: "TH", type: "Tourist e-visa", entry: "single", stay: 60, processing: "7–10 working days", price: 21000, evisa: true, req: ["Bank statement (6 months)", "Hotel and flight bookings", "Employment letter"] },
  { iso2: "ID", type: "Visit e-visa", entry: "single", stay: 60, processing: "5–7 working days", price: 28000, evisa: true, req: ["Passport valid 6 months", "Bank statement", "Return ticket"] },
  { iso2: "MV", type: "Visa on arrival", entry: "single", stay: 30, processing: "On arrival", price: 0, evisa: false, req: ["Confirmed resort booking", "Return ticket", "IMUGA declaration within 96 hours"] },
  { iso2: "GB", type: "Standard visitor", entry: "multiple", stay: 180, processing: "15 working days", price: 65000, evisa: false, req: ["Bank statement (6 months)", "Tax returns", "Employment or business proof", "Travel history"] },
];

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("BEGIN");

  for (const c of (worldCountries as unknown as RestCountry[]).map(mapCountry)) {
    await db.query(
      `INSERT INTO travel.countries (iso2, iso3, name, official_name, region, subregion, capital, currency_code, calling_code, flag_emoji, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (iso2) DO UPDATE SET name = EXCLUDED.name, official_name = EXCLUDED.official_name, region = EXCLUDED.region,
         subregion = EXCLUDED.subregion, capital = EXCLUDED.capital, currency_code = EXCLUDED.currency_code,
         calling_code = EXCLUDED.calling_code, flag_emoji = EXCLUDED.flag_emoji, lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()`,
      [c.iso2, c.iso3, c.name, c.official_name, c.region, c.subregion, c.capital, c.currency_code, c.calling_code, c.flag_emoji, c.lat, c.lng],
    );
  }

  const destId: Record<string, string> = {};
  for (const [i, d] of DESTINATIONS.entries()) {
    const pics = d.art === "dubai" ? { day: artPair("twin", "day", 4).day, night: "/brand/dubai-night.jpg" } : img(d.art);
    const r = await db.query(
      `INSERT INTO travel.destinations (slug, name, country_iso2, category, tagline, description, best_time, lat, lng, price_from, is_featured, sort_order, image_day_url, image_night_url, cover_image_url, flight_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13,$13,$14)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, tagline = EXCLUDED.tagline, description = EXCLUDED.description,
         best_time = EXCLUDED.best_time, price_from = EXCLUDED.price_from, sort_order = EXCLUDED.sort_order,
         image_day_url = EXCLUDED.image_day_url, image_night_url = EXCLUDED.image_night_url, flight_note = EXCLUDED.flight_note, updated_at = now()
       RETURNING id`,
      [d.slug, d.name, d.iso2, d.category, d.tagline, d.desc, d.best, d.lat, d.lng, d.price, i, pics.day, pics.night, d.fly],
    );
    destId[d.slug] = r.rows[0].id;
    await db.query(
      `INSERT INTO travel.cities (country_iso2, name, lat, lng) VALUES ($1,$2,$3,$4) ON CONFLICT (country_iso2, name) DO NOTHING`,
      [d.iso2, d.name, d.lat, d.lng],
    );
  }

  for (const h of HOTELS) {
    const p = img(h.art);
    await db.query(
      `INSERT INTO travel.hotels (source, external_id, slug, destination_id, name, kind, star_rating, address, description, amenities, rating, review_count, price_from, price_was, is_featured, image_day_url, image_night_url)
       VALUES ('manual', $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14)
       ON CONFLICT (source, external_id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description,
         amenities = EXCLUDED.amenities, rating = EXCLUDED.rating, review_count = EXCLUDED.review_count,
         price_from = EXCLUDED.price_from, price_was = EXCLUDED.price_was,
         image_day_url = EXCLUDED.image_day_url, image_night_url = EXCLUDED.image_night_url, updated_at = now()`,
      [h.slug, destId[h.dest], h.name, h.kind, h.stars, h.address, h.desc, h.amenities, h.rating, h.reviews, h.price, h.was, p.day, p.night],
    );
  }

  for (const e of EXCURSIONS) {
    const p = img(e.art);
    await db.query(
      `INSERT INTO travel.excursions (source, external_id, slug, destination_id, title, category, location_label, duration_minutes, summary, highlights, rating, review_count, price_from, price_was, price_unit, is_featured, image_day_url, image_night_url, raw)
       VALUES ('manual', $1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, $15, $16)
       ON CONFLICT (source, external_id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, summary = EXCLUDED.summary, highlights = EXCLUDED.highlights,
         rating = EXCLUDED.rating, review_count = EXCLUDED.review_count, price_from = EXCLUDED.price_from,
         price_was = EXCLUDED.price_was, image_day_url = EXCLUDED.image_day_url, image_night_url = EXCLUDED.image_night_url,
         raw = EXCLUDED.raw, updated_at = now()`,
      [e.slug, destId[e.dest], e.title, e.cat, e.loc, e.mins, e.sum, e.hl, e.rating, e.reviews, e.price, e.was, e.unit, p.day, p.night, JSON.stringify({ duration_label: e.dur })],
    );
  }

  for (const p of PACKAGES) {
    const pic = img(p.art);
    const r = await db.query(
      `INSERT INTO travel.packages (slug, title, category, duration_days, nights, itinerary_label, includes_label, summary, inclusions, rating, review_count, price_from, price_was, price_unit, is_deal, deal_badge, is_featured, image_day_url, image_night_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, inclusions = EXCLUDED.inclusions,
         rating = EXCLUDED.rating, review_count = EXCLUDED.review_count,
         price_from = EXCLUDED.price_from, price_was = EXCLUDED.price_was, is_deal = EXCLUDED.is_deal,
         deal_badge = EXCLUDED.deal_badge, image_day_url = EXCLUDED.image_day_url, image_night_url = EXCLUDED.image_night_url, updated_at = now()
       RETURNING id`,
      [p.slug, p.title, p.cat, p.days, p.nights, p.itin, p.inc, p.sum, p.incl, p.rating, p.reviews, p.price, p.was, p.unit, !!p.deal, p.deal ?? null, !p.deal, pic.day, pic.night],
    );
    for (const [i, [slug, nights]] of p.dests.entries()) {
      await db.query(
        `INSERT INTO travel.package_destinations (package_id, destination_id, nights, position) VALUES ($1,$2,$3,$4)
         ON CONFLICT (package_id, destination_id) DO UPDATE SET nights = EXCLUDED.nights, position = EXCLUDED.position`,
        [r.rows[0].id, destId[slug], nights, i],
      );
    }
  }

  for (const [i, v] of VISAS.entries()) {
    await db.query(
      `INSERT INTO travel.visa_services (country_iso2, visa_type, entry, stay_days, processing_days, price_from, is_evisa, requirements, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (country_iso2, visa_type) DO UPDATE SET entry = EXCLUDED.entry, stay_days = EXCLUDED.stay_days,
         processing_days = EXCLUDED.processing_days, price_from = EXCLUDED.price_from, is_evisa = EXCLUDED.is_evisa,
         requirements = EXCLUDED.requirements, sort_order = EXCLUDED.sort_order`,
      [v.iso2, v.type, v.entry, v.stay, v.processing, v.price, v.evisa, v.req, i],
    );
  }

  await db.query("COMMIT");
  await db.end();
  console.log(`seeded ${worldCountries.length} countries, ${DESTINATIONS.length} destinations, ${HOTELS.length} hotels, ${EXCURSIONS.length} excursions, ${PACKAGES.length} packages, ${VISAS.length} visa services`);
}

main().catch((e) => { console.error(e); process.exit(1); });
