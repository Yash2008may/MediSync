import { query } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/AppError.js';

// Only licence-verified pharmacies may review prescriptions, take orders, etc.
export const requireApprovedPharmacy = asyncHandler(async (req, _res, next) => {
  const { rows } = await query('SELECT * FROM pharmacies WHERE user_id = $1', [req.user.id]);
  const pharmacy = rows[0];
  if (!pharmacy) throw new AppError(403, 'Pharmacy account required');
  if (pharmacy.verification_status === 'pending') {
    throw new AppError(403, 'Your pharmacy is awaiting licence verification.');
  }
  if (pharmacy.verification_status === 'rejected') {
    throw new AppError(403, `Your pharmacy registration was rejected. ${pharmacy.verification_note ?? ''}`.trim());
  }
  req.pharmacy = pharmacy;
  next();
});
