import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query, withTransaction } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { findUserByIdentifier, toPublicUser } from '../services/userService.js';
import { generateOtp, hashOtp, safeEqual, sendOtpNotifications } from '../services/otpService.js';
import { recordConsent } from '../services/consentService.js';
import { clearSessionCookie, setSessionCookie } from '../utils/session.js';
import { sendEmail } from '../utils/notify.js';

// Compared against when the account doesn't exist, so response time doesn't reveal it.
const DUMMY_HASH = bcrypt.hashSync('medisync-dummy-password', env.bcryptRounds);

const signToken = (user) =>
  jwt.sign({ role: user.role }, env.jwtSecret, {
    subject: user.id,
    expiresIn: env.jwtExpiresIn,
  });

// Every successful sign-in / sign-up issues the httpOnly session cookie the browser uses.
// The same token is returned in the body for scripts and API tests.
async function sendSession(res, user, status = 200) {
  const token = signToken(user);
  setSessionCookie(res, token);
  res.status(status).json({ token, user: await toPublicUser(user) });
}

// ---------------------------------------------------------------- REGISTER
export const registerPatient = asyncHandler(async (req, res) => {
  const d = req.body;
  const passwordHash = await bcrypt.hash(d.password, env.bcryptRounds);

  const user = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (role, email, phone, password_hash)
       VALUES ('patient', $1, $2, $3) RETURNING *`,
      [d.email, d.phone, passwordHash]
    );
    await c.query(
      `INSERT INTO patients (user_id, name, address, home_lat, home_lng, timezone, notify_sms, notify_email)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Asia/Kolkata'), $7, $7)`,
      [rows[0].id, d.name, d.address, d.homeLat ?? null, d.homeLng ?? null, d.timezone ?? null, d.consents.notifications]
    );
    await recordConsent(c, rows[0].id, 'privacy_policy', true);
    await recordConsent(c, rows[0].id, 'health_data_processing', true);
    await recordConsent(c, rows[0].id, 'notifications', d.consents.notifications);
    return rows[0];
  });

  await sendSession(res, user, 201);
});

export const registerPharmacy = asyncHandler(async (req, res) => {
  const d = req.body;
  const passwordHash = await bcrypt.hash(d.password, env.bcryptRounds);

  const user = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (role, email, phone, password_hash)
       VALUES ('pharmacy', $1, $2, $3) RETURNING *`,
      [d.email, d.phone, passwordHash]
    );
    // Dev shortcut only (AUTO_VERIFY_PHARMACIES). Otherwise an admin must approve the licence.
    const auto = env.autoVerifyPharmacies;
    await c.query(
      `INSERT INTO pharmacies
         (user_id, store_name, license_number, address, latitude, longitude, place_id, maps_verified,
          verification_status, verified_at, verification_note, pharmacist_name, pharmacist_reg_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text,
               CASE WHEN $9::text = 'approved' THEN now() END, $10, $11, $12)`,
      [rows[0].id, d.storeName, d.licenseNumber, d.address, d.latitude, d.longitude, d.placeId ?? null,
       Boolean(d.placeId), auto ? 'approved' : 'pending',
       auto ? 'Auto-verified (AUTO_VERIFY_PHARMACIES, testing only)' : null,
       d.pharmacistName ?? null, d.pharmacistRegNo ?? null]
    );
    await recordConsent(c, rows[0].id, 'privacy_policy', true);
    return rows[0];
  });

  await sendSession(res, user, 201);
});

// ---------------------------------------------------- ADMIN ONE-TIME SIGN-UP
// GET /api/auth/admin/bootstrap — can the first admin still be created?
export const adminBootstrapState = asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS exists`);
  res.json({ available: !rows[0].exists });
});

// POST /api/auth/admin/register — bootstraps the very first admin, once.
// After an admin exists this always fails, so the console is never self-served.
export const registerAdmin = asyncHandler(async (req, res) => {
  const { email, phone, password } = req.body;
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

  let user;
  try {
    user = await withTransaction(async (c) => {
      // Serialise concurrent attempts so exactly one admin can ever be bootstrapped.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('medisync:admin-bootstrap'))`);
      const { rows: existing } = await c.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
      if (existing[0]) {
        throw new AppError(409, 'An admin account already exists. Sign in instead, or ask an existing admin.');
      }
      const { rows } = await c.query(
        `INSERT INTO users (role, email, phone, password_hash) VALUES ('admin', $1, $2, $3) RETURNING *`,
        [email, phone, passwordHash]
      );
      return rows[0];
    });
  } catch (error) {
    if (error?.code === '23505') {
      throw new AppError(409, 'An account with this email or mobile number already exists.');
    }
    throw error;
  }

  await sendSession(res, user, 201);
});

