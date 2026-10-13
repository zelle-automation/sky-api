// Demo catalogue detail for the hotel and excursion editors: room types, rate plans, 30 nights of
// availability, policies, taxes, contacts and reviews for the seeded hotels (plus the client's real
// Ibis Dubai Al Rigga), and itineraries, schedules and age-band options for the seeded excursions.
// Idempotent: rows are updated by slug and child rows are replaced.
import type { Client } from "pg";

const START = "2026-10-13";
const art = (kind: string, pal: string, seed: number) => `/art/${kind}-${pal}-${seed}.svg`;
const pair = (kind: string, day: string, eve: string | null, seed: number, tag: string) => ({ day: art(kind, day, seed), night: eve ? art(kind, eve, seed) : null, tag });

type RoomSeed = [name: string, m2: number, beds: string, adults: number, kids: number, units: number, view: string, amenities: string[], base: number];
type PlanSeed = [name: string, meal: string, cancel: string, payment: "pay_now" | "pay_at_hotel" | "deposit", type: "percent" | "fixed", value: number, live: boolean];
type TaxSeed = [name: string, type: "percent" | "fixed", amount: number, currency: string, per: "stay" | "night" | "person" | "room_night", included: boolean];

const UAE_TAX = (dirham: number): TaxSeed[] => [
  ["VAT", "percent", 5, "AED", "stay", true], ["Municipality fee", "percent", 7, "AED", "stay", true],
  ["Service charge", "percent", 10, "AED", "stay", true], ["Tourism Dirham", "fixed", dirham, "AED", "room_night", false],
];
const KSA_TAX: TaxSeed[] = [["VAT", "percent", 15, "SAR", "stay", true], ["Municipality fee", "percent", 2.5, "SAR", "stay", true]];
const TR_TAX: TaxSeed[] = [["VAT", "percent", 10, "TRY", "stay", true], ["Accommodation tax", "percent", 2, "TRY", "stay", true]];
const AZ_TAX: TaxSeed[] = [["VAT", "percent", 18, "AZN", "stay", true], ["Tourist fee", "fixed", 1.3, "AZN", "room_night", false]];
const PK_TAX: TaxSeed[] = [["Sales tax (GST)", "percent", 16, "PKR", "stay", true]];

const PLANS_STD: PlanSeed[] = [
  ["Room only · Non-refundable", "Room only", "Non-refundable", "pay_now", "percent", -12, true],
  ["Bed & breakfast · Flexible", "Breakfast", "Free until 3 days before", "pay_now", "percent", 0, true],
  ["Half board · Flexible", "Breakfast + dinner", "Free until 3 days before", "pay_now", "percent", 18, true],
  ["Umrah & long stay · 7+ nights", "Breakfast", "Free until 7 days before", "deposit", "percent", -8, false],
];
const PLANS_KSA: PlanSeed[] = [
  ["Room only · Non-refundable", "Room only", "Non-refundable", "pay_now", "percent", -10, true],
  ["Bed & breakfast · Flexible", "Breakfast", "Free until 7 days before", "pay_now", "percent", 0, true],
  ["Ramadan suhoor + iftar", "Suhoor + iftar", "Free until 14 days before", "deposit", "percent", 22, false],
];
const PLANS_PK: PlanSeed[] = [
  ["Bed & breakfast · Flexible", "Breakfast", "Free until 3 days before", "pay_now", "percent", 0, true],
  ["Breakfast & dinner", "Breakfast + dinner", "Free until 3 days before", "pay_now", "fixed", 6500, true],
  ["Pay at hotel", "Breakfast", "Free until 1 day before", "pay_at_hotel", "percent", 5, true],
];

const FAC_BASE = ["Free Wi-Fi", "Restaurant", "24-hour front desk", "Room service", "Breakfast buffet", "Halal food", "Lift to all floors", "CCTV in common areas", "Smoke alarms", "Fire extinguishers", "Security 24 hours", "In-room safe", "Prayer mats on request", "Qibla direction in rooms"];
const FAC_LUX = [...FAC_BASE, "Airport shuttle", "Swimming pool", "Family rooms", "Fitness centre", "Spa", "Kids’ meals", "Outdoor pool", "Massage", "Kids’ club", "Babysitting", "Airport pick-up", "Valet parking", "Wheelchair accessible", "Accessible bathroom", "First aid kit"];

const NAMES = ["Ayesha Khan", "Usman Tariq", "Fatima Raza", "Bilal Ahmed", "Hina Malik", "Hamza Qureshi", "Sana Iqbal", "Omar Farooq", "Zainab Shah", "Ali Haider"];
const CITIES = ["Lahore", "Karachi", "Islamabad", "Faisalabad", "Multan", "Peshawar", "Rawalpindi", "Sialkot"];

type HotelSeed = {
  slug: string; chain: string; opened: number | null; renovated: number | null; total: number; badge: string; type: string; area: string; city: string;
  country: string; postcode: string; lat: number; lng: number; address?: string; summary: string; description?: string; languages: string[];
  distances: [string, string][]; photos: { day: string; night: string | null; tag: string }[]; voucher?: string; rooms: RoomSeed[]; plans: PlanSeed[];
  uplift: number; facilities: string[]; checkIn: string; checkOut: string; policies: Record<string, unknown>; taxes: TaxSeed[];
  phone: string; email: string; website: string; emergency: string; scores: number[]; supplier: string; supplierId: string; priority: number;
  status?: string; deals?: boolean; payAtHotel?: boolean; reviews: [string, string][];
};

const POL = (o: Record<string, unknown> = {}) => ({
  check_in_until: "Midnight", check_out_from: "06:00",
  cancellation: "Free cancellation until 3 days before arrival. After that, the first night is charged. No-shows are charged the full stay.",
  children: "Children of any age are welcome. Under 6 stay free using existing beds. Cribs are free on request.",
  min_age: "18", pets: "Not allowed", deposit: "", cards: ["Visa", "Mastercard"], id_required: true, marriage_cert: false,
  smoking_areas: true, no_parties: true, quiet_hours: false, min_stay: 1, lead_days: 0, child_free_age: 5, ...o,
});

