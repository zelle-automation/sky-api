// Demo bookings, payments (incl. slips to verify and refunds), travellers, history and
// enquiries matching the approved preview. Safe to re-run: it replaces its own rows.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const H = 60,
  D = 1440;
const FREE3 = "Free cancellation until 3 days before arrival. After that the first night is charged.";
const FREE24 = "Free cancellation until 24 hours before the start time. No refund after that.";
const PKG = "25% deposit is non-refundable within 30 days of departure. Full charge within 7 days.";

const BOOKINGS = [
  {
    ref: "SKY-26-04821",
    guest: "Ayesha Khan",
    phone: "+92 300 2214 785",
    email: "ayesha.k@example.com",
    type: "package",
    slug: "economy-umrah-15-nights",
    name: "Economy Umrah, 15 Nights",
    start: "2026-11-14",
    end: "2026-11-29",
    adults: 4,
    total: 1396000,
    status: "pending",
    channel: "website",
    agoMin: 12,
    method: "bank",
    cnic: "42101-5532190-3",
    pays: [{ method: "bank", provider: "Meezan Bank", amount: 349000, ref: "MZN-22071801", ago: 10 }],
    trav: [
      ["Ayesha Khan", "adult", "AB1234567", "Mrs"],
      ["Imran Khan", "adult", "AB7654321", "Mr"],
      ["Shazia Khan", "adult", "AC1029384", "Mrs"],
      ["Rafiq Khan", "adult", null, "Mr"],
    ],
    snap: {
      room_sharing: "Quad",
      flights: "KHI → JED, MED → KHI",
      group_leader: "Maulana Faheem",
      makkah_hotel: "Swissôtel Makkah",
      madinah_hotel: "Pullman ZamZam Madinah",
    },
    requests: "Wheelchair at Haram",
    notes: "Mother needs wheelchair. Asked Swissôtel for a Haram-view room.",
    cancel: PKG,
    supplierCost: 1180000,
    supplier: "Al Haram Ground Services",
  },
  {
    ref: "SKY-26-04820",
    guest: "Hamza Siddiqui",
    phone: "+92 321 7781 002",
    email: "hamza.s@example.com",
    type: "hotel",
    slug: "atlantis-the-palm",
    name: "Atlantis The Palm",
    start: "2026-10-22",
    end: "2026-10-26",
    adults: 2,
    children: 1,
    total: 338000,
    status: "confirmed",
    channel: "website",
    agoMin: 40,
    method: "card",
    cnic: "35202-4410876-1",
    pays: [{ method: "card", provider: "Visa •• 4417", amount: 338000, ref: "TXN-04820-01", ago: 39 }],
    trav: [
      ["Hamza Siddiqui", "adult", "BA4471902", "Mr"],
      ["Mehwish Siddiqui", "adult", "BA4471903", "Mrs"],
      ["Zayan Siddiqui", "child", "BC5510933"],
    ],
    snap: { room_type: "Deluxe King, Palm view", meal_plan: "Bed & breakfast", rooms: 1 },
    supplierRef: "ATL-77120",
    supplierCost: 291000,
    supplier: "Atlantis reservations",
    requests: "High floor, late arrival",
    cancel: FREE3,
  },
  {
    ref: "SKY-26-04819",
    guest: "Fatima Rizvi",
    phone: "+92 333 4410 991",
    email: "fatima.r@example.com",
    type: "excursion",
    slug: "dubai-desert-safari-bbq",
    name: "Desert Safari with BBQ Dinner",
    start: "2026-10-23",
    end: "2026-10-23",
    adults: 2,
    children: 1,
    total: 26500,
    status: "confirmed",
    channel: "whatsapp",
    agoMin: 60,
    method: "wallet",
    cnic: "42201-7781230-4",
    pays: [{ method: "wallet", provider: "JazzCash", amount: 26500, ref: "JC-88120451", ago: 55 }],
    trav: [
      ["Fatima Rizvi", "adult", "CA1188230", "Ms"],
      ["Ali Rizvi", "adult", "CA1188231", "Mr"],
      ["Hania Rizvi", "child", "CC1188232"],
    ],
    snap: { option: "Shared 4x4", time_slot: "15:00", pickup: "Hotel lobby, Downtown" },
    supplierRef: "DS-55821",
    supplierCost: 21000,
    supplier: "Arabian Desert Tours",
    cancel: FREE24,
  },
  {
    ref: "SKY-26-04818",
    guest: "Bilal Ahmed",
    phone: "+92 345 9012 334",
    email: "bilal.a@example.com",
    type: "hotel",
    slug: "swissotel-makkah",
    name: "Swissôtel Makkah",
    start: "2026-11-15",
    end: "2026-11-23",
    adults: 2,
    total: 488000,
    status: "pending",
    channel: "website",
    agoMin: 2 * H,
    method: "bank",
    cnic: "61101-2290871-5",
    pays: [
      { method: "bank", provider: "HBL → Meezan", amount: 488000, status: "pending", ref: "22071934", slip: true, ago: 100 },
    ],
    trav: [
      ["Bilal Ahmed", "adult", "DA9012334", "Mr"],
      ["Sara Bilal", "adult", "DA9012335", "Mrs"],
    ],
    snap: { room_type: "Superior Room, Haram view", meal_plan: "Room Only", rooms: 1 },
    cancel: FREE3,
    supplierCost: 430000,
  },
  {
    ref: "SKY-26-04817",
    guest: "Sana Javed",
    phone: "+92 302 5566 120",
    email: "sana.j@example.com",
    type: "package",
    slug: "northern-areas-grand-tour",
    name: "Northern Areas Grand Tour",
    start: "2026-10-18",
    end: "2026-10-26",
    adults: 2,
    children: 2,
    total: 572000,
    status: "supplier",
    channel: "agent",
    agoMin: 3 * H,
    method: "wallet",
    cnic: "37405-5566120-2",
    pays: [{ method: "wallet", provider: "Easypaisa", amount: 572000, ref: "EP-55102991", ago: 170 }],
    trav: [
      ["Sana Javed", "adult", null, "Mrs"],
      ["Omer Javed", "adult", null, "Mr"],
      ["Aliza Javed", "child", null],
      ["Rayyan Javed", "child", null],
    ],
    snap: { room_sharing: "Family room", transport: "Prado 4x4 with driver", route: "Islamabad → Hunza → Skardu → Islamabad" },
    supplierCost: 468000,
    supplier: "Karakoram Ground Ops",
    requests: "Need a 4x4 for Deosai",
    cancel: PKG,
  },
  {
    ref: "SKY-26-04816",
    guest: "Usman Tariq",
    phone: "+92 311 8823 451",
    email: "usman.t@example.com",
    type: "excursion",
    slug: "burj-khalifa-at-the-top",
    name: "Burj Khalifa At the Top",
    start: "2026-10-12",
    end: "2026-10-14",
    adults: 3,
    total: 43500,
    status: "travelling",
    channel: "website",
    agoMin: D + 2 * H,
    method: "card",
    cnic: "35201-8823451-7",
    pays: [{ method: "card", provider: "Mastercard •• 2290", amount: 43500, ref: "TXN-04816-01", ago: D + 2 * H - 5 }],
    trav: [
      ["Usman Tariq", "adult", "EA8823451", "Mr"],
      ["Hassan Tariq", "adult", "EA8823452", "Mr"],
      ["Bilal Tariq", "adult", "EA8823453", "Mr"],
    ],
    snap: { option: "Level 124 + 125, prime time", time_slot: "17:30" },
    supplierRef: "BK-302114",
    supplierCost: 37000,
    cancel: FREE24,
  },
  {
    ref: "SKY-26-04815",
    guest: "Mariam Qureshi",
    phone: "+92 300 1100 765",
    email: "mariam.q@example.com",
    type: "package",
    slug: "bali-island-escape",
    name: "Bali Island Escape",
    start: "2026-12-02",
    end: "2026-12-07",
    adults: 2,
    total: 478000,
    status: "confirmed",
    channel: "walk-in",
    agoMin: D + 5 * H,
    method: "bank",
    cnic: "42301-1100765-8",
    pays: [{ method: "bank", provider: "Meezan Bank", amount: 119500, ref: "MZN-22070533", ago: D + 4 * H }],
    trav: [
      ["Mariam Qureshi", "adult", "FA1100765", "Mrs"],
      ["Danish Qureshi", "adult", "FA1100766", "Mr"],
    ],
    snap: { room_sharing: "Double", flights: "KHI → DPS via KUL", hotel: "Ubud jungle villa + Seminyak beach" },
    supplierCost: 401000,
    cancel: PKG,
  },
  {
    ref: "SKY-26-04814",
    guest: "Ali Haider",
    phone: "+92 322 6640 218",
    email: "ali.h@example.com",
    type: "hotel",
    slug: "pera-palace-hotel",
    name: "Pera Palace Hotel",
    start: "2026-10-30",
    end: "2026-11-03",
    adults: 2,
    total: 208000,
    status: "confirmed",
    channel: "website",
    agoMin: 2 * D,
    method: "card",
    cnic: "35202-6640218-9",
    pays: [{ method: "card", provider: "Visa •• 8812", amount: 208000, ref: "TXN-04814-01", ago: 2 * D - 3 }],
    trav: [
      ["Ali Haider", "adult", "GA6640218", "Mr"],
      ["Amna Haider", "adult", "GA6640219", "Mrs"],
    ],
    snap: { room_type: "Deluxe Room, Golden Horn view", meal_plan: "Bed & breakfast", rooms: 1 },
    supplierRef: "88231-PP",
    supplierCost: 179000,
    cancel: FREE3,
  },
  {
    ref: "SKY-26-04813",
    guest: "Hira Malik",
    phone: "+92 301 7780 432",
    email: "hira.m@example.com",
    type: "hotel",
    slug: "shangrila-resort-skardu",
    name: "Shangrila Resort",
    start: "2026-10-10",
    end: "2026-10-12",
    adults: 2,
    total: 76000,
    status: "completed",
    channel: "website",
    agoMin: 6 * D,
    method: "wallet",
    cnic: "17301-7780432-6",
    pays: [{ method: "wallet", provider: "Easypaisa", amount: 76000, ref: "EP-55093320", ago: 6 * D - 10 }],
    trav: [
      ["Hira Malik", "adult", null, "Ms"],
      ["Saba Malik", "adult", null, "Ms"],
    ],
    snap: { room_type: "Lake-view Chalet", meal_plan: "Half board", rooms: 1 },
    supplierRef: "SR-4410",
    supplierCost: 64000,
    cancel: FREE3,
  },
  {
    ref: "SKY-26-04812",
    guest: "Kamran Shah",
    phone: "+92 334 2290 871",
    email: "kamran.s@example.com",
    type: "package",
    slug: "baku-city-break",
    name: "Baku City Break",
    start: "2026-11-08",
    end: "2026-11-11",
    adults: 2,
    total: 318000,
    status: "refund",
    channel: "website",
    agoMin: 6 * D + 3 * H,
    method: "card",
    cnic: "42101-2290871-1",
    pays: [
      { method: "card", provider: "Mastercard •• 0921", amount: 318000, ref: "TXN-04812-01", ago: 6 * D + 3 * H - 4 },
      {
        kind: "refund",
        method: "card",
        provider: "Mastercard •• 0921",
        amount: 318000,
        status: "pending",
        ref: "TXN-04812-02",
        ago: 2 * D,
      },
    ],
    trav: [
      ["Kamran Shah", "adult", "HA2290871", "Mr"],
      ["Nida Kamran", "adult", "HA2290872", "Mrs"],
    ],
    snap: { room_sharing: "Double", flights: "KHI → GYD direct" },
    supplierCost: 268000,
    cancel: PKG,
    reason: "Guest's visa appointment moved; asked for a full refund",
  },
  {
    ref: "SKY-26-04811",
    guest: "Zainab Hussain",
    phone: "+92 300 4419 006",
    email: "zainab.h@example.com",
    type: "excursion",
    slug: "ziyarat-of-madinah",
    name: "Ziyarat of Madinah",
    start: "2026-11-20",
    end: "2026-11-20",
    adults: 5,
    total: 22500,
    status: "pending",
    channel: "whatsapp",
    agoMin: 7 * D,
    method: "bank",
    cnic: "42401-4419006-2",
    pays: [{ method: "bank", provider: "UBL → HBL", amount: 22500, status: "pending", ref: "40018822", slip: true, ago: 30 }],
    trav: [["Zainab Hussain", "adult", null, "Mrs"]],
    snap: { option: "Private car with guide", time_slot: "08:00", pickup: "Hotel lobby, Madinah" },
    cancel: FREE24,
  },
  {
    ref: "SKY-26-04810",
    guest: "Omar Farooq",
    phone: "+92 315 3378 554",
    email: "omar.f@example.com",
    type: "hotel",
    slug: "address-downtown",
    name: "Address Downtown",
    start: "2026-10-01",
    end: "2026-10-04",
    adults: 2,
    total: 213000,
    status: "cancelled",
    channel: "website",
    agoMin: 21 * D,
    method: "card",
    cnic: "35202-3378554-3",
    pays: [
      { method: "card", provider: "Visa •• 1180", amount: 213000, ref: "TXN-04810-01", ago: 21 * D - 2 },
      { kind: "refund", method: "card", provider: "Visa •• 1180", amount: 213000, ref: "TXN-04810-02", ago: 18 * D },
    ],
    trav: [
      ["Omar Farooq", "adult", "JA3378554", "Mr"],
      ["Hina Omar", "adult", "JA3378555", "Mrs"],
    ],
    snap: { room_type: "Deluxe Room, Burj view", meal_plan: "Room Only", rooms: 1 },
    cancel: FREE3,
    reason: "Cancelled within free cancellation window",
  },
  {
    ref: "SKY-26-04809",
    guest: "Nida Shah",
    phone: "+92 333 9081 447",
    email: "nida.s@example.com",
    type: "excursion",
    slug: "attabad-lake-passu-cones",
    name: "Attabad Lake & Passu Cones",
    start: "2026-11-02",
    end: "2026-11-02",
    adults: 2,
    total: 24000,
    status: "pending",
    channel: "website",
    agoMin: 8 * D,
    method: "wallet",
    cnic: "71501-9081447-4",
    pays: [{ method: "wallet", provider: "JazzCash", amount: 18500, status: "failed", ref: "JC-88090121", ago: 8 * D - 5 }],
    trav: [
      ["Nida Shah", "adult", null, "Ms"],
      ["Areeba Shah", "adult", null, "Ms"],
    ],
    snap: { option: "Private jeep", time_slot: "09:00", pickup: "Karimabad" },
    cancel: FREE24,
  },
  // The client's real voucher booking.
  {
    ref: "SKY-26-04790",
    guest: "Saad Nadeem",
    phone: "+92 300 5120 448",
    email: "saad.n@example.com",
    type: "hotel",
    slug: "ibis-dubai-al-rigga",
    name: "Ibis Dubai Al Rigga",
    start: "2026-09-13",
    end: "2026-09-25",
    adults: 3,
    children: 1,
    total: 412000,
    status: "completed",
    channel: "website",
    agoMin: 28 * D,
    method: "bank",
    cnic: "42101-5120448-5",
    pays: [{ method: "bank", provider: "Meezan Bank", amount: 412000, ref: "MZN-21990417", ago: 28 * D - 60 }],
    trav: [
      ["Saad Nadeem", "adult", "KA5120448", "Mr"],
      ["Rabia Saad", "adult", "KA5120449", "Mrs"],
      ["Nadeem Akhtar", "adult", "KA5120450", "Mr"],
      ["Ibrahim Saad", "child", "KC5120451"],
    ],
    snap: { room_type: "Standard Room", meal_plan: "Room Only", rooms: 1 },
    supplierRef: "6685AIC05944433",
    supplierCost: 352000,
    supplier: "Accor",
    cancel: FREE3,
  },
];

