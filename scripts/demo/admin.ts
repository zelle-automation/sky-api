// Demo data for the admin area: email templates, business/branding/email/notification settings,
// one staff user per non-owner role (shared test password) and a dozen newsletter subscribers.
// Idempotent: templates and users are upserted, settings keep anything already saved.
import type { Client } from "pg";
import { hashPassword } from "../../server/lib/auth";
import { DEFAULT_BRANDING, DEFAULT_TEMPLATES, DEFAULT_TEXTS } from "../../shared/doc-defaults";

export const STAFF_TEST_PASSWORD = "SkyStaff-2026!";

const BUSINESS = {
  company_name: "Sky Holidays", legal_name: "Sky Holidays (Pvt) Ltd", slogan: "Experience the Exceptional",
  phone: "+92 311 11 33 020", whatsapp: "+92 311 11 33 020", email: "info@skyholidays.pk", website: "skyholidays.pk",
  address: "Office 12, Business Avenue, Shahrah-e-Faisal, Karachi", dts_licence: "", iata_number: "", ntn: "",
  currency: "PKR", timezone: "Asia/Karachi", website_theme: "system",
  social: { facebook: "https://facebook.com/skyholidays.pk", instagram: "https://instagram.com/skyholidays.pk", youtube: "", tiktok: "", linkedin: "", x: "" },
};

const STAFF: [string, string, string, string][] = [
  ["Hina Shah", "hina@skyholidays.pk", "+92 300 1122 334", "Content editor"],
  ["Imran Ali", "imran@skyholidays.pk", "+92 321 4455 667", "Umrah desk"],
  ["Faisal Mirza", "faisal@skyholidays.pk", "+92 333 7788 990", "Umrah desk"],
  ["Kashif Noor", "kashif@skyholidays.pk", "+92 345 2211 008", "Accounts"],
  ["Sara Ahmed", "sara@skyholidays.pk", "+92 302 6677 115", "Cancellations desk"],
];

const SUBS: [string, string, number, boolean][] = [
  ["ayesha.k@gmail.com", "Website footer", 1, true],
  ["bilal.ahmed@outlook.com", "Checkout", 2, true],
  ["sana.javed@yahoo.com", "Website footer", 4, true],
  ["umar.rashid@gmail.com", "Umrah page", 5, true],
  ["hira.malik@hotmail.com", "Checkout", 11, false],
  ["zainab.hussain@gmail.com", "Website footer", 13, true],
  ["omer.farooq@gmail.com", "Packages page", 17, true],
  ["mehwish.ali@outlook.com", "Website footer", 22, true],
  ["hamza.siddiqui@gmail.com", "Checkout", 26, true],
  ["nadia.pervez@gmail.com", "Visa page", 33, true],
  ["tahir.mehmood@yahoo.com", "Website footer", 41, false],
  ["saima.butt@gmail.com", "Umrah page", 52, true],
];

/** Inserts the setting, or adds missing keys to one that exists (saved values win). */
const mergeSetting = (c: Client, key: string, value: object) =>
  c.query(
    `INSERT INTO travel.settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value || travel.settings.value`,
    [key, JSON.stringify(value)],
  );

export async function run(c: Client) {
  for (const [i, t] of DEFAULT_TEMPLATES.entries()) {
    await c.query(
      `INSERT INTO travel.email_templates (key, name, trigger_label, attachments, subject, body, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, trigger_label = EXCLUDED.trigger_label, attachments = EXCLUDED.attachments, position = EXCLUDED.position`,
      [t.key, t.name, t.trigger_label, t.attachments, t.subject, t.body, i],
    );
  }

  await mergeSetting(c, "business", BUSINESS);
  await mergeSetting(c, "branding", DEFAULT_BRANDING);
  await mergeSetting(c, "doc_texts", DEFAULT_TEXTS);
  await mergeSetting(c, "email", {
    provider: "smtp", host: "", port: 587, security: "starttls", user: "", from_name: "Sky Holidays",
    from_email: "info@skyholidays.pk", reply_to: "bookings@skyholidays.pk", bcc: "",
  });
  await mergeSetting(c, "notifications", {
    events: {
      new_booking: { email: true, whatsapp: true }, new_enquiry: { email: true, whatsapp: false }, slip_uploaded: { email: true, whatsapp: true },
      payment_verified: { email: true, whatsapp: false }, cancellation: { email: true, whatsapp: true },
    },
    emails: ["info@skyholidays.pk"], whatsapp: ["+92 311 11 33 020"], daily_summary: false,
  });

  const hash = await hashPassword(STAFF_TEST_PASSWORD);
  let added = 0;
  for (const [name, email, phone, role] of STAFF) {
    const r = await c.query(
      `INSERT INTO travel.admin_users (email, name, phone, role_id, password_hash)
       SELECT $1, $2, $3, id, $5 FROM travel.admin_roles WHERE name = $4
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, role_id = EXCLUDED.role_id, password_hash = EXCLUDED.password_hash, is_active = true`,
      [email, name, phone, role, hash],
    );
    added += r.rowCount ?? 0;
  }

  for (const [email, source, daysAgo, on] of SUBS) {
    await c.query(
      `INSERT INTO travel.newsletter_subscribers (email, source, created_at, unsubscribed_at)
       VALUES ($1, $2, now() - make_interval(days => $3), CASE WHEN $4 THEN NULL ELSE now() - make_interval(days => $3 / 2) END)
       ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source`,
      [email, source, daysAgo, on],
    );
  }

  console.log(`  admin: ${DEFAULT_TEMPLATES.length} email templates, ${added} staff users (password: ${STAFF_TEST_PASSWORD}), ${SUBS.length} subscribers`);
  for (const [name, email, , role] of STAFF) console.log(`    ${role.padEnd(19)} ${name.padEnd(13)} ${email}`);
}