const HOTELS: HotelSeed[] = [
  {
    slug: "atlantis-the-palm", chain: "Atlantis Resorts", opened: 2008, renovated: 2023, total: 1548, badge: "Luxury Resort", type: "Resort",
    area: "Palm Jumeirah", city: "Dubai", country: "United Arab Emirates", postcode: "211222", lat: 25.1304, lng: 55.1171, address: "Crescent Road, The Palm, Dubai",
    summary: "Ocean-facing rooms on the Palm’s crescent with the waterpark and private beach steps away.",
    description: "Set on the crescent of Palm Jumeirah, Atlantis The Palm is a landmark ocean resort with Aquaventure Waterpark, The Lost Chambers Aquarium and 1.4 km of private beach. Rooms open onto the Arabian Gulf or the Palm, and 23 restaurants include halal fine dining. Guests get unlimited access to Aquaventure for the length of their stay.",
    languages: ["English", "Arabic", "Urdu", "Hindi", "Russian"],
    distances: [["Dubai International Airport (DXB)", "34 km"], ["Al Maktoum Airport (DWC)", "44 km"], ["Dubai Mall & Burj Khalifa", "26 km"], ["Palm Monorail, Atlantis Aquaventure", "0.3 km"], ["Private beach", "On site"]],
    photos: [pair("villas", "teal", "night", 44, "Exterior"), pair("island", "morning", "dusk", 45, "Beach"), pair("tower", "day", "night", 46, "Lobby"), pair("villas", "day", null, 47, "Pool"), pair("city", "day", "night", 48, "Room view")],
    rooms: [
      ["Deluxe King, Palm view", 45, "1 king bed", 2, 1, 120, "Palm", ["Balcony", "Rain shower", "Minibar", "Nespresso machine"], 84500],
      ["Deluxe Two Queens, Ocean view", 45, "2 queen beds", 4, 1, 96, "Sea", ["Ocean view", "Bathtub", "Minibar", "Sofa bed"], 92000],
      ["Imperial Club King", 50, "1 king bed", 2, 2, 40, "Sea", ["Club lounge access", "Butler", "Evening canapés"], 128000],
      ["Terrace Suite", 95, "1 king + sofa bed", 3, 2, 12, "Sea", ["Private terrace", "Living room", "Guest toilet"], 212000],
    ],
    plans: PLANS_STD.map((p) => (p[0].startsWith("Room only") ? [p[0], p[1], p[2], p[3], p[4], 0, p[6]] as PlanSeed : p)), uplift: 18, facilities: [...FAC_LUX, "Private beach", "Kids’ pool"],
    checkIn: "15:00", checkOut: "12:00", policies: POL({ min_age: "21", deposit: "AED 500 per night", cards: ["Visa", "Mastercard", "Amex", "UnionPay"], children: "Children of any age are welcome. Under 6 stay free using existing beds. One extra bed per room for PKR 9,000 a night. Cribs are free on request." }),
    taxes: UAE_TAX(20), phone: "+971 4 426 2000", email: "reservations@atlantisthepalm.com", website: "https://www.atlantis.com/dubai", emergency: "+971 4 426 1000",
    scores: [9.1, 8.9, 9.3, 8.4, 9.2, 9.2], supplier: "Direct contract", supplierId: "ATL-DXB-0001", priority: 10, deals: true,
    reviews: [["Perfect family stay", "Kids loved Aquaventure and the halal options at Saffron were excellent. Staff helped with a prayer mat within minutes."], ["Worth it for the waterpark", "Pricey but the room view over the Palm was unreal. Check-in queue was long at 3 pm."], ["Honeymoon to remember", "Upgraded to an ocean view, beach was spotless."]],
  },
  {
    slug: "address-downtown", chain: "Address Hotels + Resorts", opened: 2008, renovated: 2018, total: 196, badge: "City View", type: "Hotel",
    area: "Downtown Dubai", city: "Dubai", country: "United Arab Emirates", postcode: "123234", lat: 25.1933, lng: 55.2797, address: "Sheikh Mohammed bin Rashid Blvd, Downtown Dubai",
    summary: "Fountain-facing rooms next to Dubai Mall with the Burj Khalifa outside the window.",
    languages: ["English", "Arabic", "Urdu", "Hindi"],
    distances: [["Dubai International Airport (DXB)", "15 km"], ["Dubai Mall", "0.2 km"], ["Burj Khalifa", "0.4 km"], ["Burj Khalifa/Dubai Mall Metro", "1.1 km"]],
    photos: [pair("tower", "day", "night", 15, "Exterior"), pair("city", "day", "night", 16, "Burj view"), pair("city", "morning", "dusk", 17, "Infinity pool"), pair("tower", "teal", "night", 18, "Suite")],
    rooms: [
      ["Deluxe Room, Burj view", 52, "1 king bed", 2, 1, 80, "City", ["Burj Khalifa view", "Rain shower", "Minibar"], 71000],
      ["Deluxe Twin, Fountain view", 52, "2 twin beds", 2, 1, 60, "City", ["Fountain view", "Bathtub", "Minibar"], 76000],
      ["Address Suite", 98, "1 king + sofa bed", 3, 2, 12, "City", ["Living room", "Club lounge access", "Butler"], 158000],
    ],
    plans: PLANS_STD.slice(1, 3).map((p) => p), uplift: 15, facilities: [...FAC_LUX.filter((f) => f !== "Kids’ club")],
    checkIn: "15:00", checkOut: "12:00", policies: POL({ min_age: "21", deposit: "AED 300 per night", cards: ["Visa", "Mastercard", "Amex"] }),
    taxes: UAE_TAX(20), phone: "+971 4 436 8888", email: "stay@addresshotels.com", website: "https://www.addresshotels.com", emergency: "",
    scores: [9.2, 9.6, 9.1, 8.2, 9.0, 8.9], supplier: "Hotelbeds", supplierId: "HB-118302", priority: 8,
    reviews: [["Best view in Dubai", "Watched the fountain show from our room every night."], ["Great location", "Two minutes to Dubai Mall, ideal for shopping trips."]],
  },
  {
    slug: "swissotel-makkah", chain: "Swissôtel (Accor)", opened: 2012, renovated: 2022, total: 1624, badge: "Haram View", type: "Hotel",
    area: "Abraj Al Bait", city: "Makkah", country: "Saudi Arabia", postcode: "24231", lat: 21.4189, lng: 39.8256, address: "Abraj Al Bait Complex, King Abdul Aziz Endowment, Makkah",
    summary: "Direct access to the Haram plaza from the Abraj Al Bait complex.",
    description: "Swissôtel Makkah sits inside the Abraj Al Bait complex with a private entrance onto the Haram plaza, two minutes from the King Abdul Aziz Gate. Rooms are quiet and family-sized, many with Haram views, and the restaurants serve suhoor and iftar buffets through Ramadan.",
    languages: ["Arabic", "English", "Urdu", "Malay", "Turkish"],
    distances: [["Masjid al-Haram, King Abdul Aziz Gate", "2 min walk"], ["King Abdulaziz Airport (JED)", "95 km"], ["Haramain Train, Makkah station", "4 km"], ["Mina", "6 km"]],
    photos: [pair("tower", "day", "night", 52, "Clock tower"), pair("domes", "morning", "gold", 53, "Haram view"), pair("domes", "day", "night", 54, "Prayer area"), pair("tower", "morning", "dusk", 55, "Family room")],
    rooms: [
      ["Superior Room, city view", 30, "2 twin beds", 2, 1, 600, "City", ["Prayer mat", "Quran", "Kettle"], 61000],
      ["Deluxe Room, Haram view", 32, "1 king bed", 2, 1, 340, "Haram", ["Haram view", "Prayer mat", "Bathtub"], 79000],
      ["Family Quad", 42, "4 single beds", 4, 2, 180, "City", ["Sofa", "Prayer mat", "Two bathrooms"], 88000],
      ["Kaaba View Suite", 80, "1 king + sofa bed", 3, 2, 20, "Kaaba", ["Kaaba view", "Living room", "Butler"], 196000],
    ],
    plans: PLANS_KSA, uplift: 10, facilities: [...FAC_BASE, "Family rooms", "Prayer room", "Haram shuttle", "Wheelchair accessible", "Accessible bathroom", "Airport pick-up", "Babysitting"],
    checkIn: "16:00", checkOut: "12:00", policies: POL({ cancellation: "Free cancellation until 7 days before arrival. During Ramadan and Hajj season all bookings are non-refundable.", marriage_cert: true, smoking_areas: false, quiet_hours: true, min_age: "18" }),
    taxes: KSA_TAX, phone: "+966 12 571 7777", email: "reservations.makkah@swissotel.com", website: "https://www.swissotel.com/hotels/makkah", emergency: "+966 12 571 7700",
    scores: [9.0, 9.8, 9.1, 8.3, 8.9, 8.7], supplier: "WebBeds", supplierId: "WB-MAK-40512", priority: 9,
    reviews: [["Steps from the Haram", "My parents could walk to every prayer. Lifts get busy after Isha."], ["Clean and calm", "Family quad was spacious for the four of us."]],
  },
  {
    slug: "pullman-zamzam-madinah", chain: "Pullman (Accor)", opened: 2009, renovated: 2019, total: 646, badge: "Haram View", type: "Hotel",
    area: "Central Area", city: "Madinah", country: "Saudi Arabia", postcode: "42311", lat: 24.4697, lng: 39.6106, address: "Central Area North, Bab Al Salam, Madinah",
    summary: "A few minutes on foot from the Prophet’s Mosque, popular with Umrah families.",
    languages: ["Arabic", "English", "Urdu", "Indonesian"],
    distances: [["Masjid an-Nabawi, Gate 21", "3 min walk"], ["Prince Mohammad bin Abdulaziz Airport (MED)", "18 km"], ["Masjid Quba", "4 km"]],
    photos: [pair("domes", "day", "night", 83, "Exterior"), pair("domes", "morning", null, 84, "Masjid view"), pair("tower", "day", "night", 85, "Lobby")],
    rooms: [
      ["Superior Twin", 28, "2 twin beds", 2, 1, 300, "City", ["Prayer mat", "Kettle", "Safe"], 33500],
      ["Deluxe Triple, Haram view", 34, "3 single beds", 3, 1, 160, "Haram", ["Haram view", "Prayer mat"], 46000],
      ["Family Quad", 40, "4 single beds", 4, 2, 120, "City", ["Sofa", "Prayer mat"], 52000],
    ],
    plans: PLANS_KSA.slice(0, 2), uplift: 0, facilities: [...FAC_BASE, "Family rooms", "Prayer room", "Wheelchair accessible", "Airport pick-up"],
    checkIn: "16:00", checkOut: "12:00", policies: POL({ cancellation: "Free cancellation until 7 days before arrival.", quiet_hours: true, smoking_areas: false }),
    taxes: KSA_TAX, phone: "+966 14 820 9000", email: "h7088-re@accor.com", website: "https://all.accor.com", emergency: "",
    scores: [8.7, 9.6, 8.8, 8.5, 8.6, 8.2], supplier: "Ratehawk", supplierId: "RH-MED-7088", priority: 7,
    reviews: [["Close to Masjid an-Nabawi", "Very convenient for elderly parents."], ["Good value", "Breakfast was simple but fresh."]],
  },
  {
    slug: "pera-palace-hotel", chain: "Jumeirah", opened: 1892, renovated: 2010, total: 115, badge: "Heritage Hotel", type: "Heritage hotel",
    area: "Beyoğlu", city: "Istanbul", country: "Türkiye", postcode: "34430", lat: 41.0317, lng: 28.9746, address: "Meşrutiyet Cd. No:52, Tepebaşı, Beyoğlu",
    summary: "The 1892 grand hotel built for Orient Express passengers, steps from Istiklal Avenue.",
    languages: ["Turkish", "English", "Arabic"],
    distances: [["Istanbul Airport (IST)", "45 km"], ["Istiklal Avenue", "0.4 km"], ["Galata Tower", "1 km"], ["Hagia Sophia", "4 km"]],
    photos: [pair("domes", "morning", "night", 71, "Façade"), pair("domes", "day", "dusk", 72, "Golden Horn"), pair("city", "day", "night", 73, "Orient Bar")],
    rooms: [
      ["Classic Room", 26, "1 queen bed", 2, 1, 50, "City", ["High ceilings", "Marble bathroom"], 52000],
      ["Deluxe Golden Horn", 32, "1 king bed", 2, 1, 40, "Sea", ["Golden Horn view", "Bathtub"], 64000],
      ["Agatha Christie Suite", 55, "1 king bed", 2, 1, 1, "City", ["Historic suite", "Living area"], 145000],
    ],
    plans: PLANS_STD.slice(0, 2), uplift: 12, facilities: [...FAC_BASE.filter((f) => !f.includes("Qibla")), "Spa", "Fitness centre", "Indoor pool", "Hammam", "Bar"],
    checkIn: "15:00", checkOut: "12:00", policies: POL({ cards: ["Visa", "Mastercard", "Amex"] }),
    taxes: TR_TAX, phone: "+90 212 377 4000", email: "perapalace@jumeirah.com", website: "https://www.jumeirah.com", emergency: "",
    scores: [9.2, 9.3, 9.4, 8.6, 9.1, 8.8], supplier: "Hotelbeds", supplierId: "HB-IST-2207", priority: 5,
    reviews: [["Pure history", "Stayed in a room above the Orient Bar. Magical."]],
  },
  {
    slug: "fairmont-baku-flame-towers", chain: "Fairmont (Accor)", opened: 2012, renovated: null, total: 318, badge: "City Landmark", type: "Hotel",
    area: "Mehdi Huseyn", city: "Baku", country: "Azerbaijan", postcode: "AZ1006", lat: 40.3594, lng: 49.8266, address: "1A Mehdi Huseyn Street, Baku",
    summary: "Inside the city’s landmark towers with sweeping views over the Caspian boulevard.",
    languages: ["Azerbaijani", "Russian", "English"],
    distances: [["Heydar Aliyev Airport (GYD)", "26 km"], ["Old City (Icherisheher)", "1.2 km"], ["Baku Boulevard", "1 km"]],
    photos: [pair("city", "morning", "dusk", 29, "Flame Towers")],
    rooms: [
      ["Fairmont Room, city view", 40, "1 king bed", 2, 1, 200, "City", ["City view", "Minibar"], 39500],
      ["Fairmont Gold, Caspian view", 45, "1 king bed", 2, 1, 60, "Sea", ["Caspian view", "Gold lounge"], 58000],
    ],
    plans: PLANS_STD.slice(1, 2), uplift: 10, facilities: FAC_BASE.slice(0, 6),
    checkIn: "15:00", checkOut: "12:00", policies: POL(), taxes: AZ_TAX, phone: "+994 12 565 4848", email: "baku@fairmont.com", website: "", emergency: "",
    scores: [8.9, 8.7, 9.0, 8.5, 9.0, 8.8], supplier: "Direct contract", supplierId: "", priority: 0, status: "draft",
    reviews: [],
  },
  {
    slug: "shangrila-resort-skardu", chain: "Shangrila Resorts", opened: 1983, renovated: 2021, total: 95, badge: "Lakeside Resort", type: "Resort",
    area: "Lower Kachura", city: "Skardu", country: "Pakistan", postcode: "16100", lat: 35.4314, lng: 75.4553, address: "Lower Kachura Lake, Skardu, Gilgit-Baltistan",
    summary: "Red-roofed chalets on the shore of Lower Kachura Lake, ringed by the Karakoram.",
    languages: ["Urdu", "English", "Balti"],
    distances: [["Skardu Airport (KDU)", "24 km"], ["Skardu bazaar", "32 km"], ["Upper Kachura Lake", "3 km"]],
    photos: [pair("lake", "day", "dusk", 61, "Lake chalets"), pair("mountains", "day", "dusk", 62, "Karakoram view"), pair("lake", "morning", "gold", 63, "Aircraft café")],
    rooms: [
      ["Standard Chalet", 24, "1 double bed", 2, 1, 40, "Lake", ["Heater", "Tea kettle"], 38000],
      ["Deluxe Lake-view Chalet", 30, "1 king bed", 2, 2, 30, "Lake", ["Lake view", "Heater", "Sitting area"], 48000],
      ["Family Cottage", 44, "2 queen beds", 4, 2, 12, "Garden", ["Two rooms", "Heater"], 62000],
    ],
    plans: PLANS_PK, uplift: 10, facilities: [...FAC_BASE.filter((f) => f !== "Lift to all floors"), "Free parking", "Family rooms", "Playground", "Airport pick-up", "Car hire desk"],
    checkIn: "14:00", checkOut: "12:00", policies: POL({ cancellation: "Free cancellation until 3 days before arrival. Flight cancellations to Skardu are rebooked free of charge.", marriage_cert: true, cards: ["Visa", "Mastercard", "UnionPay"] }),
    taxes: PK_TAX, phone: "+92 5815 450 146", email: "reservations@shangrilaresorts.com", website: "https://shangrilaresorts.com", emergency: "+92 300 850 1234",
    scores: [8.6, 9.5, 8.8, 8.1, 8.5, 8.2], supplier: "Direct contract", supplierId: "SR-SKD-01", priority: 6, payAtHotel: true,
    reviews: [["Most beautiful place in Pakistan", "Woke up to the lake every morning. Heaters were very welcome in October."], ["Lovely but remote", "Bring cash for the bazaar, the drive is long."]],
  },
  {
    slug: "hunza-serena-inn", chain: "Serena Hotels", opened: 1998, renovated: 2020, total: 42, badge: "Mountain Lodge", type: "Inn",
    area: "Karimabad", city: "Hunza", country: "Pakistan", postcode: "15700", lat: 36.3206, lng: 74.6644, address: "Karimabad, Hunza Valley, Gilgit-Baltistan",
    summary: "Stone-and-timber cottages in Karimabad, a short walk from Baltit Fort.",
    languages: ["Urdu", "English", "Burushaski"],
    distances: [["Gilgit Airport (GIL)", "100 km"], ["Baltit Fort", "0.8 km"], ["Altit Fort", "2 km"], ["Attabad Lake", "25 km"]],
    photos: [pair("mountains", "morning", "dusk", 72, "Cottages"), pair("mountains", "day", "gold", 73, "Rakaposhi view")],
    rooms: [
      ["Deluxe Room, Rakaposhi view", 28, "1 queen bed", 2, 1, 24, "Mountain", ["Mountain view", "Heater"], 29500],
      ["Family Suite", 46, "1 king + sofa bed", 3, 2, 6, "Garden", ["Fireplace", "Sitting room"], 52000],
    ],
    plans: PLANS_PK.slice(0, 2), uplift: 8, facilities: [...FAC_BASE.filter((f) => f !== "Lift to all floors"), "Free parking", "Family rooms"],
    checkIn: "14:00", checkOut: "12:00", policies: POL({ marriage_cert: true }),
    taxes: PK_TAX, phone: "+92 5813 457 660", email: "hunza@serena.com.pk", website: "https://www.serenahotels.com", emergency: "",
    scores: [8.8, 9.4, 9.0, 8.3, 8.6, 8.1], supplier: "Direct contract", supplierId: "SER-HZ-02", priority: 5,
    reviews: [["Wonderful staff", "The apricot jam at breakfast and the view of Rakaposhi made the trip."]],
  },
];

