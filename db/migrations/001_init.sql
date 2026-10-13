-- Sky Holidays core travel schema.
-- Everything lives in the "travel" schema so this database can later be joined
-- (or postgres_fdw-linked) with another database without name clashes.
-- Conventions: uuid primary keys, ISO codes for countries/currencies, IATA for
-- airports, and (source, external_id) on anything that comes from a supplier API
-- so records can be matched against other systems.

CREATE SCHEMA IF NOT EXISTS travel;

CREATE TABLE travel.countries (
  iso2            char(2)      PRIMARY KEY,
  iso3            char(3)      NOT NULL UNIQUE,
  name            text         NOT NULL,
  official_name   text,
  region          text,
  subregion       text,
  capital         text,
  currency_code   char(3),
  calling_code    text,
  flag_emoji      text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE travel.cities (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2    char(2)      NOT NULL REFERENCES travel.countries(iso2),
  name            text         NOT NULL,
  lat             numeric(9,6),
  lng             numeric(9,6),
  UNIQUE (country_iso2, name)
);

CREATE TABLE travel.airports (
  iata_code       char(3)      PRIMARY KEY,
  name            text         NOT NULL,
  city_id         uuid         REFERENCES travel.cities(id),
  country_iso2    char(2)      NOT NULL REFERENCES travel.countries(iso2),
  lat             numeric(9,6),
  lng             numeric(9,6)
);

CREATE TABLE travel.destinations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text         NOT NULL UNIQUE,
  name            text         NOT NULL,
  country_iso2    char(2)      NOT NULL REFERENCES travel.countries(iso2),
  city_id         uuid         REFERENCES travel.cities(id),
  category        text         NOT NULL DEFAULT 'international'
                  CHECK (category IN ('international','domestic','umrah')),
  tagline         text,
  description     text,
  best_time       text,
  cover_image_url text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  price_from      numeric(12,2),
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  is_featured     boolean      NOT NULL DEFAULT false,
  sort_order      int          NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE travel.hotels (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text         NOT NULL DEFAULT 'manual',   -- manual | osm | supplier name
  external_id     text,
  destination_id  uuid         REFERENCES travel.destinations(id) ON DELETE SET NULL,
  name            text         NOT NULL,
  kind            text,                                     -- e.g. Luxury Resort, Haram View
  star_rating     smallint     CHECK (star_rating BETWEEN 1 AND 5),
  address         text,
  lat             numeric(9,6),
  lng             numeric(9,6),
  description     text,
  amenities       text[]       NOT NULL DEFAULT '{}',
  image_url       text,
  rating          numeric(3,1),
  review_count    int,
  price_from      numeric(12,2),
  price_was       numeric(12,2),
  price_unit      text         NOT NULL DEFAULT 'per night',
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  is_featured     boolean      NOT NULL DEFAULT false,
  raw             jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE TABLE travel.excursions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source           text        NOT NULL DEFAULT 'manual',
  external_id      text,
  destination_id   uuid        REFERENCES travel.destinations(id) ON DELETE SET NULL,
  title            text        NOT NULL,
  category         text,
  location_label   text,
  lat              numeric(9,6),
  lng              numeric(9,6),
  duration_minutes int,
  summary          text,
  highlights       text[]      NOT NULL DEFAULT '{}',
  image_url        text,
  rating           numeric(3,1),
  review_count     int,
  price_from       numeric(12,2),
  price_was        numeric(12,2),
  price_unit       text        NOT NULL DEFAULT 'per person',
  currency_code    char(3)     NOT NULL DEFAULT 'PKR',
  is_featured      boolean     NOT NULL DEFAULT false,
  raw              jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE TABLE travel.packages (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text         NOT NULL UNIQUE,
  title           text         NOT NULL,
  category        text         NOT NULL
                  CHECK (category IN ('international','domestic','umrah','honeymoon')),
  duration_days   smallint     NOT NULL,
  nights          smallint     NOT NULL,
  itinerary_label text,                                     -- e.g. "Makkah 8N · Madinah 7N"
  includes_label  text,                                     -- e.g. "Visa + flights + hotels"
  summary         text,
  inclusions      text[]       NOT NULL DEFAULT '{}',
  image_url       text,
  rating          numeric(3,1),
  review_count    int,
  price_from      numeric(12,2) NOT NULL,
  price_was       numeric(12,2),
  price_unit      text         NOT NULL DEFAULT 'per person',
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  is_deal         boolean      NOT NULL DEFAULT false,
  deal_badge      text,
  is_featured     boolean      NOT NULL DEFAULT false,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE travel.package_destinations (
  package_id      uuid NOT NULL REFERENCES travel.packages(id) ON DELETE CASCADE,
  destination_id  uuid NOT NULL REFERENCES travel.destinations(id) ON DELETE CASCADE,
  nights          smallint,
  position        smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (package_id, destination_id)
);

-- Responses from external APIs (flight offers, OSM lookups) cached to stay within free limits.
CREATE TABLE travel.provider_cache (
  cache_key       text         PRIMARY KEY,
  provider        text         NOT NULL,
  payload         jsonb        NOT NULL,
  expires_at      timestamptz  NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX ON travel.cities (country_iso2);
CREATE INDEX ON travel.destinations (country_iso2);
CREATE INDEX ON travel.destinations (category, sort_order);
CREATE INDEX ON travel.hotels (destination_id);
CREATE INDEX ON travel.excursions (destination_id);
CREATE INDEX ON travel.provider_cache (expires_at);
