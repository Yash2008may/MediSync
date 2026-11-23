import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { defaultLocationSchema, locationSchema } from '../validators/app.validators.js';
import {
  clearLiveLocation,
  getDefaultLocation,
  listDefaultStores,
  saveDefaultLocation,
  getPortalState,
  savePortalState,
  updateLiveLocation,
} from '../controllers/patient.controller.js';

// watchPosition can fire often; cap per user so Google API usage stays bounded.
const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: { message: 'Location updates are too frequent. Please slow down.' } },
});

const router = Router();
router.use(requireAuth, requireRole('patient'));

router.put('/me/location', locationLimiter, validate(locationSchema), updateLiveLocation);
router.delete('/me/location', clearLiveLocation);
router.get('/me/default-stores', listDefaultStores);
router.get('/me/default-location', getDefaultLocation);
router.put('/me/default-location', validate(defaultLocationSchema), saveDefaultLocation);

router.get('/me/portal-state', getPortalState);
router.put('/me/portal-state', savePortalState);

export default router;
