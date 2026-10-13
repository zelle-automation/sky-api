-- Documents, email and subscribers: email templates edited under Settings → Email, a log of
-- every email the system sends, saved quotations, shared document links, and subscriber details.

-- One row per automatic email. Subject/body use {{variables}} filled in when the email is sent.
CREATE TABLE travel.email_templates (
  key             text         PRIMARY KEY,                 -- booking_confirmed, voucher, quotation, ...
  name            text         NOT NULL,
  trigger_label   text         NOT NULL DEFAULT '',          -- "When a booking is confirmed"
  attachments     text         NOT NULL DEFAULT 'None',      -- what is attached, shown in the list
  subject         text         NOT NULL,
  body            text         NOT NULL,                     -- plain text; blank lines become paragraphs
  enabled         boolean      NOT NULL DEFAULT true,
  position        smallint     NOT NULL DEFAULT 0,
  updated_by      uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE travel.email_log (
  id              bigserial    PRIMARY KEY,
  template_key    text,
  to_email        text         NOT NULL,
  subject         text         NOT NULL,
  status          text         NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error           text,
  message_id      text,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.email_log (template_key, created_at DESC);
CREATE INDEX ON travel.email_log (created_at DESC);

-- Quotations made in Documents → Quotation, for an enquiry or freely.
CREATE SEQUENCE travel.quotation_no_seq START 410;
CREATE TABLE travel.quotations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text         NOT NULL UNIQUE,             -- QUO-26-00412
  enquiry_id      uuid         REFERENCES travel.enquiries(id) ON DELETE SET NULL,
  customer_name   text         NOT NULL,
  customer_phone  text,
  customer_email  text,
  summary         text,                                     -- one line under the name
  price_label     text         NOT NULL DEFAULT 'Per person',
  col1_label      text         NOT NULL DEFAULT 'Details',   -- table column headers, e.g. Makkah / Madinah
  col2_label      text         NOT NULL DEFAULT '',          -- second column is hidden when blank
  items           jsonb        NOT NULL DEFAULT '[]',        -- [{title, details, details2, price}]
  included        text,
  valid_until     date,
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  created_by      uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.quotations (created_at DESC);

-- A document emailed to a guest: the rendered page, opened by its secret link.
CREATE TABLE travel.document_shares (
  token           text         PRIMARY KEY,
  doc_type        text         NOT NULL,
  booking_id      uuid         REFERENCES travel.bookings(id) ON DELETE CASCADE,
  quotation_id    uuid         REFERENCES travel.quotations(id) ON DELETE CASCADE,
  title           text         NOT NULL,
  html            text         NOT NULL,
  created_by      uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  expires_at      timestamptz  NOT NULL DEFAULT now() + interval '180 days'
);

ALTER TABLE travel.newsletter_subscribers
  ADD COLUMN source          text NOT NULL DEFAULT 'Website footer',
  ADD COLUMN unsubscribed_at timestamptz;
