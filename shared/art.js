// Stand-in artwork: every scene has a daytime and an evening palette, served as SVG from /art/….
// Replace image_day_url / image_night_url in the database with real photos when they're available.
import { scene, PAL } from "./art-scene.js";

export const KINDS = ["mountains", "city", "twin", "domes", "tower", "island", "villas", "desert", "lake"];

const DAY = { night: "day", dusk: "morning", gold: "morning", teal: "teal", day: "day" };
const EVE = { night: "night", dusk: "dusk", gold: "gold", teal: "night", day: "dusk" };

export function artPair(kind, flavor, seed) {
  return {
    day: `/art/${kind}-${DAY[flavor]}-${seed}.svg`,
    night: `/art/${kind}-${EVE[flavor]}-${seed}.svg`,
  };
}

export function renderArt(name) {
  const m = /^([a-z]+)-([a-z]+)-(\d{1,4})\.svg$/.exec(name);
  if (!m) return null;
  const [, kind, pal, seed] = m;
  if (!KINDS.includes(kind) || !(pal in PAL)) return null;
  return scene(kind, pal, Number(seed));
}