const IBIS_DESC = "Ibis Dubai Al Rigga hotel is a great choice for both business and leisure travelers. Choose from standard double room or twin bed, designed to suit your needs and ensuring a relaxing, value for money experience.";

const IBIS: HotelSeed = {
  slug: "ibis-dubai-al-rigga", chain: "ibis (Accor)", opened: 2008, renovated: 2019, total: 363, badge: "Value Pick", type: "Hotel",
  area: "Al Rigga, Deira", city: "Dubai", country: "United Arab Emirates", postcode: "", lat: 25.2638, lng: 55.3209,
  address: "Al Rigga Rd - Al Muraqqabat, Deira - Dubai - United Arab Emirates",
  summary: "Simple, modern rooms on Al Rigga Road, two minutes from the metro and Deira’s souks.", description: IBIS_DESC,
  languages: ["English", "Arabic", "Urdu", "Hindi", "Tagalog"],
  distances: [["Dubai International Airport (DXB)", "4 km"], ["Al Rigga Metro station", "0.2 km"], ["Deira City Centre", "2.5 km"], ["Gold Souk", "3 km"], ["Dubai Mall & Burj Khalifa", "14 km"]],
  photos: [
    { day: "/brand/docs/sample-ibis-room.jpg", night: "/brand/dubai-night.jpg", tag: "Standard Room" },
    pair("city", "day", "night", 30, "Al Rigga Road"), pair("tower", "day", "night", 31, "Lobby"),
  ],
  voucher: "/brand/docs/sample-ibis-room.jpg",
  rooms: [["Standard Room", 18, "1 double bed or 2 twin beds", 2, 1, 363, "City", ["Air conditioning", "Flat-screen TV", "Free Wi-Fi", "Work desk", "Shower"], 14500]],
  plans: [
    ["Room only · Flexible", "Room only", "Free until 1 day before", "pay_now", "percent", 0, true],
    ["Bed & breakfast · Flexible", "Breakfast", "Free until 1 day before", "pay_now", "fixed", 2500, true],
    ["Room only · Non-refundable", "Room only", "Non-refundable", "pay_now", "percent", -8, false],
  ],
  uplift: 12, facilities: ["Free Wi-Fi", "Restaurant", "24-hour front desk", "Bar", "Breakfast buffet", "Halal food", "Lift to all floors", "CCTV in common areas", "Smoke alarms", "Fire extinguishers", "Security 24 hours", "Prayer mats on request", "Qibla direction in rooms", "Free parking", "Wheelchair accessible"],
  checkIn: "14:00", checkOut: "12:00", policies: POL({ cancellation: "Free cancellation until 1 day before arrival. After that, the first night is charged.", children: "Up to 2 children under 12 stay free in the parents’ room using existing beds.", min_age: "18", deposit: "AED 200 per stay", child_free_age: 11 }),
  taxes: UAE_TAX(7), phone: "+971 4 206 8100", email: "h6685@accor.com", website: "https://all.accor.com", emergency: "",
  scores: [8.2, 8.6, 8.4, 8.5, 7.9, 7.6], supplier: "Direct contract", supplierId: "ACC-6685", priority: 9,
  reviews: [["Good value near the metro", "Clean room, quick check-in, and the metro is right outside."], ["Ideal for a short business trip", "Small room but everything worked. Breakfast is worth adding."], ["Convenient for Deira", "Walked to the souks and Deira City Centre."]],
};

