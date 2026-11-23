import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { validate, validateQuery } from '../middleware/validate.js';
import { geocodeAddressSchema, nearbyQuerySchema, reverseGeocodeSchema } from '../validators/app.validators.js';
import { autocomplete, geocode, nearby, reverse , ensurePartner } from '../controllers/stores.controller.js';

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  message: { error: { message: 'Too many map look-ups. Please wait a minute.' } },
});

const router = Router();
router.use(requireAuth, limiter);

router.get('/autocomplete', autocomplete);
router.get('/nearby', validateQuery(nearbyQuerySchema), nearby);
router.post('/reverse-geocode', validate(reverseGeocodeSchema), reverse);
router.post('/geocode', validate(geocodeAddressSchema), geocode);
router.post('/ensure-partner', ensurePartner);

export default router;
