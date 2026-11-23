import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { prescriptionDir } from './accountService.js';

// Removes health data once it is no longer needed:
// - prescription files that belong only to delivered/cancelled orders older than the retention window
// - notifications older than the notification window
// - expired reverse-geocode cache entries
// Idempotent, so it is safe to run from the daily scheduler and from `npm run db:retention`.
export async function runRetention() {
  const days = Number.isFinite(env.retentionDays) && env.retentionDays > 0 ? env.retentionDays : 180;

  const expired = await pool.query(
    `SELECT p.id, p.stored_name
       FROM prescriptions p
       JOIN orders o ON o.prescription_id = p.id
      WHERE o.status IN ('delivered', 'cancelled')
        AND COALESCE(o.delivered_at, o.updated_at, o.created_at) < now() - make_interval(days => $1)
        AND NOT EXISTS (
          SELECT 1 FROM orders open_order
           WHERE open_order.prescription_id = p.id
             AND open_order.status NOT IN ('delivered', 'cancelled')
        )`,
    [days]
  );

  for (const row of expired.rows) {
    await fs.unlink(path.join(prescriptionDir(), row.stored_name)).catch(() => {});
  }
  const removedRows = expired.rows.length
    ? await pool.query('DELETE FROM prescriptions WHERE id = ANY($1::uuid[])', [expired.rows.map((row) => row.id)])
    : { rowCount: 0 };

  const notifications = await pool.query(
    'DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1)',
    [env.notificationRetentionDays]
  );
  const cache = await pool.query('DELETE FROM geocode_cache WHERE expires_at < now()');

  return {
    files: expired.rows.length,
    prescriptions: removedRows.rowCount,
    notifications: notifications.rowCount,
    cache: cache.rowCount,
  };
}
