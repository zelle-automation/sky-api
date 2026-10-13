# Sky Holidays API

The Node.js backend (Express 5, TypeScript run by tsx) behind the Sky Holidays website and
dashboard. It owns the Postgres database (schema `travel`), Redis sessions and cache, uploaded
files and email.

## Run it

```bash
cp .env.example .env     # DATABASE_URL, APP_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d     # Postgres 16 on :5432, Redis 7 on :6379
npm install
npm run db:setup         # tables, countries and catalogue, staff roles, the Owner account
npm run db:seed-demo     # optional demo bookings, enquiries, Umrah, transfers, staff and templates
npm run dev              # http://localhost:4000 (restarts on changes)
```

Production: `npm start` under pm2 or systemd, behind the website and dashboard (they forward
`/api` and `/uploads` here). Back up the database and `UPLOAD_DIR`, and keep `APP_SECRET` stable:
it decrypts the saved SMTP password and payment gateway keys.

## Layout

- `server/index.ts`: app setup. Routes: `/api/health`, `/api/auth` (staff sign-in),
  `/api/admin/<section>` (dashboard, needs a staff session), `/api/docs/:token` (emailed
  documents), `/api` (public website data and forms), `/uploads` (files).
- `server/routes/admin/`: one router per dashboard section. Every route checks the role's
  permission for that sub-tab.
- `server/lib/`: database, Redis, auth, uploads, settings, audit log, mailer.
- `db/migrations/`: SQL, applied in order by `npm run db:migrate`.
- `shared/`: code also used by the web apps. `admin-nav.ts` defines the permission keys and
  **must match the dashboard's copy**.
