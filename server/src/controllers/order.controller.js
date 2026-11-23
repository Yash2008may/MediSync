import fs from 'node:fs/promises';
import path from 'node:path';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import {
  orderAdvanceSchema,
  orderCancelSchema,
  orderCreateSchema,
  orderItemsSchema,
  orderRejectSchema,
} from '../validators/app.validators.js';
import { prescriptionDir } from '../services/accountService.js';
import { storePrescriptionFile } from '../services/prescriptionService.js';
import { quoteOrder, round2 } from '../services/pricing.js';
import { notifyUser } from '../services/notificationService.js';

const ORDER_COLUMNS = `o.id, o.patient_id AS "patientId", o.pharmacy_id AS "pharmacyId",
  o.status, o.fulfillment, o.delivery_type AS "deliveryType",
  o.delivery_address AS "deliveryAddress", o.total_mrp::float8 AS "totalMrp",
  o.discount_pct::float8 AS "discountPct", o.final_price::float8 AS "finalPrice",
  o.payment_method AS "paymentMethod", o.payment_status AS "paymentStatus",
  o.rejection_reason AS "rejectionReason", o.cancellation_reason AS "cancellationReason",
  o.created_at AS "createdAt", o.accepted_at AS "acceptedAt", o.delivered_at AS "deliveredAt",
  o.prescription_id AS "prescriptionId",
  ph.store_name AS "pharmacyName", ph.address AS "pharmacyAddress", phu.phone AS "pharmacyPhone",
  pt.name AS "patientName", pu.phone AS "patientPhone",
  r.status AS "prescriptionStatus", r.original_name AS "prescriptionName", r.mime_type AS "prescriptionMimeType"`;

const LOAD_ORDER = `SELECT ${ORDER_COLUMNS}
   FROM orders o
   LEFT JOIN pharmacies ph ON ph.user_id = o.pharmacy_id
   LEFT JOIN users phu ON phu.id = o.pharmacy_id
   LEFT JOIN patients pt ON pt.user_id = o.patient_id
   LEFT JOIN users pu ON pu.id = o.patient_id
   LEFT JOIN prescriptions r ON r.id = o.prescription_id`;

export async function attachItems(rows) {
  if (!rows.length) return rows;
  const { rows: items } = await query(
    `SELECT id, order_id AS "orderId", medicine_name AS "medicineName", quantity, mrp::float8 AS mrp,
            discount_pct::float8 AS "discountPct", is_schedule_h AS "isScheduleH",
            (mrp * (1 - discount_pct / 100) * quantity)::numeric(10,2)::float8 AS "lineTotal"
       FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id`,
    [rows.map((row) => row.id)]
  );
  return rows.map((row) => ({ ...row, items: items.filter((item) => item.orderId === row.id) }));
}

async function attachHistory(rows) {
  if (!rows.length) return rows;
  const { rows: history } = await query(
    `SELECT order_id AS "orderId", status, note, changed_at AS "changedAt"
       FROM order_status_history WHERE order_id = ANY($1::uuid[]) ORDER BY changed_at, id`,
    [rows.map((row) => row.id)]
  );
  return rows.map((row) => ({
    ...row,
    history: history.filter((entry) => entry.orderId === row.id),
  }));
}

const withDetails = async (rows) => attachHistory(await attachItems(rows));

async function loadOrder(id) {
  const { rows } = await query(`${LOAD_ORDER} WHERE o.id = $1`, [id]);
  const [order] = await withDetails(rows);
  return order;
}

// The order is visible to the patient who placed it, the pharmacy it was sent to and an admin.
async function findVisibleOrder(id, user) {
  const { rows } = await query(`${LOAD_ORDER} WHERE o.id = $1`, [id]);
  const order = rows[0];
  if (!order) return null;
  if (user.role === 'admin') return order;
  if (user.role === 'patient' && order.patientId === user.id) return order;
  return null;
}

