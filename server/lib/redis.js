import Redis from "ioredis";

let client;

/** Shared Redis client, or null when REDIS_URL is not set (the site then runs without it). */
export function redis() {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  client = url ? new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: true }) : null;
  client?.on("error", (e) => console.warn("redis:", e.message));
  return client;
}

/** Fixed-window rate limit. Returns true when the caller is still under `limit` per `windowSec`. */
export async function allow(key, limit, windowSec) {
  const r = redis();
  if (!r) return true;
  try {
    const k = `rl:${key}`;
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSec);
    return n <= limit;
  } catch {
    return true;
  }
}
