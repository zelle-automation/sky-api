// Users & roles: staff accounts (users.users) and roles with per-sub-tab permissions (users.roles).
import { randomInt } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { ACTIONS, ALL_KEYS, fullPermissions, type Permissions } from "../../../shared/admin-nav";
import { assertCan, canAny, endAllSessions, hashPassword, me } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { one, query, tx } from "../../lib/db";
import { HttpError, notFound, parse } from "../../lib/http";
import { sendRaw, textToHtml } from "../../lib/mailer";

const r = Router();

/** Readable temporary password, e.g. "Sky-4821-Kite". */
function tempPassword() {
  const words = ["Kite", "Dune", "Palm", "Moon", "Reef", "Peak", "Lake", "Star", "Wave", "Pine", "Sail", "Mint"];
  return `Sky-${randomInt(1000, 9999)}-${words[randomInt(words.length)]}${randomInt(10, 99)}`;
}

const password = z.string().min(10, "Use at least 10 characters").max(200);

/* ---------- users ---------- */

r.get("/", async (req, res) => {
  assertCan(req, "users.users");
  const rows = await query(
    `SELECT u.id, u.email, u.name, u.phone, u.role_id, r.name AS role_name, r.is_owner, u.is_active, u.last_login_at, u.created_at
       FROM travel.admin_users u JOIN travel.admin_roles r ON r.id = u.role_id
      ORDER BY u.is_active DESC, r.is_owner DESC, u.name`,
  );
  res.json({ data: rows });
});

async function activeOwners(exceptUserId?: string) {
  const row = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM travel.admin_users u JOIN travel.admin_roles r ON r.id = u.role_id
      WHERE r.is_owner AND u.is_active AND ($1::uuid IS NULL OR u.id <> $1)`,
    [exceptUserId ?? null],
  );
  return row?.n ?? 0;
}

const UserBody = z.object({
  name: z.string().trim().min(2, "Enter the person’s name").max(120),
  email: z.email("Enter a valid email").transform((s) => s.trim().toLowerCase()),
  phone: z.string().trim().max(40).optional().nullable(),
  role_id: z.uuid("Choose a role"),
  password: password.optional(),
  send_invite: z.boolean().optional(),
});

r.post("/", async (req, res) => {
  assertCan(req, "users.users", "create");
  const b = parse(UserBody, req.body);
  const role = await one<{ is_owner: boolean }>("SELECT is_owner FROM travel.admin_roles WHERE id = $1", [b.role_id]);
  if (!role) throw new HttpError(400, "That role no longer exists");
  if (role.is_owner && !me(req).isOwner) throw new HttpError(403, "Only an Owner can add another Owner");
  const temp = b.password ?? tempPassword();
  const row = await one<{ id: string }>(
    `INSERT INTO travel.admin_users (email, name, phone, role_id, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [b.email, b.name, b.phone || null, b.role_id, await hashPassword(temp)],
  );
  await audit(me(req).id, "user.create", "admin_user", row!.id, { email: b.email, role_id: b.role_id });
  let invite: { sent: boolean; error?: string } | null = null;
  if (b.send_invite) {
    const site = process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`;
    invite = await sendRaw(b.email, "Your Sky Holidays dashboard account", textToHtml(
      `Assalam o Alaikum ${b.name},\n\n${me(req).name} has given you access to the Sky Holidays dashboard.\n\nSign in at ${site}/admin/login\nEmail: ${b.email}\nTemporary password: ${temp}\n\nPlease change your password after you sign in.`,
    ));
  }
  res.status(201).json({ data: { id: row!.id, temp_password: temp, invite } });
});

r.patch("/:id", async (req, res) => {
  assertCan(req, "users.users", "edit");
  const b = parse(z.object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    role_id: z.uuid().optional(),
    is_active: z.boolean().optional(),
  }), req.body);
  const id = String(req.params.id);
  const cur = await one<{ is_owner: boolean; is_active: boolean; role_id: string }>(
    "SELECT r.is_owner, u.is_active, u.role_id FROM travel.admin_users u JOIN travel.admin_roles r ON r.id = u.role_id WHERE u.id = $1", [id]);
  if (!cur) throw notFound("User not found");
  const self = id === me(req).id;
  if (b.is_active === false && self) throw new HttpError(400, "You can’t deactivate your own account");
  let newRoleOwner = cur.is_owner;
  if (b.role_id && b.role_id !== cur.role_id) {
    const nr = await one<{ is_owner: boolean }>("SELECT is_owner FROM travel.admin_roles WHERE id = $1", [b.role_id]);
    if (!nr) throw new HttpError(400, "That role no longer exists");
    if ((nr.is_owner || cur.is_owner) && !me(req).isOwner) throw new HttpError(403, "Only an Owner can give or take the Owner role");
    newRoleOwner = nr.is_owner;
  }
  const losesOwner = cur.is_owner && cur.is_active && (!newRoleOwner || b.is_active === false);
  if (losesOwner && (await activeOwners(id)) === 0) throw new HttpError(400, "This is the last active Owner. Make someone else an Owner first.");
  const row = await one(
    `UPDATE travel.admin_users SET name = COALESCE($2, name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
            role_id = COALESCE($5, role_id), is_active = COALESCE($6, is_active), updated_at = now()
      WHERE id = $1 RETURNING id, name, email, phone, role_id, is_active`,
    [id, b.name ?? null, b.phone !== undefined, b.phone || null, b.role_id ?? null, b.is_active ?? null],
  );
  if (b.is_active === false) await endAllSessions(id);
  await audit(me(req).id, b.is_active === false ? "user.deactivate" : b.is_active === true ? "user.activate" : "user.update", "admin_user", id, b);
  res.json({ data: row });
});

r.post("/:id/reset-password", async (req, res) => {
  assertCan(req, "users.users", "edit");
  const b = parse(z.object({ password: password.optional() }), req.body ?? {});
  const id = String(req.params.id);
  const target = await one<{ is_owner: boolean }>("SELECT r.is_owner FROM travel.admin_users u JOIN travel.admin_roles r ON r.id = u.role_id WHERE u.id = $1", [id]);
  if (!target) throw notFound("User not found");
  if (target.is_owner && !me(req).isOwner) throw new HttpError(403, "Only an Owner can reset an Owner’s password");
  const temp = b.password ?? tempPassword();
  await query("UPDATE travel.admin_users SET password_hash = $2, updated_at = now() WHERE id = $1", [id, await hashPassword(temp)]);
  await endAllSessions(id);
  await audit(me(req).id, "user.reset_password", "admin_user", id);
  res.json({ data: { temp_password: temp } });
});

/* ---------- roles ---------- */

r.get("/roles", async (req, res) => {
  if (!canAny(req, ["users.roles", "users.users"])) throw new HttpError(403, "Your role does not allow this");
  const rows = await query(
    `SELECT r.id, r.name, r.description, r.permissions, r.is_owner, r.own_bookings_only, r.hide_costs, r.mask_ids, r.can_export,
            (SELECT count(*) FROM travel.admin_users u WHERE u.role_id = r.id)::int AS users
       FROM travel.admin_roles r ORDER BY r.is_owner DESC, r.created_at`,
  );
  res.json({ data: rows.map((x) => (x.is_owner ? { ...x, permissions: fullPermissions() } : x)) });
});

/** Keeps only known keys/actions; "view" is implied by any other action on a sub-tab. */
function clean(p: Permissions): Permissions {
  const out: Permissions = {};
  for (const k of ALL_KEYS) {
    const acts = (p[k] ?? []).filter((a) => ACTIONS.includes(a));
    if (!acts.length) continue;
    out[k] = ACTIONS.filter((a) => acts.includes(a) || (a === "view" && acts.length > 0));
  }
  return out;
}

const RoleBody = z.object({
  name: z.string().trim().min(2, "Give the role a name").max(60),
  description: z.string().trim().max(200).optional().nullable(),
  permissions: z.record(z.string(), z.array(z.enum(["view", "create", "edit", "delete"]))).default({}),
  own_bookings_only: z.boolean().default(false),
  hide_costs: z.boolean().default(false),
  mask_ids: z.boolean().default(false),
  can_export: z.boolean().default(false),
});

r.post("/roles", async (req, res) => {
  assertCan(req, "users.roles", "create");
  const b = parse(RoleBody, req.body);
  const row = await one(
    `INSERT INTO travel.admin_roles (name, description, permissions, own_bookings_only, hide_costs, mask_ids, can_export)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.name, b.description || null, JSON.stringify(clean(b.permissions)), b.own_bookings_only, b.hide_costs, b.mask_ids, b.can_export],
  );
  await audit(me(req).id, "role.create", "admin_role", row!.id, { name: b.name });
  res.status(201).json({ data: row });
});