const ENQ = [
  {
    name: "Rehan Akhtar",
    svc: "umrah",
    msg: "Family of 6 for Umrah in December, need wheelchair support for my mother and a Haram-facing room.",
    ago: 8,
    ch: "website",
    stage: "new",
    phone: "+92 300 8812 004",
    email: "rehan.a@example.com",
    trav: 6,
    date: "2026-12-10",
    budget: 1800000,
  },
  {
    name: "Nadia Pervez",
    svc: "visa",
    msg: "Need a Schengen-free option for honeymoon, thinking Baku or Türkiye. Which visa is faster?",
    ago: 25,
    ch: "whatsapp",
    stage: "new",
    phone: "+92 321 6600 912",
    trav: 2,
  },
  {
    name: "Tahir Mehmood",
    svc: "hotels",
    msg: "Corporate rate for 12 rooms in Dubai for GITEX week.",
    ago: 5 * H,
    ch: "email",
    stage: "new",
    phone: "+92 333 1009 556",
    email: "tahir.m@example.com",
    trav: 12,
  },
  {
    name: "Saima Butt",
    svc: "packages",
    msg: "Northern Areas tour for a school group of 30 students in April.",
    ago: 3 * H,
    ch: "website",
    stage: "contacted",
    phone: "+92 345 7710 220",
    email: "saima.b@example.com",
    trav: 30,
    date: "2027-04-12",
  },
  {
    name: "Farhan Ali",
    svc: "excursions",
    msg: "Private desert safari for 8 people with vegetarian BBQ.",
    ago: 5 * H,
    ch: "whatsapp",
    stage: "contacted",
    phone: "+92 302 4451 118",
    trav: 8,
  },
  {
    name: "Asma Nadeem",
    svc: "umrah",
    msg: "Premium Umrah for 2 in Ramadan, last ashra.",
    ago: D + 2 * H,
    ch: "phone",
    stage: "quoted",
    phone: "+92 300 2203 667",
    quote: 1240000,
    trav: 2,
  },
  {
    name: "Junaid Iqbal",
    svc: "packages",
    msg: "Maldives overwater villa, 4 nights in February.",
    ago: D + 6 * H,
    ch: "website",
    stage: "quoted",
    phone: "+92 311 5532 901",
    email: "junaid.i@example.com",
    quote: 1058000,
    trav: 2,
    date: "2027-02-14",
  },
  {
    name: "Ayesha Khan",
    svc: "umrah",
    msg: "Economy Umrah for 4 on the 14 Nov departure.",
    ago: 2 * D,
    ch: "website",
    stage: "converted",
    phone: "+92 300 2214 785",
    email: "ayesha.k@example.com",
    ref: "SKY-26-04821",
    trav: 4,
    date: "2026-11-14",
  },
  {
    name: "Sana Javed",
    svc: "packages",
    msg: "Northern Areas with kids, need a 4x4 for Deosai.",
    ago: 3 * D,
    ch: "agent",
    stage: "converted",
    phone: "+92 302 5566 120",
    email: "sana.j@example.com",
    ref: "SKY-26-04817",
    trav: 4,
    date: "2026-10-18",
  },
  {
    name: "Waqas Raza",
    svc: "cars",
    msg: "Car with driver in Islamabad for 3 days.",
    ago: 4 * D,
    ch: "website",
    stage: "closed",
    phone: "+92 334 8890 113",
    reason: "Booked elsewhere",
    trav: 2,
  },
];

