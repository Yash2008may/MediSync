import fs from 'node:fs/promises';
import path from 'node:path';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { latestConsents } from './consentService.js';
import { getProfile } from './userService.js';

export const prescriptionDir = () => path.resolve(env.uploadDir, 'prescriptions');

// Everything we hold about the user, as JSON (data-access right).
export async function exportAccountData(user) {
  const data = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, role: user.role, email: user.email, phone: user.phone },
    profile: await getProfile(user),
    consents: await latestConsents(user.id),
  };

  if (user.role === 'patient') {
    const q = async (sql) => (await query(sql, [user.id])).rows;
    data.prescriptions = await q(
      `SELECT id, original_name, doctor_name, notes, status, review_note, valid_until, created_at
         FROM prescriptions WHERE patient_id = $1 ORDER BY created_at`);
    data.medicines = await q(
      `SELECT m.id, m.name, m.dosage, m.stock_remaining, m.mrp,
              COALESCE(json_agg(s.time_of_day ORDER BY s.time_of_day) FILTER (WHERE s.id IS NOT NULL), '[]') AS times
         FROM patient_medicines m LEFT JOIN medication_schedules s ON s.patient_medicine_id = m.id
        WHERE m.patient_id = $1 GROUP BY m.id`);
    data.orders = await q(
      `SELECT o.id, o.status, o.delivery_type, o.delivery_address, o.final_price, o.payment_method,
              o.payment_status, o.created_at,
              (SELECT json_agg(json_build_object('medicine', i.medicine_name, 'quantity', i.quantity, 'mrp', i.mrp))
                 FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o WHERE o.patient_id = $1 ORDER BY o.created_at`);
  }
  return data;
}

// Right to erasure. Orders are kept (financial records) but stripped of personal data.
export async function deleteAccount(user) {
  if (user.role === 'admin') throw new AppError(403, 'Admin accounts cannot be self-deleted');
  const filesToRemove = [];

  await withTransaction(async (c) => {
    if (user.role === 'patient') {
      const { rows } = await c.query('SELECT stored_name FROM prescriptions WHERE patient_id = $1', [user.id]);
      filesToRemove.push(...rows.map((r) => r.stored_name));
      await c.query(
        `UPDATE orders SET delivery_address = '[deleted]', delivery_lat = NULL, delivery_lng = NULL, delivery_alt = NULL
          WHERE patient_id = $1`,
        [user.id]
      );
    } else {
      const open = await c.query(
        `SELECT 1 FROM orders WHERE pharmacy_id = $1 AND status NOT IN ('delivered', 'cancelled') LIMIT 1`,
        [user.id]
      );
      if (open.rowCount) throw new AppError(409, 'Finish or cancel your open orders before deleting this account.');
    }
    await c.query('DELETE FROM order_messages WHERE sender_id = $1', [user.id]);
    await c.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  await Promise.allSettled(filesToRemove.map((f) => fs.unlink(path.join(prescriptionDir(), f))));
}
