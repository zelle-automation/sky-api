import { query } from "./db";
import { redis } from "./redis";

/**
 * Read-through cache. Uses Redis when REDIS_URL is set, otherwise the
 * travel.provider_cache table, so the site works with or without Redis.
 */
export async function cached<T>(
  provider: string,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const cacheKey = `${provider}:${key}`;
  const r = redis();
  if (r) {
    try {
      const hit = await r.get(`cache:${cacheKey}`);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      return load();
    }
    const payload = await load();
    await r.set(`cache:${cacheKey}`, JSON.stringify(payload), "EX", ttlSeconds).catch(() => {});
    return payload;
  }

  const hit = await query<{ payload: T }>(
    "SELECT payload FROM travel.provider_cache WHERE cache_key = $1 AND expires_at > now()",
    [cacheKey],
  );
  if (hit[0]) return hit[0].payload;
  const payload = await load();
  await query(
    `INSERT INTO travel.provider_cache (cache_key, provider, payload, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
    [cacheKey, provider, JSON.stringify(payload), ttlSeconds],
  );
  return payload;
}

/** Drops every cached catalogue query (call after editing catalogue data). */
export async function clearCatalogCache() {
  const r = redis();
  if (!r) return;
  const keys = await r.keys("cache:catalog:*");
  if (keys.length) await r.del(...keys);
}
