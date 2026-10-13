// Flight offers from Duffel (https://duffel.com). Test mode is free and returns
// realistic offers; live mode needs a Duffel account. Returns null when no token is set
// so the UI can show an "our travel desk will quote this" state instead.
import { z } from "zod";
import { cached } from "../cache.js";

export const FlightSearch = z.object({
  from: z.string().length(3).toUpperCase(),
  to: z.string().length(3).toUpperCase(),
  departDate: z.iso.date(),
  returnDate: z.iso.date().optional(),
  adults: z.number().int().min(1).max(9).default(1),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]).default("economy"),
});

export async function searchFlights(s) {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return null;
  const key = JSON.stringify(s);
  return cached("duffel", key, 60 * 10, async () => {
    const slices = [{ origin: s.from, destination: s.to, departure_date: s.departDate }];
    if (s.returnDate) slices.push({ origin: s.to, destination: s.from, departure_date: s.returnDate });
    const res = await fetch("https://api.duffel.com/air/offer_requests?return_offers=true", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: { slices, passengers: Array.from({ length: s.adults }, () => ({ type: "adult" })), cabin_class: s.cabin },
      }),
    });
    if (!res.ok) throw new Error(`Duffel responded ${res.status}`);
    const offers = (await res.json()).data.offers;
    return offers
      .sort((a, b) => Number(a.total_amount) - Number(b.total_amount))
      .slice(0, 20)
      .map((o) => ({
        id: o.id,
        airline: o.owner.name,
        airlineCode: o.owner.iata_code,
        totalAmount: o.total_amount,
        currency: o.total_currency,
        slices: o.slices.map((sl) => ({
          from: sl.origin.iata_code,
          to: sl.destination.iata_code,
          departAt: sl.segments[0].departing_at,
          arriveAt: sl.segments[sl.segments.length - 1].arriving_at,
          duration: sl.duration,
          stops: sl.segments.length - 1,
        })),
      }));
  });
}
