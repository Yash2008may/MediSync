import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { inventoryItemSchema, inventoryUpdateSchema, pharmacistSchema } from '../validators/app.validators.js';
import { setPharmacist } from '../controllers/pharmacy.controller.js';
import {
  addInventoryItem,
  getCatalog,
  listMyInventory,
  removeInventoryItem,
  updateInventoryItem,
} from '../controllers/inventory.controller.js';

const router = Router();
router.use(requireAuth);

// The orderable price list of a verified store (patients and pharmacies can read it).
router.get('/:id/catalog', requireRole('patient', 'pharmacy', 'admin'), getCatalog);

router.use(requireRole('pharmacy'));
router.patch('/me/pharmacist', validate(pharmacistSchema), setPharmacist);

// Catalogue (price list) management. Prices quoted to patients always come from here.
router.get('/me/inventory', listMyInventory);
router.post('/me/inventory', validate(inventoryItemSchema), addInventoryItem);
router.patch('/me/inventory/:id', validate(inventoryUpdateSchema), updateInventoryItem);
router.delete('/me/inventory/:id', removeInventoryItem);

export default router;
