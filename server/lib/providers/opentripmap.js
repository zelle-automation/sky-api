// Excursion ideas from OpenTripMap (free API key). Falls back to OSM when no key is set.
import { cached } from "../cache.js";
import { attractionsNear } from "./osm.js";

export async function excursionIdeas(lat, lng, radiusM = 10000) {
  const key = process.env.OPENTRIPMAP_API_KEY;
  if (!key) return attractionsNear(lat, lng, radiusM);
  return cached("opentripmap", `${lat.toFixed(3)},${lng.toFixed(3)},${radiusM}`, 60 * 60 * 24 * 7, async () => {
    const url = new URL("https://api.opentripmap.com/0.1/en/places/radius");
    url.search = new URLSearchParams({
      radius: String(radiusM),
      lat: String(lat),
      lon: String(lng),
      rate: "3",
      format: "json",
      limit: "30",
      apikey: key,
    }).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenTripMap responded ${res.status}`);
    const rows = await res.json();
    return rows
      .filter((r) => r.name)
      .map((r) => ({
        source: "opentripmap",
        external_id: r.xid,
        name: r.name,
        kind: r.kinds.split(",")[0],
        lat: r.point.lat,
        lng: r.point.lon,
        star_rating: null,
        address: null,
        website: null,
      }));
  });
}
