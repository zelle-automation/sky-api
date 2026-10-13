// Read side of the public catalogue, served by the API to the website. Results are cached for a minute
// (Redis when available) so busy pages don't hit Postgres on every request.
import { query } from "./db";
import { cached } from "./cache";
import { categoryLabel, type Card, type Destination, type Pic, type Visa } from "../../shared/catalog-types";

export type { Card, Destination, Pic, Visa };

const TTL = 60;
const c = <T>(key: string, load: () => Promise<T>) => cached("catalog", key, TTL, load);

const num = (v: unknown) => (v == null ? null : Number(v));
const pic = (r: { image_day_url: string | null; image_night_url: string | null }): Pic => ({
  day: r.image_day_url ?? r.image_night_url ?? "",
  night: r.image_night_url ?? r.image_day_url ?? "",
});

type DestRow = {
  id: string; slug: string; name: string; country_iso2: string; country_name: string; flag_emoji: string | null;
  category: Destination["category"]; tagline: string | null; description: string | null; best_time: string | null;
  flight_note: string | null; lat: string | null; lng: string | null; price_from: string | null;
  image_day_url: string | null; image_night_url: string | null;
};

const DEST_SQL = `SELECT d.id, d.slug, d.name, d.country_iso2, c.name AS country_name, c.flag_emoji, d.category, d.tagline,
       d.description, d.best_time, d.flight_note, d.lat, d.lng, d.price_from, d.image_day_url, d.image_night_url
  FROM travel.destinations d JOIN travel.countries c ON c.iso2 = d.country_iso2
 WHERE d.is_published`;

const toDest = (r: DestRow): Destination => ({
  id: r.id, slug: r.slug, name: r.name, countryIso2: r.country_iso2, countryName: r.country_name, flag: r.flag_emoji,
  category: r.category, tagline: r.tagline, description: r.description, bestTime: r.best_time, flightNote: r.flight_note,
  lat: num(r.lat), lng: num(r.lng), priceFrom: num(r.price_from), pic: pic(r),
});

export function listDestinations(category?: string) {
  return c(`dest:${category ?? "all"}`, async () =>
    (await query<DestRow>(`${DEST_SQL} AND ($1::text IS NULL OR d.category = $1) ORDER BY d.sort_order, d.name`, [category ?? null])).map(toDest),
  );
}

export function getDestination(slug: string) {
  return c(`dest:one:${slug}`, async () => {
    const rows = await query<DestRow>(`${DEST_SQL} AND d.slug = $1`, [slug]);
    return rows[0] ? toDest(rows[0]) : null;
  });
}

type HotelRow = {
  id: string; slug: string; name: string; kind: string | null; star_rating: number | null; address: string | null;
  description: string | null; amenities: string[]; rating: string | null; review_count: number | null;
  price_from: string | null; price_was: string | null; price_unit: string; image_day_url: string | null;
  image_night_url: string | null; destination_slug: string | null; destination_name: string | null;
};

export function hotelCards(destinationSlug?: string) {
  return c(`hotels:${destinationSlug ?? "all"}`, async () => {
    const rows = await query<HotelRow>(
      `SELECT h.id, h.slug, h.name, h.kind, h.star_rating, h.address, h.description, h.amenities, h.rating, h.review_count,
              h.price_from, h.price_was, h.price_unit, h.image_day_url, h.image_night_url,
              d.slug AS destination_slug, d.name AS destination_name
         FROM travel.hotels h LEFT JOIN travel.destinations d ON d.id = h.destination_id
        WHERE h.slug IS NOT NULL AND h.status = 'published' AND ($1::text IS NULL OR d.slug = $1)
        ORDER BY h.is_featured DESC, h.priority DESC, h.created_at`,
      [destinationSlug ?? null],
    );
    return rows.map((h): Card => ({
      id: h.id, slug: h.slug, type: "hotels", href: `/hotels/${h.slug}`, title: h.name,
      location: h.address ?? "", detail: h.star_rating ? `${h.star_rating}-star ${h.kind?.toLowerCase().includes("resort") ? "resort" : "hotel"}` : "Hotel",
      kind: h.kind ?? "Hotel", rating: num(h.rating), reviews: h.review_count, price: Number(h.price_from ?? 0),
      priceWas: num(h.price_was), unit: h.price_unit, features: h.amenities, summary: h.description ?? "", pic: pic(h),
      city: h.destination_name ?? "", destinationSlug: h.destination_slug,
    }));
  });
}

type ExcRow = {
  id: string; slug: string; title: string; category: string | null; location_label: string | null; summary: string | null;
  highlights: string[]; rating: string | null; review_count: number | null; price_from: string | null; price_was: string | null;
  price_unit: string; image_day_url: string | null; image_night_url: string | null; raw: { duration_label?: string } | null;
  destination_slug: string | null; destination_name: string | null;
};

