// Media library: uploads land on disk under UPLOAD_DIR and are served at /uploads/<file>.
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { assertCan, me } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
import { one, query } from "../../lib/db.js";
import { HttpError, notFound, parse } from "../../lib/http.js";
import { imageSize, upload, UPLOAD_DIR } from "../../lib/uploads.js";

const r = Router();
const FOLDERS = [
  "general",
  "hotels",
  "excursions",
  "destinations",
  "packages",
  "branding",
  "slips",
  "transfers",
  "cars",
  "umrah",
];

// Any signed-in staff member can upload; editors need photos and logos while editing their own sections.
r.post("/", upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f) throw new HttpError(400, "Choose a file to upload");
  const folder = FOLDERS.includes(req.body?.folder) ? req.body.folder : "general";
  let size = null;
  try {
    size = f.mimetype.startsWith("image/") ? imageSize(readFileSync(f.path)) : null;
  } catch {
    size = null;
  }
  const row = await one(
    `INSERT INTO travel.media (url, file_name, mime_type, size_bytes, width, height, folder, alt_text, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, url, file_name, mime_type, size_bytes, width, height, folder, alt_text, created_at`,
    [
      `/uploads/${f.filename}`,
      f.originalname.slice(0, 200),
      f.mimetype,
      f.size,
      size?.width ?? null,
      size?.height ?? null,
      folder,
      req.body?.alt || null,
      me(req).id,
    ],
  );
  res.status(201).json({ data: row });
});

r.get("/", async (req, res) => {
  const folder = typeof req.query.folder === "string" && req.query.folder !== "all" ? req.query.folder : null;
  assertCan(req, `media.${folder && ["hotels", "excursions", "destinations", "branding"].includes(folder) ? folder : "all"}`);
  const rows = await query(
    `SELECT m.id, m.url, m.file_name, m.mime_type, m.size_bytes, m.width, m.height, m.folder, m.alt_text, m.created_at, u.name AS uploaded_by
       FROM travel.media m LEFT JOIN travel.admin_users u ON u.id = m.uploaded_by
      WHERE ($1::text IS NULL OR m.folder = $1) AND m.folder <> 'slips'
      ORDER BY m.created_at DESC LIMIT 500`,
    [folder],
  );
  res.json({ data: rows });
});

/** Day/evening photo pairs on catalogue records, so the library shows what is missing. */
r.get("/pairs", async (req, res) => {
  const type = req.query.type;
  const SQL = {
    hotels: ["SELECT id, name, image_day_url, image_night_url FROM travel.hotels ORDER BY name", "/admin/hotels/edit/"],
    excursions: [
      "SELECT id, title AS name, image_day_url, image_night_url FROM travel.excursions ORDER BY title",
      "/admin/excursions/edit/",
    ],
    destinations: [
      "SELECT id, name, image_day_url, image_night_url FROM travel.destinations ORDER BY sort_order, name",
      "/admin/destinations?open=",
    ],
  };
  if (typeof type !== "string" || !SQL[type]) throw new HttpError(400, "type must be hotels, excursions or destinations");
  assertCan(req, `media.${type}`);
  const rows = await query(SQL[type][0]);
  res.json({ data: rows.map((x) => ({ ...x, href: SQL[type][1] + x.id })) });
});

r.patch("/:id", async (req, res) => {
  assertCan(req, "media.all", "edit");
  const b = parse(
    z.object({ alt_text: z.string().max(300).nullable().optional(), folder: z.enum(FOLDERS).optional() }),
    req.body,
  );
  const row = await one(
    "UPDATE travel.media SET alt_text = COALESCE($2, alt_text), folder = COALESCE($3, folder) WHERE id = $1 RETURNING *",
    [req.params.id, b.alt_text ?? null, b.folder ?? null],
  );
  if (!row) throw notFound("Photo not found");
  res.json({ data: row });
});

r.delete("/:id", async (req, res) => {
  assertCan(req, "media.all", "delete");
  const row = await one("DELETE FROM travel.media WHERE id = $1 RETURNING url", [req.params.id]);
  if (!row) throw notFound("Photo not found");
  try {
    unlinkSync(path.join(UPLOAD_DIR, path.basename(row.url)));
  } catch {
    /* already gone */
  }
  await audit(me(req).id, "media.delete", "media", req.params.id, { url: row.url });
  res.json({ ok: true });
});

export default r;