function slipSvg(ref, from, amount, tid) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="620" viewBox="0 0 420 620"><rect width="420" height="620" fill="#f6f7f9"/>
<rect x="20" y="20" width="380" height="580" rx="18" fill="#fff" stroke="#dde1e7"/><rect x="20" y="20" width="380" height="90" rx="18" fill="#0F6B4F"/>
<text x="210" y="62" text-anchor="middle" font-family="Arial" font-size="20" font-weight="700" fill="#fff">Transfer successful</text>
<text x="210" y="90" text-anchor="middle" font-family="Arial" font-size="13" fill="#d8f0e6">${from}</text>
<text x="210" y="170" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#111">PKR ${amount.toLocaleString("en-US")}</text>
${[
  ["To", "Sky Holidays (Pvt) Ltd"],
  ["Account", "PK36 MEZN 0001 2345 6789 0123"],
  ["Reference", ref],
  ["Transaction ID", tid],
  ["Date", new Date().toLocaleDateString("en-GB")],
]
  .map(
    ([k, v], i) =>
      `<text x="44" y="${240 + i * 56}" font-family="Arial" font-size="12" fill="#6b7280">${k}</text><text x="44" y="${262 + i * 56}" font-family="Arial" font-size="15" font-weight="700" fill="#111">${v}</text>`,
  )
  .join("")}
