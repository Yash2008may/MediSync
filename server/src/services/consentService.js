import { query } from '../config/db.js';

// Bump when content/privacy-policy.md changes in a way users must re-accept.
export const PRIVACY_POLICY_VERSION = '2026-11-draft-1';

export async function recordConsent(db, userId, type, granted, version = PRIVACY_POLICY_VERSION) {
  await db.query('INSERT INTO user_consents (user_id, type, granted, version) VALUES ($1, $2, $3, $4)', [
    userId, type, granted, version,
  ]);
}

export async function latestConsents(userId) {
  const { rows } = await query(
    `SELECT DISTINCT ON (type) type, granted, version, created_at AS "at"
       FROM user_consents WHERE user_id = $1
      ORDER BY type, created_at DESC`,
    [userId]
  );
  return Object.fromEntries(rows.map((r) => [r.type, { granted: r.granted, version: r.version, at: r.at }]));
}

export async function hasConsent(userId, type) {
  return (await latestConsents(userId))[type]?.granted === true;
}