/* ---------- excursions ---------- */

type OptSeed = [name: string, note: string, basis: "person" | "group", maxGroup: number | null, adult: number, child: number | null, infant: number | null, cost: number, live: boolean];
type ExcSeed = {
  slug: string; category: string; duration: string; level: string; group: string; description: string; itinerary: [string, string, string, string][];
  days: string[]; times: string[]; capacity: number; min: number; cutoff: number; season?: [string, string]; blackout: string[]; options: OptSeed[];
  discount?: [number, number]; peak?: [number, string, string]; inc: string[]; exc: string[]; pickup: boolean; zones: [string, string, number][];
  meeting: string; map: string; ends: string; guide: string; langs: string[]; notFor: string[]; bring: string[]; minAge: number | null; dress: string;
  cancel: string; weather: string; photos: { day: string; night: string | null; tag: string }[]; supplier: string; productId: string; confirms: string; status?: string;
};

const EXCURSIONS: ExcSeed[] = [
  {
    slug: "dubai-desert-safari-bbq", category: "Desert safari", duration: "6 hours · Hotel pickup", level: "Moderate", group: "Shared or private",
    description: "Leave the city behind for the red dunes of Lahbab. Your driver collects you from your hotel in the afternoon for 30 minutes of dune bashing, then you watch the sunset from the dunes before arriving at a Bedouin-style camp. Ride a camel, try sandboarding, get a henna design and enjoy an unlimited BBQ buffet with live Tanoura and fire shows.",
    itinerary: [["15:00", "Hotel pickup", "30 min", "4x4 Land Cruiser, up to 6 guests"], ["16:00", "Lahbab red dunes", "45 min", "Dune bashing and sunset photo stop"], ["17:15", "Desert camp", "1 h 15 min", "Camel ride, sandboarding, henna, Arabic coffee and dates"], ["18:30", "BBQ dinner and shows", "2 h", "Halal BBQ buffet, Tanoura and fire shows"], ["21:00", "Return to hotel", "1 h", "Drop-off at the same place"]],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], times: ["15:00", "15:30"], capacity: 120, min: 2, cutoff: 6, blackout: ["1st Ramadan evening", "UAE National Day"],
    options: [["Shared 4x4", "Seat in a shared vehicle", "person", null, 10500, 7500, 0, 7800, true], ["Private 4x4", "Whole vehicle for your group", "group", 6, 62000, null, null, 48000, true], ["VIP with quad bike", "30 min quad + VIP seating", "person", null, 24000, null, null, 18500, true], ["Overnight camp", "Breakfast, tent stay", "person", null, 21000, 16000, 0, 15500, false]],
    discount: [10, 10], peak: [15, "2026-12-15", "2027-01-05"],
    inc: ["Hotel pickup & drop-off", "Dune bashing", "Camel ride", "Sandboarding", "BBQ buffet dinner", "Soft drinks & water", "Live shows"], exc: ["Quad biking (unless VIP)", "Photos from the camp photographer", "Tips"],
    pickup: true, zones: [["Downtown & Business Bay", "15:00–15:20", 0], ["Dubai Marina & JBR", "14:45–15:15", 0], ["Palm Jumeirah", "14:40–15:00", 2500], ["Deira & Bur Dubai", "15:10–15:30", 0], ["Sharjah", "14:15–14:45", 4000]],
    meeting: "Al Lahbab Desert camp gate, Dubai–Hatta Road", map: "https://maps.google.com/?q=25.0237,55.5921", ends: "Back at pickup point", guide: "Driver-guide", langs: ["English", "Urdu", "Hindi", "Arabic"],
    notFor: ["Pregnant women", "Back or neck problems", "Children under 3 for dune bashing", "Wheelchair users"], bring: ["Sunglasses", "Light jacket in winter", "Passport copy"], minAge: 3, dress: "Modest clothing at the camp",
    cancel: "Free cancellation up to 24 hours before", weather: "Full refund or new date",
    photos: [pair("desert", "morning", "dusk", 14, "Dunes"), pair("desert", "morning", "gold", 15, "Camp"), pair("desert", "day", "night", 16, "BBQ dinner"), pair("tower", "day", "night", 17, "Pickup")],
    supplier: "Arabian Adventures", productId: "AA-DS-101", confirms: "Instantly",
  },
  {
    slug: "burj-khalifa-at-the-top", category: "Attraction ticket", duration: "1.5 hours · Skip the line", level: "Easy", group: "Shared group",
    description: "Ride one of the world’s fastest lifts to levels 124 and 125 of the Burj Khalifa. Walk the open-air terrace for views over the desert, the coast and the Palm, then visit the interactive gallery on the way down. Sunset slots sell out first.",
    itinerary: [["—", "Entrance at Dubai Mall, lower ground", "15 min", "Show your mobile ticket at the At the Top counter"], ["—", "High-speed lift", "1 min", "10 metres per second to level 124"], ["—", "Levels 124 & 125", "1 h", "Indoor and outdoor viewing decks, telescopes"], ["—", "Exit via Dubai Mall", "15 min", "Gift shop and Dubai Fountain"]],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], times: ["09:00", "11:00", "13:00", "15:00", "16:30", "17:30", "19:00", "21:00"], capacity: 200, min: 1, cutoff: 2, blackout: ["New Year’s Eve"],
    options: [["Levels 124 & 125, standard time", "Non-prime hours", "person", null, 12900, 9900, 0, 11000, true], ["Levels 124 & 125, sunset", "16:30–18:00 entry", "person", null, 18500, 14500, 0, 16200, true], ["SKY level 148", "Lounge with refreshments", "person", null, 52000, 52000, null, 46000, true]],
    inc: ["Entry ticket", "Fast-track lift", "Wi-Fi on the deck"], exc: ["Hotel transfers", "Food and drinks"],
    pickup: false, zones: [], meeting: "At the Top entrance, Dubai Mall lower ground floor", map: "https://maps.google.com/?q=25.1972,55.2744", ends: "Dubai Mall", guide: "No guide", langs: ["English", "Arabic"],
    notFor: [], bring: ["Mobile ticket", "Passport or Emirates ID"], minAge: null, dress: "Smart casual",
    cancel: "Non-refundable", weather: "New date only",
    photos: [pair("city", "morning", "dusk", 95, "Burj Khalifa"), pair("tower", "day", "night", 96, "Observation deck"), pair("city", "day", "night", 97, "Sunset view")],
    supplier: "Direct operator", productId: "EMAAR-ATT-125", confirms: "Instantly",
  },
  {
    slug: "bosphorus-sunset-cruise", category: "Cruise", duration: "2.5 hours · Live guide", level: "Easy", group: "Shared group",
    description: "Board at Eminönü and sail the Bosphorus between Europe and Asia as the sun sets. Pass Dolmabahçe Palace, the Ortaköy Mosque and Rumeli Fortress with Turkish tea and simit on board, and watch the minarets light up on the way back.",
    itinerary: [["18:00", "Boarding at Eminönü pier", "15 min", "Meet the guide at the yellow flag"], ["18:15", "Dolmabahçe & Ortaköy", "45 min", "Palace and mosque from the water"], ["19:00", "Rumeli Fortress & bridges", "45 min", "Turn under the Fatih Sultan Mehmet Bridge"], ["19:45", "Asian shore & return", "45 min", "Kuzguncuk, Maiden’s Tower at dusk"]],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], times: ["18:00"], capacity: 90, min: 1, cutoff: 12, blackout: [],
    options: [["Shared cruise", "Tea and simit included", "person", null, 8900, 6500, 0, 6800, true], ["Dinner cruise with show", "Halal dinner and Turkish night show", "person", null, 19500, 13500, 0, 15500, true]],
    inc: ["Cruise", "Live guide", "Turkish tea and simit"], exc: ["Hotel transfers", "Dinner (unless dinner cruise)"],
    pickup: false, zones: [], meeting: "Eminönü ferry pier, next to the Spice Bazaar", map: "https://maps.google.com/?q=41.0175,28.9719", ends: "Eminönü pier", guide: "Licensed guide", langs: ["English", "Turkish", "Arabic"],
    notFor: ["Wheelchair users (steps to the deck)"], bring: ["Light jacket"], minAge: null, dress: "",
    cancel: "Free cancellation up to 24 hours before", weather: "Full refund or new date",
    photos: [pair("domes", "morning", "dusk", 18, "Bosphorus"), pair("domes", "day", "night", 19, "Minarets at night"), pair("city", "morning", "dusk", 20, "On deck")],
    supplier: "GetYourGuide", productId: "GYG-IST-55021", confirms: "Within 2 hours",
  },
  {
    slug: "gabala-shamakhi-day-tour", category: "Day trip", duration: "10 hours · Small group", level: "Moderate", group: "Shared group",
    description: "Drive into the Caucasus foothills via the Juma Mosque in Shamakhi and the Diri Baba mausoleum, then ride the Tufandag cable car in Gabala and stop at the Seven Beauties waterfall before lunch at Nohur Lake.",
    itinerary: [["08:00", "Pickup in Baku", "30 min", "Hotels in the city centre"], ["10:30", "Juma Mosque, Shamakhi", "40 min", ""], ["12:30", "Tufandag cable car", "1 h 30 min", "Two-stage ride to 1,900 m"], ["14:30", "Lunch at Nohur Lake", "1 h", "Halal Azerbaijani lunch"], ["15:45", "Seven Beauties waterfall", "45 min", ""], ["18:30", "Back in Baku", "", ""]],
    days: ["Tue", "Thu", "Sat"], times: ["08:00"], capacity: 16, min: 2, cutoff: 24, blackout: ["Novruz holidays"],
    options: [["Small group", "Up to 16 guests", "person", null, 13900, 9900, 0, 10500, true], ["Private car", "Up to 4 guests with driver-guide", "group", 4, 52000, null, null, 41000, true]],
    inc: ["Hotel pickup & drop-off", "Driver-guide", "Bottled water"], exc: ["Cable car tickets (AZN 30)", "Lunch", "Tips"],
    pickup: true, zones: [["Baku city centre", "07:45–08:15", 0], ["Baku airport hotels", "07:30–07:45", 2500]], meeting: "Fountain Square, Baku", map: "", ends: "Your hotel", guide: "Driver-guide", langs: ["English", "Russian", "Urdu"],
    notFor: ["People with fear of heights (cable car)"], bring: ["Warm layer", "Comfortable shoes"], minAge: null, dress: "Head scarf for women at the mosque",
    cancel: "Free cancellation up to 48 hours before", weather: "Full refund or new date",
    photos: [pair("lake", "morning", "gold", 26, "Nohur Lake"), pair("mountains", "day", "dusk", 27, "Tufandag"), pair("domes", "day", "night", 28, "Juma Mosque")],
    supplier: "Direct operator", productId: "BKU-GAB-01", confirms: "Within 24 hours",
  },
  {
    slug: "ziyarat-of-madinah", category: "Ziyarat", duration: "4 hours · Scholar guide", level: "Easy", group: "Shared or private",
    description: "Visit the historic sites of Madinah with an Urdu-speaking scholar: Masjid Quba, Masjid Qiblatain, the Seven Mosques, Mount Uhud and the martyrs’ graveyard, with the history of each site explained on the way.",
    itinerary: [["08:00", "Pickup near Masjid an-Nabawi", "15 min", "Air-conditioned coach"], ["08:30", "Masjid Quba", "45 min", "Pray two rakats"], ["09:30", "Masjid Qiblatain", "30 min", ""], ["10:15", "Seven Mosques (Khandaq)", "30 min", ""], ["11:00", "Mount Uhud & martyrs’ graveyard", "45 min", ""], ["12:00", "Drop-off at your hotel", "", ""]],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], times: ["08:00", "16:30"], capacity: 45, min: 1, cutoff: 12, blackout: [],
    options: [["Shared coach", "Urdu-speaking scholar", "person", null, 6500, 4500, 0, 4200, true], ["Private car", "Up to 6 family members", "group", 6, 28000, null, null, 19000, true]],
    inc: ["Transport", "Scholar guide", "Zamzam water"], exc: ["Meals", "Tips"],
    pickup: true, zones: [["Central Area hotels", "07:45–08:00", 0], ["Outside Central Area", "07:30–07:45", 1500]], meeting: "Gate 21, Masjid an-Nabawi", map: "", ends: "Your hotel", guide: "Scholar guide", langs: ["Urdu", "Arabic", "English"],
    notFor: [], bring: ["Prayer mat", "Water bottle"], minAge: null, dress: "Modest clothing, ihram not required",
    cancel: "Free cancellation up to 24 hours before", weather: "New date only",
    photos: [pair("domes", "morning", "gold", 8, "Masjid Quba"), pair("domes", "day", "night", 9, "Uhud"), pair("domes", "morning", "dusk", 10, "Qiblatain")],
    supplier: "Own team", productId: "SKY-ZIY-MED", confirms: "Instantly",
  },
  {
    slug: "attabad-lake-passu-cones", category: "Day trip", duration: "Full day · Private car", level: "Easy", group: "Private only",
    description: "Drive the Karakoram Highway from Karimabad to the turquoise Attabad Lake for a boat ride, cross the swaying Hussaini suspension bridge and stop below the jagged Passu Cathedral peaks before lunch in Passu.",
    itinerary: [["09:00", "Pickup in Karimabad", "", "Toyota Prado or Corolla"], ["09:45", "Attabad Lake", "1 h 30 min", "Boat or jet-ski ride"], ["11:45", "Hussaini suspension bridge", "45 min", ""], ["13:00", "Lunch in Passu", "1 h", "Apricot cake at Glacier Breeze"], ["14:30", "Passu Cones viewpoint", "30 min", ""], ["17:00", "Back in Karimabad", "", ""]],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], times: ["09:00"], capacity: 10, min: 1, cutoff: 24, blackout: [],
    options: [["Corolla (up to 3 guests)", "Private car with driver", "group", 3, 18000, null, null, 13000, true], ["Prado 4x4 (up to 6 guests)", "Private 4x4 with driver", "group", 6, 26000, null, null, 19500, true]],
    inc: ["Private car & driver", "Fuel and tolls"], exc: ["Boat ride (PKR 1,500)", "Lunch"],
    pickup: true, zones: [["Karimabad / Aliabad", "08:45–09:15", 0], ["Gilgit city", "06:30–07:00", 9000]], meeting: "", map: "", ends: "Your hotel", guide: "Driver-guide", langs: ["Urdu", "English"],
    notFor: [], bring: ["Warm jacket", "CNIC or passport for checkposts"], minAge: null, dress: "",
    cancel: "Free cancellation up to 24 hours before", weather: "Full refund or new date",
    photos: [pair("lake", "day", "dusk", 37, "Attabad Lake"), pair("mountains", "day", "gold", 38, "Passu Cones"), pair("mountains", "morning", "dusk", 39, "Hussaini bridge")],
    supplier: "Own team", productId: "SKY-HZ-ATB", confirms: "Instantly",
  },
  {
    slug: "deosai-plains-jeep-safari", category: "Adventure", duration: "Full day · Private jeep", level: "Moderate", group: "Private only",
    description: "Cross the world’s second-highest plateau by jeep to Sheosar Lake, with wildflowers in July, golden marmots everywhere and brown bear country on the way. Open only when the road is clear of snow, usually June to September.",
    itinerary: [["07:00", "Pickup in Skardu", "", "Toyota Land Cruiser jeep"], ["09:00", "Sadpara Lake", "20 min", ""], ["10:30", "Bara Pani", "45 min", "Tea at the camp"], ["12:30", "Sheosar Lake", "1 h 30 min", "Packed lunch by the lake"], ["17:30", "Back in Skardu", "", ""]],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], times: ["07:00"], capacity: 6, min: 1, cutoff: 24, season: ["2027-06-01", "2027-09-30"], blackout: [],
    options: [["Private jeep (up to 5 guests)", "Jeep, driver and packed lunch", "group", 5, 24000, null, null, 17000, true]],
    inc: ["Jeep & driver", "Packed lunch", "Park entry fee"], exc: ["Overnight camping", "Tips"],
    pickup: true, zones: [["Skardu city hotels", "06:45–07:15", 0], ["Shangrila / Kachura", "06:30–06:45", 3000]], meeting: "", map: "", ends: "Your hotel", guide: "Driver-guide", langs: ["Urdu", "Balti", "English"],
    notFor: ["Heart or breathing problems (4,100 m altitude)", "Pregnant women"], bring: ["Warm jacket", "Sun cream", "Altitude tablets"], minAge: 5, dress: "Warm layers",
    cancel: "Free cancellation up to 48 hours before", weather: "Full refund or new date",
    photos: [pair("lake", "morning", "gold", 54, "Sheosar Lake"), pair("mountains", "day", "dusk", 55, "Plains"), pair("lake", "day", "dusk", 56, "Bara Pani")],
    supplier: "Own team", productId: "SKY-SKD-DEO", confirms: "Within 24 hours", status: "seasonal",
  },
  {
    slug: "bali-swing-rice-terraces", category: "Day trip", duration: "8 hours · Hotel pickup", level: "Easy", group: "Shared or private",
    description: "Swing over the jungle at Bali Swing, walk the Tegallalang rice terraces and taste Luwak coffee at a plantation near Ubud.",
    itinerary: [["08:30", "Hotel pickup", "", ""], ["10:00", "Bali Swing", "2 h", ""], ["12:30", "Tegallalang terraces", "1 h", ""]],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], times: ["08:30"], capacity: 30, min: 2, cutoff: 24, blackout: ["Nyepi (Day of Silence)"],
    options: [["Shared tour", "", "person", null, 15500, 11500, 0, 11800, true]],
    inc: ["Hotel pickup", "Swing entry"], exc: [], pickup: true, zones: [], meeting: "", map: "", ends: "", guide: "Driver-guide", langs: ["English"],
    notFor: [], bring: [], minAge: null, dress: "Sarong for temples", cancel: "Free cancellation up to 24 hours before", weather: "Full refund or new date",
    photos: [pair("island", "day", "dusk", 39, "Bali Swing")], supplier: "Klook", productId: "", confirms: "Within 2 hours", status: "draft",
  },
];

