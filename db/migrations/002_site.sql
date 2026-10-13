-- Site build: day/evening images, slugs for detail pages, visa catalogue, enquiries, newsletter.

ALTER TABLE travel.destinations ADD COLUMN image_day_url text, ADD COLUMN image_night_url text, ADD COLUMN flight_note text;
ALTER TABLE travel.hotels       ADD COLUMN slug text UNIQUE, ADD COLUMN image_day_url text, ADD COLUMN image_night_url text;
ALTER TABLE travel.excursions   ADD COLUMN slug text UNIQUE, ADD COLUMN image_day_url text, ADD COLUMN image_night_url text;
ALTER TABLE travel.packages     ADD COLUMN image_day_url text, ADD COLUMN image_night_url text;

CREATE TABLE travel.visa_services (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2     char(2)      NOT NULL REFERENCES travel.countries(iso2),
  visa_type        text         NOT NULL,                 -- e.g. "30-day tourist"
  entry            text         NOT NULL DEFAULT 'single' CHECK (entry IN ('single','multiple')),
  stay_days        smallint,
  processing_days  text,                                   -- e.g. "3–5 working days"
  price_from       numeric(12,2),
  currency_code    char(3)      NOT NULL DEFAULT 'PKR',
  is_evisa         boolean      NOT NULL DEFAULT false,
  requirements     text[]       NOT NULL DEFAULT '{}',
  sort_order       int          NOT NULL DEFAULT 0,
  UNIQUE (country_iso2, visa_type)
);

-- Booking requests and questions from the site. `ref_type`/`ref_id` point at the item enquired about.
CREATE TABLE travel.enquiries (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  service         text         NOT NULL,                  -- hotels | excursions | packages | umrah | visa | flights | cars | transfers | general
  ref_type        text,
  ref_id          uuid,
  name            text         NOT NULL,
  email           text,
  phone           text         NOT NULL,
  travel_date     date,
  travellers      smallint,
  message         text,
  status          text         NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','quoted','booked','closed')),
  source_ip       inet,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ON travel.enquiries (status, created_at DESC);

CREATE TABLE travel.newsletter_subscribers (
  email           text         PRIMARY KEY,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
