import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../src/config/db.js';
import { login, orderForm, PNG_BYTES, request, startServer } from '../helpers.js';

// Keep in sync with db/seed.js (importing the seed script would run it).
const DEMO_PATIENT = { email: 'patient@medisync.demo', password: 'Patient@123' };
const DEMO_PHARMACY = {
  email: 'pharmacy@medisync.demo',
  password: 'Pharmacy@123',
  address: '100 Feet Road, Indiranagar, Bengaluru 560038',
};

let server;
let patientCookie;
let pharmacyCookie;
let adminCookie;
let pharmacyId;
let inventoryId;
const createdOrderIds = [];

const auth = (cookie) => ({ cookie });

before(async () => {
  server = await startServer();
  patientCookie = await login(server.base, 'patient', DEMO_PATIENT.email, DEMO_PATIENT.password);
  pharmacyCookie = await login(server.base, 'pharmacy', DEMO_PHARMACY.email, DEMO_PHARMACY.password);
  adminCookie = await login(server.base, 'admin', 'admin@medisync.demo', 'Admin@12345');

  const me = await request(server.base, '/api/auth/me', auth(pharmacyCookie));
  pharmacyId = me.data.user.id;

  const created = await request(server.base, '/api/pharmacies/me/inventory', {
    ...auth(pharmacyCookie),
    method: 'POST',
    body: { medicineName: `Test Amoxicillin ${Date.now()}`, mrp: 100, discountPct: 10, stockQty: 5, isScheduleH: true },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  inventoryId = created.data.item.id;
});

after(async () => {
  if (createdOrderIds.length) {
    await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [createdOrderIds]);
  }
  if (inventoryId) await pool.query('DELETE FROM pharmacy_inventory WHERE id = $1', [inventoryId]);
  await server?.close();
  await pool.end();
});

const placeOrder = (quantity = 2, cookie = patientCookie) =>
  request(server.base, '/api/orders', {
    cookie,
    method: 'POST',
    form: orderForm({ pharmacyId, items: [{ inventoryId, quantity }] }),
  });

test('health and readiness answer', async () => {
  assert.equal((await request(server.base, '/api/health')).status, 200);
  assert.equal((await request(server.base, '/api/ready')).status, 200);
});

test('the session cookie authenticates without a Bearer token', async () => {
  const me = await request(server.base, '/api/auth/me', auth(patientCookie));
  assert.equal(me.status, 200);
  assert.equal(me.data.user.role, 'patient');
  assert.equal((await request(server.base, '/api/auth/me')).status, 401);
});

test('a patient cannot place an order with a client-supplied price', async () => {
  const result = await request(server.base, '/api/orders', {
    cookie: patientCookie,
    method: 'POST',
    form: orderForm({ pharmacyId, items: [{ medicineName: 'Fake', quantity: 1, mrp: 1 }] }),
  });
  assert.equal(result.status, 400);
});

test('order lifecycle: placed -> confirmed -> out_for_delivery -> delivered', async () => {
  const placed = await placeOrder(2);
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  const order = placed.data.order;
  createdOrderIds.push(order.id);

  assert.equal(order.status, 'placed');
  assert.equal(order.finalPrice, 180);
  assert.equal(order.totalMrp, 200);
  assert.equal(order.items[0].mrp, 100);
  assert.equal(order.items[0].lineTotal, 180);
  assert.equal(order.history.at(-1).status, 'placed');

  // Another pharmacy (the patient) cannot accept it.
  const forbidden = await request(server.base, `/api/orders/${order.id}/accept`, {
    ...auth(patientCookie),
    method: 'PATCH',
    body: {},
  });
  assert.equal(forbidden.status, 403);

  const accepted = await request(server.base, `/api/orders/${order.id}/accept`, {
    ...auth(pharmacyCookie),
    method: 'PATCH',
    body: { note: 'Ready in 20 minutes' },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.order.status, 'confirmed');
  assert.equal(accepted.data.order.prescriptionStatus, 'approved');

  const stock = await pool.query('SELECT stock_qty FROM pharmacy_inventory WHERE id = $1', [inventoryId]);
  assert.equal(stock.rows[0].stock_qty, 3);

  const forwarded = await request(server.base, `/api/orders/${order.id}/status`, {
    ...auth(pharmacyCookie),
    method: 'PATCH',
    body: { status: 'out_for_delivery' },
  });
  assert.equal(forwarded.data.order.status, 'out_for_delivery');

  const delivered = await request(server.base, `/api/orders/${order.id}/status`, {
    ...auth(pharmacyCookie),
    method: 'PATCH',
    body: { status: 'delivered' },
  });
  assert.equal(delivered.data.order.status, 'delivered');
  assert.ok(delivered.data.order.deliveredAt);

  const lateCancel = await request(server.base, `/api/orders/${order.id}/cancel`, {
    ...auth(patientCookie),
    method: 'PATCH',
    body: {},
  });
  assert.equal(lateCancel.status, 409);

  // The patient sees the same order and its full history.
  const mine = await request(server.base, `/api/orders/${order.id}`, auth(patientCookie));
  assert.deepEqual(
    mine.data.order.history.map((entry) => entry.status),
    ['placed', 'confirmed', 'out_for_delivery', 'delivered']
  );

  // Notifications were created for both sides.
  const notes = await request(server.base, '/api/notifications', auth(patientCookie));
  assert.ok(notes.data.notifications.some((entry) => entry.orderId === order.id));
});

test('the prescription file is readable by the owner and the assigned pharmacy only', async () => {
  const placed = await placeOrder(1);
  const order = placed.data.order;
  createdOrderIds.push(order.id);

  const byPatient = await fetch(`${server.base}/api/prescriptions/${order.prescriptionId}/file`, {
    headers: { Cookie: patientCookie },
  });
  assert.equal(byPatient.status, 200);
  assert.equal(byPatient.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await byPatient.arrayBuffer()), PNG_BYTES);

  const byPharmacy = await fetch(`${server.base}/api/prescriptions/${order.prescriptionId}/file`, {
    headers: { Cookie: pharmacyCookie },
  });
  assert.equal(byPharmacy.status, 200);

  const audit = await pool.query(
    'SELECT count(*)::int AS count FROM prescription_file_access WHERE prescription_id = $1',
    [order.prescriptionId]
  );
  assert.ok(audit.rows[0].count >= 2);

  const anonymous = await fetch(`${server.base}/api/prescriptions/${order.prescriptionId}/file`);
  assert.equal(anonymous.status, 401);
});

test('a pharmacy can reject an order with a reason, and the stock stays put', async () => {
  const placed = await placeOrder(1);
  const order = placed.data.order;
  createdOrderIds.push(order.id);

  const rejected = await request(server.base, `/api/orders/${order.id}/reject`, {
    ...auth(pharmacyCookie),
    method: 'PATCH',
    body: { reason: 'Prescription is not legible' },
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal(rejected.data.order.status, 'rejected');
  assert.equal(rejected.data.order.rejectionReason, 'Prescription is not legible');

  const stock = await pool.query('SELECT stock_qty FROM pharmacy_inventory WHERE id = $1', [inventoryId]);
  assert.equal(stock.rows[0].stock_qty, 3, 'accepting is what reserves stock');
});

test('a patient can cancel a confirmed order and the reserved stock comes back', async () => {
  const placed = await placeOrder(2);
  const order = placed.data.order;
  createdOrderIds.push(order.id);
  await request(server.base, `/api/orders/${order.id}/accept`, { ...auth(pharmacyCookie), method: 'PATCH', body: {} });

  const cancelled = await request(server.base, `/api/orders/${order.id}/cancel`, {
    ...auth(patientCookie),
    method: 'PATCH',
    body: { reason: 'Ordered the wrong pack size' },
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.order.status, 'cancelled');

  const stock = await pool.query('SELECT stock_qty FROM pharmacy_inventory WHERE id = $1', [inventoryId]);
  assert.equal(stock.rows[0].stock_qty, 3);
});

test('orders cannot be placed beyond available stock', async () => {
  const result = await placeOrder(40); // within the per-line maximum, above the 3 in stock
  assert.equal(result.status, 409);
});

test('profile edits are audited and a pharmacy address change asks for re-verification', async () => {
  const patient = await request(server.base, '/api/me/profile', {
    ...auth(patientCookie),
    method: 'PATCH',
    body: { name: 'Ananya S. Sharma' },
  });
  assert.equal(patient.status, 200, JSON.stringify(patient.data));
  assert.equal(patient.data.user.profile.name, 'Ananya S. Sharma');

  const audit = await pool.query(
    `SELECT changed_fields FROM profile_audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [patient.data.user.id]
  );
  assert.deepEqual(audit.rows[0].changed_fields, ['name']);

  const store = await request(server.base, '/api/me/profile', {
    ...auth(pharmacyCookie),
    method: 'PATCH',
    body: { address: '100 Feet Road, Indiranagar, Bengaluru 560038 (Unit 2)' },
  });
  assert.equal(store.status, 200);
  assert.equal(store.data.user.profile.needsReview, true);

  // Restore the demo detail so later runs start clean.
  await request(server.base, '/api/me/profile', {
    ...auth(pharmacyCookie),
    method: 'PATCH',
    body: { address: DEMO_PHARMACY.address },
  });
});

test('admins can see every order and the account directory; patients cannot', async () => {
  const admin = await request(server.base, '/api/admin/orders?limit=20', auth(adminCookie));
  assert.equal(admin.status, 200);
  assert.ok(admin.data.total >= 1);

  const users = await request(server.base, '/api/admin/users?role=pharmacy', auth(adminCookie));
  assert.equal(users.status, 200);
  assert.ok(users.data.users.some((entry) => entry.id === pharmacyId));

  const denied = await request(server.base, '/api/admin/orders', auth(patientCookie));
  assert.equal(denied.status, 403);
});

test('cookie-authenticated writes reject a foreign origin', async () => {
  const blocked = await fetch(`${server.base}/api/me/profile`, {
    method: 'PATCH',
    headers: { Cookie: patientCookie, 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ name: 'Should Not Apply' }),
  });
  assert.equal(blocked.status, 403);

  // The app's own origin (or a CORS-allowed one) passes the same check.
  const allowed = await fetch(`${server.base}/api/me/profile`, {
    method: 'PATCH',
    headers: { Cookie: patientCookie, 'Content-Type': 'application/json', Origin: server.base },
    body: JSON.stringify({ name: 'Ananya S. Sharma' }),
  });
  assert.equal(allowed.status, 200);
});

test('a typed place name resolves without Google Maps, typos included', async () => {
  const res = await fetch(`${server.base}/api/stores/geocode`, {
    method: 'POST',
    headers: { Cookie: patientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: 'Indiranagar, Bengaluru' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  // No GOOGLE_MAPS_SERVER_KEY in tests: the offline locality index answers with real
  // coordinates, so a patient never has to type latitude/longitude.
  assert.equal(body.resolved, true);
  assert.equal(body.location.address, 'Indiranagar, Bengaluru');
  assert.ok(Math.abs(body.location.latitude - 12.9719) < 0.05);

  // Spacing and spelling differences still land on the same locality.
  const typo = await fetch(`${server.base}/api/stores/geocode`, {
    method: 'POST',
    headers: { Cookie: patientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: 'kumars wamy layout' }),
  });
  const typoBody = await typo.json();
  assert.equal(typoBody.resolved, true);
  assert.equal(typoBody.location.address, 'Kumaraswamy Layout, Bengaluru');

  const tooShort = await fetch(`${server.base}/api/stores/geocode`, {
    method: 'POST',
    headers: { Cookie: patientCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: 'ab' }),
  });
  assert.equal(tooShort.status, 400);
});

test('signing out clears the cookie so it cannot be reused', async () => {
  const extra = await login(server.base, 'patient', DEMO_PATIENT.email, DEMO_PATIENT.password);
  assert.ok(extra);
  const logout = await request(server.base, '/api/auth/logout', { cookie: extra, method: 'POST' });
  assert.equal(logout.status, 200);
  assert.match(logout.response.headers.get('set-cookie') ?? '', /medisync_session=;/);
});
