// The dashboard's sections and their sub-tabs. One list drives the left rail in the
// browser and the permission keys the API checks ("<section>.<tab>" + an action), so
// a role can be limited to a single sub-tab such as "bookings.cancelled".

export type Action = "view" | "create" | "edit" | "delete";
export const ACTIONS: Action[] = ["view", "create", "edit", "delete"];

export type Tab = { key: string; label: string };
export type Section = { key: string; label: string; icon: string; tabs: Tab[]; badge?: "bookings" | "enquiries" };
export type Group = { label: string; sections: Section[] };

const t = (key: string, label: string): Tab => ({ key, label });

export const NAV: Group[] = [
  {
    label: "Operate",
    sections: [
      { key: "overview", label: "Overview", icon: "grid", tabs: [t("main", "Overview")] },
      {
        key: "bookings", label: "Bookings", icon: "ticket", badge: "bookings",
        tabs: [t("all", "All bookings"), t("pending", "Awaiting payment"), t("supplier", "Awaiting supplier"), t("confirmed", "Confirmed"), t("travelling", "Travelling"), t("completed", "Completed"), t("refund", "Refunds"), t("cancelled", "Cancelled")],
      },
      {
        key: "enquiries", label: "Enquiries", icon: "inbox", badge: "enquiries",
        tabs: [t("board", "Board"), t("new", "New"), t("contacted", "Contacted"), t("quoted", "Quoted"), t("converted", "Converted"), t("closed", "Closed")],
      },
      {
        key: "payments", label: "Payments", icon: "card",
        tabs: [t("methods", "Payment methods"), t("transactions", "Transactions"), t("verify", "Slips to verify"), t("refunds", "Refunds"), t("rules", "Checkout rules")],
      },
      {
        key: "documents", label: "Documents", icon: "file",
        tabs: [t("hotel-voucher", "Hotel voucher"), t("transfer-voucher", "Transfer voucher"), t("invoice", "Invoice"), t("quotation", "Quotation"), t("visa-letter", "Visa letter"), t("receipt", "Receipt"), t("branding", "Logo, header & footer")],
      },
    ],
  },
  {
    label: "Catalogue",
    sections: [
      { key: "hotels", label: "Hotels", icon: "bed", tabs: [t("all", "All hotels"), t("published", "Published"), t("draft", "Drafts"), t("photos", "Needs photos")] },
      { key: "excursions", label: "Excursions", icon: "compass", tabs: [t("all", "All excursions"), t("published", "Published"), t("seasonal", "Seasonal"), t("draft", "Drafts")] },
      { key: "packages", label: "Packages", icon: "bag", tabs: [t("all", "All packages"), t("international", "International"), t("domestic", "Domestic"), t("deals", "Weekly deals")] },
      { key: "umrah", label: "Umrah", icon: "moon", tabs: [t("flexible", "Flexible packages"), t("groups", "Group departures"), t("hotels", "Makkah & Madinah hotels")] },
      { key: "transfers", label: "Transfers", icon: "route", tabs: [t("airport", "Airport transfers"), t("intercity", "City to city"), t("vehicles", "Vehicles")] },
      { key: "cars", label: "Car rental", icon: "car", tabs: [t("fleet", "Fleet"), t("rates", "Rates & rules"), t("drivers", "Chauffeurs")] },
      { key: "destinations", label: "Destinations", icon: "globe", tabs: [t("main", "Destinations")] },
      { key: "visa", label: "Visa services", icon: "passport", tabs: [t("main", "Visa services")] },
    ],
  },
  {
    label: "Website",
    sections: [
      { key: "homepage", label: "Homepage", icon: "home", tabs: [t("hero", "Hero & offer"), t("sections", "Sections")] },
      { key: "media", label: "Media library", icon: "image", tabs: [t("all", "All photos"), t("hotels", "Hotels"), t("excursions", "Excursions"), t("destinations", "Destinations"), t("branding", "Branding")] },
      { key: "subscribers", label: "Subscribers", icon: "mail", tabs: [t("main", "Subscribers")] },
    ],
  },
  {
    label: "Admin",
    sections: [
      { key: "users", label: "Users & roles", icon: "users", tabs: [t("users", "Users"), t("roles", "Roles & permissions")] },
      { key: "settings", label: "Settings", icon: "gear", tabs: [t("business", "Business"), t("email", "Email"), t("notifications", "Notifications"), t("connections", "Connections")] },
    ],
  },
];

export const SECTIONS: Section[] = NAV.flatMap((g) => g.sections);
export const sectionOf = (key: string) => SECTIONS.find((s) => s.key === key);
/** True when a section has real sub-tabs (more than its single "main" page). */
export const hasTabs = (s: Section) => !(s.tabs.length === 1 && s.tabs[0].key === "main");
export const ALL_KEYS: string[] = SECTIONS.flatMap((s) => s.tabs.map((tb) => `${s.key}.${tb.key}`));

export type Permissions = Record<string, Action[]>;

export type Me = {
  id: string;
  name: string;
  email: string;
  role: string;
  isOwner: boolean;
  permissions: Permissions;
  limits: { ownBookingsOnly: boolean; hideCosts: boolean; maskIds: boolean; canExport: boolean };
};

/** `key` is "section.tab" or just "section" (true when any tab of it allows the action). */
export function allowed(me: Pick<Me, "isOwner" | "permissions">, key: string, action: Action = "view"): boolean {
  if (me.isOwner) return true;
  if (key.includes(".")) return !!me.permissions[key]?.includes(action);
  return Object.entries(me.permissions).some(([k, acts]) => k.startsWith(key + ".") && acts.includes(action));
}

/** Every permission, used for the Owner role. */
export const fullPermissions = (): Permissions => Object.fromEntries(ALL_KEYS.map((k) => [k, [...ACTIONS]]));
