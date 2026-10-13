// Settings: business details, email sending (SMTP + templates + DNS checks), staff
// notifications and the status of outside connections.
import { resolveNs, resolveTxt } from "node:dns/promises";
import { Router } from "express";
import { z } from "zod";
import { assertCan, me } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { clearCatalogCache } from "../../lib/cache.js";
import { one, pool, query } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";
import { emailSettings, NOTIFY_DEFAULTS, textToHtml, transportFor } from "../../lib/mailer.js";
import { redis } from "../../lib/redis.js";
import { encrypt } from "../../lib/secret.js";
import { getSetting, setSetting } from "../../lib/settings.js";
import { DEFAULT_TEMPLATES, fillVars } from "../../../shared/doc-defaults.js";

const r = Router();

/* ---------- business ---------- */

export const BUSINESS_DEFAULTS = {
  company_name: "Sky Holidays",
  legal_name: "Sky Holidays (Pvt) Ltd",
  slogan: "Experience the Exceptional",
  phone: "+92 311 11 33 020",
  whatsapp: "+92 311 11 33 020",
  email: "info@skyholidays.pk",
  website: "skyholidays.pk",
  address: "",
  dts_licence: "",
  iata_number: "",
  ntn: "",
  currency: "PKR",
  timezone: "Asia/Karachi",
  website_theme: "system",
  social: { facebook: "", instagram: "", youtube: "", tiktok: "", linkedin: "", x: "" },
};

const str = (max = 300) => z.string().trim().max(max);
const BusinessBody = z.object({
  company_name: str(120).min(1, "Company name is required"),
  legal_name: str(160),
  slogan: str(160),
  phone: str(40),
  whatsapp: str(40),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  website: str(160),
  address: str(400),
  dts_licence: str(60),
  iata_number: str(60),
  ntn: str(60),
  currency: z.enum(["PKR", "AED", "SAR", "USD", "GBP", "EUR"]),
  timezone: str(60),
  website_theme: z.enum(["system", "light", "dark"]),
  social: z.object({ facebook: str(), instagram: str(), youtube: str(), tiktok: str(), linkedin: str(), x: str() }).partial(),
});

r.get("/business", async (req, res) => {
  assertCan(req, "settings.business");
  const b = await getSetting("business", BUSINESS_DEFAULTS);
  res.json({ data: { ...b, social: { ...BUSINESS_DEFAULTS.social, ...b.social } } });
});

r.put("/business", async (req, res) => {
  assertCan(req, "settings.business", "edit");
  const b = parse(BusinessBody, req.body);
  const value = { ...b, social: { ...BUSINESS_DEFAULTS.social, ...b.social } };
  await setSetting("business", value, me(req).id);
  await clearCatalogCache();
  await audit(me(req).id, "settings.business", "settings", "business");
  res.json({ data: value });
});

/* ---------- email: server ---------- */

const publicEmail = (s) => {
  const { pass_enc, ...rest } = s;
  return { ...rest, password_set: !!pass_enc };
};

const EmailBody = z.object({
  provider: z.enum(["smtp", "google", "microsoft", "ses", "brevo", "mailgun"]),
  host: str(200),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(["starttls", "ssl", "none"]),
  user: str(200),
  password: z.string().max(500).optional(),
  clear_password: z.boolean().optional(),
  from_name: str(120),
  from_email: z.union([z.literal(""), z.email("Enter a valid From email")]),
  reply_to: z.union([z.literal(""), z.email("Enter a valid Reply-to email")]),
  bcc: z.union([z.literal(""), z.email("Enter a valid copy address")]),
});

function merge(saved, b) {
  const { password, clear_password, ...rest } = b;
  const next = { ...saved, ...rest };
  if (clear_password) delete next.pass_enc;
  else if (password) next.pass_enc = encrypt(password);
  return next;
}

r.get("/email", async (req, res) => {
  assertCan(req, "settings.email");
  res.json({ data: publicEmail(await emailSettings()) });
});

r.put("/email", async (req, res) => {
  assertCan(req, "settings.email", "edit");
  const b = parse(EmailBody, req.body);
  const next = merge(await emailSettings(), b);
  await setSetting("email", next, me(req).id);
  await audit(me(req).id, "settings.email", "settings", "email", {
    host: next.host,
    user: next.user,
    password_changed: !!b.password,
  });
  res.json({ data: publicEmail(next) });
});

