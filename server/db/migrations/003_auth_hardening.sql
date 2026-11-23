-- 003: auth hardening support.
-- The OTP attempt cap, expiry and resend cooldown already live on the rows; this adds
-- the requesting IP (for abuse review) and an index for the hourly per-account cap.

ALTER TABLE password_reset_otps
  ADD COLUMN IF NOT EXISTS requested_ip TEXT;

CREATE INDEX IF NOT EXISTS password_reset_otps_created_idx
  ON password_reset_otps (created_at DESC);
