// Shapes the API returns for the public catalogue; shared by the Express API and the Next.js pages.

export type Pic = { day: string; night: string };

/** One listing in any collection (hotel, excursion or package), shaped for the card, list and spotlight views. */
export type Card = {
  id: string;
  slug: string;
  type: "hotels" | "excursions" | "packages";
  href: string;
  title: string;
  location: string;
  detail: string;
  kind: string;
  rating: number | null;
  reviews: number | null;
  price: number;
  priceWas: number | null;
  unit: string;
  features: string[];
  summary: string;
  pic: Pic;
  city: string;
  destinationSlug: string | null;
  category?: string;
  badge?: string | null;
};

export type Destination = {
  id: string;
  slug: string;
  name: string;
  countryIso2: string;
  countryName: string;
  flag: string | null;
  category: "international" | "domestic" | "umrah";
  tagline: string | null;
  description: string | null;
  bestTime: string | null;
  flightNote: string | null;
  lat: number | null;
  lng: number | null;
  priceFrom: number | null;
  pic: Pic;
};

export type Visa = {
  id: string; countryIso2: string; country: string; flag: string | null; type: string; entry: string;
  stayDays: number | null; processing: string | null; price: number | null; evisa: boolean; requirements: string[];
};

const CATEGORY_LABEL: Record<string, string> = { international: "International", domestic: "Domestic", umrah: "Umrah", honeymoon: "Honeymoon" };
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c;
