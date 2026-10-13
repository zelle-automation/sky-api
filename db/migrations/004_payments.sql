-- Payments area: the payment methods guests see at checkout (each with an on/off switch),
-- the bank accounts shown for transfers, plus a few fields the enquiry board needs.

-- One row per method: bank | card | wallet | cash. `config` holds the method's plain settings
-- (gateway, merchant id, wallets, hold times...); `secrets` holds encrypted values only
-- (v1:... strings from server/lib/secret.ts) and is never sent to the browser.
CREATE TABLE travel.payment_methods (
  key             text         PRIMARY KEY CHECK (key IN ('bank','card','wallet','cash')),
  label           text         NOT NULL,
  enabled         boolean      NOT NULL DEFAULT true,
  offer_for       text[]       NOT NULL DEFAULT '{hotel,excursion,package,umrah,visa}',  -- product types
  config          jsonb        NOT NULL DEFAULT '{}',
  secrets         jsonb        NOT NULL DEFAULT '{}',
  sort_order      smallint     NOT NULL DEFAULT 0,
  updated_by      uuid         REFERENCES travel.admin_users(id) ON DELETE SET NULL,
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO travel.payment_methods (key, label, enabled, sort_order, config) VALUES
  ('bank',   'Bank transfer',       true,  1, '{"require_slip":true,"raast_enabled":true,"hold_hours":24,"verify_within":"4 hours"}'),
  ('card',   'Debit / credit card', false, 2, '{"gateway":"Bank payment gateway","merchant_id":"","surcharge_pct":0,"mode":"test","brands":{"visa":true,"mastercard":true,"unionpay":true,"paypak":true,"amex":false},"three_d_secure":true,"international":true}'),
  ('wallet', 'Mobile wallet',       false, 3, '{"wallets":{"jazzcash":{"enabled":false,"account":""},"easypaisa":{"enabled":false,"account":""},"sadapay":{"enabled":false,"account":""}},"limit_per_payment":500000,"window_minutes":30}'),
  ('cash',   'Cash at office',      false, 4, '{"office":"Sky Holidays, Karachi","pay_within_hours":24}');

-- Accounts guests can transfer into. Shown at checkout when bank transfer is on.
CREATE TABLE travel.payment_bank_accounts (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name       text         NOT NULL,
  account_title   text         NOT NULL,
  account_no      text,
  iban            text,
  raast_id        text,
  branch          text,
  enabled         boolean      NOT NULL DEFAULT true,
  position        smallint     NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- Enquiry drawer fields.
ALTER TABLE travel.enquiries
  ADD COLUMN budget        numeric(12,2),
  ADD COLUMN follow_up_at  timestamptz;

-- When a refund was actually paid out to the guest (refund rows only).
ALTER TABLE travel.booking_payments ADD COLUMN paid_at timestamptz;
