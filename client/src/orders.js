// Prescription-backed orders. The browser only sends catalogue ids and quantities; the
// server prices every line from the pharmacy's own price list. Files need the session
// cookie, so they are fetched as a blob instead of being linked directly.

import { ApiError, apiUrl, expireSession } from './api.js';

async function authedFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the MediSync server. Check that it is running and try again.', {
      code: 'offline',
    });
  }
  if (res.status === 401) {
    expireSession();
    throw new ApiError('Your session expired. Please sign in again.', { status: 401, code: 'session-expired' });
  }
  if (!res.ok) {
    let message = null;
    try {
      const body = await res.json();
      message = body?.error?.message ?? body?.message ?? null;
    } catch {
      /* not JSON */
    }
    throw new ApiError(message ?? 'The request failed. Please try again.', { status: res.status });
  }
  return res;
}

// GET /api/pharmacies/:id/catalog — the orderable price list of a verified pharmacy.
export async function fetchCatalogue(pharmacyId) {
  const res = await authedFetch(`/api/pharmacies/${encodeURIComponent(pharmacyId)}/catalog`);
  const data = await res.json();
  return { items: Array.isArray(data.items) ? data.items : [], pharmacy: data.pharmacy ?? null };
}

// POST /api/orders — one prescription file plus catalogue lines.
export async function submitPrescriptionOrder({
  pharmacyId,
  items,
  file,
  deliveryAddress,
  fulfillment = 'delivery',
  doctorName,
  notes,
}) {
  const form = new FormData();
  form.append('file', file);
  form.append('pharmacyId', pharmacyId);
  form.append('items', JSON.stringify(items));
  form.append('deliveryAddress', deliveryAddress);
  form.append('fulfillment', fulfillment);
  if (doctorName) form.append('doctorName', doctorName);
  if (notes) form.append('notes', notes);

  const res = await authedFetch('/api/orders', { method: 'POST', body: form });
  const data = await res.json();
  return data.order;
}

// GET /api/orders — patient: own orders; pharmacy: orders sent to this store.
export async function fetchOrders({ status, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const res = await authedFetch(`/api/orders${params.size ? `?${params}` : ''}`);
  const data = await res.json();
  return { orders: Array.isArray(data.orders) ? data.orders : [], total: Number(data.total ?? 0) };
}

export async function fetchOrder(id) {
  const res = await authedFetch(`/api/orders/${encodeURIComponent(id)}`);
  const data = await res.json();
  return data.order;
}

// PATCH /api/orders/:id/accept — reserves stock and approves the prescription.
export async function acceptPrescriptionOrder(id, payload = {}) {
  const res = await authedFetch(`/api/orders/${encodeURIComponent(id)}/accept`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return data.order;
}

export async function rejectPrescriptionOrder(id, reason) {
  const res = await authedFetch(`/api/orders/${encodeURIComponent(id)}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const data = await res.json();
  return data.order;
}

export async function advanceOrder(id, status, note) {
  const res = await authedFetch(`/api/orders/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...(note ? { note } : {}) }),
  });
  const data = await res.json();
  return data.order;
}

export async function cancelOrder(id, reason) {
  const res = await authedFetch(`/api/orders/${encodeURIComponent(id)}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  const data = await res.json();
  return data.order;
}

// Opens the prescription image/PDF in a new tab using a short-lived blob URL.
export async function openPrescriptionFile(prescriptionId) {
  if (!prescriptionId) return;
  const res = await authedFetch(`/api/prescriptions/${encodeURIComponent(prescriptionId)}/file`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