r.put("/roles/:id", async (req, res) => {
  assertCan(req, "users.roles", "edit");
  const b = parse(RoleBody, req.body);
  const id = String(req.params.id);
  const cur = await one<{ is_owner: boolean }>("SELECT is_owner FROM travel.admin_roles WHERE id = $1", [id]);
  if (!cur) throw notFound("Role not found");
  if (cur.is_owner) {
    // The Owner role always has every permission and no limits; only its name and description change.
    if (!me(req).isOwner) throw new HttpError(403, "Only an Owner can change the Owner role");
    const row = await one("UPDATE travel.admin_roles SET name = $2, description = $3, updated_at = now() WHERE id = $1 RETURNING *", [id, b.name, b.description || null]);
    res.json({ data: { ...row, permissions: fullPermissions() } });
    return;
  }
  const row = await one(
    `UPDATE travel.admin_roles SET name = $2, description = $3, permissions = $4, own_bookings_only = $5, hide_costs = $6, mask_ids = $7, can_export = $8, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, b.name, b.description || null, JSON.stringify(clean(b.permissions)), b.own_bookings_only, b.hide_costs, b.mask_ids, b.can_export],
  );
  await audit(me(req).id, "role.update", "admin_role", id, { name: b.name });
  res.json({ data: row });
});

r.delete("/roles/:id", async (req, res) => {
  assertCan(req, "users.roles", "delete");
  const id = String(req.params.id);
  await tx(async (c) => {
    const cur = (await c.query<{ is_owner: boolean; name: string }>("SELECT is_owner, name FROM travel.admin_roles WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!cur) throw notFound("Role not found");
    if (cur.is_owner) throw new HttpError(400, "The Owner role can’t be deleted");
    const n = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM travel.admin_users WHERE role_id = $1", [id])).rows[0].n;
    if (n > 0) throw new HttpError(400, `${n} user${n > 1 ? "s" : ""} still ha${n > 1 ? "ve" : "s"} this role. Move them to another role first.`);
    await c.query("DELETE FROM travel.admin_roles WHERE id = $1", [id]);
  });
  await audit(me(req).id, "role.delete", "admin_role", id);
  res.json({ ok: true });
});

export default r;
