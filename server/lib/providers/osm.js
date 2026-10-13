// Hotels and attractions near a point, from OpenStreetMap via the Overpass API (no key).
// OSM has names, stars and locations but no prices or photos, so these results
// enrich a destination; bookable rates come from our own catalogue or a supplier.
import { cached } from "../cache.js";

async function overpass(q) {
  const url = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "skyholidays.pk" },
    body: "data=" + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  return (await res.json()).elements;
}

function toPlace(e, kind) {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  if (!t.name || lat == null || lng == null) return null;
  const stars = Number.parseInt(t.stars ?? "", 10);
  const address = [t["addr:street"], t["addr:city"]].filter(Boolean).join(", ") || null;
  return {
    source: "osm",
    external_id: `${e.type}/${e.id}`,
    name: t["name:en"] ?? t.name,
    kind: t.tourism ?? t.historic ?? kind,
    lat,
    lng,
    star_rating: stars >= 1 && stars <= 5 ? stars : null,
    address,
    website: t.website ?? null,
  };
}

export function hotelsNear(lat, lng, radiusM = 5000, limit = 30) {
  return cached("osm-hotels", `${lat.toFixed(3)},${lng.toFixed(3)},${radiusM}`, 60 * 60 * 24 * 7, async () => {
    const q = `[out:json][timeout:25];nwr["tourism"~"^(hotel|resort|guest_house)$"]["name"](around:${radiusM},${lat},${lng});out center ${limit};`;
    return (await overpass(q)).map((e) => toPlace(e, "hotel")).filter((p) => !!p);
  });
}

export function attractionsNear(lat, lng, radiusM = 8000, limit = 30) {
  return cached("osm-attractions", `${lat.toFixed(3)},${lng.toFixed(3)},${radiusM}`, 60 * 60 * 24 * 7, async () => {
    const q = `[out:json][timeout:25];(nwr["tourism"~"^(attraction|museum|viewpoint|theme_park|zoo)$"]["name"](around:${radiusM},${lat},${lng});nwr["historic"]["name"]["wikidata"](around:${radiusM},${lat},${lng}););out center ${limit};`;
    return (await overpass(q)).map((e) => toPlace(e, "attraction")).filter((p) => !!p);
  });
}
