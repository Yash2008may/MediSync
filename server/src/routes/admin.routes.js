import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { adminAccountSchema, adminVerifySchema } from '../validators/app.validators.js';
import {
  broadcastAnnouncement,
  listPharmacies,
  overview,
  setPharmacyAccount,
  systemHealth,
  verifyPharmacy,
} from '../controllers/admin.controller.js';
import { listAllOrders, listUsers, setUserAccount } from '../controllers/adminOverview.controller.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/overview', overview);
router.get('/system-health', systemHealth);
router.post('/broadcast', broadcastAnnouncement);
router.get('/orders', listAllOrders);
router.get('/users', listUsers);
router.get('/pharmacies', listPharmacies);
router.patch('/pharmacies/:id/verify', validate(adminVerifySchema), verifyPharmacy);
router.patch('/pharmacies/:id/account', validate(adminAccountSchema), setPharmacyAccount);
router.patch('/users/:id/account', validate(adminAccountSchema), setUserAccount);

export default router;