/* ---------- writer ---------- */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

async function writeHotel(c: Client, h: HotelSeed, idx: number) {
  const row = await c.query<{ id: string; name: string; rating: number | null; review_count: number | null; image_day_url: string | null }>(
    "SELECT id, name, rating, review_count, image_day_url FROM travel.hotels WHERE slug = $1", [h.slug]);
  const hotel = row.rows[0];
  if (!hotel) return;
  const id = hotel.id;
  const [cl, lo, st, va, co, fa] = h.scores;
  const plans = h.plans;
  // Lowest live rate, same rule as the editor.
  const live = plans.filter((p) => p[6]);
  const rates = (live.length ? live : [["", "", "", "pay_now", "percent", 0, true] as PlanSeed]).flatMap((p) =>
    h.rooms.map((r) => Math.round(p[4] === "percent" ? r[8] * (1 + p[5] / 100) : r[8] + p[5])));
  const priceFrom = Math.min(...rates);
  await c.query(
    `UPDATE travel.hotels SET chain=$2, opened_year=$3, renovated_year=$4, total_rooms=$5, badge=$6, kind=$7, area=$8, city=$9, country=$10, postcode=$11,
       lat=$12, lng=$13, address=COALESCE($14, address), summary=$15, description=COALESCE($16, description), languages=$17, distances=$18, photos=$19,
       image_day_url=$20, image_night_url=$21, voucher_image_url=COALESCE($22, voucher_image_url, $20), weekend_uplift=$23, facilities=$24,
       check_in_time=$25, check_out_time=$26, policies=$27, taxes=$28, phone=$29, email=$30, website=$31, emergency_phone=NULLIF($32,''),
       review_scores=$33, supplier=$34, supplier_hotel_id=NULLIF($35,''), priority=$36, status=$37, in_deals=$38, pay_at_hotel=$39,
       seo_title=$40, seo_description=$41, price_from=$42, star_rating=COALESCE(star_rating, 3), updated_at=now()
     WHERE id=$1`,
    [
      id, h.chain, h.opened, h.renovated, h.total, h.badge, h.type, h.area, h.city, h.country, h.postcode, h.lat, h.lng, h.address ?? null, h.summary,
      h.description ?? null, h.languages, JSON.stringify(h.distances.map(([place, distance]) => ({ place, distance }))), JSON.stringify(h.photos),
      h.photos[0].day, h.photos[0].night ?? h.photos[0].day, h.voucher ?? null, h.uplift, h.facilities, h.checkIn, h.checkOut, JSON.stringify(h.policies),
      JSON.stringify(h.taxes.map(([name, type, amount, currency, per, included]) => ({ name, type, amount, currency, per, included }))),
      h.phone, h.email, h.website, h.emergency, JSON.stringify({ cleanliness: cl, location: lo, staff: st, value: va, comfort: co, facilities: fa }),
      h.supplier, h.supplierId, h.priority, h.status ?? "published", !!h.deals, !!h.payAtHotel,
      `${hotel.name}, ${h.city} | Book with Sky Holidays`.slice(0, 70),
      `Book ${hotel.name} in ${h.area}, ${h.city} with Sky Holidays. ${h.summary} Pay by bank or card.`.slice(0, 160),
      priceFrom,
    ],
  );
  await c.query("DELETE FROM travel.hotel_rooms WHERE hotel_id = $1", [id]);
  await c.query("DELETE FROM travel.hotel_rate_plans WHERE hotel_id = $1", [id]);
  await c.query("DELETE FROM travel.hotel_reviews WHERE hotel_id = $1", [id]);
  const roomIds: { id: string; units: number; base: number }[] = [];
  for (const [i, [name, m2, beds, adults, kids, units, view, amen, base]] of h.rooms.entries()) {
    const extra = h.type === "Hotel" && h.country !== "Pakistan" ? "Available, PKR 9,000 / night" : "Free for children under 6";
    const r = await c.query<{ id: string }>(
      `INSERT INTO travel.hotel_rooms (hotel_id, name, size_m2, beds, max_adults, max_children, units, view, smoking, extra_bed, amenities, photos, base_price, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Non-smoking',$9,$10,$11,$12,$13) RETURNING id`,
      [id, name, m2, beds, adults, kids, units, view, extra, [...new Set(["Air conditioning", "Flat-screen TV", "Kettle", "Safe", ...amen])], [h.photos[Math.min(i, h.photos.length - 1)].day], base, i],
    );
    roomIds.push({ id: r.rows[0].id, units, base });
  }
  for (const [i, [name, meal, cancel, payment, type, value, isLive]] of plans.entries()) {
    await c.query(
      `INSERT INTO travel.hotel_rate_plans (hotel_id, room_id, name, meal_plan, cancellation, payment, adjust_type, adjust_value, is_live, position)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, meal, cancel, payment, type, value, isLive, i],
    );
  }
  // 30 nights from today: rooms left vary, the top room sells out some nights, a couple of stop-sell nights.
  for (const [ri, rm] of roomIds.entries()) {
    for (let d = 0; d < 30; d++) {
      const night = addDays(START, d);
      const cap = Math.min(rm.units, 15);
      const left = Math.max(0, cap - ((ri * 3 + d * 7 + idx * 5) % 11) - (ri === roomIds.length - 1 && roomIds.length > 1 ? 2 : 0));
      const stop = ri === 2 && (d === 9 || d === 10);
      const special = d >= 20 && d <= 23 && ri === 0 ? Math.round((rm.base * 1.1) / 500) * 500 : null; // a local event
      await c.query(
        `INSERT INTO travel.hotel_availability (room_id, night, price, rooms_left, stop_sell) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (room_id, night) DO UPDATE SET price = EXCLUDED.price, rooms_left = EXCLUDED.rooms_left, stop_sell = EXCLUDED.stop_sell`,
        [rm.id, night, special, left, stop],
      );
    }
  }
  for (const [i, [title, body]] of h.reviews.entries()) {
    const score = Math.max(6, Math.min(10, Math.round(((hotel.rating ?? 8.5) + ((i % 3) - 1) * 0.4) * 10) / 10));
    await c.query(
      `INSERT INTO travel.hotel_reviews (hotel_id, guest_name, guest_city, score, title, body, stayed_on, is_published, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true, now() - make_interval(days => $8))`,
      [id, NAMES[(idx * 3 + i) % NAMES.length], CITIES[(idx + i) % CITIES.length], score, title, body, addDays(START, -20 - i * 17), 10 + i * 17],
    );
  }
}

async function writeExcursion(c: Client, e: ExcSeed) {
  const row = await c.query<{ id: string; title: string; location_label: string | null }>("SELECT id, title, location_label FROM travel.excursions WHERE slug = $1", [e.slug]);
  const x = row.rows[0];
  if (!x) return;
  const live = e.options.filter((o) => o[8] && o[4] > 0);
  const price = live.length ? Math.min(...live.map((o) => o[4])) : null;
  await c.query(
    `UPDATE travel.excursions SET category=$2, duration_label=$3, raw = COALESCE(raw,'{}'::jsonb) || jsonb_build_object('duration_label', $3::text),
       activity_level=$4, group_type=$5, description=$6, itinerary=$7, days_of_week=$8, start_times=$9, capacity=$10, min_guests=$11, cutoff_hours=$12,
       season_from=$13, season_to=$14, blackout_dates=$15, group_discount_pct=$16, group_discount_min=$17, peak_uplift_pct=$18, peak_from=$19, peak_to=$20,
       inclusions=$21, exclusions=$22, pickup_offered=$23, pickup_zones=$24, meeting_point=NULLIF($25,''), meeting_map_url=NULLIF($26,''), ends_at=NULLIF($27,''),
       guide_type=$28, languages=$29, not_suitable=$30, what_to_bring=$31, min_age=$32, dress_code=NULLIF($33,''), cancellation_policy=$34, weather_policy=$35,
       photos=$36, image_day_url=$37, image_night_url=$38, status=$39, supplier=$40, supplier_product_id=NULLIF($41,''), supplier_confirms=$42,
       seo_title=$43, seo_description=$44, price_from=COALESCE($45, price_from), updated_at=now()
     WHERE id=$1`,
    [
      x.id, e.category, e.duration, e.level, e.group, e.description,
      JSON.stringify(e.itinerary.map(([time, title, duration, description]) => ({ time: time === "—" ? "" : time, title, duration, description }))),
      e.days, e.times, e.capacity, e.min, e.cutoff, e.season?.[0] ?? null, e.season?.[1] ?? null, e.blackout,
      e.discount?.[0] ?? null, e.discount?.[1] ?? null, e.peak?.[0] ?? null, e.peak?.[1] ?? null, e.peak?.[2] ?? null,
      e.inc, e.exc, e.pickup, JSON.stringify(e.zones.map(([zone, window, fee]) => ({ zone, window, fee }))), e.meeting, e.map, e.ends,
      e.guide, e.langs, e.notFor, e.bring, e.minAge, e.dress, e.cancel, e.weather,
      JSON.stringify(e.photos), e.photos[0].day, e.photos[0].night ?? e.photos[0].day, e.status ?? "published", e.supplier, e.productId, e.confirms,
      e.status === "draft" ? "" : `${x.title} | Sky Holidays`.slice(0, 70),
      `${x.title}${x.location_label ? ` in ${x.location_label}` : ""}: ${e.description}`.slice(0, 157).replace(/\s+\S*$/, "…"),
      price,
    ],
  );
  await c.query("DELETE FROM travel.excursion_options WHERE excursion_id = $1", [x.id]);
  for (const [i, [name, note, basis, maxGroup, adult, child, infant, cost, isLive]] of e.options.entries()) {
    await c.query(
      `INSERT INTO travel.excursion_options (excursion_id, name, note, price_basis, max_group, adult_price, child_price, infant_price, supplier_cost, is_live, position)
       VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11)`,
      [x.id, name, note, basis, maxGroup, adult, child, infant, cost, isLive, i],
    );
  }
}

export async function run(c: Client) {
  // The client's own hotel. Another seeder may have added a minimal row; fill it in either way.
  const dubai = (await c.query<{ id: string }>("SELECT id FROM travel.destinations WHERE slug = 'dubai'")).rows[0]?.id ?? null;
  await c.query(
    `INSERT INTO travel.hotels (source, slug, destination_id, name, kind, star_rating, address, description, amenities, rating, review_count,
       price_from, phone, email, check_in_time, check_out_time, voucher_image_url, status, is_featured, image_day_url, image_night_url)
     VALUES ('manual', 'ibis-dubai-al-rigga', $1, 'Ibis Dubai Al Rigga', 'Hotel', 2, $2, $3, $4, 8.1, 3120, 14500, '+971 4 206 8100', 'h6685@accor.com',
       '14:00', '12:00', '/brand/docs/sample-ibis-room.jpg', 'published', false, '/brand/docs/sample-ibis-room.jpg', '/brand/dubai-night.jpg')
     ON CONFLICT (slug) DO UPDATE SET destination_id = COALESCE(travel.hotels.destination_id, EXCLUDED.destination_id), name = EXCLUDED.name,
       kind = EXCLUDED.kind, star_rating = EXCLUDED.star_rating, address = EXCLUDED.address, description = EXCLUDED.description,
       amenities = EXCLUDED.amenities, rating = COALESCE(travel.hotels.rating, EXCLUDED.rating), review_count = COALESCE(travel.hotels.review_count, EXCLUDED.review_count),
       phone = EXCLUDED.phone, email = EXCLUDED.email, check_in_time = EXCLUDED.check_in_time, check_out_time = EXCLUDED.check_out_time,
       voucher_image_url = EXCLUDED.voucher_image_url, status = EXCLUDED.status, updated_at = now()`,
    [dubai, IBIS.address, IBIS_DESC, ["Near Al Rigga Metro", "Free Wi-Fi", "Value for money"]],
  );
  for (const [i, h] of [IBIS, ...HOTELS].entries()) await writeHotel(c, h, i);
  for (const e of EXCURSIONS) await writeExcursion(c, e);
}
