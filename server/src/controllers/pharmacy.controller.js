import { query } from '../config/db.js';
import { asyncHandler } from '../utils/AppError.js';

// PATCH /api/pharmacies/me/pharmacist  – registered pharmacist who reviews Schedule H prescriptions
export const setPharmacist = asyncHandler(async (req, res) => {
  const { pharmacistName, pharmacistRegNo } = req.body;
  await query('UPDATE pharmacies SET pharmacist_name = $2, pharmacist_reg_no = $3 WHERE user_id = $1', [
    req.user.id, pharmacistName, pharmacistRegNo,
  ]);
  res.json({ pharmacistName, pharmacistRegNo });
});