async function assertParticipant(orderId, user) {
  const { rows } = await query(
    `SELECT o.id, o.patient_id, o.pharmacy_id, o.status FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw new AppError(404, 'Order not found');
  const allowed =
    user.role === 'admin' ||
    (user.role === 'patient' && order.patient_id === user.id) ||
    (user.role === 'pharmacy' && order.pharmacy_id === user.id);
  if (!allowed) throw new AppError(404, 'Order not found');
  return order;
}

async function recordStatus(client, orderId, status, userId, note = null) {
  await client.query(
    'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES ($1, $2, $3, $4)',
    [orderId, status, userId, note]
  );
}

// POST /api/orders   multipart/form-data:
//   file (required JPG/PNG/PDF), pharmacyId, items (JSON [{inventoryId, quantity}]),
//   deliveryAddress, fulfillment?, paymentMethod?, doctorName?, notes?
export const createOrder = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'Attach the prescription (JPG, PNG or PDF) with this order');

  const parsed = orderCreateSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { pharmacyId, deliveryAddress, deliveryType, fulfillment, paymentMethod, doctorName, notes } = parsed.data;

  let items;
  try {
    items = JSON.parse(req.body.items ?? '[]');
  } catch {
    throw new AppError(400, 'The medicine list could not be read. Please try again.');
  }
  const parsedItems = orderItemsSchema.safeParse(items);
  if (!parsedItems.success) throw new AppError(400, parsedItems.error.issues[0].message);
  const lines = parsedItems.data;

  if (lines.length > env.orders.maxLines) {
    throw new AppError(400, `An order can contain at most ${env.orders.maxLines} medicines.`);
  }
  const uniqueIds = new Set(lines.map((line) => line.inventoryId));
  if (uniqueIds.size !== lines.length) throw new AppError(400, 'Each medicine may appear only once per order.');

  const pharmacy = await query(
    `SELECT store_name AS "storeName", address, cu.email AS "email"
       FROM pharmacies ph JOIN users cu ON cu.id = ph.user_id
      WHERE ph.user_id = $1 AND ph.verification_status = 'approved'`,
    [pharmacyId]
  );
  if (!pharmacy.rowCount) throw new AppError(400, 'Choose a verified MediSync pharmacy');
  const store = pharmacy.rows[0];

  // Price from the pharmacy's own catalogue, never from the browser.
  const { rows: catalog } = await query(
    `SELECT id, medicine_name AS "medicineName", mrp, discount_pct AS "discountPct",
            stock_qty AS "stockQty", is_schedule_h AS "isScheduleH"
       FROM pharmacy_inventory WHERE pharmacy_id = $1 AND id = ANY($2::uuid[])`,
    [pharmacyId, [...uniqueIds]]
  );
  if (catalog.length !== uniqueIds.size) {
    throw new AppError(400, 'One of those medicines is no longer in this pharmacy\'s catalogue. Refresh and pick again.');
  }

  const priced = lines.map((line) => {
    const item = catalog.find((row) => row.id === line.inventoryId);
    if (!item) throw new AppError(400, 'Medicine not found in this pharmacy\'s catalogue');
    if (item.stockQty < line.quantity) {
      throw new AppError(409, `Only ${item.stockQty} pack(s) of ${item.medicineName} are in stock.`);
    }
    return {
      inventoryId: item.id,
      medicineName: item.medicineName,
      quantity: line.quantity,
      mrp: Number(item.mrp),
      discountPct: Number(item.discountPct),
      isScheduleH: item.isScheduleH,
    };
  });
  const totals = quoteOrder(priced);

  const file = await storePrescriptionFile(req.file);
  if (!file) throw new AppError(415, 'Unsupported file. Upload a JPG, PNG or PDF.');

  const resolvedFulfillment = fulfillment ?? 'delivery';
  const address = resolvedFulfillment === 'pickup' ? deliveryAddress || `Store pickup — ${store.address}` : deliveryAddress;

  let orderId;
  try {
    orderId = await withTransaction(async (c) => {
      const rx = await c.query(
        `INSERT INTO prescriptions
           (patient_id, pharmacy_id, original_name, stored_name, mime_type, size_bytes, doctor_name, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          req.user.id,
          pharmacyId,
          path.basename(req.file.originalname).slice(0, 120),
          file.storedName,
          file.mimeType,
          req.file.size,
          doctorName ?? null,
          notes ?? null,
        ]
      );

      const order = await c.query(
        `INSERT INTO orders
           (patient_id, pharmacy_id, prescription_id, status, fulfillment, delivery_type, delivery_address,
            total_mrp, discount_pct, final_price, payment_method, priced_at)
         VALUES ($1, $2, $3, 'placed', $4, $5, $6, $7, $8, $9, $10, now()) RETURNING id`,
        [
          req.user.id,
          pharmacyId,
          rx.rows[0].id,
          resolvedFulfillment,
          deliveryType ?? 'home_address',
          address,
          totals.totalMrp,
          totals.discountPct,
          totals.finalPrice,
          paymentMethod ?? 'cod',
        ]
      );

      for (const line of priced) {
        await c.query(
          `INSERT INTO order_items (order_id, inventory_id, medicine_name, quantity, mrp, discount_pct, is_schedule_h)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [order.rows[0].id, line.inventoryId, line.medicineName, line.quantity, line.mrp, line.discountPct, line.isScheduleH]
        );
      }
      await recordStatus(c, order.rows[0].id, 'placed', req.user.id, notes ?? null);
      return order.rows[0].id;
    });
  } catch (error) {
    await fs.unlink(path.join(prescriptionDir(), file.storedName)).catch(() => {});
    throw error;
  }

  await notifyUser({
    userId: pharmacyId,
    type: 'order_placed',
    title: 'New prescription order',
    body: `${req.user.email} sent a prescription order with ${priced.length} medicine line(s) worth ₹${totals.finalPrice}.`,
    orderId,
    email: store.email,
  });

  res.status(201).json({ order: await loadOrder(orderId) });
});

// GET /api/orders?status=&limit=&offset=
//   patient -> own orders; pharmacy -> orders sent to its store; admin -> all
export const listOrders = asyncHandler(async (req, res) => {
  const status = ['placed', 'confirmed', 'out_for_delivery', 'delivered', 'rejected', 'cancelled'].includes(
    req.query.status
  )
    ? req.query.status
    : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || env.orders.pageSize, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const scope =
    req.user.role === 'admin'
      ? { sql: '1 = 1', params: [] }
      : {
          sql: `${req.user.role === 'patient' ? 'o.patient_id' : 'o.pharmacy_id'} = $1`,
          params: [req.user.id],
        };

  const params = [...scope.params, status];
  const statusClause = `AND ($${params.length}::text IS NULL OR o.status = $${params.length})`;

  const { rows } = await query(
    `${LOAD_ORDER} WHERE ${scope.sql} ${statusClause}
      ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  const total = await query(
    `SELECT count(*)::int AS count FROM orders o WHERE ${scope.sql} ${statusClause}`,
    params
  );

  res.json({ orders: await withDetails(rows), total: total.rows[0]?.count ?? 0, limit, offset });
});

// GET /api/orders/:id — participants (and admins) see the order and its status history.
export const getOrder = asyncHandler(async (req, res) => {
  const order = await findVisibleOrder(req.params.id, req.user);
  if (!order) throw new AppError(404, 'Order not found');
  const [detailed] = await withDetails([order]);
  res.json({ order: detailed });
});

// PATCH /api/orders/:id/accept   (verified pharmacy)
// Reserves the stock, confirms the order and approves the attached prescription.
export const acceptOrder = asyncHandler(async (req, res) => {
  const { fulfillment } = req.body ?? {};

  const result = await withTransaction(async (c) => {
    const found = await c.query(
      `SELECT id, patient_id, prescription_id, fulfillment FROM orders
        WHERE id = $1 AND pharmacy_id = $2 AND status = 'placed' FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    const order = found.rows[0];
    if (!order) throw new AppError(404, 'No order waiting for acceptance with this id');

    const items = await c.query(
      `SELECT inventory_id, medicine_name, quantity FROM order_items WHERE order_id = $1`,
      [order.id]
    );
    for (const item of items.rows) {
      if (!item.inventory_id) continue;
      const stock = await c.query(
        `UPDATE pharmacy_inventory SET stock_qty = stock_qty - $2, updated_at = now()
          WHERE id = $1 AND pharmacy_id = $3 AND stock_qty >= $2
          RETURNING stock_qty`,
        [item.inventory_id, item.quantity, req.user.id]
      );
      if (!stock.rowCount) {
        throw new AppError(409, `Not enough stock of ${item.medicine_name} to accept this order.`);
      }
    }

    await c.query(
      `UPDATE orders SET status = 'confirmed', accepted_at = now(), updated_at = now(),
              fulfillment = COALESCE($3, fulfillment)
        WHERE id = $1 AND pharmacy_id = $2`,
      [order.id, req.user.id, fulfillment ?? null]
    );

    if (order.prescription_id) {
      await c.query(
        `UPDATE prescriptions
            SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
                review_note = COALESCE(review_note, 'Approved with the order'),
                valid_until = current_date + $3::int
          WHERE id = $1 AND pharmacy_id = $2 AND status = 'pending'`,
        [order.prescription_id, req.user.id, env.prescriptionValidDays]
      );
    }

    await recordStatus(c, order.id, 'confirmed', req.user.id, req.body?.note ?? null);
    return { orderId: order.id, patientId: order.patient_id };
  });

  await notifyUser({
    userId: result.patientId,
    type: 'order_confirmed',
    title: 'Order accepted',
    body: 'Your pharmacy accepted the prescription order. It will be prepared for delivery.',
    orderId: result.orderId,
  });

  res.json({ order: await loadOrder(result.orderId) });
});

// PATCH /api/orders/:id/reject   { reason }
export const rejectOrder = asyncHandler(async (req, res) => {
  const parsed = orderRejectSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { reason } = parsed.data;

  const result = await withTransaction(async (c) => {
    const found = await c.query(
      `SELECT id, patient_id, prescription_id FROM orders
        WHERE id = $1 AND pharmacy_id = $2 AND status = 'placed' FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    const order = found.rows[0];
    if (!order) throw new AppError(404, 'No order waiting for a decision with this id');

    await c.query(
      `UPDATE orders SET status = 'rejected', rejection_reason = $3, updated_at = now()
        WHERE id = $1 AND pharmacy_id = $2`,
      [order.id, req.user.id, reason]
    );
    if (order.prescription_id) {
      await c.query(
        `UPDATE prescriptions
            SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3
          WHERE id = $1 AND pharmacy_id = $2 AND status = 'pending'`,
        [order.prescription_id, req.user.id, reason]
      );
    }
    await recordStatus(c, order.id, 'rejected', req.user.id, reason);
    return { orderId: order.id, patientId: order.patient_id };
  });

  await notifyUser({
    userId: result.patientId,
    type: 'order_rejected',
    title: 'Order could not be accepted',
    body: `The pharmacy declined your order: ${reason}`,
    orderId: result.orderId,
  });

  res.json({ order: await loadOrder(result.orderId) });
});

// PATCH /api/orders/:id/status   { status: 'out_for_delivery' | 'delivered' }
export const advanceOrder = asyncHandler(async (req, res) => {
  const parsed = orderAdvanceSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const { status, note } = parsed.data;

  const result = await withTransaction(async (c) => {
    const found = await c.query(
      `SELECT id, patient_id, status FROM orders
        WHERE id = $1 AND pharmacy_id = $2 FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    const order = found.rows[0];
    if (!order) throw new AppError(404, 'Order not found for your pharmacy');

    const allowed = { out_for_delivery: ['confirmed'], delivered: ['out_for_delivery'] }[status] ?? [];
    if (!allowed.includes(order.status)) {
      throw new AppError(409, `An order that is ${order.status.replaceAll('_', ' ')} cannot move to ${status.replaceAll('_', ' ')}.`);
    }

    await c.query(
      `UPDATE orders SET status = $3, updated_at = now(),
              delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END
        WHERE id = $1 AND pharmacy_id = $2`,
      [order.id, req.user.id, status]
    );
    await recordStatus(c, order.id, status, req.user.id, note ?? null);
    return { orderId: order.id, patientId: order.patient_id, status };
  });

  const text = {
    out_for_delivery: 'Your order is out for delivery.',
    delivered: 'Your order was delivered. Thank you for using MediSync.',
  }[result.status];
  await notifyUser({
    userId: result.patientId,
    type: `order_${result.status}`,
    title: result.status === 'delivered' ? 'Order delivered' : 'Order on the way',
    body: note ? `${text} Note: ${note}` : text,
    orderId: result.orderId,
  });

  res.json({ order: await loadOrder(result.orderId) });
});

// PATCH /api/orders/:id/cancel   { reason? }   (patient, before dispatch)
export const cancelOrder = asyncHandler(async (req, res) => {
  const parsed = orderCancelSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0].message);
  const reason = parsed.data.reason || 'Cancelled by the patient';

  const result = await withTransaction(async (c) => {
    const found = await c.query(
      `SELECT id, pharmacy_id, status FROM orders
        WHERE id = $1 AND patient_id = $2 FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    const order = found.rows[0];
    if (!order) throw new AppError(404, 'Order not found');
    if (!['placed', 'confirmed'].includes(order.status)) {
      throw new AppError(409, 'This order has already been dispatched and can no longer be cancelled.');
    }

    // A confirmed order reserved stock; put it back.
    if (order.status === 'confirmed') {
      const items = await c.query(
        'SELECT inventory_id, quantity FROM order_items WHERE order_id = $1',
        [order.id]
      );
      for (const item of items.rows) {
        if (!item.inventory_id) continue;
        await c.query(
          'UPDATE pharmacy_inventory SET stock_qty = stock_qty + $2, updated_at = now() WHERE id = $1',
          [item.inventory_id, item.quantity]
        );
      }
    }

    await c.query(
      `UPDATE orders SET status = 'cancelled', cancellation_reason = $3, updated_at = now()
        WHERE id = $1 AND patient_id = $2`,
      [order.id, req.user.id, reason]
    );
    await recordStatus(c, order.id, 'cancelled', req.user.id, reason);
    return { orderId: order.id, pharmacyId: order.pharmacy_id };
  });

  if (result.pharmacyId) {
    await notifyUser({
      userId: result.pharmacyId,
      type: 'order_cancelled',
      title: 'Order cancelled',
      body: `The patient cancelled order ${result.orderId.slice(0, 8)}: ${reason}`,
      orderId: result.orderId,
    });
  }

  res.json({ order: await loadOrder(result.orderId) });
});

export { assertParticipant, round2 };