/** Sends a real test email with the saved settings, or with the unsaved form when `draft` is given. */
r.post("/email/test", async (req, res) => {
  assertCan(req, "settings.email", "edit");
  const b = parse(z.object({ to: z.email("Enter the address to send the test to"), draft: EmailBody.optional() }), req.body);
  const saved = await emailSettings();
  const s = b.draft ? merge(saved, b.draft) : saved;
  let t;
  try {
    t = transportFor(s, b.draft?.password || undefined);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  try {
    const info = await t.sendMail({
      from: { name: s.from_name || "Sky Holidays", address: s.from_email || s.user },
      to: b.to,
      replyTo: s.reply_to || undefined,
      subject: "Test email from the Sky Holidays dashboard",
      html: textToHtml(
        `This is a test email sent by ${me(req).name} from Settings → Email.\n\nIf you can read this, email sending works.`,
      ),
    });
    await query(
      "INSERT INTO travel.email_log (template_key, to_email, subject, status, message_id) VALUES ('test',$1,'Test email','sent',$2)",
      [b.to, info.messageId],
    );
    res.json({ data: { sent: true, messageId: info.messageId, response: info.response } });
  } catch (e) {
    await query(
      "INSERT INTO travel.email_log (template_key, to_email, subject, status, error) VALUES ('test',$1,'Test email','failed',$2)",
      [b.to, e.message],
    );
    throw new HttpError(502, `The email server said: ${e.message}`);
  } finally {
    t.close();
  }
});

async function txt(name) {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(""));
  } catch (e) {
    const code = e.code;
    if (code === "ENOTFOUND" || code === "ENODATA") return [];
    throw e;
  }
}
const DKIM_SELECTORS = [
  "google",
  "selector1",
  "selector2",
  "default",
  "mail",
  "dkim",
  "k1",
  "s1",
  "s2",
  "smtp",
  "brevo",
  "mailo",
  "mg",
  "pic",
  "email",
  "sky",
];

r.get("/email/dns", async (req, res) => {
  assertCan(req, "settings.email");
  const s = await emailSettings();
  const domain = String(req.query.domain || s.from_email.split("@")[1] || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    throw new HttpError(400, "Add a From email first so we know which domain to check");
  const checks = [];
  try {
    await resolveNs(domain);
  } catch (e) {
    const error = `Could not look up ${domain}: the domain has no DNS servers or the server can’t reach DNS right now (${e.code ?? e.message}).`;
    res.json({ data: { domain, checks: [], error } });
    return;
  }
  try {
    const spf = (await txt(domain)).find((t) => t.toLowerCase().startsWith("v=spf1"));
    checks.push(
      spf
        ? { name: "SPF record", status: "ok", detail: "Found", record: spf }
        : {
            name: "SPF record",
            status: "bad",
            detail: `Not found. Add a TXT record on ${domain} starting with v=spf1 that includes your email provider.`,
          },
    );
    let dkim = null;
    const sel = String(req.query.selector || "").trim();
    for (const s2 of sel ? [sel, ...DKIM_SELECTORS] : DKIM_SELECTORS) {
      const recs = await txt(`${s2}._domainkey.${domain}`).catch(() => []);
      const hit = recs.find((t) => /v=DKIM1|p=/i.test(t));
      if (hit) {
        dkim = { sel: s2, rec: hit };
        break;
      }
    }
    checks.push(
      dkim
        ? {
            name: "DKIM signature",
            status: "ok",
            detail: `Found (selector “${dkim.sel}”)`,
            record: dkim.rec.slice(0, 120) + (dkim.rec.length > 120 ? "…" : ""),
          }
        : {
            name: "DKIM signature",
            status: "warn",
            detail:
              "Not found on common selectors. Your provider gives you the DKIM record to add; enter its selector to check it.",
          },
    );
    const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => t.toUpperCase().startsWith("V=DMARC1"));
    checks.push(
      dmarc
        ? { name: "DMARC policy", status: "ok", detail: "Found", record: dmarc }
        : {
            name: "DMARC policy",
            status: "warn",
            detail: `Not set. Add a TXT record on _dmarc.${domain}, for example: v=DMARC1; p=none; rua=mailto:${s.from_email || "info@" + domain}`,
          },
    );
  } catch (e) {
    throw new HttpError(502, `Could not look up DNS for ${domain}: ${e.message}`);
  }
  res.json({ data: { domain, checks } });
});

/* ---------- email: templates ---------- */

