-- Hotel and excursion editors (Booking.com / Agoda-level listing data).
-- Hotels: property details, location, photo pairs, room types, rate plans, a nightly
-- availability calendar, facilities, policies, taxes, contacts, reviews and SEO.
-- Excursions: itinerary, schedule, age-band options, inclusions, pickup zones and more.

ALTER TABLE travel.hotels
  ADD COLUMN IF NOT EXISTS chain            text,
  ADD COLUMN IF NOT EXISTS opened_year      smallint,
  ADD COLUMN IF NOT EXISTS renovated_year   smallint,
  ADD COLUMN IF NOT EXISTS total_rooms      int,
  ADD COLUMN IF NOT EXISTS badge            text,
  ADD COLUMN IF NOT EXISTS summary          text,
  ADD COLUMN IF NOT EXISTS languages        text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS area             text,
  ADD COLUMN IF NOT EXISTS city             text,
  ADD COLUMN IF NOT EXISTS country          text,
  ADD COLUMN IF NOT EXISTS postcode         text,
  ADD COLUMN IF NOT EXISTS distances        jsonb   NOT NULL DEFAULT '[]',   -- [{place, distance}]
  ADD COLUMN IF NOT EXISTS photos           jsonb   NOT NULL DEFAULT '[]',   -- [{day, night, tag}], first is the cover
  ADD COLUMN IF NOT EXISTS facilities       text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS weekend_uplift   numeric(5,2) NOT NULL DEFAULT 0, -- % added on Fri/Sat nights
  ADD COLUMN IF NOT EXISTS policies         jsonb   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS taxes            jsonb   NOT NULL DEFAULT '[]',   -- [{name, type, amount, per, included}]
  ADD COLUMN IF NOT EXISTS emergency_phone  text,
  ADD COLUMN IF NOT EXISTS voucher_show_phone boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS voucher_show_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_scores    jsonb   NOT NULL DEFAULT '{}',   -- {cleanliness, location, staff, value, comfort, facilities}
  ADD COLUMN IF NOT EXISTS priority         smallint NOT NULL DEFAULT 0,     -- higher shows first
  ADD COLUMN IF NOT EXISTS seo_title        text,
  ADD COLUMN IF NOT EXISTS seo_description  text,
  ADD COLUMN IF NOT EXISTS supplier         text,
  ADD COLUMN IF NOT EXISTS supplier_hotel_id text,
  ADD COLUMN IF NOT EXISTS in_deals         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pay_at_hotel     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES travel.admin_users(id) ON DELETE SET NULL;

