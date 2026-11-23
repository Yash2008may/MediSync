import { query, withTransaction } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { attachItems } from './order.controller.js';

// GET /api/admin/orders?status=&pharmacyId=&limit=&offset=
// Cross-pharmacy oversight of every order, newest first.
export const listAllOrders = asyncHandler(async (req, res) => {
  const status = ['placed', 'confirmed', 'out_for_delivery', 'delivered', 'rejected', 'cancelled'].includes(
    req.query.status
  )
    ? req.query.status
    : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const params = [status, req.query.pharmacyId ?? null];
  const { rows } = await query(
    `SELECT o.id, o.status, o.fulfillment, o.final_price AS "finalPrice", o.created_at AS "createdAt",
            o.delivery_address AS "deliveryAddress", o.rejection_reason AS "rejectionReason",
            ph.store_name AS "pharmacyName", pt.name AS "patientName",
            r.status AS "prescriptionStatus"
       FROM orders o
       LEFT JOIN pharmacies ph ON ph.user_id = o.pharmacy_id
       LEFT JOIN patients pt ON pt.user_id = o.patient_id
       LEFT JOIN prescriptions r ON r.id = o.prescription_id
      WHERE ($1::text IS NULL OR o.status = $1)
        AND ($2::uuid IS NULL OR o.pharmacy_id = $2)
      ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,
    [...params, limit, offset]
  );
  const total = await query(
    `SELECT count(*)::int AS count FROM orders o
      WHERE ($1::text IS NULL OR o.status = $1) AND ($2::uuid IS NULL OR o.pharmacy_id = $2)`,
    params
  );
  res.json({ orders: await attachItems(rows), total: total.rows[0]?.count ?? 0, limit, offset });
});

// GET /api/admin/users?role=&q= — account directory (no password data, ever).
export const listUsers = asyncHandler(async (req, res) => {
  const role = ['patient', 'pharmacy', 'admin'].includes(req.query.role) ? req.query.role : null;
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  const { rows } = await query(
    `SELECT u.id, u.role, u.email, u.phone, u.is_active AS "isActive", u.created_at AS "createdAt",
            COALESCE(pt.name, ph.store_name) AS name,
            ph.license_number AS "licenseNumber", ph.verification_status AS "verificationStatus",
            ph.needs_review AS "needsReview"
       FROM users u
       LEFT JOIN patients pt ON pt.user_id = u.id
       LEFT JOIN pharmacies ph ON ph.user_id = u.id
      WHERE ($1::text IS NULL OR u.role = $1)
        AND ($2::text = '' OR u.email ILIKE '%' || $2 || '%' OR u.phone LIKE '%' || $2 || '%'
             OR pt.name ILIKE '%' || $2 || '%' OR ph.store_name ILIKE '%' || $2 || '%')
      ORDER BY u.created_at DESC LIMIT 100`,
    [role, q]
  );
  res.json({ users: rows });
});

// PATCH /api/admin/users/:id/account { active } — suspend or re-enable any non-admin account.
export const setUserAccount = asyncHandler(async (req, res) => {
  const { active } = req.body;
  const userId = req.params.id;

  const updated = await withTransaction(async (c) => {
    const found = await c.query(`SELECT id, role, email FROM users WHERE id = $1 AND role <> 'admin'`, [userId]);
    const user = found.rows[0];
    if (!user) throw new AppError(404, 'Account not found');
    await c.query('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1', [userId, active]);
    await c.query('INSERT INTO admin_audit_log (admin_id, action, target_id, note) VALUES ($1, $2, $3, $4)', [
      req.user.id,
      active ? 'account_reactivated' : 'account_suspended',
      userId,
      `${user.role} ${user.email}`,
    ]);
    return user;
  });

  res.json({ id: userId, role: updated.role, isActive: active });
});
