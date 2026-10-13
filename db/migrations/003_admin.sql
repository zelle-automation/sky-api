-- Admin dashboard core: staff accounts, roles with per-sub-tab permissions, sessions,
-- audit log, settings, media library, and the booking ledger shared by every service.

-- Roles hold permissions as {"bookings.cancelled": ["view"], "payments.refunds": ["view","edit"], ...}.
-- Keys are "<section>.<tab>" from src/shared/admin-nav.ts; actions are view | create | edit | delete.
CREATE TABLE travel.admin_roles (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text         NOT NULL UNIQUE,
  description     text,
  permissions     jsonb        NOT NULL DEFAULT '{}',
  is_owner        boolean      NOT NULL DEFAULT false,      -- owner roles bypass every check
  -- Data limits applied on top of permissions.
  own_bookings_only boolean    NOT NULL DEFAULT false,
  hide_costs      boolean      NOT NULL DEFAULT false,
  mask_ids        boolean      NOT NULL DEFAULT false,
  can_export      boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE travel.admin_users (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text         NOT NULL UNIQUE,
  name            text         NOT NULL,
  phone           text,
  password_hash   text         NOT NULL,                    -- scrypt$<salt>$<hash>
  role_id         uuid         NOT NULL REFERENCES travel.admin_roles(id),
  is_active       boolean      NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- Sessions live in Redis when it is configured; this table is the fallback store.
CREATE TABLE travel.admin_sessions (
  token_hash      text         PRIMARY KEY,
  user_id         uuid         NOT NULL REFERENCES travel.admin_users(id) ON DELETE CASCADE,
  expires_at      timestamptz  NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.admin_sessions (expires_at);

CREATE TABLE travel.audit_log (
  id              bigserial    PRIMARY KEY,
  user_id         uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  action          text         NOT NULL,                    -- e.g. booking.cancel, hotel.update
  entity_type     text,
  entity_id       text,
  detail          jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.audit_log (entity_type, entity_id, created_at DESC);

-- Key/value settings edited in the dashboard: business, email (SMTP), notifications,
-- checkout rules, homepage, document branding. Secrets inside are encrypted by the API.
CREATE TABLE travel.settings (
  key             text         PRIMARY KEY,
  value           jsonb        NOT NULL DEFAULT '{}',
  updated_by      uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- Uploaded files. Bytes live on disk under UPLOAD_DIR; url is what pages reference.
CREATE TABLE travel.media (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  url             text         NOT NULL UNIQUE,
  file_name       text         NOT NULL,
  mime_type       text         NOT NULL,
  size_bytes      int          NOT NULL,
  width           int,
  height          int,
  folder          text         NOT NULL DEFAULT 'general',   -- hotels | excursions | destinations | branding | slips | general
  alt_text        text,
  uploaded_by     uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.media (folder, created_at DESC);

-- Fields the hotel voucher prints.
ALTER TABLE travel.hotels
  ADD COLUMN logo_url        text,
  ADD COLUMN voucher_image_url text,
  ADD COLUMN phone           text,
  ADD COLUMN email           text,
  ADD COLUMN website         text,
  ADD COLUMN check_in_time   time DEFAULT '14:00',
  ADD COLUMN check_out_time  time DEFAULT '12:00',
  ADD COLUMN status          text NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft','archived'));
ALTER TABLE travel.excursions
  ADD COLUMN status          text NOT NULL DEFAULT 'published' CHECK (status IN ('published','seasonal','draft','archived'));
ALTER TABLE travel.packages
  ADD COLUMN status          text NOT NULL DEFAULT 'published' CHECK (status IN ('published','draft','archived'));
ALTER TABLE travel.destinations
  ADD COLUMN is_published    boolean NOT NULL DEFAULT true;

-- Bookings for every service. product_type/product_id point at the catalogue row
-- (hotels, excursions, packages, umrah packages, transfer routes, cars); product_snapshot
-- freezes what was sold so later catalogue edits never change a confirmed booking.
CREATE SEQUENCE travel.booking_ref_seq START 4800;
CREATE TABLE travel.bookings (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text         NOT NULL UNIQUE,               -- SKY-26-04821
  product_type    text         NOT NULL CHECK (product_type IN ('hotel','excursion','package','umrah','transfer','car','visa','flight','other')),
  product_id      uuid,
  product_name    text         NOT NULL,
  product_snapshot jsonb       NOT NULL DEFAULT '{}',         -- room type, meal plan, option, vehicle, etc.
  status          text         NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','supplier','confirmed','travelling','completed','refund','cancelled')),
  payment_status  text         NOT NULL DEFAULT 'unpaid'
                  CHECK (payment_status IN ('unpaid','deposit','paid','verify','refunded')),
  start_date      date         NOT NULL,
  end_date        date,
  adults          smallint     NOT NULL DEFAULT 1,
  children        smallint     NOT NULL DEFAULT 0,
  infants         smallint     NOT NULL DEFAULT 0,
  lead_name       text         NOT NULL,
  lead_email      text,
  lead_phone      text         NOT NULL,
  lead_cnic       text,
  lead_nationality char(2)     REFERENCES travel.countries(iso2),
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  base_amount     numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount      numeric(12,2) NOT NULL DEFAULT 0,
  fee_amount      numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount    numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(12,2) NOT NULL DEFAULT 0,
  supplier_cost   numeric(12,2),
  supplier_name   text,
  supplier_ref    text,                                      -- hotel confirmation number
  payment_method  text,                                      -- bank | card | wallet | cash
  channel         text         NOT NULL DEFAULT 'website',   -- website | whatsapp | phone | walk-in | agent | email
  assigned_to     uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  enquiry_id      uuid         REFERENCES travel.enquiries(id) ON DELETE SET NULL,
  special_requests text,
  internal_notes  text,
  cancellation_policy text,
  payment_due_at  timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_by      uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.bookings (status, start_date);
CREATE INDEX ON travel.bookings (payment_status);
CREATE INDEX ON travel.bookings (created_at DESC);
CREATE INDEX ON travel.bookings (product_type, product_id);

CREATE TABLE travel.booking_travellers (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid         NOT NULL REFERENCES travel.bookings(id) ON DELETE CASCADE,
  position        smallint     NOT NULL DEFAULT 0,
  title           text,
  full_name       text         NOT NULL,
  kind            text         NOT NULL DEFAULT 'adult' CHECK (kind IN ('adult','child','infant')),
  date_of_birth   date,
  nationality     char(2)      REFERENCES travel.countries(iso2),
  passport_no     text,
  passport_expiry date,
  passport_status text         NOT NULL DEFAULT 'missing' CHECK (passport_status IN ('missing','received','verified'))
);
CREATE INDEX ON travel.booking_travellers (booking_id);

-- Money in (payments) and out (refunds). Slips uploaded by guests wait in 'pending' until verified.
CREATE TABLE travel.booking_payments (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid         NOT NULL REFERENCES travel.bookings(id) ON DELETE CASCADE,
  kind            text         NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund')),
  method          text         NOT NULL,                      -- bank | card | wallet | cash
  provider        text,                                      -- Meezan, HBL, JazzCash, Easypaisa, gateway name
  amount          numeric(12,2) NOT NULL,
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  status          text         NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','failed')),
  reference       text,                                      -- bank TID, gateway txn id
  slip_url        text,
  note            text,
  received_at     timestamptz  NOT NULL DEFAULT now(),
  verified_by     uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  verified_at     timestamptz,
  created_by      uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.booking_payments (booking_id);
CREATE INDEX ON travel.booking_payments (status, created_at DESC);

CREATE TABLE travel.booking_events (
  id              bigserial    PRIMARY KEY,
  booking_id      uuid         NOT NULL REFERENCES travel.bookings(id) ON DELETE CASCADE,
  kind            text         NOT NULL,                      -- created | status | payment | document | note | email
  message         text         NOT NULL,
  user_id         uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.booking_events (booking_id, created_at);

-- Enquiry workflow fields used by the board.
ALTER TABLE travel.enquiries DROP CONSTRAINT enquiries_status_check;
UPDATE travel.enquiries SET status = 'converted' WHERE status = 'booked';
ALTER TABLE travel.enquiries
  ADD CONSTRAINT enquiries_status_check CHECK (status IN ('new','contacted','quoted','converted','closed')),
  ADD COLUMN channel        text NOT NULL DEFAULT 'website',
  ADD COLUMN quote_amount   numeric(12,2),
  ADD COLUMN close_reason   text,
  ADD COLUMN assigned_to    uuid REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  ADD COLUMN booking_id     uuid REFERENCES travel.bookings(id) ON DELETE SET NULL,
  ADD COLUMN updated_at     timestamptz NOT NULL DEFAULT now();

CREATE TABLE travel.enquiry_notes (
  id              bigserial    PRIMARY KEY,
  enquiry_id      uuid         NOT NULL REFERENCES travel.enquiries(id) ON DELETE CASCADE,
  kind            text         NOT NULL DEFAULT 'note',       -- note | reply | status
  body            text         NOT NULL,
  user_id         uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.enquiry_notes (enquiry_id, created_at);
