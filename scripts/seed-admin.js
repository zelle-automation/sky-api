// Creates the built-in staff roles and the first Owner account. Safe to re-run.
// The Owner's email comes from ADMIN_EMAIL (default info@skyholidays.pk) and the password
// from ADMIN_PASSWORD; without it a random password is generated and printed once.
// Usage: npm run db:seed-admin
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { hashPassword } from "../server/lib/auth.js";
import { fullPermissions } from "../shared/admin-nav.js";

const all = ["view", "create", "edit", "delete"];
const view = ["view"];
const grant = (keys, acts) => Object.fromEntries(keys.map((k) => [k, [...acts]]));

const ROLES = [
  {
    name: "Owner",
    description: "Full access to everything, including users, roles and settings.",
    owner: true,
    perms: fullPermissions(),
  },
  {
    name: "Content editor",
    description: "Edits hotels, excursions, packages, destinations, photos and the homepage. No bookings or money.",
    perms: {
      ...grant(
        [
          "hotels.all",
          "hotels.published",
          "hotels.draft",
          "hotels.photos",
          "excursions.all",
          "excursions.published",
          "excursions.seasonal",
          "excursions.draft",
          "packages.all",
          "packages.international",
          "packages.domestic",
          "packages.deals",
          "destinations.main",
          "visa.main",
          "homepage.hero",
          "homepage.sections",
          "media.all",
          "media.hotels",
          "media.excursions",
          "media.destinations",
        ],
        all,
      ),
    },
    limits: { hide_costs: true, can_export: false },
  },
  {
    name: "Umrah desk",
    description: "Handles Umrah packages, groups, Makkah and Madinah hotels, transfers and Umrah bookings.",
    perms: {
      ...grant(["umrah.flexible", "umrah.groups", "umrah.hotels", "transfers.airport", "transfers.intercity"], all),
      ...grant(
        ["bookings.all", "bookings.pending", "bookings.supplier", "bookings.confirmed", "bookings.travelling"],
        ["view", "create", "edit"],
      ),
      ...grant(
        ["enquiries.board", "enquiries.new", "enquiries.contacted", "enquiries.quoted", "enquiries.converted"],
        ["view", "create", "edit"],
      ),
      ...grant(["documents.hotel-voucher", "documents.transfer-voucher", "documents.quotation", "documents.visa-letter"], view),
    },
    limits: { own_bookings_only: false, hide_costs: true, mask_ids: false },
  },
  {
    name: "Accounts",
    description: "Payments, slip verification, refunds, invoices and receipts.",
    perms: {
      ...grant(
        ["payments.methods", "payments.transactions", "payments.verify", "payments.refunds", "payments.rules"],
        ["view", "create", "edit"],
      ),
      ...grant(
        ["bookings.all", "bookings.pending", "bookings.confirmed", "bookings.completed", "bookings.refund", "bookings.cancelled"],
        view,
      ),
      ...grant(["documents.invoice", "documents.receipt"], ["view", "create"]),
    },
    limits: { mask_ids: true },
  },
  {
    name: "Cancellations desk",
    description: "Sees cancelled bookings and handles refunds only.",
    perms: {
      ...grant(["bookings.cancelled"], view),
      ...grant(["bookings.refund", "payments.refunds"], ["view", "edit"]),
      ...grant(["documents.receipt"], view),
    },
    limits: { hide_costs: true, mask_ids: true, can_export: false },
  },
];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const ids = {};
  for (const r of ROLES) {
    const l = r.limits ?? {};
    const row = await c.query(
      `INSERT INTO travel.admin_roles (name, description, permissions, is_owner, own_bookings_only, hide_costs, mask_ids, can_export)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description,
         permissions = CASE WHEN travel.admin_roles.is_owner THEN EXCLUDED.permissions ELSE travel.admin_roles.permissions END
       RETURNING id`,
      [
        r.name,
        r.description,
        JSON.stringify(r.perms),
        !!r.owner,
        !!l.own_bookings_only,
        !!l.hide_costs,
        !!l.mask_ids,
        l.can_export ?? true,
      ],
    );
    ids[r.name] = row.rows[0].id;
  }

  const email = (process.env.ADMIN_EMAIL || "info@skyholidays.pk").toLowerCase();
  const exists = await c.query("SELECT 1 FROM travel.admin_users WHERE lower(email) = $1", [email]);
  if (!exists.rowCount) {
    const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");
    await c.query("INSERT INTO travel.admin_users (email, name, password_hash, role_id) VALUES ($1,$2,$3,$4)", [
      email,
      process.env.ADMIN_NAME || "Sky Holidays Owner",
      await hashPassword(password),
      ids.Owner,
    ]);
    console.log(`Owner account: ${email}`);
    if (!process.env.ADMIN_PASSWORD) console.log(`Generated password (shown once): ${password}`);
  } else {
    console.log(`Owner account ${email} already exists; password unchanged.`);
  }
  console.log(`Roles ready: ${Object.keys(ids).join(", ")}`);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
