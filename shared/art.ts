// Stand-in artwork: every scene has a daytime and an evening palette, served as SVG from /art/….
// Replace image_day_url / image_night_url in the database with real photos when they're available.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scene, PAL } = require("./art-scene.js") as {
  scene: (kind: string, pal: string, seed: number) => string;
  PAL: Record<string, unknown>;
};

export const KINDS = ["mountains", "city", "twin", "domes", "tower", "island", "villas", "desert", "lake"] as const;
export type Kind = (typeof KINDS)[number];
export type Flavor = "night" | "dusk" | "gold" | "teal" | "day";

const DAY: Record<Flavor, string> = { night: "day", dusk: "morning", gold: "morning", teal: "teal", day: "day" };
const EVE: Record<Flavor, string> = { night: "night", dusk: "dusk", gold: "gold", teal: "night", day: "dusk" };

export function artPair(kind: Kind, flavor: Flavor, seed: number) {
  return {
    day: `/art/${kind}-${DAY[flavor]}-${seed}.svg`,
    night: `/art/${kind}-${EVE[flavor]}-${seed}.svg`,
  };
}

export function renderArt(name: string): string | null {
  const m = /^([a-z]+)-([a-z]+)-(\d{1,4})\.svg$/.exec(name);
  if (!m) return null;
  const [, kind, pal, seed] = m;
  if (!(KINDS as readonly string[]).includes(kind) || !(pal in PAL)) return null;
  return scene(kind, pal, Number(seed));
}
