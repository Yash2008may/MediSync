-- 002: order lifecycle, catalogue pricing, in-app notifications, profile audit,
--      prescription-file access audit and reverse-geocode cache.

-- ============================================================
-- ORDERS: full lifecycle (placed -> confirmed -> out_for_delivery -> delivered,
-- plus rejected by the pharmacy and cancelled by the patient)
-- ============================================================
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('placed', 'confirmed', 'rejected', 'out_for_delivery', 'delivered', 'cancelled'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment TEXT NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS priced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_check CHECK (fulfillment IN ('delivery', 'pickup'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS inventory_id UUID REFERENCES pharmacy_inventory(id) ON DELETE SET NULL;

ALTER TABLE order_status_history
  ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS note TEXT;

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history (order_id, changed_at);

-- ============================================================
-- PHARMACY CATALOGUE: the price list the server quotes orders from
-- ============================================================
ALTER TABLE pharmacy_inventory
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS pack_size TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS pharmacy_inventory_pharmacy_idx ON pharmacy_inventory (pharmacy_id, medicine_name);

-- ============================================================
-- PHARMACY RE-VERIFICATION after a verification-relevant profile edit
-- ============================================================
ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;
CREATE INDEX IF NOT EXISTS pharmacies_needs_review_idx ON pharmacies (needs_review) WHERE needs_review;

CREATE TABLE IF NOT EXISTS profile_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  role           TEXT NOT NULL,
  changed_fields TEXT[] NOT NULL,
  old_values     JSONB,
  new_values     JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_audit_user_idx ON profile_audit_log (user_id, created_at DESC);

-- ============================================================
-- IN-APP NOTIFICATIONS (email is attempted when SMTP is configured)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  order_id   UUID REFERENCES orders(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- ============================================================
-- HEALTH-DATA ACCESS AUDIT: who opened which prescription file
-- ============================================================
CREATE TABLE IF NOT EXISTS prescription_file_access (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  role            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prescription_file_access_rx_idx
  ON prescription_file_access (prescription_id, created_at DESC);

-- ============================================================
-- REVERSE-GEOCODE CACHE (short-lived, so Maps outages degrade to the last address)
-- ============================================================
CREATE TABLE IF NOT EXISTS geocode_cache (
  cache_key  TEXT PRIMARY KEY,
  result     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS geocode_cache_expiry_idx ON geocode_cache (expires_at);
