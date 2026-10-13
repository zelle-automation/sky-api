// Homepage content (settings key "homepage", served publicly at GET /api/site):
// hero texts and images, the seasonal offer, search tabs, and the order and visibility of sections.
import { Router } from "express";
import { z } from "zod";
import { assertCan, canAny, me } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { clearCatalogCache } from "../../lib/cache.js";
import { query } from "../../lib/db.js";
import { HttpError, parse } from "../../lib/http.js";
import { getSetting, setSetting } from "../../lib/settings.js";

const r = Router();

export const SEARCH_TABS = ["flights", "hotels", "packages", "excursions", "umrah", "transfers", "cars", "visa"];
export const SECTION_KEYS = [
  "destinations",
  "hotels",
  "excursions",
  "deals",
  "umrah",
  "visa",
  "services",
  "stories",
  "newsletter",
];
export const SECTION_LABELS = {
  destinations: "Popular destinations rail",
  hotels: "Hotels",
  excursions: "Excursions",
  deals: "Weekly deals",
  umrah: "Umrah packages",
  visa: "Visa services",
  services: "Services grid",
  stories: "Traveller stories",
  newsletter: "Newsletter sign-up",
};

const HERO_DEFAULTS = {
  eyebrow: "Sky Holidays · door to destination",
  headline: "Every journey, exceptional.",
  sub: "Flights, hotels, tours, visas and Umrah, planned end to end by one travel desk in Pakistan and looked after until you are home.",
  cta_label: "Explore destinations",
  cta_link: "/destinations",
  cta2_label: "View packages",
  cta2_link: "/packages",
  image_day_url: "/brand/hero-terrace.jpg",
  image_night_url: "/brand/dubai-night.jpg",
  search_default: "hotels",
  search_tabs: Object.fromEntries(SEARCH_TABS.map((t) => [t, true])),
};
const OFFER_DEFAULTS = {
  enabled: true,
  badge: "Seasonal offer",
  title: "Umrah 2026–27 departures",
  text: "Visa, flights, Haram-view hotels and Ziyarat transfers in one package.",
  link: "/umrah",
  until: "",
};
const SECTIONS_DEFAULT = SECTION_KEYS.map((key) => ({ key, enabled: true }));

async function load() {
  const h = await getSetting("homepage", {});
  const saved = (h.sections ?? []).filter((s) => SECTION_KEYS.includes(s.key));
  const missing = SECTIONS_DEFAULT.filter((d) => !saved.some((s) => s.key === d.key));
  return {
    hero: { ...HERO_DEFAULTS, ...h.hero, search_tabs: { ...HERO_DEFAULTS.search_tabs, ...h.hero?.search_tabs } },
    offer: { ...OFFER_DEFAULTS, ...h.offer },
    sections: [...saved, ...missing],
  };
}

/** The saved homepage plus what the editor needs (section names, packages to link the offer to). */
async function withExtras(h) {
  const pkgs = await query("SELECT slug, title FROM travel.packages WHERE status = 'published' ORDER BY title LIMIT 200").catch(
    () => [],
  );
  return { ...h, labels: SECTION_LABELS, packages: pkgs };
}

r.get("/", async (req, res) => {
  if (!canAny(req, ["homepage.hero", "homepage.sections"])) throw new HttpError(403, "Your role does not allow this");
  res.json({ data: await withExtras(await load()) });
});

const link = z
  .string()
  .trim()
  .max(300)
  .refine((s) => s === "" || s.startsWith("/") || /^https?:\/\//.test(s), "Links start with / or https://");
const img = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((s) => s || "");

r.put("/hero", async (req, res) => {
  assertCan(req, "homepage.hero", "edit");
  const b = parse(
    z.object({
      hero: z.object({
        eyebrow: z.string().trim().max(120),
        headline: z.string().trim().min(3, "Add a headline").max(120),
        sub: z.string().trim().max(400),
        cta_label: z.string().trim().max(40),
        cta_link: link,
        cta2_label: z.string().trim().max(40),
        cta2_link: link,
        image_day_url: img,
        image_night_url: img,
        search_default: z.enum(SEARCH_TABS),
        search_tabs: z.record(z.enum(SEARCH_TABS), z.boolean()),
      }),
      offer: z.object({
        enabled: z.boolean(),
        badge: z.string().trim().max(40),
        title: z.string().trim().max(120),
        text: z.string().trim().max(300),
        link,
        until: z.union([z.literal(""), z.iso.date()]),
      }),
    }),
    req.body,
  );
  if (!Object.values(b.hero.search_tabs).some(Boolean)) throw new HttpError(400, "Keep at least one search tab on");
  if (!b.hero.search_tabs[b.hero.search_default]) throw new HttpError(400, "The search can’t open on a tab that is switched off");
  const cur = await load();
  const value = {
    ...cur,
    hero: { ...b.hero, search_tabs: { ...HERO_DEFAULTS.search_tabs, ...b.hero.search_tabs } },
    offer: b.offer,
  };
  await setSetting("homepage", value, me(req).id);
  await clearCatalogCache();
  await audit(me(req).id, "homepage.hero", "settings", "homepage");
  res.json({ data: await withExtras(value) });
});

r.put("/sections", async (req, res) => {
  assertCan(req, "homepage.sections", "edit");
  const b = parse(
    z.object({ sections: z.array(z.object({ key: z.enum(SECTION_KEYS), enabled: z.boolean() })).max(SECTION_KEYS.length) }),
    req.body,
  );
  if (new Set(b.sections.map((s) => s.key)).size !== b.sections.length) throw new HttpError(400, "Each section can appear once");
  const cur = await load();
  const missing = SECTIONS_DEFAULT.filter((d) => !b.sections.some((s) => s.key === d.key));
  const value = { ...cur, sections: [...b.sections, ...missing] };
  await setSetting("homepage", value, me(req).id);
  await clearCatalogCache();
  await audit(me(req).id, "homepage.sections", "settings", "homepage");
  res.json({ data: await withExtras(value) });
});

export default r;
