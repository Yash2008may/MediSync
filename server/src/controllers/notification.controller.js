import { query } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { listNotifications, notifyUser } from '../services/notificationService.js';
import { sendEmail, sendSms } from '../utils/notify.js';

export const listMine = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  res.json(await listNotifications(req.user.id, limit));
});

export const getCareSettings = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT caregiver_name AS "caregiverName", caregiver_phone AS "caregiverPhone",
            caregiver_email AS "caregiverEmail", preferred_lang AS "preferredLang"
       FROM patient_care_settings WHERE user_id = $1`,
    [req.user.id]
  );
  res.json(
    rows[0] ?? { caregiverName: '', caregiverPhone: '', caregiverEmail: '', preferredLang: 'en' }
  );
});

export const saveCareSettings = asyncHandler(async (req, res) => {
  const caregiverName = String(req.body?.caregiverName ?? '').trim().slice(0, 100);
  const caregiverPhone = String(req.body?.caregiverPhone ?? '').trim().slice(0, 25);
  const caregiverEmail = String(req.body?.caregiverEmail ?? '').trim().slice(0, 120);
  const preferredLang = ['en', 'kn', 'hi'].includes(req.body?.preferredLang) ? req.body.preferredLang : 'en';

  await query(
    `INSERT INTO patient_care_settings (user_id, caregiver_name, caregiver_phone, caregiver_email, preferred_lang, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET
       caregiver_name = EXCLUDED.caregiver_name,
       caregiver_phone = EXCLUDED.caregiver_phone,
       caregiver_email = EXCLUDED.caregiver_email,
       preferred_lang = EXCLUDED.preferred_lang,
       updated_at = now()`,
    [req.user.id, caregiverName, caregiverPhone, caregiverEmail, preferredLang]
  );

  res.json({ caregiverName, caregiverPhone, caregiverEmail, preferredLang });
});

export const syncSchedules = asyncHandler(async (req, res) => {
  const rawList = Array.isArray(req.body?.schedules) ? req.body.schedules : [];
  const cleaned = rawList
    .map((item) => ({
      medName: String(item.medName || item.name || '').trim().slice(0, 120),
      dosage: String(item.strength || item.dosage || '').trim().slice(0, 80),
      instructions: String(item.instructions || item.dosage || '').trim().slice(0, 120),
      doseTime: String(item.doseTime || item.time || '').trim(),
      active: item.active !== false && !item.taken,
    }))
    .filter((item) => item.medName && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.doseTime));

  await query('DELETE FROM reminder_schedules WHERE user_id = $1', [req.user.id]);

  for (const item of cleaned) {
    await query(
      `INSERT INTO reminder_schedules (user_id, med_name, dosage, instructions, dose_time, active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, item.medName, item.dosage, item.instructions, item.doseTime, item.active]
    );
  }

  res.json({ synced: cleaned.length });
});

export const dispatchAlert = asyncHandler(async (req, res) => {
  const type = String(req.body?.type || 'medication_reminder').slice(0, 60);
  const title = String(req.body?.title || 'MediSync Medication Reminder').trim().slice(0, 160);
  const body = String(req.body?.body || 'It is time to take your scheduled medication.').trim().slice(0, 1000);

  const emailSubject = req.body?.emailSubject ? String(req.body.emailSubject).trim().slice(0, 160) : null;
  const emailBody = req.body?.emailBody ? String(req.body.emailBody).trim().slice(0, 1000) : null;

  const id = await notifyUser({
    userId: req.user.id,
    type,
    title,
    body,
    emailSubject,
    emailBody,
  });

  res.status(201).json({ id, dispatched: true });
});

export const markRead = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE notifications SET read_at = now()
      WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) {
    const exists = await query('SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!exists.rowCount) throw new AppError(404, 'Notification not found');
  }
  res.json({ id: req.params.id, read: true });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
    [req.user.id]
  );
  res.json({ updated: rowCount });
});
export const testCaregiverAlert = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.caregiver_name, c.caregiver_phone, c.caregiver_email, COALESCE(p.name, u.email) AS patient_name
       FROM users u
       LEFT JOIN patients p ON p.user_id = u.id
       LEFT JOIN patient_care_settings c ON c.user_id = u.id
      WHERE u.id = $1`,
    [req.user.id]
  );
  const care = rows[0];
  if (!care || (!care.caregiver_phone && !care.caregiver_email)) {
    throw new AppError(400, 'Save a caregiver phone number or email first.');
  }
  const msg = `MediSync Caregiver Alert: ${care.patient_name} missed their scheduled dose (30 mins overdue). Please check in with them.`;
  if (care.caregiver_email) {
    await sendEmail({
      to: care.caregiver_email,
      subject: `MediSync Caregiver Escalation · ${care.patient_name}`,
      text: `MediSync ಆರೈಕೆದಾರರ ಎಚ್ಚರಿಕೆ:\n${care.patient_name} ಅವರು ನಿಗದಿತ ಸಮಯಕ್ಕೆ ಔಷಧಿಯನ್ನು ತೆಗೆದುಕೊಂಡಿಲ್ಲ.\n\n(${msg})`,
    });
  }
  if (care.caregiver_phone) {
    const digits10 = String(care.caregiver_phone).replace(/\D/g, '').slice(-10);
    if (digits10.length === 10) {
      await sendSms({ to: digits10, message: msg });
    }
  }
  res.json({ sent: true, toPhone: care.caregiver_phone || null, toEmail: care.caregiver_email || null });
});