r.get("/email/templates", async (req, res) => {
  assertCan(req, "settings.email");
  const rows = await query(
    `SELECT t.key, t.name, t.trigger_label, t.attachments, t.subject, t.body, t.enabled, t.position, t.updated_at,
            (SELECT count(*) FROM travel.email_log l WHERE l.template_key = t.key AND l.status = 'sent' AND l.created_at > now() - interval '30 days')::int AS sent_30d
       FROM travel.email_templates t ORDER BY t.position, t.name`,
  );
  res.json({ data: rows });
});

r.put("/email/templates/:key", async (req, res) => {
  assertCan(req, "settings.email", "edit");
  const b = parse(
    z.object({
      subject: str(300).min(1, "Subject is required").optional(),
      body: z.string().max(20000).optional(),
      enabled: z.boolean().optional(),
    }),
    req.body,
  );
  const row = await one(
    `UPDATE travel.email_templates SET subject = COALESCE($2, subject), body = COALESCE($3, body), enabled = COALESCE($4, enabled),
            updated_by = $5, updated_at = now() WHERE key = $1 RETURNING *`,
    [req.params.key, b.subject ?? null, b.body ?? null, b.enabled ?? null, me(req).id],
  );
  if (!row) throw notFound("Template not found");
  await audit(me(req).id, "email_template.update", "email_template", String(req.params.key), { enabled: b.enabled });
  res.json({ data: row });
});

r.post("/email/templates/:key/reset", async (req, res) => {
  assertCan(req, "settings.email", "edit");
  const d = DEFAULT_TEMPLATES.find((t) => t.key === req.params.key);
  if (!d) throw notFound("No default for this template");
  const row = await one(
    "UPDATE travel.email_templates SET subject = $2, body = $3, updated_by = $4, updated_at = now() WHERE key = $1 RETURNING *",
    [d.key, d.subject, d.body, me(req).id],
  );
  if (!row) throw notFound("Template not found");
  res.json({ data: row });
});

/** Renders a template with sample values (for the preview pane). */
r.post("/email/templates/:key/preview", async (req, res) => {
  assertCan(req, "settings.email");
  const b = parse(z.object({ subject: z.string().max(300), body: z.string().max(20000) }), req.body);
  const biz = await getSetting("business", BUSINESS_DEFAULTS);
  const vars = {
    guest_name: "Ayesha Khan",
    booking_ref: "SKY-26-04821",
    product_name: "Swissôtel Makkah, 6 nights",
    start_date: "14 Nov 2026",
    end_date: "20 Nov 2026",
    total: "PKR 486,000",
    paid: "PKR 200,000",
    balance: "PKR 286,000",
    amount: "PKR 200,000",
    link: "https://skyholidays.pk/d/sample",
    payment_link: "https://skyholidays.pk/pay/SKY-26-04821",
    reason: "Guest asked to cancel",
    quote_no: "QUO-26-00412",
    valid_until: "20 Oct 2026",
    message: "Thank you for your message. Here are the options we discussed.",
    company_name: biz.company_name,
    company_phone: biz.phone,
    company_email: biz.email,
  };
  res.json({ data: { subject: fillVars(b.subject, vars), html: textToHtml(fillVars(b.body, vars), biz.company_name) } });
});

r.get("/email/log", async (req, res) => {
  assertCan(req, "settings.email");
  res.json({
    data: await query(
      "SELECT id, template_key, to_email, subject, status, error, created_at FROM travel.email_log ORDER BY created_at DESC LIMIT 50",
    ),
  });
});

/* ---------- notifications ---------- */

const ev = z.object({ email: z.boolean(), whatsapp: z.boolean() });
r.get("/notifications", async (req, res) => {
  assertCan(req, "settings.notifications");
  const n = await getSetting("notifications", NOTIFY_DEFAULTS);
  res.json({ data: { ...n, events: { ...NOTIFY_DEFAULTS.events, ...n.events } } });
});
r.put("/notifications", async (req, res) => {
  assertCan(req, "settings.notifications", "edit");
  const b = parse(
    z.object({
      events: z.object({ new_booking: ev, new_enquiry: ev, slip_uploaded: ev, payment_verified: ev, cancellation: ev }),
      emails: z.array(z.email("Each recipient must be an email address")).max(20),
      whatsapp: z
        .array(
          z
            .string()
            .trim()
            .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter WhatsApp numbers like +92 300 1234567"),
        )
        .max(20),
      daily_summary: z.boolean(),
    }),
    req.body,
  );
  await setSetting("notifications", b, me(req).id);
  await audit(me(req).id, "settings.notifications", "settings", "notifications");
  res.json({ data: b });
});