-- Existing cover images become the first photo pair.
UPDATE travel.hotels SET photos = jsonb_build_array(jsonb_build_object('day', image_day_url, 'night', image_night_url, 'tag', 'Cover'))
 WHERE photos = '[]' AND image_day_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS travel.hotel_rooms (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid         NOT NULL REFERENCES travel.hotels(id) ON DELETE CASCADE,
  name          text         NOT NULL,
  size_m2       int,
  beds          text,
  max_adults    smallint     NOT NULL DEFAULT 2,
  max_children  smallint     NOT NULL DEFAULT 0,
  units         int          NOT NULL DEFAULT 1,
  view          text,
  smoking       text         NOT NULL DEFAULT 'Non-smoking',
  extra_bed     text,
  amenities     text[]       NOT NULL DEFAULT '{}',
  photos        text[]       NOT NULL DEFAULT '{}',
  base_price    numeric(12,2) NOT NULL DEFAULT 0,      -- per night, before rate plan changes
  position      smallint     NOT NULL DEFAULT 0,
  created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_rooms_hotel_idx ON travel.hotel_rooms (hotel_id, position);

CREATE TABLE IF NOT EXISTS travel.hotel_rate_plans (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid         NOT NULL REFERENCES travel.hotels(id) ON DELETE CASCADE,
  room_id       uuid         REFERENCES travel.hotel_rooms(id) ON DELETE CASCADE,  -- null = every room type
  name          text         NOT NULL,
  meal_plan     text         NOT NULL DEFAULT 'Room only',
  cancellation  text         NOT NULL DEFAULT 'Free until 3 days before',
  payment       text         NOT NULL DEFAULT 'pay_now' CHECK (payment IN ('pay_now','pay_at_hotel','deposit')),
  adjust_type   text         NOT NULL DEFAULT 'percent' CHECK (adjust_type IN ('percent','fixed')),
  adjust_value  numeric(12,2) NOT NULL DEFAULT 0,
  is_live       boolean      NOT NULL DEFAULT true,
  position      smallint     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS hotel_rate_plans_hotel_idx ON travel.hotel_rate_plans (hotel_id, position);

-- Nightly overrides; a date without a row sells at base price (+ weekend uplift) with every unit open.
CREATE TABLE IF NOT EXISTS travel.hotel_availability (
  room_id       uuid         NOT NULL REFERENCES travel.hotel_rooms(id) ON DELETE CASCADE,
  night         date         NOT NULL,
  price         numeric(12,2),
  rooms_left    int,
  stop_sell     boolean      NOT NULL DEFAULT false,
  PRIMARY KEY (room_id, night)
);

CREATE TABLE IF NOT EXISTS travel.hotel_reviews (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid         NOT NULL REFERENCES travel.hotels(id) ON DELETE CASCADE,
  guest_name    text         NOT NULL,
  guest_city    text,
  score         numeric(3,1) NOT NULL CHECK (score BETWEEN 1 AND 10),
  title         text,
  body          text,
  stayed_on     date,
  is_published  boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_reviews_hotel_idx ON travel.hotel_reviews (hotel_id, created_at DESC);

ALTER TABLE travel.excursions
  ADD COLUMN IF NOT EXISTS description      text,
  ADD COLUMN IF NOT EXISTS duration_label   text,
  ADD COLUMN IF NOT EXISTS activity_level   text NOT NULL DEFAULT 'Easy',
  ADD COLUMN IF NOT EXISTS group_type       text NOT NULL DEFAULT 'Shared group',
  ADD COLUMN IF NOT EXISTS itinerary        jsonb  NOT NULL DEFAULT '[]',   -- [{time, title, duration, description}]
  ADD COLUMN IF NOT EXISTS days_of_week     text[] NOT NULL DEFAULT '{Mon,Tue,Wed,Thu,Fri,Sat,Sun}',
  ADD COLUMN IF NOT EXISTS start_times      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS capacity         int,
  ADD COLUMN IF NOT EXISTS min_guests       int    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cutoff_hours     int    NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS season_from      date,
  ADD COLUMN IF NOT EXISTS season_to        date,
  ADD COLUMN IF NOT EXISTS blackout_dates   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS group_discount_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS group_discount_min int,
  ADD COLUMN IF NOT EXISTS peak_uplift_pct  numeric(5,2),
  ADD COLUMN IF NOT EXISTS peak_from        date,
  ADD COLUMN IF NOT EXISTS peak_to          date,
  ADD COLUMN IF NOT EXISTS inclusions       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS exclusions       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pickup_offered   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_zones     jsonb  NOT NULL DEFAULT '[]',   -- [{zone, window, fee}]
  ADD COLUMN IF NOT EXISTS meeting_point    text,
  ADD COLUMN IF NOT EXISTS meeting_map_url  text,
  ADD COLUMN IF NOT EXISTS ends_at          text,
  ADD COLUMN IF NOT EXISTS guide_type       text,
  ADD COLUMN IF NOT EXISTS languages        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS not_suitable     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS what_to_bring    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_age          smallint,
  ADD COLUMN IF NOT EXISTS dress_code       text,
  ADD COLUMN IF NOT EXISTS cancellation_policy text,
  ADD COLUMN IF NOT EXISTS weather_policy   text,
  ADD COLUMN IF NOT EXISTS photos           jsonb  NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS seo_title        text,
  ADD COLUMN IF NOT EXISTS seo_description  text,
  ADD COLUMN IF NOT EXISTS supplier         text,
  ADD COLUMN IF NOT EXISTS supplier_product_id text,
  ADD COLUMN IF NOT EXISTS supplier_confirms text,
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES travel.admin_users(id) ON DELETE SET NULL;

UPDATE travel.excursions SET duration_label = raw->>'duration_label' WHERE duration_label IS NULL AND raw ? 'duration_label';
UPDATE travel.excursions SET photos = jsonb_build_array(jsonb_build_object('day', image_day_url, 'night', image_night_url, 'tag', 'Cover'))
 WHERE photos = '[]' AND image_day_url IS NOT NULL;

-- Bookable options with age-band prices. A null child/infant price means that age band can't book this option.
CREATE TABLE IF NOT EXISTS travel.excursion_options (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  excursion_id  uuid         NOT NULL REFERENCES travel.excursions(id) ON DELETE CASCADE,
  name          text         NOT NULL,
  note          text,
  price_basis   text         NOT NULL DEFAULT 'person' CHECK (price_basis IN ('person','group')),
  max_group     smallint,                               -- for per-group options (private car up to 6)
  adult_price   numeric(12,2) NOT NULL,
  child_price   numeric(12,2),
  infant_price  numeric(12,2),
  supplier_cost numeric(12,2),                          -- per adult (or per group); hidden from roles with hideCosts
  is_live       boolean      NOT NULL DEFAULT true,
  position      smallint     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS excursion_options_exc_idx ON travel.excursion_options (excursion_id, position);
