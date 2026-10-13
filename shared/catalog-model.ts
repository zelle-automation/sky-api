// Shapes, defaults, price rules and listing-quality checks shared by the hotel / excursion
// editors (browser) and their API routes (server). No browser or server imports here.

export type PhotoPair = { day: string; night: string | null; tag: string };
export type Distance = { place: string; distance: string };

export type Room = {
  id?: string; key: string; name: string; size_m2: number | null; beds: string; max_adults: number; max_children: number;
  units: number; view: string; smoking: string; extra_bed: string; amenities: string[]; photos: string[]; base_price: number;
};
export type Payment = "pay_now" | "pay_at_hotel" | "deposit";
export type RatePlan = {
  id?: string; key: string; room_key: string | null; name: string; meal_plan: string; cancellation: string; payment: Payment;
  adjust_type: "percent" | "fixed"; adjust_value: number; is_live: boolean;
};
export type Tax = { name: string; type: "percent" | "fixed"; amount: number; currency: string; per: "stay" | "night" | "person" | "room_night"; included: boolean };
export type Review = { id?: string; guest_name: string; guest_city: string; score: number; title: string; body: string; stayed_on: string | null; is_published: boolean };
export type Policies = {
  check_in_until: string; check_out_from: string; cancellation: string; children: string; min_age: string; pets: string;
  deposit: string; cards: string[]; id_required: boolean; marriage_cert: boolean; smoking_areas: boolean; no_parties: boolean;
  quiet_hours: boolean; min_stay: number; lead_days: number; child_free_age: number;
};
export const SCORE_KEYS = ["cleanliness", "location", "staff", "value", "comfort", "facilities"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export const SCORE_LABEL: Record<ScoreKey, string> = { cleanliness: "Cleanliness", location: "Location", staff: "Staff", value: "Value for money", comfort: "Comfort", facilities: "Facilities" };

export type HotelStatus = "published" | "draft" | "archived";
export type HotelDoc = {
  id?: string;
  name: string; kind: string; star_rating: number | null; chain: string; opened_year: number | null; renovated_year: number | null;
  total_rooms: number | null; badge: string; summary: string; description: string; highlights: string[]; languages: string[];
  address: string; area: string; city: string; destination_id: string | null; country: string; postcode: string;
  lat: number | null; lng: number | null; distances: Distance[];
  logo_url: string | null; voucher_image_url: string | null; photos: PhotoPair[];
  rooms: Room[]; rate_plans: RatePlan[]; weekend_uplift: number;
  facilities: string[];
  check_in_time: string; check_out_time: string; policies: Policies;
  taxes: Tax[];
  phone: string; email: string; website: string; emergency_phone: string; voucher_show_phone: boolean; voucher_show_email: boolean;
  rating: number | null; review_count: number | null; review_scores: Partial<Record<ScoreKey, number>>; reviews: Review[];
  status: HotelStatus; priority: number; slug: string; seo_title: string; seo_description: string; supplier: string; supplier_hotel_id: string;
  is_featured: boolean; in_deals: boolean; pay_at_hotel: boolean; currency_code: string;
};

export const PROPERTY_TYPES = ["Hotel", "Resort", "Apartment", "Guest house", "Villa", "Inn", "Heritage hotel", "Hostel", "Mountain lodge"];
export const BADGES = ["Luxury Resort", "City View", "Haram View", "Heritage Hotel", "Lakeside Resort", "Mountain Lodge", "City Landmark", "Value Pick", "Best seller", "New"];
export const BED_SETUPS = ["1 king bed", "1 queen bed", "1 double bed", "2 twin beds", "2 queen beds", "1 king + sofa bed", "3 single beds", "4 single beds", "Bunk beds"];
export const VIEWS = ["City", "Sea", "Palm", "Haram", "Kaaba", "Lake", "Mountain", "Garden", "Pool", "No view"];
export const SMOKING = ["Non-smoking", "Smoking", "Both available"];
export const MEAL_PLANS = ["Room only", "Breakfast", "Breakfast + dinner", "All meals", "Suhoor + iftar"];
export const CANCEL_RULES = ["Non-refundable", "Free until 1 day before", "Free until 3 days before", "Free until 7 days before", "Free until 14 days before"];
export const PAYMENTS: { value: Payment; label: string }[] = [{ value: "pay_now", label: "Pay now" }, { value: "deposit", label: "Deposit now, rest later" }, { value: "pay_at_hotel", label: "Pay at hotel" }];
export const TAX_PER: { value: Tax["per"]; label: string }[] = [{ value: "stay", label: "Per stay" }, { value: "night", label: "Per night" }, { value: "person", label: "Per person" }, { value: "room_night", label: "Per room, per night" }];
export const SUPPLIERS = ["Direct contract", "Hotelbeds", "WebBeds", "Ratehawk", "TBO Holidays", "Expedia TAAP"];

export const FACILITIES: Record<string, string[]> = {
  "Most popular": ["Free Wi-Fi", "Airport shuttle", "Swimming pool", "Family rooms", "Restaurant", "24-hour front desk", "Room service", "Fitness centre", "Spa", "Free parking"],
  "Food & drink": ["Breakfast buffet", "Halal food", "Kids’ meals", "Bar", "Coffee house on site", "Special diet menus"],
  "Pool & wellness": ["Outdoor pool", "Indoor pool", "Private beach", "Hammam", "Sauna", "Massage", "Kids’ pool"],
  "Prayer & family": ["Prayer room", "Qibla direction in rooms", "Prayer mats on request", "Babysitting", "Kids’ club", "Playground"],
  "Transport": ["Airport pick-up", "Haram shuttle", "Car hire desk", "Valet parking", "EV charging"],
  "Accessibility": ["Wheelchair accessible", "Lift to all floors", "Accessible bathroom", "Visual aids", "Toilet with grab rails"],
  "Safety": ["CCTV in common areas", "Smoke alarms", "Fire extinguishers", "Security 24 hours", "In-room safe", "First aid kit"],
};

export const DEFAULT_POLICIES: Policies = {
  check_in_until: "Midnight", check_out_from: "06:00",
  cancellation: "Free cancellation until 3 days before arrival. After that, the first night is charged. No-shows are charged the full stay.",
  children: "Children of any age are welcome. Under 6 stay free using existing beds.", min_age: "18", pets: "Not allowed",
  deposit: "", cards: ["Visa", "Mastercard"], id_required: true, marriage_cert: false, smoking_areas: true, no_parties: true,
  quiet_hours: false, min_stay: 1, lead_days: 0, child_free_age: 5,
};

let n = 0;
export const tmpKey = () => `tmp-${Date.now().toString(36)}-${(n++).toString(36)}`;

export const emptyRoom = (): Room => ({
  key: tmpKey(), name: "", size_m2: null, beds: "1 king bed", max_adults: 2, max_children: 1, units: 1, view: "City",
  smoking: "Non-smoking", extra_bed: "Not available", amenities: ["Air conditioning", "Flat-screen TV", "Kettle", "Safe"], photos: [], base_price: 0,
});
export const emptyRate = (): RatePlan => ({
  key: tmpKey(), room_key: null, name: "", meal_plan: "Breakfast", cancellation: "Free until 3 days before", payment: "pay_now",
  adjust_type: "percent", adjust_value: 0, is_live: true,
});

export function emptyHotel(): HotelDoc {
  return {
    name: "", kind: "Hotel", star_rating: 3, chain: "", opened_year: null, renovated_year: null, total_rooms: null, badge: "", summary: "",
    description: "", highlights: [], languages: ["English", "Urdu", "Arabic"], address: "", area: "", city: "", destination_id: null, country: "",
    postcode: "", lat: null, lng: null, distances: [], logo_url: null, voucher_image_url: null, photos: [], rooms: [], rate_plans: [],
    weekend_uplift: 0, facilities: [], check_in_time: "14:00", check_out_time: "12:00", policies: { ...DEFAULT_POLICIES }, taxes: [],
    phone: "", email: "", website: "", emergency_phone: "", voucher_show_phone: true, voucher_show_email: true,
    rating: null, review_count: null, review_scores: {}, reviews: [], status: "draft", priority: 0, slug: "", seo_title: "",
    seo_description: "", supplier: "Direct contract", supplier_hotel_id: "", is_featured: false, in_deals: false, pay_at_hotel: false, currency_code: "PKR",
  };
}

/** Nightly price of a room under a rate plan. */
export const ratePrice = (base: number, p: Pick<RatePlan, "adjust_type" | "adjust_value">) =>
  Math.max(0, Math.round(p.adjust_type === "percent" ? base * (1 + p.adjust_value / 100) : base + p.adjust_value));

/** The "from" price the website shows: the lowest live rate across room types (base price when no plan is live). */
export function lowestRate(rooms: Pick<Room, "key" | "base_price">[], plans: Pick<RatePlan, "room_key" | "adjust_type" | "adjust_value" | "is_live">[]): number | null {
  const priced = rooms.filter((r) => r.base_price > 0);
  if (!priced.length) return null;
  const live = plans.filter((p) => p.is_live);
  const all = live.length
    ? live.flatMap((p) => priced.filter((r) => !p.room_key || p.room_key === r.key).map((r) => ratePrice(r.base_price, p)))
    : priced.map((r) => r.base_price);
  return all.length ? Math.min(...all) : Math.min(...priced.map((r) => r.base_price));
}

/* ---------- listing quality ---------- */

export type Check = { section: string; label: string; ok: boolean };

export function photoIssue(photos: PhotoPair[], voucherImage?: string | null): string | null {
  if (!photos.length) return "No photos yet";
  const eve = photos.filter((p) => !p.night).length;
  if (eve) return `${eve} evening shot${eve > 1 ? "s" : ""} missing`;
  if (photos.length < 3) return `Add ${3 - photos.length} more photo${photos.length === 2 ? "" : "s"}`;
  if (voucherImage === null || voucherImage === "") return "Voucher photo missing";
  return null;
}

type HotelQ = Pick<HotelDoc, "name" | "summary" | "description" | "star_rating" | "address" | "destination_id" | "lat" | "lng" | "photos" | "voucher_image_url" | "facilities" | "check_in_time" | "phone" | "email" | "slug" | "seo_title"> & {
  policies: Partial<Policies>; rooms: unknown[] | number; rate_plans: { is_live: boolean }[] | number;
};

export function hotelChecks(h: HotelQ): Check[] {
  const rooms = typeof h.rooms === "number" ? h.rooms : h.rooms.length;
  const live = typeof h.rate_plans === "number" ? h.rate_plans : h.rate_plans.filter((p) => p.is_live).length;
  const ph = photoIssue(h.photos, h.voucher_image_url);
  return [
    { section: "basics", label: "Name, stars, summary and description", ok: !!(h.name && h.summary && h.description && h.star_rating) },
    { section: "loc", label: "Address, destination and map pin", ok: !!(h.address && h.destination_id && h.lat != null && h.lng != null) },
    { section: "photos", label: ph ? `Photos: ${ph.charAt(0).toLowerCase() + ph.slice(1)}` : "Photos and voucher photo", ok: !ph },
    { section: "rooms", label: rooms ? "Room types" : "Add at least one room type", ok: rooms > 0 },
    { section: "rates", label: live ? "Live rate plans" : "Turn on at least one rate plan", ok: live > 0 },
    { section: "amen", label: "Facilities (5 or more)", ok: h.facilities.length >= 5 },
    { section: "pol", label: "Check-in times and cancellation policy", ok: !!(h.check_in_time && h.policies?.cancellation) },
    { section: "contact", label: "Hotel phone or email for the voucher", ok: !!(h.phone || h.email) },
    { section: "vis", label: "Page address and SEO title", ok: !!(h.slug && h.seo_title) },
  ];
}

/* ---------- excursions ---------- */

export type ExcStatus = "published" | "seasonal" | "draft" | "archived";
export type Stop = { time: string; title: string; duration: string; description: string };
export type Zone = { zone: string; window: string; fee: number };
export type ExcOption = {
  id?: string; key: string; name: string; note: string; price_basis: "person" | "group"; max_group: number | null;
  adult_price: number; child_price: number | null; infant_price: number | null; supplier_cost?: number | null; is_live: boolean;
};
export type ExcDoc = {
  id?: string;
  title: string; category: string; destination_id: string | null; location_label: string; duration_label: string; duration_minutes: number | null;
  activity_level: string; group_type: string; summary: string; description: string; highlights: string[];
  itinerary: Stop[];
  days_of_week: string[]; start_times: string[]; capacity: number | null; min_guests: number; cutoff_hours: number;
  season_from: string | null; season_to: string | null; blackout_dates: string[];
  options: ExcOption[]; group_discount_pct: number | null; group_discount_min: number | null; peak_uplift_pct: number | null; peak_from: string | null; peak_to: string | null;
  inclusions: string[]; exclusions: string[];
  pickup_offered: boolean; pickup_zones: Zone[]; meeting_point: string; meeting_map_url: string; ends_at: string;
  guide_type: string; languages: string[];
  not_suitable: string[]; what_to_bring: string[]; min_age: number | null; dress_code: string;
  cancellation_policy: string; weather_policy: string;
  photos: PhotoPair[];
  status: ExcStatus; slug: string; seo_title: string; seo_description: string; supplier: string; supplier_product_id: string; supplier_confirms: string;
  is_featured: boolean; rating: number | null; review_count: number | null; currency_code: string; price_unit: string;
};

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const EXC_CATEGORIES = ["Desert safari", "City tour", "Cruise", "Attraction ticket", "Day trip", "Adventure", "Cultural", "Ziyarat", "Food tour", "Theme park", "Water sports", "Mountain tour", "Landmark"];
export const ACTIVITY = ["Easy", "Moderate", "Challenging"];
export const GROUP_TYPES = ["Shared group", "Private only", "Shared or private"];
export const GUIDES = ["Driver-guide", "Licensed guide", "Scholar guide", "Audio guide", "No guide"];
export const EXC_CANCEL = ["Free cancellation up to 24 hours before", "Free cancellation up to 48 hours before", "Free cancellation up to 7 days before", "Non-refundable"];
export const WEATHER = ["Full refund or new date", "New date only", "No change for weather"];
export const EXC_SUPPLIERS = ["Direct operator", "Arabian Adventures", "Viator", "GetYourGuide", "Klook", "Own team"];
export const CONFIRMS = ["Instantly", "Within 2 hours", "Within 24 hours"];

export const emptyOption = (): ExcOption => ({ key: tmpKey(), name: "", note: "", price_basis: "person", max_group: null, adult_price: 0, child_price: null, infant_price: 0, supplier_cost: null, is_live: true });

export function emptyExcursion(): ExcDoc {
  return {
    title: "", category: "Day trip", destination_id: null, location_label: "", duration_label: "", duration_minutes: null, activity_level: "Easy",
    group_type: "Shared group", summary: "", description: "", highlights: [], itinerary: [], days_of_week: [...DAYS], start_times: [],
    capacity: null, min_guests: 1, cutoff_hours: 24, season_from: null, season_to: null, blackout_dates: [], options: [],
    group_discount_pct: null, group_discount_min: null, peak_uplift_pct: null, peak_from: null, peak_to: null, inclusions: [], exclusions: [],
    pickup_offered: false, pickup_zones: [], meeting_point: "", meeting_map_url: "", ends_at: "", guide_type: "Driver-guide",
    languages: ["English", "Urdu"], not_suitable: [], what_to_bring: [], min_age: null, dress_code: "",
    cancellation_policy: EXC_CANCEL[0], weather_policy: WEATHER[0], photos: [], status: "draft", slug: "", seo_title: "", seo_description: "",
    supplier: "Direct operator", supplier_product_id: "", supplier_confirms: "Instantly", is_featured: false, rating: null, review_count: null,
    currency_code: "PKR", price_unit: "per person",
  };
}

export const lowestAdult = (opts: Pick<ExcOption, "adult_price" | "is_live">[]) => {
  const live = opts.filter((o) => o.is_live && o.adult_price > 0);
  return live.length ? Math.min(...live.map((o) => o.adult_price)) : null;
};

type ExcQ = Pick<ExcDoc, "title" | "summary" | "description" | "destination_id" | "days_of_week" | "start_times" | "capacity" | "inclusions" | "photos" | "slug" | "seo_title" | "cancellation_policy"> & {
  itinerary: unknown[] | number; options: { is_live: boolean }[] | number;
};

export function excChecks(e: ExcQ): Check[] {
  const stops = typeof e.itinerary === "number" ? e.itinerary : e.itinerary.length;
  const live = typeof e.options === "number" ? e.options : e.options.filter((o) => o.is_live).length;
  const ph = photoIssue(e.photos);
  return [
    { section: "basics", label: "Title, destination, summary and description", ok: !!(e.title && e.destination_id && e.summary && e.description) },
    { section: "itin", label: stops ? "Itinerary stops" : "Add the itinerary", ok: stops > 0 },
    { section: "sched", label: "Days, start times and capacity", ok: e.days_of_week.length > 0 && e.start_times.length > 0 && !!e.capacity },
    { section: "price", label: live ? "Live options with prices" : "Add a live option", ok: live > 0 },
    { section: "inc", label: "What’s included", ok: e.inclusions.length > 0 },
    { section: "cancel", label: "Cancellation policy", ok: !!e.cancellation_policy },
    { section: "photos", label: ph ? `Photos: ${ph.charAt(0).toLowerCase() + ph.slice(1)}` : "Photos", ok: !ph },
    { section: "vis", label: "Page address and SEO title", ok: !!(e.slug && e.seo_title) },
  ];
}

export const quality = (checks: Check[]) => Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
