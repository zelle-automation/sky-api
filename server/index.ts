// Sky Holidays API (Express). Serves the public catalogue to the website, the staff
// dashboard under /api/admin, and uploaded files under /uploads.
import express from "express";
import cookieParser from "cookie-parser";
import { errorHandler, HttpError } from "./lib/http";
import { pool } from "./lib/db";
import { UPLOAD_DIR } from "./lib/uploads";
import publicRoutes from "./routes/public";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import { publicDocs } from "./routes/admin/documents";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/docs", publicDocs); // emailed document links (secret token, no sign-in)
app.use("/api", publicRoutes);
app.use("/uploads", express.static(UPLOAD_DIR, {
  maxAge: "30d",
  immutable: true,
  setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
}));
app.use("/api", () => {
  throw new HttpError(404, "Unknown API route");
});
app.use(errorHandler);

const port = Number(process.env.API_PORT || 4000);
app.listen(port, () => console.log(`Sky Holidays API on http://localhost:${port}`));
