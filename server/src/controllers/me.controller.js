import bcrypt from 'bcrypt';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { PRIVACY_POLICY_VERSION, latestConsents, recordConsent } from '../services/consentService.js';
import { deleteAccount, exportAccountData } from '../services/accountService.js';
import { toPublicUser } from '../services/userService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Public: GET /api/privacy/policy
export const getPolicy = asyncHandler(async (_req, res) => {
  const markdown = await fs.readFile(path.join(__dirname, '../../content/privacy-policy.md'), 'utf8');
  res.json({ version: PRIVACY_POLICY_VERSION, markdown });
});

export const listConsents = asyncHandler(async (req, res) => {
  res.json({ policyVersion: PRIVACY_POLICY_VERSION, consents: await latestConsents(req.user.id) });
});

export const setConsent = asyncHandler(async (req, res) => {
  const { type, granted } = req.body;
  const isPatient = req.user.role === 'patient';

  if (!granted && (type === 'privacy_policy' || type === 'health_data_processing')) {
    throw new AppError(400, 'To withdraw this consent, delete your account (Settings → Delete my account).');
  }
  if (type !== 'privacy_policy' && !isPatient) throw new AppError(403, 'This consent applies to patient accounts only');

  await recordConsent({ query }, req.user.id, type, granted);

  if (isPatient && type === 'notifications') {
    await query('UPDATE patients SET notify_sms = $2, notify_email = $2 WHERE user_id = $1', [req.user.id, granted]);
  }
  if (isPatient && type === 'location' && !granted) {
    // Withdrawing location consent erases what we hold
    await query(
      `UPDATE patients SET live_lat = NULL, live_lng = NULL, live_alt = NULL, live_accuracy_m = NULL,
              live_address = NULL, live_updated_at = NULL WHERE user_id = $1`,
      [req.user.id]
    );
    await query('DELETE FROM patient_default_stores WHERE patient_id = $1', [req.user.id]);
  }
  res.json({ consents: await latestConsents(req.user.id) });
});

// PATCH /api/me/profile — the signed-in user edits their own profile.
// Patients change name/address; pharmacies change store name/address; everyone can change the
// contact mobile. Login identity (email, drug licence, verified coordinates) is not editable.
// Every edit is written to profile_audit_log, and a pharmacy that changes its name or address is
// flagged for admin re-verification (the licence was checked against the old details).
export const updateProfile = asyncHandler(async (req, res) => {
  const { name, address, storeName, phone } = req.body;
  const role = req.user.role;

  if (role === 'admin' && (name || address || storeName)) {
    throw new AppError(400, 'Admin profiles only change the contact mobile number.');
  }
  if (role === 'admin' && !phone) throw new AppError(400, 'Nothing to update');

  try {
    await withTransaction(async (c) => {
      const current = await c.query('SELECT phone FROM users WHERE id = $1', [req.user.id]);
      const oldPhone = current.rows[0]?.phone ?? null;
      const changed = [];
      const oldValues = {};
      const newValues = {};

      if (phone && phone !== oldPhone) {
        await c.query('UPDATE users SET phone = $2, updated_at = now() WHERE id = $1', [req.user.id, phone]);
        changed.push('phone');
        oldValues.phone = oldPhone;
        newValues.phone = phone;
      }

      if (role === 'patient' && (name || address)) {
        const before = await c.query('SELECT name, address FROM patients WHERE user_id = $1', [req.user.id]);
        const row = before.rows[0] ?? {};
        await c.query(
          `UPDATE patients SET name = COALESCE($2, name), address = COALESCE($3, address)
            WHERE user_id = $1`,
          [req.user.id, name ?? null, address ?? null]
        );
        if (name && name !== row.name) {
          changed.push('name');
          oldValues.name = row.name ?? null;
          newValues.name = name;
        }
        if (address && address !== row.address) {
          changed.push('address');
          oldValues.address = row.address ?? null;
          newValues.address = address;
        }
      }

      if (role === 'pharmacy' && (storeName || address)) {
        const before = await c.query('SELECT store_name, address FROM pharmacies WHERE user_id = $1', [req.user.id]);
        const row = before.rows[0] ?? {};
        await c.query(
          `UPDATE pharmacies SET store_name = COALESCE($2, store_name), address = COALESCE($3, address)
            WHERE user_id = $1`,
          [req.user.id, storeName ?? null, address ?? null]
        );
        const nameChanged = Boolean(storeName && storeName !== row.store_name);
        const addressChanged = Boolean(address && address !== row.address);
        if (nameChanged) {
          changed.push('storeName');
          oldValues.storeName = row.store_name ?? null;
          newValues.storeName = storeName;
        }
        if (addressChanged) {
          changed.push('address');
          oldValues.address = row.address ?? null;
          newValues.address = address;
        }
        if (nameChanged || addressChanged) {
          await c.query(
            `UPDATE pharmacies SET needs_review = TRUE,
                    review_reason = 'Store name/address changed after verification — confirm the licence again.'
              WHERE user_id = $1`,
            [req.user.id]
          );
        }
      }

      if (changed.length) {
        await c.query(
          `INSERT INTO profile_audit_log (user_id, role, changed_fields, old_values, new_values)
           VALUES ($1, $2, $3, $4, $5)`,
          [req.user.id, role, changed, oldValues, newValues]
        );
      }
    });
  } catch (error) {
    if (error?.code === '23505') throw new AppError(409, 'That mobile number is already used by another account.');
    throw error;
  }

  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({ user: await toPublicUser(rows[0]) });
});

export const exportData = asyncHandler(async (req, res) => {
  const data = await exportAccountData(req.user);
  res.setHeader('Content-Disposition', 'attachment; filename="medisync-my-data.json"');
  res.json(data);
});

// DELETE /api/me   { password }
export const deleteMe = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(req.body.password, rows[0].password_hash))) {
    throw new AppError(401, 'Password is incorrect');
  }
  await deleteAccount(req.user);
  res.json({ message: 'Your account and personal data have been deleted.' });
});
