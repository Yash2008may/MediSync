import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  dispatchAlert,
  getCareSettings,
  listMine,
  markAllRead,
  markRead,
  saveCareSettings,
  syncSchedules,
  testCaregiverAlert,
} from '../controllers/notification.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', listMine);
router.get('/care-settings', getCareSettings);
router.put('/care-settings', saveCareSettings);
router.post('/care-settings/test', testCaregiverAlert);
router.post('/schedules', syncSchedules);
router.post('/alert', dispatchAlert);
router.post('/read-all', markAllRead);
router.patch('/:id/read', markRead);

export default router;