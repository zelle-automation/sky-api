// Payments: checkout methods (each with an on/off switch, stored in travel.payment_methods
// and travel.payment_bank_accounts), the transactions ledger, slips to verify, refunds and
// checkout rules (settings key "checkout").
import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit";
import { can, canAny, me } from "../../lib/auth";
import { query, tx } from "../../lib/db";
import { HttpError, parse } from "../../lib/http";
import { encrypt } from "../../lib/secret";
import { getSetting, setSetting } from "../../lib/settings";
import { bookingScope, payRefund, verifyPayment } from "./bookings";

const r = Router();

/* ---------- methods ---------- */

type MethodRow = { key: string; label: string; enabled: boolean; offer_for: string[]; config: Record<string, unknown>; secrets: Record<string, string>; updated_at: string };

async function loadMethods() {
  const rows = await query<MethodRow>("SELECT key, label, enabled, offer_for, config, secrets, updated_at FROM travel.payment_methods ORDER BY sort_order");
  const accounts = await query("SELECT id, bank_name, account_title, account_no, iban, raast_id, branch, enabled, position FROM travel.payment_bank_accounts ORDER BY position, created_at");
  // Secrets never leave the server: only say whether each one is set.
  const methods = Object.fromEntries(rows.map(({ secrets, ...m }) => [m.key, { ...m, secrets_set: Object.fromEntries(Object.keys(secrets ?? {}).map((k) => [k, true])) }]));
  // Older rows kept one limit / window for every wallet: give each wallet its own.
  const w = methods.wallet?.config as { wallets?: Record<string, Record<string, unknown>>; limit_per_payment?: number; window_minutes?: number } | undefined;
  if (w?.wallets) {
    for (const k of ["jazzcash", "easypaisa", "sadapay"]) {
      const x = (w.wallets[k] ??= { enabled: false, account: "" });
      x.limit ??= w.limit_per_payment ?? 500000;
      x.window_minutes ??= w.window_minutes ?? 30;
    }
  }
  return { methods, accounts };
}

r.get("/methods", can("payments.methods"), async (_req, res) => {
  res.json({ data: await loadMethods() });
});

const PRODUCT_TYPES = ["hotel", "excursion", "package", "umrah", "transfer", "car", "visa"] as const;
const offer = z.array(z.enum(PRODUCT_TYPES)).default([]);
const s = (max = 200) => z.string().trim().max(max).nullish().transform((v) => v ?? "");
const wallet = z.object({
  enabled: z.boolean().default(false), account: s(80),
  limit: z.coerce.number().min(0).max(1e8).default(500000), window_minutes: z.coerce.number().int().min(5).max(240).default(30),
});

const methodsSchema = z.object({
  bank: z.object({
    enabled: z.boolean(), offer_for: offer,
    config: z.object({ require_slip: z.boolean().default(true), raast_enabled: z.boolean().default(true), hold_hours: z.coerce.number().int().min(1).max(168).default(24), verify_within: s(40) }),
  }),
  card: z.object({
    enabled: z.boolean(), offer_for: offer,
    config: z.object({
      gateway: s(80), merchant_id: s(80), surcharge_pct: z.coerce.number().min(0).max(20).default(0), mode: z.enum(["test", "live"]).default("test"),
      brands: z.object({ visa: z.boolean(), mastercard: z.boolean(), unionpay: z.boolean(), paypak: z.boolean(), amex: z.boolean() }),
      three_d_secure: z.boolean().default(true), international: z.boolean().default(true),
    }),
    // Write-only secrets: blank keeps the saved value, null clears it.
    secrets: z.object({ api_key: z.string().max(500).nullish(), secret_key: z.string().max(500).nullish() }).partial().optional(),
  }),
  wallet: z.object({
    enabled: z.boolean(), offer_for: offer,
    config: z.object({
      wallets: z.object({ jazzcash: wallet, easypaisa: wallet, sadapay: wallet }),
    }),
    secrets: z.object({ jazzcash_key: z.string().max(500).nullish(), easypaisa_key: z.string().max(500).nullish(), sadapay_key: z.string().max(500).nullish() }).partial().optional(),
  }),
  cash: z.object({
    enabled: z.boolean(), offer_for: offer,
    config: z.object({ office: s(200), pay_within_hours: z.coerce.number().int().min(1).max(168).default(24) }),
  }),
  accounts: z.array(z.object({
    id: z.string().uuid().optional(),
    bank_name: z.string().trim().min(2, "Enter the bank name").max(80),
    account_title: z.string().trim().min(2, "Enter the account title").max(120),
    account_no: s(40), iban: s(40), raast_id: s(40), branch: s(120), enabled: z.boolean().default(true),
  })).max(20),
});

