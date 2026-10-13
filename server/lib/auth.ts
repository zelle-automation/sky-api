// Staff sign-in: scrypt password hashes, opaque session tokens in an httpOnly cookie,
// sessions in Redis (falling back to Postgres), and permission checks per sub-tab.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { allowed, type Action, type Me, type Permissions } from "../../shared/admin-nav";
import { one, query } from "./db";
import { HttpError } from "./http";
import { redis } from "./redis";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = "sky_admin";
const TTL_SEC = 60 * 60 * 12; // sliding 12 hours

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length);
  return timingSafeEqual(want, got);
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const h = digest(token);
  const r = redis();
  if (r) await r.set(`sess:${h}`, userId, "EX", TTL_SEC);
  else await query("INSERT INTO travel.admin_sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + make_interval(secs => $3))", [h, userId, TTL_SEC]);
  return token;
}

async function sessionUser(token: string): Promise<string | null> {
  const h = digest(token);
  const r = redis();
  if (r) {
    const id = await r.get(`sess:${h}`);
    if (id) await r.expire(`sess:${h}`, TTL_SEC);
    return id;
  }
  const row = await one<{ user_id: string }>(
    "UPDATE travel.admin_sessions SET expires_at = now() + make_interval(secs => $2) WHERE token_hash = $1 AND expires_at > now() RETURNING user_id",
    [h, TTL_SEC],
  );
  return row?.user_id ?? null;
}

export async function endSession(token: string) {
  const h = digest(token);
  await redis()?.del(`sess:${h}`);
  await query("DELETE FROM travel.admin_sessions WHERE token_hash = $1", [h]);
}

/** Signs a user out everywhere (after a password change or deactivation). */
export async function endAllSessions(userId: string) {
  const r = redis();
  if (r) {
    const keys = await r.keys("sess:*");
    for (const k of keys) if ((await r.get(k)) === userId) await r.del(k);
  }
  await query("DELETE FROM travel.admin_sessions WHERE user_id = $1", [userId]);
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "1",
    path: "/",
    maxAge: TTL_SEC * 1000,
  });
}

type UserRow = {
  id: string; name: string; email: string; is_active: boolean; role_name: string; is_owner: boolean; permissions: Permissions;
  own_bookings_only: boolean; hide_costs: boolean; mask_ids: boolean; can_export: boolean;
};

export async function loadMe(userId: string): Promise<Me | null> {
  const u = await one<UserRow>(
    `SELECT u.id, u.name, u.email, u.is_active, r.name AS role_name, r.is_owner, r.permissions,
            r.own_bookings_only, r.hide_costs, r.mask_ids, r.can_export
       FROM travel.admin_users u JOIN travel.admin_roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId],
  );
  if (!u || !u.is_active) return null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role_name, isOwner: u.is_owner, permissions: u.permissions ?? {},
    limits: { ownBookingsOnly: u.own_bookings_only, hideCosts: u.hide_costs, maskIds: u.mask_ids, canExport: u.can_export },
  };
}

declare module "express-serve-static-core" {
  interface Request {
    me?: Me;
  }
}

/** Requires a signed-in, active staff member; sets req.me. Mutations also need the X-Requested-With header (CSRF guard). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE] as string | undefined;
  const userId = token ? await sessionUser(token) : null;
  const me = userId ? await loadMe(userId) : null;
  if (!me) throw new HttpError(401, "Please sign in");
  if (req.method !== "GET" && req.method !== "HEAD" && req.get("x-requested-with") !== "sky-admin") {
    throw new HttpError(403, "Missing request header");
  }
  req.me = me;
  next();
}

export function assertCan(req: Request, key: string, action: Action = "view") {
  if (!req.me || !allowed(req.me, key, action)) throw new HttpError(403, "Your role does not allow this");
}

/** Route middleware: `can("bookings.cancelled", "edit")` or a section key for "any tab of it". */
export const can = (key: string, action: Action = "view") => (req: Request, _res: Response, next: NextFunction) => {
  assertCan(req, key, action);
  next();
};

/** True when the user may act on at least one of the keys. */
export function canAny(req: Request, keys: string[], action: Action = "view") {
  return !!req.me && keys.some((k) => allowed(req.me!, k, action));
}

export const me = (req: Request) => {
  if (!req.me) throw new HttpError(401, "Please sign in");
  return req.me;
};
