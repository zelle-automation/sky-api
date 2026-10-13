// Sends email using the SMTP settings saved in the dashboard (Settings → Email).
// Templates live in travel.email_templates (subject/body with {{variables}}); every send is logged.
import nodemailer, { type Transporter } from "nodemailer";
import { DEFAULT_TEMPLATES, fillVars } from "../../shared/doc-defaults";
import { one, query } from "./db";
import { decrypt } from "./secret";
import { getSetting } from "./settings";

export type SendResult = { sent: boolean; error?: string; messageId?: string };
export type Attachment = { filename: string; content: Buffer | string; contentType?: string };
type Vars = Record<string, string | number | null | undefined>;

export type EmailSettings = {
  provider: string;
  host: string;
  port: number;
  security: "starttls" | "ssl" | "none";
  user: string;
  pass_enc?: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  bcc: string;
};

export const EMAIL_DEFAULTS: EmailSettings = {
  provider: "smtp", host: "", port: 587, security: "starttls", user: "", from_name: "Sky Holidays",
  from_email: "info@skyholidays.pk", reply_to: "", bcc: "",
};

export type NotifyEvent = "new_booking" | "new_enquiry" | "slip_uploaded" | "payment_verified" | "cancellation";
export type NotifySettings = {
  events: Record<NotifyEvent, { email: boolean; whatsapp: boolean }>;
  emails: string[];
  whatsapp: string[];
  daily_summary: boolean;
};
export const NOTIFY_DEFAULTS: NotifySettings = {
  events: {
    new_booking: { email: true, whatsapp: true },
    new_enquiry: { email: true, whatsapp: false },
    slip_uploaded: { email: true, whatsapp: true },
    payment_verified: { email: true, whatsapp: false },
    cancellation: { email: true, whatsapp: true },
  },
  emails: ["info@skyholidays.pk"],
  whatsapp: ["+92 311 11 33 020"],
  daily_summary: false,
};

export const emailSettings = () => getSetting<EmailSettings>("email", EMAIL_DEFAULTS);

/** Builds a nodemailer transport from saved (or draft) settings. Throws a readable error when incomplete. */
export function transportFor(s: EmailSettings, password?: string): Transporter {
  if (!s.host) throw new Error("Email is not set up yet. Add the SMTP server under Settings → Email.");
  let pass = password;
  if (pass === undefined && s.pass_enc) {
    try { pass = decrypt(s.pass_enc); } catch { throw new Error("The saved email password can’t be read. Enter it again under Settings → Email."); }
  }
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 587,
    secure: s.security === "ssl",
    requireTLS: s.security === "starttls",
    ignoreTLS: s.security === "none",
    auth: s.user ? { user: s.user, pass: pass ?? "" } : undefined,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const linkify = (s: string) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2F6CA8">$1</a>');

/** Plain-text body (blank line = new paragraph) to a simple branded HTML email. */
export function textToHtml(text: string, company = "Sky Holidays") {
  const paras = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#F3F5F9;font-family:Segoe UI,Arial,sans-serif;color:#0D1B3A">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
<div style="background:#0A1734;color:#D9B26A;padding:18px 24px;border-radius:12px 12px 0 0;font-family:Georgia,serif;letter-spacing:.28em;font-size:18px">${esc(company.toUpperCase())}</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;font-size:15px;line-height:1.55">${paras}</div>
</div></body></html>`;
}

async function companyVars(): Promise<Vars> {
  const b = await getSetting<{ company_name?: string; phone?: string; email?: string; website?: string }>("business", {});
  return { company_name: b.company_name || "Sky Holidays", company_phone: b.phone || "+92 311 11 33 020", company_email: b.email || "info@skyholidays.pk" };
}

async function log(key: string | null, to: string, subject: string, r: SendResult) {
  await query(
    "INSERT INTO travel.email_log (template_key, to_email, subject, status, error, message_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [key, to, subject.slice(0, 500), r.sent ? "sent" : r.error?.startsWith("Skipped") ? "skipped" : "failed", r.error ?? null, r.messageId ?? null],
  ).catch((e) => console.warn("email log:", e.message));
}

async function deliver(to: string, subject: string, html: string, text: string | undefined, attachments: Attachment[], opts: { bcc?: boolean } = {}): Promise<SendResult> {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { sent: false, error: "No valid email address for this guest" };
  const s = await emailSettings();
  let t: Transporter;
  try { t = transportFor(s); } catch (e) { return { sent: false, error: (e as Error).message }; }
  try {
    const info = await t.sendMail({
      from: { name: s.from_name || "Sky Holidays", address: s.from_email || s.user },
      to,
      replyTo: s.reply_to || undefined,
      bcc: opts.bcc !== false && s.bcc ? s.bcc : undefined,
      subject,
      html,
      text,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    return { sent: true, messageId: info.messageId };
  } catch (e) {
    return { sent: false, error: `The email server said: ${(e as Error).message}` };
  } finally {
    t.close();
  }
}

/** Renders template `key` (e.g. "booking_confirmed") with {{vars}} and sends it to `to`. */
export async function sendTemplate(key: string, to: string, vars: Vars, attachments: Attachment[] = []): Promise<SendResult> {
  const row = await one<{ subject: string; body: string; enabled: boolean }>("SELECT subject, body, enabled FROM travel.email_templates WHERE key = $1", [key]);
  const tpl = row ?? DEFAULT_TEMPLATES.find((t) => t.key === key);
  if (!tpl) return { sent: false, error: `Unknown email template "${key}"` };
  const all = { ...(await companyVars()), ...vars };
  const subject = fillVars(tpl.subject, all).replace(/\s+/g, " ").trim();
  if (row && !row.enabled) {
    const r = { sent: false, error: "Skipped: this email is switched off under Settings → Email" };
    await log(key, to || "-", subject, r);
    return r;
  }
  const text = fillVars(tpl.body, all);
  const r = await deliver(to, subject, textToHtml(text, String(all.company_name)), text, attachments);
  await log(key, to || "-", subject, r);
  return r;
}

/** Sends a free-form email (enquiry replies). */
export async function sendRaw(to: string, subject: string, html: string, attachments: Attachment[] = []): Promise<SendResult> {
  const r = await deliver(to, subject, html, undefined, attachments);
  await log(null, to || "-", subject, r);
  return r;
}

/**
 * Tells the team about an event when it is switched on under Settings → Notifications.
 * Email goes to the saved staff addresses; WhatsApp numbers are returned for a future WhatsApp sender.
 */
export async function notifyStaff(event: NotifyEvent, message: string, link?: string): Promise<{ emailed: number; whatsapp: string[] }> {
  const n = await getSetting<NotifySettings>("notifications", NOTIFY_DEFAULTS);
  const ev = n.events?.[event] ?? NOTIFY_DEFAULTS.events[event];
  let emailed = 0;
  if (ev.email) {
    for (const to of n.emails ?? []) {
      const r = await sendTemplate("staff_alert", to, { message, link: link ?? "" });
      if (r.sent) emailed++;
    }
  }
  return { emailed, whatsapp: ev.whatsapp ? n.whatsapp ?? [] : [] };
}