r.put("/methods", can("payments.methods", "edit"), async (req, res) => {
  const d = parse(methodsSchema, req.body);
  const m = me(req);
  if (d.bank.enabled && !d.accounts.some((a) => a.enabled)) throw new HttpError(400, "Add at least one bank account that is switched on, or switch bank transfer off");
  if (d.wallet.enabled && !Object.values(d.wallet.config.wallets).some((w) => w.enabled)) throw new HttpError(400, "Switch on at least one wallet, or switch mobile wallet off");
  await tx(async (c) => {
    for (const key of ["bank", "card", "wallet", "cash"] as const) {
      const v = d[key];
      const incoming = "secrets" in v ? (v.secrets ?? {}) : {};
      const old = (await c.query<{ secrets: Record<string, string> }>("SELECT secrets FROM travel.payment_methods WHERE key=$1", [key])).rows[0]?.secrets ?? {};
      const secrets: Record<string, string> = { ...old };
      for (const [k, val] of Object.entries(incoming)) {
        if (val === null) delete secrets[k];
        else if (typeof val === "string" && val.trim()) secrets[k] = encrypt(val.trim());
      }
      await c.query("UPDATE travel.payment_methods SET enabled=$2, offer_for=$3, config=$4, secrets=$5, updated_by=$6, updated_at=now() WHERE key=$1",
        [key, v.enabled, v.offer_for, JSON.stringify(v.config), JSON.stringify(secrets), m.id]);
    }
    const keep = d.accounts.map((a) => a.id).filter(Boolean);
    await c.query("DELETE FROM travel.payment_bank_accounts WHERE NOT (id = ANY($1::uuid[]))", [keep]);
    for (const [i, a] of d.accounts.entries()) {
      if (a.id) {
        await c.query(`UPDATE travel.payment_bank_accounts SET bank_name=$2, account_title=$3, account_no=$4, iban=$5, raast_id=$6, branch=$7, enabled=$8, position=$9, updated_at=now() WHERE id=$1`,
          [a.id, a.bank_name, a.account_title, a.account_no, a.iban.replace(/\s+/g, "").toUpperCase(), a.raast_id, a.branch, a.enabled, i]);
      } else {
        await c.query(`INSERT INTO travel.payment_bank_accounts (bank_name, account_title, account_no, iban, raast_id, branch, enabled, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [a.bank_name, a.account_title, a.account_no, a.iban.replace(/\s+/g, "").toUpperCase(), a.raast_id, a.branch, a.enabled, i]);
      }
    }
  });
  await audit(m.id, "payments.methods.update", "settings", "payment_methods", {
    enabled: { bank: d.bank.enabled, card: d.card.enabled, wallet: d.wallet.enabled, cash: d.cash.enabled }, accounts: d.accounts.length,
  });
  res.json({ data: await loadMethods() });
});

/* ---------- transactions, slips, refunds ---------- */

r.get("/transactions", async (req, res) => {
  const tab = String(req.query.tab ?? "transactions");
  if (!["transactions", "verify", "refunds"].includes(tab)) throw new HttpError(400, "Unknown tab");
  if (!canAny(req, [`payments.${tab}`])) throw new HttpError(403, "Your role does not allow this");
  // Payments staff see every booking's money; the bookings own-only limit still applies.
  const params: unknown[] = [];
  const m = me(req);
  const where: string[] = [];
  if (m.limits.ownBookingsOnly) where.push(bookingScope(req, params));
  if (tab === "verify") where.push("p.kind = 'payment' AND p.status = 'pending'");
  if (tab === "refunds") where.push("p.kind = 'refund'");
  const term = String(req.query.q ?? "").trim();
  if (term) {
    params.push(`%${term}%`);
    const n = params.length;
    where.push(`(b.ref ILIKE $${n} OR b.lead_name ILIKE $${n} OR p.reference ILIKE $${n} OR p.provider ILIKE $${n} OR p.method ILIKE $${n} OR p.id::text ILIKE $${n})`);
  }
  const rows = await query(`SELECT p.id, p.kind, p.method, p.provider, p.amount, p.currency_code, p.status, p.reference, p.slip_url, p.note,
      p.received_at, p.verified_at, p.paid_at, vu.name AS verified_by_name, b.id AS booking_id, b.ref, b.lead_name, b.product_name, b.status AS booking_status,
      b.total_amount, b.paid_amount
    FROM travel.booking_payments p JOIN travel.bookings b ON b.id = p.booking_id LEFT JOIN travel.admin_users vu ON vu.id = p.verified_by
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY (p.status = 'pending') DESC, p.received_at DESC LIMIT 500`, params);

  let awaiting: unknown[] = [];
  if (tab === "refunds") {
    // Bookings in "Refund pending" that have no refund row yet (refund amount still to decide).
    const bp: unknown[] = [];
    const sc = m.limits.ownBookingsOnly ? bookingScope(req, bp) : "true";
    awaiting = await query(`SELECT b.id, b.ref, b.lead_name, b.product_name, b.paid_amount, b.total_amount, b.cancel_reason, b.cancelled_at, b.payment_method
      FROM travel.bookings b WHERE b.status = 'refund' AND ${sc}
       AND NOT EXISTS (SELECT 1 FROM travel.booking_payments p WHERE p.booking_id = b.id AND p.kind = 'refund' AND p.status = 'pending')
      ORDER BY b.cancelled_at DESC NULLS LAST`, bp);
  }
  res.json({ data: { rows, awaiting } });
});

r.post("/transactions/:id/verify", async (req, res) => {
  const { approve, note } = parse(z.object({ approve: z.boolean().default(true), note: z.string().max(500).optional() }), req.body);
  res.json({ data: await verifyPayment(req, String(req.params.id), approve, note) });
});

r.post("/refunds/:id/paid", async (req, res) => {
  const { reference } = parse(z.object({ reference: z.string().max(120).optional() }), req.body);
  res.json({ data: await payRefund(req, String(req.params.id), reference) });
});

/** Creates the refund row for a booking already in "Refund pending" without one. */
r.post("/refunds/booking/:bookingId", async (req, res) => {
  if (!canAny(req, ["payments.refunds", "bookings.refund"], "edit")) throw new HttpError(403, "Your role does not allow refunds");
  const d = parse(z.object({ amount: z.coerce.number().positive("Enter the refund amount"), method: z.enum(["bank", "card", "wallet", "cash"]).default("bank"), note: z.string().max(500).optional() }), req.body);
  const m = me(req);
  const params: unknown[] = [req.params.bookingId];
  const sc = m.limits.ownBookingsOnly ? bookingScope(req, params) : "true";
  const b = (await query<{ id: string; paid_amount: number }>(`SELECT b.id, b.paid_amount FROM travel.bookings b WHERE b.id = $1 AND b.status = 'refund' AND ${sc}`, params))[0];
  if (!b) throw new HttpError(404, "Booking not found in Refund pending");
  if (d.amount > b.paid_amount) throw new HttpError(400, "The refund is more than the guest has paid");
  await query("INSERT INTO travel.booking_payments (booking_id, kind, method, amount, status, note, created_by) VALUES ($1,'refund',$2,$3,'pending',$4,$5)", [b.id, d.method, d.amount, d.note ?? null, m.id]);
  await query("INSERT INTO travel.booking_events (booking_id, kind, message, user_id) VALUES ($1,'payment',$2,$3)", [b.id, `Refund of PKR ${Math.round(d.amount).toLocaleString("en-US")} set up`, m.id]);
  await audit(m.id, "refund.create", "booking", b.id, d);
  res.status(201).json({ data: { ok: true } });
});

/* ---------- checkout rules ---------- */

export const CHECKOUT_DEFAULTS = {
  allow_deposits: true, deposit_pct: 25, deposit_for: ["package", "umrah"] as string[], balance_due_days: 14,
  auto_cancel: true, auto_cancel_hours: 24, whatsapp_receipt: true, email_receipt: true, tax_inclusive: true,
};
const rulesSchema = z.object({
  allow_deposits: z.boolean(), deposit_pct: z.coerce.number().min(1).max(100), deposit_for: z.array(z.enum(PRODUCT_TYPES)),
  balance_due_days: z.coerce.number().int().min(0).max(120), auto_cancel: z.boolean(), auto_cancel_hours: z.coerce.number().int().min(1).max(720),
  whatsapp_receipt: z.boolean(), email_receipt: z.boolean(), tax_inclusive: z.boolean(),
});

r.get("/rules", can("payments.rules"), async (_req, res) => {
  res.json({ data: await getSetting("checkout", CHECKOUT_DEFAULTS) });
});

r.put("/rules", can("payments.rules", "edit"), async (req, res) => {
  const d = parse(rulesSchema, req.body);
  await setSetting("checkout", d, me(req).id);
  await audit(me(req).id, "settings.checkout.update", "settings", "checkout", d);
  res.json({ data: d });
});

export default r;
