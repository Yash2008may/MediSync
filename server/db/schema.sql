-- MediSync schema v2 (requires PostgreSQL 13+). Idempotent: safe to re-run.
-- For a clean slate in development use:  npm run db:reset

-- ============================================================
-- AUTH & ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role                TEXT NOT NULL CHECK (role IN ('patient', 'pharmacy', 'admin')),
  email               TEXT NOT NULL,
  phone               TEXT NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),
  password_hash       TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_role_email_uq ON users (role, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_role_phone_uq ON users (role, phone);

CREATE TABLE IF NOT EXISTS patients (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  address          TEXT NOT NULL,                  -- registered home address (checkout option 2)
  home_lat         DOUBLE PRECISION CHECK (home_lat BETWEEN -90 AND 90),
  home_lng         DOUBLE PRECISION CHECK (home_lng BETWEEN -180 AND 180),
  timezone         TEXT NOT NULL DEFAULT 'Asia/Kolkata',   -- used by the reminder scheduler
  notify_sms       BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Live device location (checkout option 1). NULL until the browser actually reports it;
  -- the server never fills in a default.
  live_lat         DOUBLE PRECISION CHECK (live_lat BETWEEN -90 AND 90),
  live_lng         DOUBLE PRECISION CHECK (live_lng BETWEEN -180 AND 180),
  live_alt         DOUBLE PRECISION,
  live_accuracy_m  DOUBLE PRECISION,
  live_address     TEXT,                            -- reverse-geocoded from live_lat/live_lng
  live_updated_at  TIMESTAMPTZ,
  -- The patient's own saved default location (used by "Default location" on the shop map)
  default_lat      DOUBLE PRECISION CHECK (default_lat BETWEEN -90 AND 90),
  default_lng      DOUBLE PRECISION CHECK (default_lng BETWEEN -180 AND 180),
  default_label    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Existing databases created before the default location existed
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS default_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS default_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS default_label TEXT;

CREATE TABLE IF NOT EXISTS pharmacies (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  store_name          TEXT NOT NULL,
  license_number      TEXT NOT NULL,
  address             TEXT NOT NULL,
  latitude            DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude           DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  place_id            TEXT,                          -- Google Place ID (optional)
  maps_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Licence verification (admin screen, or AUTO_VERIFY_PHARMACIES=true in development)
  verification_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  verified_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at         TIMESTAMPTZ,
  verification_note   TEXT,
  -- Registered pharmacist (needed to review Schedule H prescriptions)
  pharmacist_name     TEXT,
  pharmacist_reg_no   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pharmacies_license_uq ON pharmacies (upper(license_number));
CREATE INDEX IF NOT EXISTS pharmacies_geo_idx ON pharmacies (latitude, longitude);
CREATE INDEX IF NOT EXISTS pharmacies_status_idx ON pharmacies (verification_status);

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash    TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_otps_user_idx ON password_reset_otps (user_id, created_at DESC);

-- ============================================================
-- PRIVACY: consent records (append-only; latest row per type wins) & admin audit
-- ============================================================
CREATE TABLE IF NOT EXISTS user_consents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('privacy_policy', 'health_data_processing', 'notifications', 'location')),
  granted    BOOLEAN NOT NULL,
  version    TEXT NOT NULL,                          -- privacy-policy version shown to the user
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_consents_user_idx ON user_consents (user_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target_id  UUID,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- NEARBY / DEFAULT STORES (auto-picked from live GPS)
-- Google results store only place_id + coordinates (name/address are re-fetched live
-- from Google, in line with Google Maps Platform caching terms).
-- ============================================================
CREATE TABLE IF NOT EXISTS patient_default_stores (
  patient_id  UUID NOT NULL REFERENCES patients(user_id) ON DELETE CASCADE,
  rank        SMALLINT NOT NULL,                     -- 1 = default store
  source      TEXT NOT NULL CHECK (source IN ('registered', 'google')),
  pharmacy_id UUID REFERENCES pharmacies(user_id) ON DELETE CASCADE,
  place_id    TEXT,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  distance_m  INT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, rank),
  CHECK ((source = 'registered' AND pharmacy_id IS NOT NULL) OR (source = 'google' AND place_id IS NOT NULL))
);

-- ============================================================
-- PRESCRIPTIONS (Schedule H workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS prescriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES patients(user_id) ON DELETE CASCADE,
  pharmacy_id   UUID REFERENCES pharmacies(user_id) ON DELETE SET NULL,  -- pharmacy asked to review it
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,                       -- random file name on disk
  mime_type     TEXT NOT NULL,
  size_bytes    INT  NOT NULL,
  doctor_name   TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  valid_until   DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prescriptions_patient_idx  ON prescriptions (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_pharmacy_idx ON prescriptions (pharmacy_id, status);

-- ============================================================
-- MEDICINES, STOCK & REMINDERS (Part 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS patient_medicines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES patients(user_id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  dosage              TEXT,
  stock_remaining     INT NOT NULL DEFAULT 0 CHECK (stock_remaining >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 5,
  mrp                 NUMERIC(10,2) CHECK (mrp >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_medicines_patient_idx ON patient_medicines (patient_id);

CREATE TABLE IF NOT EXISTS medication_schedules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_medicine_id UUID NOT NULL REFERENCES patient_medicines(id) ON DELETE CASCADE,
  time_of_day         TIME NOT NULL,                  -- patient-local wall-clock time
  days_of_week        SMALLINT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',  -- 0 = Sunday
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (schedule, local date, channel) => a reminder can never be sent twice
CREATE TABLE IF NOT EXISTS reminder_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
  local_date  DATE NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  status      TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, local_date, channel)
);

CREATE TABLE IF NOT EXISTS pharmacy_inventory (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id    UUID NOT NULL REFERENCES pharmacies(user_id) ON DELETE CASCADE,
  medicine_name  TEXT NOT NULL,
  mrp            NUMERIC(10,2) NOT NULL CHECK (mrp >= 0),
  discount_pct   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  stock_qty      INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_schedule_h  BOOLEAN NOT NULL DEFAULT FALSE,     -- needs an approved prescription
  UNIQUE (pharmacy_id, medicine_name)
);

-- ============================================================
-- ORDERS, PAYMENTS, PRICE CHAT & LIVE TRACKING (Part 2)
-- Patient/pharmacy links use SET NULL so accounts can be deleted while
-- anonymised order records are retained.
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id              UUID REFERENCES patients(user_id) ON DELETE SET NULL,
  pharmacy_id             UUID REFERENCES pharmacies(user_id) ON DELETE SET NULL,
  prescription_id         UUID REFERENCES prescriptions(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'placed'
                          CHECK (status IN ('placed', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled')),
  delivery_type           TEXT NOT NULL CHECK (delivery_type IN ('live_gps', 'home_address')),
  delivery_address        TEXT NOT NULL,
  delivery_lat            DOUBLE PRECISION,
  delivery_lng            DOUBLE PRECISION,
  delivery_alt            DOUBLE PRECISION,
  total_mrp               NUMERIC(10,2) NOT NULL,
  discount_pct            NUMERIC(5,2)  NOT NULL DEFAULT 0,
  negotiated_discount_pct NUMERIC(5,2)  NOT NULL DEFAULT 0,
  final_price             NUMERIC(10,2) NOT NULL,
  payment_method          TEXT NOT NULL CHECK (payment_method IN ('cod', 'upi', 'card', 'netbanking', 'wallet')),
  payment_status          TEXT NOT NULL DEFAULT 'pending'
                          CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  courier_lat             DOUBLE PRECISION,           -- live delivery-partner position
  courier_lng             DOUBLE PRECISION,
  courier_updated_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_patient_idx  ON orders (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_pharmacy_idx ON orders (pharmacy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  quantity      INT NOT NULL CHECK (quantity > 0),
  mrp           NUMERIC(10,2) NOT NULL,
  discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_schedule_h BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id      UUID NOT NULL REFERENCES users(id),
  sender_role    TEXT NOT NULL CHECK (sender_role IN ('patient', 'pharmacy')),
  body           TEXT NOT NULL,
  proposed_price NUMERIC(10,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_messages_order_idx ON order_messages (order_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('razorpay', 'cod')),
  provider_order_id   TEXT,
  provider_payment_id TEXT,
  amount              NUMERIC(10,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);