export function excursionCards(destinationSlug?: string) {
  return c(`excursions:${destinationSlug ?? "all"}`, async () => {
    const rows = await query<ExcRow>(
      `SELECT e.id, e.slug, e.title, e.category, e.location_label, e.summary, e.highlights, e.rating, e.review_count,
              e.price_from, e.price_was, e.price_unit, e.image_day_url, e.image_night_url, e.raw,
              d.slug AS destination_slug, d.name AS destination_name
         FROM travel.excursions e LEFT JOIN travel.destinations d ON d.id = e.destination_id
        WHERE e.slug IS NOT NULL AND e.status IN ('published','seasonal') AND ($1::text IS NULL OR d.slug = $1)
        ORDER BY e.is_featured DESC, e.created_at`,
      [destinationSlug ?? null],
    );
    return rows.map((e): Card => ({
      id: e.id, slug: e.slug, type: "excursions", href: `/excursions/${e.slug}`, title: e.title,
      location: e.location_label ?? "", detail: e.raw?.duration_label ?? "", kind: e.category ?? "Excursion",
      rating: num(e.rating), reviews: e.review_count, price: Number(e.price_from ?? 0), priceWas: num(e.price_was),
      unit: e.price_unit, features: e.highlights, summary: e.summary ?? "", pic: pic(e),
      city: e.destination_name ?? "", destinationSlug: e.destination_slug,
    }));
  });
}

type PkgRow = {
  id: string; slug: string; title: string; category: string; itinerary_label: string | null; includes_label: string | null;
  summary: string | null; inclusions: string[]; rating: string | null; review_count: number | null; price_from: string;
  price_was: string | null; price_unit: string; is_deal: boolean; deal_badge: string | null;
  image_day_url: string | null; image_night_url: string | null; destinations: string[]; destination_names: string[];
};

export function packageCards(opts: { category?: string; deals?: boolean; destination?: string } = {}) {
  const { category, deals = false, destination } = opts;
  return c(`packages:${category ?? "all"}:${deals}:${destination ?? "all"}`, async () => {
    const rows = await query<PkgRow>(
      `SELECT p.id, p.slug, p.title, p.category, p.itinerary_label, p.includes_label, p.summary, p.inclusions, p.rating,
              p.review_count, p.price_from, p.price_was, p.price_unit, p.is_deal, p.deal_badge, p.image_day_url, p.image_night_url,
              COALESCE(array_agg(d.slug ORDER BY pd.position) FILTER (WHERE d.slug IS NOT NULL), '{}') AS destinations,
              COALESCE(array_agg(d.name ORDER BY pd.position) FILTER (WHERE d.name IS NOT NULL), '{}') AS destination_names
         FROM travel.packages p
         LEFT JOIN travel.package_destinations pd ON pd.package_id = p.id
         LEFT JOIN travel.destinations d ON d.id = pd.destination_id
        WHERE p.status = 'published' AND ($1::text IS NULL OR p.category = $1) AND (NOT $2 OR p.is_deal)
        GROUP BY p.id
       HAVING $3::text IS NULL OR $3 = ANY(array_agg(d.slug))
        ORDER BY p.is_featured DESC, p.created_at`,
      [category ?? null, deals, destination ?? null],
    );
    return rows.map((p): Card => ({
      id: p.id, slug: p.slug, type: "packages", href: `/packages/${p.slug}`, title: p.title,
      location: p.itinerary_label ?? "", detail: p.includes_label ?? "", kind: categoryLabel(p.category),
      rating: num(p.rating), reviews: p.review_count, price: Number(p.price_from), priceWas: num(p.price_was),
      unit: p.price_unit, features: p.inclusions, summary: p.summary ?? "", pic: pic(p),
      city: p.destination_names.join(" & "), destinationSlug: p.destinations[0] ?? null, category: p.category, badge: p.deal_badge,
    }));
  });
}

export async function findCard(type: Card["type"], slug: string) {
  const all = type === "hotels" ? await hotelCards() : type === "excursions" ? await excursionCards() : await packageCards();
  return all.find((x) => x.slug === slug) ?? null;
}

export function listVisas() {
  return c("visas", async () =>
    (await query<{
      id: string; country_iso2: string; country: string; flag_emoji: string | null; visa_type: string; entry: string;
      stay_days: number | null; processing_days: string | null; price_from: string | null; is_evisa: boolean; requirements: string[];
    }>(
      `SELECT v.id, v.country_iso2, c.name AS country, c.flag_emoji, v.visa_type, v.entry, v.stay_days, v.processing_days,
              v.price_from, v.is_evisa, v.requirements
         FROM travel.visa_services v JOIN travel.countries c ON c.iso2 = v.country_iso2
        WHERE v.is_published
        ORDER BY v.sort_order`,
    )).map((v): Visa => ({
      id: v.id, countryIso2: v.country_iso2, country: v.country, flag: v.flag_emoji, type: v.visa_type, entry: v.entry,
      stayDays: v.stay_days, processing: v.processing_days, price: num(v.price_from), evisa: v.is_evisa, requirements: v.requirements,
    })),
  );
}
