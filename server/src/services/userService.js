import { query } from '../config/db.js';
import { normalizePhone } from '../utils/phone.js';

// Patients log in with email OR mobile; pharmacies with email OR drug licence number.
export async function findUserByIdentifier(role, identifier) {
  const id = String(identifier).trim();
  if (role === 'admin') {
    const { rows } = await query(`SELECT * FROM users WHERE role = 'admin' AND lower(email) = lower($1) LIMIT 1`, [id]);
    return rows[0];
  }
  if (role === 'patient') {
    const { rows } = await query(
      `SELECT * FROM users
        WHERE role = 'patient' AND (lower(email) = lower($1) OR phone = $2)
        LIMIT 1`,
      [id, normalizePhone(id)]
    );
    return rows[0];
  }
  const { rows } = await query(
    `SELECT u.* FROM users u
       JOIN pharmacies p ON p.user_id = u.id
      WHERE u.role = 'pharmacy'
        AND (lower(u.email) = lower($1) OR upper(p.license_number) = upper($1))
      LIMIT 1`,
    [id]
  );
  return rows[0];
}

export async function getProfile(user) {
  if (user.role === 'patient') {
    const { rows } = await query(
      `SELECT name, address, home_lat AS "homeLat", home_lng AS "homeLng", timezone,
              notify_sms AS "notifySms", notify_email AS "notifyEmail",
              live_lat AS "liveLat", live_lng AS "liveLng", live_alt AS "liveAlt",
              live_accuracy_m AS "liveAccuracyM", live_address AS "liveAddress", live_updated_at AS "liveUpdatedAt"
         FROM patients WHERE user_id = $1`,
      [user.id]
    );
    return rows[0] ?? null;
  }
  const { rows } = await query(
    `SELECT store_name AS "storeName", license_number AS "licenseNumber", address,
            latitude, longitude, place_id AS "placeId", maps_verified AS "mapsVerified",
            verification_status AS "verificationStatus", verification_note AS "verificationNote",
            needs_review AS "needsReview", review_reason AS "reviewReason",
            pharmacist_name AS "pharmacistName", pharmacist_reg_no AS "pharmacistRegNo"
       FROM pharmacies WHERE user_id = $1`,
    [user.id]
  );
  return rows[0] ?? null;
}

export async function toPublicUser(user) {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    phone: user.phone,
    profile: await getProfile(user),
  };
}
