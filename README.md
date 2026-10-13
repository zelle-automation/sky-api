# Sky Holidays API

The backend for the Sky Holidays website and staff dashboard. It is plain JavaScript on Node.js
(Express 5, ES modules): no TypeScript, no build step and no Docker. It owns the Postgres database
(schema `travel`), Redis sessions and cache, uploaded files and email.

## What you need

- **Node.js 22.9 or newer** (`node -v`)
- **PostgreSQL 14 or newer**
- **Redis 6 or newer** (optional; without it sessions and cache live in Postgres)

## Install Postgres and Redis

Ubuntu or Debian server:

```bash
sudo apt update
sudo apt install -y postgresql redis-server
sudo systemctl enable --now postgresql redis-server
```

macOS (Homebrew):

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

Windows: install PostgreSQL from postgresql.org/download/windows. For Redis, use Memurai
(a Redis-compatible Windows service) or leave `REDIS_URL` empty.

Then create the database and its user (change the password):

```bash
sudo -u postgres psql -c "CREATE USER sky WITH PASSWORD 'change-me';"
sudo -u postgres psql -c "CREATE DATABASE sky_holidays OWNER sky;"
```

On macOS run `psql postgres` instead of `sudo -u postgres psql`.

## Run it

```bash
cp .env.example .env     # set DATABASE_URL, APP_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run db:setup         # tables, countries and catalogue, staff roles, the Owner account
npm run db:seed-demo     # optional demo bookings, enquiries, Umrah, transfers, staff and templates
npm run dev              # http://localhost:4000, restarts when a file changes
```

`DATABASE_URL` looks like `postgres://sky:change-me@localhost:5432/sky_holidays`.
`APP_SECRET` should be a long random string, e.g. the output of
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and restarts it when a file changes |
| `npm start` | Starts the API (production) |
| `npm run db:migrate` | Applies new files in `db/migrations` |
| `npm run db:setup` | Migrate, seed the catalogue, create roles and the Owner account |
| `npm run db:seed-demo` | Adds demo data (safe to run again) |
| `npm run check` | Syntax-checks every file |

## Production

Run `npm start` under a process manager so it restarts on reboot or crash, for example pm2:

```bash
npm install -g pm2
pm2 start npm --name sky-api -- start
pm2 save && pm2 startup
```

Put the website and dashboard in front of it (they forward `/api` and `/uploads` here), serve
them over HTTPS, and set `NODE_ENV=production` so the sign-in cookie is secure-only. Back up the
database and the `UPLOAD_DIR` folder, and keep `APP_SECRET` the same: it decrypts the saved SMTP
password and payment gateway keys.

## Layout

- `server/index.js`: app setup. Routes: `/api/health`, `/api/auth` (staff sign-in),
  `/api/admin/<section>` (dashboard, needs a staff session), `/api/docs/:token` (emailed
  documents), `/api` (public website data and forms), `/uploads` (files).
- `server/routes/admin/`: one router per dashboard section. Every route checks the role's
  permission for that sub-tab.
- `server/lib/`: database, Redis, auth, uploads, settings, audit log, mailer.
- `db/migrations/`: SQL, applied in order by `npm run db:migrate`.
- `scripts/`: migrations, seeds and demo data.
- `shared/`: code also used by the web apps. `admin-nav.js` defines the sections, sub-tabs and
  permission keys and **must match `src/shared/admin-nav.ts` in sky-dashboard**.
