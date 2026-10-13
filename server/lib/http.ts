import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/** Throw from a handler to answer with this status and message. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);

/** Parses `data` with a zod schema or throws a 400 naming the first problem. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new HttpError(400, i ? `${i.path.join(".") || "input"}: ${i.message}` : "Please check the form", r.error.issues);
  }
  return r.data;
}

export const ipOf = (req: Request) =>
  (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() || req.socket.remoteAddress || null;

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const pg = err as { code?: string; detail?: string; constraint?: string };
  if (pg.code === "23505") {
    res.status(409).json({ error: "That already exists", details: pg.detail });
    return;
  }
  if (pg.code === "23503") {
    res.status(409).json({ error: "This is still linked to other records", details: pg.detail });
    return;
  }
  if (pg.code === "22P02") {
    res.status(400).json({ error: "Invalid id or value" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
}