<text x="210" y="575" text-anchor="middle" font-family="Arial" font-size="11" fill="#9ca3af">Sample slip for the demo</text></svg>`;
}

/** The sample dates were written for 13 Oct 2026; move them so they stay relative to today. */
const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
const SHIFT = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(2026, 9, 13)) / 864e5);
const shift = (d) => (SHIFT ? new Date(Date.parse(d + "T00:00:00Z") + SHIFT * 864e5).toISOString().slice(0, 10) : d);

export async function run(c) {
  const owner = (await c.query("SELECT id FROM travel.admin_users ORDER BY created_at LIMIT 1")).rows[0]?.id ?? null;
  const staff = async (pattern) =>
    (await c.query("SELECT id FROM travel.admin_users WHERE name ILIKE $1 AND is_active LIMIT 1", [pattern])).rows[0]?.id ??
    owner;
  const imran = await staff("Imran%");
  const hina = await staff("Hina%");

  // The voucher hotel; the catalogue demo normally adds it.
  await c.query(`INSERT INTO travel.hotels (source, slug, name, destination_id, kind, star_rating, address, phone, email, rating, review_count, price_from, description)
    VALUES ('manual', 'ibis-dubai-al-rigga', 'Ibis Dubai Al Rigga', (SELECT id FROM travel.destinations WHERE slug = 'dubai'), 'Hotel', 2,
      'Al Rigga Rd - Al Muraqqabat, Deira - Dubai - United Arab Emirates', '+971 4 206 8100', 'h6685@accor.com', 8.1, 3120, 14500,
      'Ibis Dubai Al Rigga hotel is a great choice for both business and leisure travelers.')
    ON CONFLICT (slug) DO NOTHING`);

  const refs = BOOKINGS.map((b) => b.ref);
  await c.query("DELETE FROM travel.enquiries WHERE (name, phone) IN (SELECT * FROM unnest($1::text[], $2::text[]))", [
    ENQ.map((e) => e.name),
    ENQ.map((e) => e.phone),
  ]);
  await c.query("DELETE FROM travel.bookings WHERE ref = ANY($1)", [refs]);

  const slipDir = path.resolve(process.env.UPLOAD_DIR || "uploads", "demo");
  mkdirSync(slipDir, { recursive: true });

  for (const b of BOOKINGS) {
    const table = b.type === "hotel" ? "hotels" : b.type === "excursion" ? "excursions" : "packages";
    const pid = (await c.query(`SELECT id FROM travel.${table} WHERE slug = $1`, [b.slug])).rows[0]?.id ?? null;
    const created = new Date(Date.now() - b.agoMin * 60000);
    const fixed = b.ref === "SKY-26-04790"; // the client's real voucher keeps its real dates
    const base = Math.round(b.total / 1.13),
      tax = Math.round(base * 0.08),
      fee = b.total - base - tax;
    const staffMade = ["walk-in", "agent", "whatsapp", "phone"].includes(b.channel);
    const assigned = b.type === "package" && b.slug.includes("umrah") ? imran : b.type === "hotel" ? hina : owner;
    const row = (
      await c.query(
        `INSERT INTO travel.bookings (ref, product_type, product_id, product_name, product_snapshot, status, start_date, end_date, adults, children,
        lead_name, lead_email, lead_phone, lead_cnic, lead_nationality, base_amount, tax_amount, fee_amount, total_amount, supplier_cost, supplier_name, supplier_ref,
        payment_method, channel, assigned_to, special_requests, internal_notes, cancellation_policy, cancelled_at, cancel_reason, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PK',$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$31) RETURNING id`,
        [
          b.ref,
          b.type,
          pid,
          b.name,
          JSON.stringify(b.snap),
          b.status,
          fixed ? b.start : shift(b.start),
          fixed ? b.end : shift(b.end),
          b.adults,
          b.children ?? 0,
          b.guest,
          b.email,
          b.phone,
          b.cnic,
          base,
          tax,
          fee,
          b.total,
          b.supplierCost ?? null,
          b.supplier ?? null,
          b.supplierRef ?? null,
          b.method,
          b.channel,
          assigned,
          b.requests ?? null,
          b.notes ?? null,
          b.cancel ?? null,
          b.reason ? new Date(Date.now() - 2 * D * 60000) : null,
          b.reason ?? null,
          staffMade ? owner : null,
          created,
        ],
      )
    ).rows[0];

    for (const [i, [name, kind = "adult", passport, title]] of b.trav.entries()) {
      await c.query(
        `INSERT INTO travel.booking_travellers (booking_id, position, title, full_name, kind, nationality, passport_no, passport_expiry, passport_status)
        VALUES ($1,$2,$3,$4,$5,'PK',$6,$7,$8)`,
        [
          row.id,
          i,
          title ?? null,
          name,
          kind,
          passport ?? null,
          passport ? "2030-06-30" : null,
          passport ? (b.status === "pending" ? "received" : "verified") : "missing",
        ],
      );
    }

    const ev = [
      ["created", `Booking created via ${b.channel === "website" ? "website" : b.channel}`, b.agoMin, staffMade ? owner : null],
    ];
    for (const p of b.pays) {
      const at = new Date(Date.now() - (p.ago ?? b.agoMin) * 60000);
      let slip = null;
      if (p.slip) {
        const file = `slip-${b.ref.toLowerCase()}.svg`;
        writeFileSync(path.join(slipDir, file), slipSvg(b.ref, p.provider ?? "Bank transfer", p.amount, p.ref ?? ""));
        slip = `/uploads/demo/${file}`;
      }
      const status = p.status ?? "verified";
      await c.query(
        `INSERT INTO travel.booking_payments (booking_id, kind, method, provider, amount, status, reference, slip_url, received_at, verified_by, verified_at, paid_at, created_by, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$9)`,
        [
          row.id,
          p.kind ?? "payment",
          p.method,
          p.provider ?? null,
          p.amount,
          status,
          p.ref ?? null,
          slip,
          at,
          status === "verified" ? owner : null,
          status === "verified" ? at : null,
          p.kind === "refund" && status === "verified" ? at : null,
          p.kind === "refund" ? owner : null,
        ],
      );
      const label =
        p.kind === "refund"
          ? status === "verified"
            ? "Refund paid"
            : "Refund due"
          : status === "pending"
            ? "Payment slip uploaded"
            : status === "failed"
              ? "Payment failed"
              : "Payment received";
      ev.push([
        "payment",
        `${label}: PKR ${p.amount.toLocaleString("en-US")} (${p.provider ?? p.method})`,
        p.ago ?? b.agoMin,
        p.kind === "refund" ? owner : null,
      ]);
    }
    const st = { supplier: "Awaiting supplier", confirmed: "Confirmed", travelling: "Travelling", completed: "Completed" };
    if (["confirmed", "travelling", "completed"].includes(b.status))
      ev.push([
        "status",
        `Status changed to Confirmed${b.supplierRef ? ` · supplier conf. ${b.supplierRef}` : ""}`,
        b.agoMin - 20,
        owner,
      ]);
    if (b.status === "supplier") ev.push(["status", "Status changed to Awaiting supplier", b.agoMin - 10, owner]);
    if (["confirmed", "travelling", "completed"].includes(b.status))
      ev.push(["email", `Voucher emailed to ${b.email}`, b.agoMin - 25, owner]);
    if (b.status === "travelling" || b.status === "completed")
      ev.push(["status", `Status changed to ${st[b.status]}`, b.status === "travelling" ? 20 * H : 2 * D, owner]);
    if (b.reason) ev.push(["status", `Cancelled: ${b.reason}`, 2 * D + 5, owner]);
    for (const [kind, msg, ago, uid] of ev) {
      await c.query(
        "INSERT INTO travel.booking_events (booking_id, kind, message, user_id, created_at) VALUES ($1,$2,$3,$4,$5)",
        [row.id, kind, msg, uid, new Date(Date.now() - Math.max(ago, 1) * 60000)],
      );
    }
  }

  // Paid amount and payment status from the ledger (same rule as the API).
  await c.query(
    `UPDATE travel.bookings b SET paid_amount = greatest(s.net, 0),
      payment_status = CASE WHEN s.refunded > 0 AND s.net <= 0 THEN 'refunded' WHEN s.pending > 0 THEN 'verify' WHEN s.net >= b.total_amount AND b.total_amount > 0 THEN 'paid' WHEN s.net > 0 THEN 'deposit' ELSE 'unpaid' END
    FROM (SELECT b2.id,
        coalesce(sum(p.amount) FILTER (WHERE p.kind='payment' AND p.status='verified'),0) - coalesce(sum(p.amount) FILTER (WHERE p.kind='refund' AND p.status='verified'),0) AS net,
        coalesce(sum(p.amount) FILTER (WHERE p.kind='refund' AND p.status='verified'),0) AS refunded,
        count(p.id) FILTER (WHERE p.kind='payment' AND p.status='pending') AS pending
      FROM travel.bookings b2 LEFT JOIN travel.booking_payments p ON p.booking_id = b2.id WHERE b2.ref = ANY($1) GROUP BY b2.id) s
    WHERE s.id = b.id`,
    [refs],
  );
  await c.query("SELECT setval('travel.booking_ref_seq', greatest((SELECT last_value FROM travel.booking_ref_seq), 4821))");

  for (const e of ENQ) {
    const created = new Date(Date.now() - e.ago * 60000);
    const bookingId = e.ref
      ? ((await c.query("SELECT id FROM travel.bookings WHERE ref = $1", [e.ref])).rows[0]?.id ?? null)
      : null;
    const assigned = e.svc === "umrah" ? imran : e.svc === "hotels" ? hina : e.stage === "new" ? null : owner;
    const row = (
      await c.query(
        `INSERT INTO travel.enquiries (service, name, email, phone, travel_date, travellers, message, status, channel, quote_amount, close_reason,
        assigned_to, booking_id, budget, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING id`,
        [
          e.svc,
          e.name,
          e.email ?? null,
          e.phone,
          e.date ? shift(e.date) : null,
          e.trav ?? null,
          e.msg,
          e.stage,
          e.ch,
          e.quote ?? null,
          e.reason ?? null,
          assigned,
          bookingId,
          e.budget ?? null,
          created,
        ],
      )
    ).rows[0];
    if (bookingId) await c.query("UPDATE travel.bookings SET enquiry_id = $1 WHERE id = $2", [row.id, bookingId]);
    const notes = [];
    if (e.stage !== "new") notes.push(["status", "Moved to Contacted", e.ago - 30]);
    if (e.stage === "contacted")
      notes.push([
        "reply",
        `WhatsApp reply: Assalam o Alaikum ${e.name.split(" ")[0]}, thank you for contacting Sky Holidays. Sharing options shortly.`,
        e.ago - 25,
      ]);
    if (e.quote)
      notes.push(
        ["status", `Quote set to PKR ${e.quote.toLocaleString("en-US")}`, e.ago - 120],
        ["status", "Moved to Quoted", e.ago - 121],
      );
    if (e.ref) notes.push(["status", `Converted to booking ${e.ref}`, e.ago - 60]);
    if (e.reason) notes.push(["status", `Moved to Closed · ${e.reason}`, e.ago - 600]);
    if (e.name === "Rehan Akhtar") notes.push(["note", "Check Swissôtel for adjoining Haram-view rooms before quoting.", 4]);
    for (const [kind, body, ago] of notes) {
      await c.query("INSERT INTO travel.enquiry_notes (enquiry_id, kind, body, user_id, created_at) VALUES ($1,$2,$3,$4,$5)", [
        row.id,
        kind,
        body,
        owner,
        new Date(Date.now() - Math.max(ago, 1) * 60000),
      ]);
    }
  }

  // Payment methods and accounts shown in the preview (only when not configured yet).
  const accounts = await c.query("SELECT 1 FROM travel.payment_bank_accounts LIMIT 1");
  if (!accounts.rowCount) {
    await c.query(`INSERT INTO travel.payment_bank_accounts (bank_name, account_title, account_no, iban, raast_id, position) VALUES
      ('Meezan Bank', 'Sky Holidays (Pvt) Ltd', '0101-0123456789', 'PK36MEZN0001234567890123', '03111133020', 0),
      ('HBL', 'Sky Holidays (Pvt) Ltd', '1234-56789012-03', 'PK14HABB0012345678901234', '', 1)`);
    await c.query(
      `UPDATE travel.payment_methods SET enabled = true, config = config || '{"gateway":"Bank payment gateway","merchant_id":"SKYHOL-00218","surcharge_pct":2.5}'::jsonb WHERE key = 'card'`,
    );
    await c.query(
      `UPDATE travel.payment_methods SET enabled = true, config = jsonb_set(config, '{wallets}', '{"jazzcash":{"enabled":true,"account":"MC-778120"},"easypaisa":{"enabled":true,"account":"EP-55102"},"sadapay":{"enabled":false,"account":""}}') WHERE key = 'wallet'`,
    );
    await c.query(`UPDATE travel.payment_methods SET offer_for = '{hotel,excursion,package,umrah}' WHERE key = 'cash'`);
  }
}
