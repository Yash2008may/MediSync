import { query } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/AppError.js';

const COLUMNS = `id, pharmacy_id AS "pharmacyId", medicine_name AS "medicineName", brand,
  pack_size AS "packSize", mrp::float8 AS mrp, discount_pct::float8 AS "discountPct",
  stock_qty AS "stockQty",
  is_schedule_h AS "isScheduleH", updated_at AS "updatedAt"`;

// GET /api/pharmacies/me/inventory — the pharmacy's full price list (including out of stock)
export const listMyInventory = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM pharmacy_inventory WHERE pharmacy_id = $1 ORDER BY medicine_name`,
    [req.user.id]
  );
  res.json({ inventory: rows });
});

// POST /api/pharmacies/me/inventory
export const addInventoryItem = asyncHandler(async (req, res) => {
  const { medicineName, brand, packSize, mrp, discountPct = 0, stockQty, isScheduleH = false } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO pharmacy_inventory
         (pharmacy_id, medicine_name, brand, pack_size, mrp, discount_pct, stock_qty, is_schedule_h)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [req.user.id, medicineName, brand ?? null, packSize ?? null, mrp, discountPct, stockQty, isScheduleH]
    );
    res.status(201).json({ item: rows[0] });
  } catch (error) {
    if (error?.code === '23505') throw new AppError(409, 'That medicine is already on your price list.');
    throw error;
  }
});

// PATCH /api/pharmacies/me/inventory/:id
export const updateInventoryItem = asyncHandler(async (req, res) => {
  const fields = {
    medicineName: 'medicine_name',
    brand: 'brand',
    packSize: 'pack_size',
    mrp: 'mrp',
    discountPct: 'discount_pct',
    stockQty: 'stock_qty',
    isScheduleH: 'is_schedule_h',
  };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(fields)) {
    if (req.body[key] === undefined) continue;
    values.push(req.body[key]);
    sets.push(`${column} = $${values.length}`);
  }
  if (!sets.length) throw new AppError(400, 'Nothing to update');

  values.push(req.params.id, req.user.id);
  const { rows } = await query(
    `UPDATE pharmacy_inventory SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${values.length - 2} AND pharmacy_id = $${values.length - 1}
      RETURNING ${COLUMNS}`,
    values
  );
  if (!rows[0]) throw new AppError(404, 'Medicine not found on your price list');
  res.json({ item: rows[0] });
});

// DELETE /api/pharmacies/me/inventory/:id
export const removeInventoryItem = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'DELETE FROM pharmacy_inventory WHERE id = $1 AND pharmacy_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) throw new AppError(404, 'Medicine not found on your price list');
  res.json({ id: rows[0].id });
});

// GET /api/pharmacies/:id/catalog — what a patient can order from a verified store.
// Only verified stores are listed, and only medicines with stock are orderable.
export const getCatalog = asyncHandler(async (req, res) => {
  const pharmacy = await query(
    `SELECT user_id AS id, store_name AS "storeName", address, verification_status AS status
       FROM pharmacies WHERE user_id = $1`,
    [req.params.id]
  );
  if (!pharmacy.rows[0] || pharmacy.rows[0].status !== 'approved') {
    throw new AppError(404, 'Pharmacy not found');
  }
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM pharmacy_inventory
      WHERE pharmacy_id = $1 AND stock_qty > 0 ORDER BY medicine_name`,
    [req.params.id]
  );
  res.json({ pharmacy: pharmacy.rows[0], items: rows });
});
