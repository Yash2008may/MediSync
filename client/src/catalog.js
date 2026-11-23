// The pharmacy's own price list. Patients order from it and the server quotes it, so the
// numbers shown here are always the numbers charged.

import { ApiError, apiUrl, expireSession } from './api.js';

async function call(path, options = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the MediSync server. Check that it is running and try again.', { code: 'offline' });
  }
  if (res.status === 401) {
    expireSession();
    throw new ApiError('Your session expired. Please sign in again.', { status: 401, code: 'session-expired' });
  }
  if (!res.ok) {
    let message = null;
    try {
      const body = await res.json();
      message = body?.error?.message ?? null;
    } catch {
      /* not JSON */
    }
    throw new ApiError(message ?? 'The request failed. Please try again.', { status: res.status });
  }
  return res.json().catch(() => ({}));
}

const json = (body) => ({ 'Content-Type': 'application/json', body: JSON.stringify(body) });

export async function fetchMyInventory() {
  const data = await call('/api/pharmacies/me/inventory');
  return Array.isArray(data.inventory) ? data.inventory : [];
}

export async function createInventoryItem(item) {
  const data = await call('/api/pharmacies/me/inventory', { method: 'POST', ...json(item) });
  return data.item;
}

export async function updateInventoryItem(id, patch) {
  const data = await call(`/api/pharmacies/me/inventory/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    ...json(patch),
  });
  return data.item;
}

export async function deleteInventoryItem(id) {
  return call(`/api/pharmacies/me/inventory/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
