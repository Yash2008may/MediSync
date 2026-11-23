import { once } from 'node:events';
import app from '../src/app.js';

export async function startServer() {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function sessionCookie(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const value = raw.map((entry) => entry.split(';')[0]).find((entry) => entry.startsWith('medisync_session='));
  return value ?? null;
}

export async function request(base, path, { method = 'GET', body, cookie, form } = {}) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${base}${path}`, { method, headers, body: payload });
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json().catch(() => null) : null;
  return { response, status: response.status, data, cookie: sessionCookie(response) };
}

export async function login(base, role, identifier, password) {
  const result = await request(base, `/api/auth/${role}/login`, {
    method: 'POST',
    body: { identifier, password },
  });
  if (result.status !== 200) {
    throw new Error(`login ${role} failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.cookie;
}

// Smallest byte sequence that passes the server's magic-byte check.
export const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

export function orderForm({ pharmacyId, items, address = '12th Main Road, Indiranagar, Bengaluru', fulfillment }) {
  const form = new FormData();
  form.append('file', new Blob([PNG_BYTES], { type: 'image/png' }), 'prescription.png');
  form.append('pharmacyId', pharmacyId);
  form.append('items', JSON.stringify(items));
  form.append('deliveryAddress', address);
  if (fulfillment) form.append('fulfillment', fulfillment);
  return form;
}
