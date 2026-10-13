import { query } from "./db.js";
import { redis } from "./redis.js";

// Settings rows are small JSON documents keyed by name (business, email, checkout, branding, ...).
// Reads are cached in Redis for a minute; writes clear the cache.

export async function getSetting(key, fallback) {
  const r = redis();
  if (r) {
    const hit = await r.get(`setting:${key}`).catch(() => null);
    if (hit) return { ...fallback, ...JSON.parse(hit) };
  }
  const rows = await query("SELECT value FROM travel.settings WHERE key = $1", [key]);
  const value = rows[0]?.value ?? {};
  await r?.set(`setting:${key}`, JSON.stringify(value), "EX", 60).catch(() => {});
  return { ...fallback, ...value };
}

export async function setSetting(key, value, userId) {
  await query(
    `INSERT INTO travel.settings (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId ?? null],
  );
  await redis()
    ?.del(`setting:${key}`)
    .catch(() => {});
}