/* ---------- connections ---------- */

const timed = async (fn, ms = 8000) =>
  Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("Timed out")), ms))]);

r.get("/connections", async (req, res) => {
  assertCan(req, "settings.connections");
  const out = [];
  let t0 = Date.now();
  try {
    const v = await one(
      "SELECT current_setting('server_version') AS v, pg_size_pretty(pg_database_size(current_database())) AS size",
    );
    out.push({
      key: "postgres",
      name: "Database (PostgreSQL)",
      status: "ok",
      detail: `Version ${v?.v} · ${v?.size} · ${pool.totalCount} connections open`,
      ms: Date.now() - t0,
    });
  } catch (e) {
    out.push({ key: "postgres", name: "Database (PostgreSQL)", status: "bad", detail: e.message });
  }
  const rd = redis();
  t0 = Date.now();
  if (!rd)
    out.push({
      key: "redis",
      name: "Cache (Redis)",
      status: "off",
      detail: "Not configured. Sessions and settings use the database instead.",
    });
  else {
    try {
      const pong = await timed(() => rd.ping(), 3000);
      out.push({
        key: "redis",
        name: "Cache (Redis)",
        status: pong === "PONG" ? "ok" : "warn",
        detail: pong === "PONG" ? "Connected" : String(pong),
        ms: Date.now() - t0,
      });
    } catch (e) {
      out.push({ key: "redis", name: "Cache (Redis)", status: "bad", detail: e.message });
    }
  }
  const es = await emailSettings();
  t0 = Date.now();
  if (!es.host)
    out.push({
      key: "email",
      name: "Email sending",
      status: "off",
      detail: "Not set up. Add your SMTP server under Settings → Email.",
    });
  else {
    try {
      const tr = transportFor(es);
      await timed(() => tr.verify(), 12000);
      tr.close();
      out.push({
        key: "email",
        name: "Email sending",
        status: "ok",
        detail: `Signed in to ${es.host}:${es.port}`,
        ms: Date.now() - t0,
      });
    } catch (e) {
      out.push({ key: "email", name: "Email sending", status: "bad", detail: `${es.host}: ${e.message}` });
    }
  }
  const card = await one("SELECT enabled, config, secrets FROM travel.payment_methods WHERE key = 'card'").catch(() => null);
  if (!card) out.push({ key: "gateway", name: "Card payment gateway", status: "off", detail: "Not set up" });
  else {
    const hasKeys = Object.values(card.secrets ?? {}).some(Boolean) && !!card.config?.merchant_id;
    out.push({
      key: "gateway",
      name: `Card payments${card.config?.gateway ? ` (${card.config.gateway})` : ""}`,
      status: !card.enabled ? "off" : hasKeys ? "ok" : "warn",
      detail: !card.enabled
        ? "Switched off under Payments → Payment methods"
        : hasKeys
          ? `Merchant ${card.config.merchant_id} · ${card.config.mode === "live" ? "live" : "test"} mode`
          : "Switched on but the merchant ID or keys are missing",
    });
  }
  const tok = process.env.DUFFEL_ACCESS_TOKEN;
  t0 = Date.now();
  if (!tok)
    out.push({
      key: "flights",
      name: "Flight search (Duffel)",
      status: "off",
      detail: "No API key. Set DUFFEL_ACCESS_TOKEN on the server to show live fares.",
    });
  else {
    try {
      const resp = await timed(
        () =>
          fetch("https://api.duffel.com/air/airlines?limit=1", {
            headers: { Authorization: `Bearer ${tok}`, "Duffel-Version": "v2", Accept: "application/json" },
          }),
        8000,
      );
      out.push({
        key: "flights",
        name: "Flight search (Duffel)",
        status: resp.ok ? "ok" : "bad",
        detail: resp.ok ? "API key works" : `Duffel answered ${resp.status}`,
        ms: Date.now() - t0,
      });
    } catch (e) {
      out.push({ key: "flights", name: "Flight search (Duffel)", status: "bad", detail: e.message });
    }
  }
  out.push(
    process.env.OPENTRIPMAP_API_KEY
      ? { key: "otm", name: "Excursion ideas (OpenTripMap)", status: "ok", detail: "API key set" }
      : { key: "otm", name: "Excursion ideas (OpenTripMap)", status: "off", detail: "No API key (OPENTRIPMAP_API_KEY)" },
  );
  res.json({ data: out });
});

export default r;
