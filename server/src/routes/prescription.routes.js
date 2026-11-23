import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireApprovedPharmacy } from '../middleware/pharmacy.js';
import { validate } from '../middleware/validate.js';
import { uploadSingleFile } from '../middleware/upload.js';
import { prescriptionReviewSchema } from '../validators/app.validators.js';
import {
  createPrescription, deletePrescription, getPrescriptionFile, listPrescriptions, reviewPrescription,
} from '../controllers/prescription.controller.js';

const router = Router();
router.use(requireAuth);

router.post('/', requireRole('patient'), uploadSingleFile, createPrescription);
router.get('/', requireRole('patient', 'pharmacy'), listPrescriptions);
router.get('/:id/file', requireRole('patient', 'pharmacy'), getPrescriptionFile);
router.patch('/:id/review', requireRole('pharmacy'), requireApprovedPharmacy, validate(prescriptionReviewSchema), reviewPrescription);
router.delete('/:id', requireRole('patient'), deletePrescription);

export default router;
