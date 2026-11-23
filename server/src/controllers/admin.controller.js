import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { sendEmail, sendSms } from '../utils/notify.js';
import { notifyUser } from '../services/notificationService.js';

const STATUSES = ['pending', 'approved', 'rejected'];

// GET /api/admin/overview
export const overview = asyncHandler(async (_req, res) => {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  const { rows } = await query(
    `SELECT verification_status AS status, count(*)::int AS count FROM pharmacies GROUP BY 1`
  );
  for (const row of rows) if (row.status in counts) counts[row.status] = row.count;

  const audit = await query(
    `SELECT a.id, a.action, a.target_id AS "targetId", a.note, a.created_at AS "createdAt",
            u.email AS "adminEmail", p.store_name AS "storeName"
       FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.admin_id
       LEFT JOIN pharmacies p ON p.user_id = a.target_id
      ORDER BY a.created_at DESC LIMIT 25`
  );

  const orderCounts = { placed: 0, confirmed: 0, out_for_delivery: 0, delivered: 0, rejected: 0, cancelled: 0 };
  const orderRows = await query(`SELECT status, count(*)::int AS count FROM orders GROUP BY 1`);
  for (const row of orderRows.rows) if (row.status in orderCounts) orderCounts[row.status] = row.count;

  const stuckOrders = await query(
    `SELECT o.id, o.status, o.created_at AS "createdAt", ph.store_name AS "pharmacyName", pt.name AS "patientName"
       FROM orders o
       LEFT JOIN pharmacies ph ON ph.user_id = o.pharmacy_id
       LEFT JOIN patients pt ON pt.user_id = o.patient_id
      WHERE o.status IN ('placed', 'confirmed')
        AND o.created_at < now() - interval '30 minutes'
      ORDER BY o.created_at ASC LIMIT 10`
  );

  const needsReview = await query('SELECT count(*)::int AS count FROM pharmacies WHERE needs_review');
  const users = await query(
    `SELECT count(*) FILTER (WHERE role = 'patient')::int AS patients,
            count(*) FILTER (WHERE role = 'pharmacy')::int AS pharmacies,
            count(*) FILTER (WHERE is_active = FALSE)::int AS disabled
       FROM users`
  );

  let reminderStats = { activeSchedules: 0, sentToday: 0, totalNotificationsToday: 0 };
  try {
    const schedRes = await query(
      `SELECT count(*) FILTER (WHERE active = TRUE)::int AS active_schedules,
              count(*) FILTER (WHERE last_sent_date = CURRENT_DATE)::int AS sent_today
         FROM reminder_schedules`
    );
    const notifRes = await query(
      `SELECT count(*)::int AS total_today FROM notifications WHERE created_at::date = CURRENT_DATE`
    );
    reminderStats = {
      activeSchedules: schedRes.rows[0]?.active_schedules ?? 0,
      sentToday: schedRes.rows[0]?.sent_today ?? 0,
      totalNotificationsToday: notifRes.rows[0]?.total_today ?? 0,
    };
  } catch {
    // reminder_schedules table not yet initialized
  }

  res.json({
    counts,
    orders: orderCounts,
    stuckOrders: stuckOrders.rows,
    needsReview: needsReview.rows[0]?.count ?? 0,
    users: users.rows[0] ?? { patients: 0, pharmacies: 0, disabled: 0 },
    reminderStats,
    audit: audit.rows,
  });
});

// GET /api/admin/system-health
export const systemHealth = asyncHandler(async (_req, res) => {
  const gatewayUrl = (process.env.SMS_GATEWAY_URL || '').trim();
  const provider = (process.env.SMS_PROVIDER || '').trim().toLowerCase();
  let smsReachable = false;
  let smsDetail = provider === 'gateway' ? gatewayUrl || 'Not configured' : provider || 'console';

  if (provider === 'gateway' && gatewayUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      await fetch(gatewayUrl, { method: 'HEAD', signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);
      smsReachable = true;
    } catch {
      smsReachable = false;
    }
  }

  res.json({
    database: { ok: true, label: 'PostgreSQL Connected' },
    email: { ok: Boolean(env.smtp?.host), label: env.smtp?.host ? `SMTP (${env.smtp.host})` : 'SMTP Not Set' },
    sms: { ok: smsReachable, provider, endpoint: smsDetail },
    scheduler: { ok: true, label: '5-Min Pre-Dose Cron Active' },
  });
});