// ------------------------------------------------------------------- LOGIN
const loginAs = (role) =>
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;
    const user = await findUserByIdentifier(role, identifier);
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.is_active) throw new AppError(401, 'Invalid credentials');

    await sendSession(res, user);
  });

export const loginPatient = loginAs('patient');
export const loginPharmacy = loginAs('pharmacy');
export const loginAdmin = loginAs('admin');

export const me = asyncHandler(async (req, res) => {
  res.json({ user: await toPublicUser(req.user) });
});

// POST /api/auth/logout — clears the httpOnly session cookie. Safe to call without a session.
export const logout = asyncHandler(async (_req, res) => {
  clearSessionCookie(res);
  res.json({ message: 'Signed out.' });
});

// ---------------------------------------------------- FORGOT PASSWORD (OTP)
// Step 1: request an OTP. Always returns the same response (no account enumeration).
export const forgotPassword = asyncHandler(async (req, res) => {
  const { role, identifier } = req.body;
  const user = await findUserByIdentifier(role, identifier);
  
  if (user && user.is_active) {
    const { rows } = await query(
      'SELECT created_at FROM password_reset_otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    const last = rows[0];
    const cooledDown =
      !last || Date.now() - new Date(last.created_at).getTime() >= env.otp.resendCooldownSeconds * 1000;
    // Per-account hourly cap: a stolen identifier cannot be used to send unlimited SMS.
    const hourly = await query(
      `SELECT count(*)::int AS count FROM password_reset_otps
        WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [user.id]
    );
    const underHourlyCap = (hourly.rows[0]?.count ?? 0) < env.rateLimit.otpPerHour;

    if (cooledDown && underHourlyCap) {
      const otp = generateOtp();
      await withTransaction(async (c) => {
        await c.query(
          'UPDATE password_reset_otps SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL',
          [user.id]
        );
        await c.query(
          `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, requested_ip)
           VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
          [user.id, hashOtp(user.id, otp), env.otp.ttlMinutes, req.ip ?? null]
        );
      });

      
      sendOtpNotifications(user, otp).catch((e) => console.error('[otp] notify error:', e.message));
    }
  }

  res.json({
    message: 'If an account exists, a 6-digit OTP has been sent to the registered email and mobile number.',
  });
});

// Step 2: verify the OTP → returns a short-lived reset token.
export const verifyOtp = asyncHandler(async (req, res) => {
  const { role, identifier, otp } = req.body;
  const invalid = () => new AppError(400, 'Invalid or expired OTP');

  const user = await findUserByIdentifier(role, identifier);
  if (!user) throw invalid();

  const { rows } = await query(
    `SELECT * FROM password_reset_otps
      WHERE user_id = $1 AND consumed_at IS NULL AND verified_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const row = rows[0];
  if (!row) throw invalid();

  if (row.attempts >= env.otp.maxAttempts) {
    await query('UPDATE password_reset_otps SET consumed_at = now() WHERE id = $1', [row.id]);
    throw new AppError(429, 'Too many incorrect attempts. Please request a new OTP.');
  }

  if (!safeEqual(row.otp_hash, hashOtp(user.id, otp))) {
    await query('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw invalid();
  }

  await query('UPDATE password_reset_otps SET verified_at = now() WHERE id = $1', [row.id]);
  const resetToken = jwt.sign({ purpose: 'password_reset', otpId: row.id }, env.jwtSecret, {
    subject: user.id,
    expiresIn: '10m',
  });
  res.json({ resetToken });
});

// Step 3: set the new password using the reset token.
export const resetPassword = asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;
  const expired = () => new AppError(400, 'Reset session expired. Please start again.');

  let payload;
  try {
    payload = jwt.verify(resetToken, env.jwtSecret);
  } catch {
    throw expired();
  }
  if (payload.purpose !== 'password_reset') throw expired();

  const { rows } = await query(
    `SELECT id FROM password_reset_otps
      WHERE id = $1 AND user_id = $2
        AND verified_at IS NOT NULL AND consumed_at IS NULL
        AND verified_at > now() - interval '10 minutes'`,
    [payload.otpId, payload.sub]
  );
  if (!rows[0]) throw expired();

  const passwordHash = await bcrypt.hash(newPassword, env.bcryptRounds);
  await withTransaction(async (c) => {
    await c.query(
      'UPDATE users SET password_hash = $1, password_changed_at = now(), updated_at = now() WHERE id = $2',
      [passwordHash, payload.sub]
    );
    await c.query('UPDATE password_reset_otps SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [
      payload.sub,
    ]);
  });

  res.json({ message: 'Password updated successfully. You can now log in.' });
});
