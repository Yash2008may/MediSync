import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireApprovedPharmacy } from '../middleware/pharmacy.js';
import { uploadSingleFile } from '../middleware/upload.js';
import {
  acceptOrder,
  advanceOrder,
  cancelOrder,
  createOrder,
  getOrder,
  listOrders,
  rejectOrder,
} from '../controllers/order.controller.js';

const router = Router();
router.use(requireAuth);

router.post('/', requireRole('patient'), uploadSingleFile, createOrder);
router.get('/', requireRole('patient', 'pharmacy', 'admin'), listOrders);
router.get('/:id', requireRole('patient', 'pharmacy', 'admin'), getOrder);
router.patch('/:id/accept', requireRole('pharmacy'), requireApprovedPharmacy, acceptOrder);
router.patch('/:id/reject', requireRole('pharmacy'), requireApprovedPharmacy, rejectOrder);
router.patch('/:id/status', requireRole('pharmacy'), requireApprovedPharmacy, advanceOrder);
router.patch('/:id/cancel', requireRole('patient'), cancelOrder);

export default router;
