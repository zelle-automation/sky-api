// Staff sign-in and the "who am I" call the dashboard makes on load.
import { Router } from "express";
import { z } from "zod";
import { COOKIE, createSession, endAllSessions, endSession, hashPassword, loadMe, requireAuth, setSessionCookie, verifyPassword, me } from "../lib/auth";
import { audit } from "../lib/audit";
import { one, query } from "../lib/db";
import { HttpError, ipOf, parse } from "../lib/http";
import { allow } from "../lib/redis";

const r = Router();

r.post("/login", async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().min(3), password: z.string().min(1) }), req.body ?? {});
  if (!(await allow(`login:${ipOf(req)}:${email}`, 10, 600))) throw new HttpError(429, "Too many attempts. Wait ten minutes and try again.");
  const u = await one<{ id: string; password_hash: string; is_active: boolean }>(
    "SELECT id, password_hash, is_active FROM travel.admin_users WHERE lower(email) = $1",
    [email],
  );
  if (!u || !u.is_active || !(await verifyPassword(password, u.password_hash))) throw new HttpError(401, "Email or password is incorrect");
  const token = await createSession(u.id);
  setSessionCookie(res, token);
  await query("UPDATE travel.admin_users SET last_login_at = now() WHERE id = $1", [u.id]);
  await audit(u.id, "auth.login", "admin_user", u.id, { ip: ipOf(req) });
  res.json({ data: await loadMe(u.id) });
});

r.post("/logout", async (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) await endSession(token);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

r.get("/me", requireAuth, (req, res) => {
  res.json({ data: me(req) });
});

r.post("/password", requireAuth, async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string(), next: z.string().min(10, "Use at least 10 characters") }), req.body ?? {});
  const u = await one<{ password_hash: string }>("SELECT password_hash FROM travel.admin_users WHERE id = $1", [me(req).id]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw new HttpError(400, "Current password is incorrect");
  await query("UPDATE travel.admin_users SET password_hash = $2, updated_at = now() WHERE id = $1", [me(req).id, await hashPassword(next)]);
  await endAllSessions(me(req).id);
  setSessionCookie(res, await createSession(me(req).id));
  res.json({ ok: true });
});

export default r;
