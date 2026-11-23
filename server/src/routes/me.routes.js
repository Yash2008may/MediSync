import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { consentSchema, deleteAccountSchema, profileUpdateSchema } from '../validators/app.validators.js';
import { deleteMe, exportData, listConsents, setConsent, updateProfile } from '../controllers/me.controller.js';

const router = Router();
router.use(requireAuth);

router.patch('/profile', validate(profileUpdateSchema), updateProfile);
router.get('/consents', listConsents);
router.post('/consents', validate(consentSchema), setConsent);
router.get('/export', exportData);                              // download my data (JSON)
router.delete('/', validate(deleteAccountSchema), deleteMe);    // delete account + personal data

export default router;
