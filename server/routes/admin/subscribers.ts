// Newsletter subscribers (sign-ups from the website): list with search, CSV export, delete.
import { Router } from "express";
import { z } from "zod";
import { assertCan, me } from "../../lib/auth";
import { audit } from "../../lib/audit";
import { one, query } from "../../lib/db";
import { HttpError, notFound, parse } from "../../lib/http";

const r = Router();

const q = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

r.get("/", async (req, res) => {
  assertCan(req, "subscribers.main");
  const term = q(req.query.q);
  const status = req.query.status === "subscribed" || req.query.status === "unsubscribed" ? req.query.status : null;
  const [rows, stats] = await Promise.all([
    query(
      `SELECT email, source, created_at, unsubscribed_at FROM travel.newsletter_subscribers
        WHERE ($1::text IS NULL OR email ILIKE '%' || $1 || '%' OR source ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR ($2 = 'subscribed') = (unsubscribed_at IS NULL))
        ORDER BY created_at DESC LIMIT 1000`,
      [term, status],
    ),
    one(
      `SELECT count(*) FILTER (WHERE unsubscribed_at IS NULL)::int AS active,
              count(*) FILTER (WHERE unsubscribed_at IS NULL AND created_at >= date_trunc('month', now()))::int AS this_month,
              count(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed,
              count(*)::int AS total
         FROM travel.newsletter_subscribers`,
    ),
  ]);
  res.json({ data: { rows, stats } });
});

const csvCell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // stop spreadsheet formulas
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

r.get("/export.csv", async (req, res) => {
  assertCan(req, "subscribers.main");
  if (!me(req).limits.canExport) throw new HttpError(403, "Your role can’t export data");
  const rows = await query<{ email: string; source: string; created_at: Date; unsubscribed_at: Date | null }>(
    "SELECT email, source, created_at, unsubscribed_at FROM travel.newsletter_subscribers ORDER BY created_at DESC",
  );
  const lines = [["email", "signed_up_from", "signed_up_at", "status"].join(",")].concat(
    rows.map((x) => [x.email, x.source, x.created_at, x.unsubscribed_at ? "unsubscribed" : "subscribed"].map(csvCell).join(",")),
  );
  await audit(me(req).id, "subscribers.export", "newsletter_subscribers", undefined, { rows: rows.length });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + lines.join("\n"));
});

r.patch("/:email", async (req, res) => {
  assertCan(req, "subscribers.main", "edit");
  const b = parse(z.object({ subscribed: z.boolean() }), req.body);
  const row = await one(
    `UPDATE travel.newsletter_subscribers SET unsubscribed_at = CASE WHEN $2 THEN NULL ELSE COALESCE(unsubscribed_at, now()) END
      WHERE email = lower($1) RETURNING email, source, created_at, unsubscribed_at`,
    [req.params.email, b.subscribed],
  );
  if (!row) throw notFound("Subscriber not found");
  await audit(me(req).id, b.subscribed ? "subscriber.resubscribe" : "subscriber.unsubscribe", "newsletter_subscriber", String(req.params.email));
  res.json({ data: row });
});

r.delete("/:email", async (req, res) => {
  assertCan(req, "subscribers.main", "delete");
  const row = await one("DELETE FROM travel.newsletter_subscribers WHERE email = lower($1) RETURNING email", [req.params.email]);
  if (!row) throw notFound("Subscriber not found");
  await audit(me(req).id, "subscriber.delete", "newsletter_subscriber", String(req.params.email));
  res.json({ ok: true });
});

export default r;