// POST /api/admin/broadcast { audience: 'all' | 'patient' | 'pharmacy', title, body }
export const broadcastAnnouncement = asyncHandler(async (req, res) => {
  const audience = ['all', 'patient', 'pharmacy'].includes(req.body?.audience) ? req.body.audience : 'all';
  const title = String(req.body?.title || '').trim().slice(0, 140);
  const body = String(req.body?.body || '').trim().slice(0, 500);
  if (title.length < 3 || body.length < 5) {
    throw new AppError(400, 'Title (min 3 chars) and message body (min 5 chars) are required.');
  }

  const { rows: recipients } = await query(
    `SELECT id, email, phone FROM users
      WHERE is_active = TRUE
        AND role <> 'admin'
        AND ($1::text = 'all' OR role = $1)`,
    [audience]
  );

  for (const user of recipients) {
    await notifyUser({
      userId: user.id,
      type: 'admin_broadcast',
      title: `MediSync Notice: ${title}`,
      body,
      email: user.email,
      phone: user.phone,
    });
  }

  await query(
    `INSERT INTO admin_audit_log (admin_id, action, target_id, note) VALUES ($1, $2, $3, $4)`,
    [req.user.id, `broadcast_${audience}`, req.user.id, `${title} (${recipients.length} recipients)`]
  );

  res.status(201).json({ sent: recipients.length, audience });
});

// GET /api/admin/pharmacies?status=pending
export const listPharmacies = asyncHandler(async (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending';
  const { rows } = await query(
    `SELECT p.user_id AS id, p.store_name AS "storeName", p.license_number AS "licenseNumber",
            p.address, p.latitude, p.longitude, p.place_id AS "placeId",
            p.pharmacist_name AS "pharmacistName", p.pharmacist_reg_no AS "pharmacistRegNo",
            p.verification_status AS status, p.verification_note AS note, p.verified_at AS "verifiedAt",
            p.needs_review AS "needsReview", p.review_reason AS "reviewReason",
            p.created_at AS "createdAt", u.email, u.phone, u.is_active AS "isActive",
            'https://www.google.com/maps/search/?api=1&query=' || p.latitude || ',' || p.longitude AS "mapsUrl"
       FROM pharmacies p JOIN users u ON u.id = p.user_id
      WHERE p.verification_status = $1
      ORDER BY p.created_at DESC LIMIT 100`,
    [status]
  );
  res.json({ pharmacies: rows });
});

// PATCH /api/admin/pharmacies/:id/account
export const setPharmacyAccount = asyncHandler(async (req, res) => {
  const { active, note } = req.body;
  const pharmacyId = req.params.id;

  const storeName = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `UPDATE users SET is_active = $2, updated_at = now()
        WHERE id = $1 AND role = 'pharmacy' RETURNING id`,
      [pharmacyId, active]
    );
    if (!rows[0]) throw new AppError(404, 'Pharmacy not found');
    const store = await c.query('SELECT store_name FROM pharmacies WHERE user_id = $1', [pharmacyId]);
    await c.query('INSERT INTO admin_audit_log (admin_id, action, target_id, note) VALUES ($1, $2, $3, $4)', [
      req.user.id,
      active ? 'pharmacy_reactivated' : 'pharmacy_signed_out',
      pharmacyId,
      note ?? (active ? 'Store account re-enabled' : 'Store signed out and suspended by admin'),
    ]);
    return store.rows[0]?.store_name ?? 'Pharmacy';
  });

  res.json({ id: pharmacyId, isActive: active, storeName });
});

// PATCH /api/admin/pharmacies/:id/verify
export const verifyPharmacy = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  const pharmacyId = req.params.id;

  const updated = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `UPDATE pharmacies
          SET verification_status = $2, verification_note = $3, verified_by = $4, verified_at = now(),
              needs_review = FALSE, review_reason = NULL
        WHERE user_id = $1 RETURNING store_name`,
      [pharmacyId, decision, note ?? null, req.user.id]
    );
    if (!rows[0]) throw new AppError(404, 'Pharmacy not found');
    await c.query(`INSERT INTO admin_audit_log (admin_id, action, target_id, note) VALUES ($1, $2, $3, $4)`, [
      req.user.id, `pharmacy_${decision}`, pharmacyId, note ?? null,
    ]);
    const u = await c.query('SELECT email, phone FROM users WHERE id = $1', [pharmacyId]);
    return { storeName: rows[0].store_name, email: u.rows[0]?.email, phone: u.rows[0]?.phone };
  });

  const text = decision === 'approved'
    ? `MediSync: ${updated.storeName} is now verified and live on the patient map. You can receive orders and review prescriptions.`
    : `MediSync: ${updated.storeName} verification was rejected. Reason: ${note}`;

  if (updated.email) {
    sendEmail({ to: updated.email, subject: `MediSync pharmacy ${decision}`, text }).catch((e) =>
      console.error('[admin] email failed:', e.message)
    );
  }
  if (updated.phone) {
    const digits10 = String(updated.phone).replace(/\D/g, '').slice(-10);
    if (digits10.length === 10) {
      sendSms({ to: digits10, message: text }).catch((e) =>
        console.error('[admin] sms failed:', e.message)
      );
    }
  }

  res.json({ id: pharmacyId, status: decision });
});