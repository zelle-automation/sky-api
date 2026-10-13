// Encrypts secrets kept in the settings table (SMTP password, gateway keys) with APP_SECRET.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("APP_SECRET is not set; it is needed to store passwords and API keys");
  return createHash("sha256").update(s).digest();
}

export function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decrypt(stored) {
  const [v, iv, tag, body] = stored.split(":");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
