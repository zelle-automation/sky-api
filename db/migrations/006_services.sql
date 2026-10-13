-- Services run from the dashboard: package itineraries and fixed departures (Umrah group
-- departures are departures of Umrah packages), flexible any-date Umrah packages with Makkah &
-- Madinah hotel rates, airport and city-to-city transfers, car rental and chauffeurs.
-- Rules for transfers and car rental live in travel.settings (keys transfers.airport, transfers.intercity, cars.rules).

-- Packages: day-by-day plan, exclusions and price per room sharing.
ALTER TABLE travel.packages
  ADD COLUMN IF NOT EXISTS itinerary     jsonb  NOT NULL DEFAULT '[]',   -- [{day:"Day 1", title, text}]
  ADD COLUMN IF NOT EXISTS exclusions    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS price_options jsonb  NOT NULL DEFAULT '[]';   -- [{label:"Quad", adult, child, infant}]

-- Fixed dates for a package. For Umrah packages these are the group departures, with flight,
-- group leader, visa progress and price per room sharing.
CREATE TABLE IF NOT EXISTS travel.package_departures (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      uuid         NOT NULL REFERENCES travel.packages(id) ON DELETE CASCADE,
  depart_date     date         NOT NULL,
  return_date     date,
  departure_city  text,
  airline         text,
  flight_no       text,
  route           text,                                      -- e.g. KHI→JED
  seats_total     smallint     NOT NULL DEFAULT 0 CHECK (seats_total >= 0),
  seats_sold      smallint     NOT NULL DEFAULT 0 CHECK (seats_sold >= 0),
  price_override  numeric(12,2),                             -- per person, replaces the package price
  price_quad      numeric(12,2),
  price_triple    numeric(12,2),
  price_double    numeric(12,2),
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  group_leader    text,
  leader_phone    text,
  visa_status     text         NOT NULL DEFAULT 'not_started'
                  CHECK (visa_status IN ('not_started','filing_open','passports_missing','submitted','approved')),
  visa_note       text,
  status          text         NOT NULL DEFAULT 'open' CHECK (status IN ('open','full','closed','departed','cancelled')),
  notes           text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS package_departures_pkg_idx ON travel.package_departures (package_id, depart_date);
CREATE INDEX IF NOT EXISTS package_departures_date_idx ON travel.package_departures (depart_date);

-- Makkah & Madinah hotels offered in flexible Umrah packages (rows of travel.hotels).
CREATE TABLE IF NOT EXISTS travel.umrah_hotels (
  hotel_id        uuid         PRIMARY KEY REFERENCES travel.hotels(id) ON DELETE CASCADE,
  city            text         NOT NULL CHECK (city IN ('makkah','madinah')),
  distance_m      int,
  distance_label  text,                                      -- "Haram view, 0 m", "Shuttle, 1.6 km"
  is_live         boolean      NOT NULL DEFAULT true,
  sort_order      int          NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- Per person per night by room sharing. A row without dates is the base rate; dated rows are seasons.
CREATE TABLE IF NOT EXISTS travel.umrah_hotel_rates (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        uuid         NOT NULL REFERENCES travel.umrah_hotels(hotel_id) ON DELETE CASCADE,
  season          text         NOT NULL DEFAULT 'Base rate',
  starts_on       date,
  ends_on         date,
  quad            numeric(12,2),
  triple          numeric(12,2),
  double          numeric(12,2),
  single          numeric(12,2),
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS umrah_hotel_rates_hotel_idx ON travel.umrah_hotel_rates (hotel_id);

-- Any-date Umrah packages: guests pick date, nights split, sharing and hotels; price is worked out.
CREATE TABLE IF NOT EXISTS travel.umrah_packages (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text        NOT NULL UNIQUE,
  title                text        NOT NULL,
  kind                 text        NOT NULL DEFAULT 'flexible' CHECK (kind IN ('flexible','visa_transport','ramadan')),
  tier                 text        CHECK (tier IN ('economy','standard','premium')),
  hotels_note          text,
  summary              text,
  image_day_url        text,
  image_night_url      text,
  min_total_nights     smallint    NOT NULL DEFAULT 7,
  min_makkah_nights    smallint    NOT NULL DEFAULT 3,
  min_madinah_nights   smallint    NOT NULL DEFAULT 2,
  lead_days            smallint    NOT NULL DEFAULT 14,
  ramadan_uplift_pct   numeric(5,2) NOT NULL DEFAULT 0,
  flights              text        NOT NULL DEFAULT 'either' CHECK (flights IN ('quoted','own','either')),
  visa_included        boolean     NOT NULL DEFAULT true,
  transport_included   boolean     NOT NULL DEFAULT true,
  ziyarat_optional     boolean     NOT NULL DEFAULT true,
  madinah_first        boolean     NOT NULL DEFAULT true,
  visa_price           numeric(12,2) NOT NULL DEFAULT 0,
  transport_price      numeric(12,2) NOT NULL DEFAULT 0,
  transport_label      text,                                -- "GMC shared"
  ziyarat_price        numeric(12,2) NOT NULL DEFAULT 0,
  service_fee          numeric(12,2) NOT NULL DEFAULT 0,
  price_from           numeric(12,2),                       -- worked out on save (quad, minimum stay)
  currency_code        char(3)     NOT NULL DEFAULT 'PKR',
  is_live              boolean     NOT NULL DEFAULT true,
  sort_order           int         NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS travel.umrah_package_hotels (
  umrah_package_id uuid NOT NULL REFERENCES travel.umrah_packages(id) ON DELETE CASCADE,
  hotel_id         uuid NOT NULL REFERENCES travel.umrah_hotels(hotel_id) ON DELETE CASCADE,
  PRIMARY KEY (umrah_package_id, hotel_id)
);

-- Vehicle types shared by airport transfers, city-to-city routes and car rental.
CREATE TABLE IF NOT EXISTS travel.vehicle_types (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text         NOT NULL UNIQUE,              -- Sedan, SUV, Van, Coaster
  examples        text,                                      -- "Toyota Camry or similar"
  passengers      smallint     NOT NULL DEFAULT 3,
  bags            smallint     NOT NULL DEFAULT 2,
  units           smallint     NOT NULL DEFAULT 0,           -- in fleet
  used_for        text         NOT NULL DEFAULT 'All transfers',
  photo_url       text,
  is_active       boolean      NOT NULL DEFAULT true,
  sort_order      int          NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS travel.transfer_routes (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text         NOT NULL CHECK (kind IN ('airport','intercity')),
  airport_code    char(3),                                   -- IATA, airport routes
  from_label      text         NOT NULL,                     -- "Jeddah (JED)" / "Islamabad"
  to_label        text         NOT NULL,                     -- zone or city served
  distance_km     int,
  duration_min    int,
  meet_greet      boolean      NOT NULL DEFAULT true,
  notes           text,
  currency_code   char(3)      NOT NULL DEFAULT 'PKR',
  is_live         boolean      NOT NULL DEFAULT true,
  sort_order      int          NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (kind, from_label, to_label)
);

-- One-way price per vehicle type; no row means that vehicle is not offered on the route.
CREATE TABLE IF NOT EXISTS travel.transfer_route_prices (
  route_id        uuid         NOT NULL REFERENCES travel.transfer_routes(id) ON DELETE CASCADE,
  vehicle_type_id uuid         NOT NULL REFERENCES travel.vehicle_types(id) ON DELETE CASCADE,
  price           numeric(12,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (route_id, vehicle_type_id)
);

CREATE TABLE IF NOT EXISTS travel.rental_cars (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL UNIQUE,
  category          text        NOT NULL DEFAULT 'Sedan',    -- Sedan, SUV, 4x4, Van, Bus
  seats             smallint    NOT NULL DEFAULT 4,
  transmission      text        NOT NULL DEFAULT 'automatic' CHECK (transmission IN ('automatic','manual')),
  with_driver_daily numeric(12,2),
  self_drive_daily  numeric(12,2),                          -- null = self-drive not offered
  cities            text[]      NOT NULL DEFAULT '{}',
  units             smallint    NOT NULL DEFAULT 1,
  photo_url         text,
  currency_code     char(3)     NOT NULL DEFAULT 'PKR',
  is_live           boolean     NOT NULL DEFAULT true,
  sort_order        int         NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS travel.chauffeurs (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text         NOT NULL,
  phone           text,
  cnic            text,
  licence_no      text,
  licence_type    text,                                      -- LTV, HTV, LTV + HTV
  licence_expiry  date,
  languages       text[]       NOT NULL DEFAULT '{}',
  cities          text[]       NOT NULL DEFAULT '{}',
  drives          text,                                      -- vehicles they drive
  rating          numeric(2,1),
  photo_url       text,
  status          text         NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_trip','off','inactive')),
  notes           text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (name, phone)
);

-- Visa services can be hidden from the site without deleting them.
ALTER TABLE travel.visa_services ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true;
