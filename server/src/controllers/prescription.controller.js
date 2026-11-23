import fs from 'node:fs/promises';
import path from 'node:path';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { readPrescriptionFile, storePrescriptionFile } from '../services/prescriptionService.js';
import { prescriptionCreateSchema } from '../validators/app.validators.js';

const COLUMNS = `r.id, r.original_name AS "fileName", r.mime_type AS "mimeType", r.size_bytes AS "sizeBytes",
  r.doctor_name AS "doctorName", r.notes, r.status, r.review_note AS "reviewNote", r.valid_until AS "validUntil",
  r.reviewed_at AS "reviewedAt", r.created_at AS "createdAt", r.pharmacy_id AS "pharmacyId"`;

// POST /api/prescriptions   multipart/form-data: file, pharmacyId, doctorName?, notes?
export const createPrescription = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'Attach a prescription image (JPG/PNG) or PDF in the "file" field');

  const parsed = prescriptionCreateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { pharmacyId, doctorName, notes } = parsed.data;

  const type = await storePrescriptionFile(req.file);
  if (!type) throw new AppError(415, 'Unsupported file. Upload a JPG, PNG or PDF.');

  const ph = await query(
    `SELECT 1 FROM pharmacies WHERE user_id = $1 AND verification_status = 'approved'`, [pharmacyId]);
  if (!ph.rowCount) throw new AppError(400, 'Choose a verified MediSync pharmacy');

  const { rows } = await query(
    `INSERT INTO prescriptions
       (patient_id, pharmacy_id, original_name, stored_name, mime_type, size_bytes, doctor_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.user.id, pharmacyId, path.basename(req.file.originalname).slice(0, 120), type.storedName, type.mimeType,
     req.file.size, doctorName ?? null, notes ?? null]
  );
  res.status(201).json({ id: rows[0].id, status: 'pending' });
});

// GET /api/prescriptions[?status=pending]
//  patient  -> own prescriptions;  pharmacy -> prescriptions sent to it
export const listPrescriptions = asyncHandler(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const isPatient = req.user.role === 'patient';
  const { rows } = await query(
    `SELECT ${COLUMNS},
            ${isPatient ? 'ph.store_name AS "pharmacyName"' : 'pt.name AS "patientName"'}
       FROM prescriptions r
       ${isPatient ? 'LEFT JOIN pharmacies ph ON ph.user_id = r.pharmacy_id' : 'JOIN patients pt ON pt.user_id = r.patient_id'}
      WHERE ${isPatient ? 'r.patient_id' : 'r.pharmacy_id'} = $1
        AND ($2::text IS NULL OR r.status = $2)
      ORDER BY r.created_at DESC LIMIT 100`,
    [req.user.id, status]
  );
  res.json({ prescriptions: rows });
});

// GET /api/prescriptions/:id/file  – only the owner or the assigned pharmacy.
// Every open is recorded in prescription_file_access (health-data access audit), and the
// file is streamed from memory so an encrypted file never needs a plaintext copy on disk.
export const getPrescriptionFile = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT stored_name, mime_type, patient_id, pharmacy_id FROM prescriptions WHERE id = $1',
    [req.params.id]
  );
  const rx = rows[0];
  const allowed = rx && (rx.patient_id === req.user.id || rx.pharmacy_id === req.user.id);
  if (!allowed) throw new AppError(404, 'Prescription not found');

  let buffer;
  try {
    buffer = await readPrescriptionFile(rx.stored_name);
  } catch {
    throw new AppError(404, 'The prescription file is no longer available.');
  }

  await query(
    'INSERT INTO prescription_file_access (prescription_id, user_id, role) VALUES ($1, $2, $3)',
    [rx.id ?? req.params.id, req.user.id, req.user.role]
  ).catch((error) => console.error('[audit] file access log failed:', error.message));

  res.setHeader('Content-Type', rx.mime_type);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

// PATCH /api/prescriptions/:id/review   { decision, note?, validUntil? }  (verified pharmacy only)
export const reviewPrescription = asyncHandler(async (req, res) => {
  if (!req.pharmacy.pharmacist_reg_no) {
    throw new AppError(400, 'Add your registered pharmacist name and registration number before reviewing prescriptions.');
  }
  const { decision, note, validUntil } = req.body;
  const { rows } = await query(
    `UPDATE prescriptions
        SET status = $3, review_note = $4, reviewed_by = $2, reviewed_at = now(),
            valid_until = CASE WHEN $3 = 'approved'
                               THEN COALESCE($5::date, current_date + $6::int) END
      WHERE id = $1 AND pharmacy_id = $2 AND status = 'pending'
      RETURNING id, status, valid_until AS "validUntil"`,
    [req.params.id, req.user.id, decision, note ?? null, validUntil ?? null, env.prescriptionValidDays]
  );
  if (!rows[0]) throw new AppError(404, 'No pending prescription with this id for your pharmacy');
  res.json(rows[0]);
});

// DELETE /api/prescriptions/:id  (patient)
export const deletePrescription = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'DELETE FROM prescriptions WHERE id = $1 AND patient_id = $2 RETURNING stored_name', [req.params.id, req.user.id]);
  if (!rows[0]) throw new AppError(404, 'Prescription not found');
  await fs.unlink(path.join(prescriptionDir(), rows[0].stored_name)).catch(() => {});
  res.json({ message: 'Prescription deleted.' });
});
