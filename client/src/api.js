// Shared client for the MediSync API.
//
// The session lives in an httpOnly cookie set by the server, so no token is readable from
// page scripts (XSS can no longer exfiltrate a session). localStorage only holds a non-secret
// hint that a session probably exists, which lets a reload restore the console.

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const SESSION_HINT_KEY = 'medisync.session';

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';

export const apiUrl = (path) => new URL(path, API_BASE || window.location.origin);

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- session hint
export function hasSession() {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSession() {
  try {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
  } catch {
    /* storage blocked — the cookie still works for this page load */
  }
}

export function clearSessionHint() {
  try {
    window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* ignore */
  }
}

// Any 401 on a request that was sent with a session means the session is gone (expired,
// revoked, or the password changed). The hook subscribes here to return to sign-in.
const unauthorizedListeners = new Set();

export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function expireSession(message = SESSION_EXPIRED_MESSAGE) {
  clearSessionHint();
  for (const listener of unauthorizedListeners) {
    try {
      listener(message);
    } catch {
      /* a broken listener must not break the request flow */
    }
  }
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    return body?.error?.message ?? body?.message ?? null;
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body, sessionless = false } = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      // Sends/receives the httpOnly session cookie on the same origin (and on a separately
      // hosted SPA listed in CLIENT_ORIGIN, where the server allows credentials).
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('Cannot reach the MediSync server. Check that it is running and try again.', {
      code: 'offline',
    });
  }

  if (res.status === 429) {
    throw new ApiError((await errorMessage(res)) ?? 'Too many attempts. Try again in a few minutes.', {
      status: 429,
      code: 'rate-limited',
    });
  }

  if (res.status === 401) {
    const serverMessage = await errorMessage(res);
    if (sessionless) {
      throw new ApiError(serverMessage ?? 'Invalid credentials.', { status: 401, code: 'unauthorized' });
    }
    expireSession();
    throw new ApiError(SESSION_EXPIRED_MESSAGE, { status: 401, code: 'session-expired' });
  }

  if (res.status === 403) {
    throw new ApiError((await errorMessage(res)) ?? 'You do not have access to that resource.', {
      status: 403,
      code: 'forbidden',
    });
  }

  if (!res.ok) {
    throw new ApiError((await errorMessage(res)) ?? 'The request failed. Please try again.', {
      status: res.status,
      code: 'server-error',
    });
  }

  try {
    return await res.json();
  } catch {
    return {};
  }
}

// POST /api/auth/:role/login — patient: email|mobile, pharmacy: email|licence, admin: email
export async function loginAs(role, { identifier, password }) {
  const data = await request(`/api/auth/${role}/login`, {
    method: 'POST',
    sessionless: true,
    body: { identifier, password },
  });
  if (!data?.user) throw new ApiError('The server did not return a session.', { code: 'bad-response' });
  markSession();
  return data;
}

// POST /api/auth/patient/register | /pharmacy/register | /admin/register
// Admin registration is a one-time bootstrap and is refused once an admin exists.
export async function registerAccount(role, payload) {
  const data = await request(`/api/auth/${role}/register`, {
    method: 'POST',
    sessionless: true,
    body: payload,
  });
  if (!data?.user) throw new ApiError('The server did not return a session.', { code: 'bad-response' });
  markSession();
  return data;
}

// POST /api/auth/logout — clears the httpOnly cookie server-side.
export async function logoutAccount() {
  try {
    await request('/api/auth/logout', { method: 'POST', sessionless: true });
  } finally {
    clearSessionHint();
  }
}

// POST /api/auth/forgot-password — asks for a 6-digit OTP by email + SMS.
// The server answers the same way whether or not the account exists.
export async function requestPasswordReset(role, identifier) {
  const data = await request('/api/auth/forgot-password', {
    method: 'POST',
    sessionless: true,
    body: { role, identifier },
  });
  return { message: data?.message ?? 'Check your email and mobile for the code.', devOtp: data?.devOtp ?? null };
}

// POST /api/auth/verify-otp — trades a correct OTP for a 10-minute reset token.
export async function verifyResetOtp(role, identifier, otp) {
  const data = await request('/api/auth/verify-otp', {
    method: 'POST',
    sessionless: true,
    body: { role, identifier, otp },
  });
  if (!data?.resetToken) throw new ApiError('The server did not return a reset token.', { code: 'bad-response' });
  return data.resetToken;
}

// POST /api/auth/reset-password — sets the new password with that reset token.
export async function resetPassword(resetToken, newPassword) {
  return request('/api/auth/reset-password', {
    method: 'POST',
    sessionless: true,
    body: { resetToken, newPassword },
  });
}

// GET /api/auth/admin/bootstrap — { available } tells the UI whether the
// one-time admin sign-up can still be used on this deployment.
export async function adminSignupAvailable() {
  try {
    const data = await request('/api/auth/admin/bootstrap', { sessionless: true });
    return { available: Boolean(data?.available) };
  } catch (error) {
    return { available: false, error: error?.message ?? 'Could not check admin setup.', offline: error?.code === 'offline' };
  }
}

// GET /api/auth/me — used to restore the session on reload.
// Returns the user, { unauthorized: true }, { offline: true } or null.
export async function fetchProfile() {
  if (!hasSession()) return null;
  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      clearSessionHint();
      return { unauthorized: true };
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user ?? null;
  } catch {
    return { offline: true };
  }
}

// PATCH /api/me/profile — the signed-in user edits their own profile.
// Patients: name/address; pharmacies: storeName/address; everyone: phone.
export async function updateMyProfile(payload) {
  return request('/api/me/profile', { method: 'PATCH', body: payload });
}

// GET /api/admin/overview
export async function fetchAdminOverview() {
  const data = await request('/api/admin/overview');
  return {
    counts: { pending: 0, approved: 0, rejected: 0, ...(data?.counts ?? {}) },
    orders: { placed: 0, confirmed: 0, out_for_delivery: 0, delivered: 0, rejected: 0, cancelled: 0, ...(data?.orders ?? {}) },
    needsReview: Number(data?.needsReview ?? 0),
    users: data?.users ?? { patients: 0, pharmacies: 0, disabled: 0 },
    audit: Array.isArray(data?.audit) ? data.audit : [],
  };
}

// GET /api/admin/orders?status=&limit=&offset=
export async function fetchAdminOrders({ status, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set('status', status);
  const data = await request(`/api/admin/orders?${params}`);
  return { orders: Array.isArray(data?.orders) ? data.orders : [], total: Number(data?.total ?? 0) };
}

// GET /api/admin/pharmacies?status=pending|approved|rejected
export async function fetchPharmaciesByStatus(status = 'pending') {
  const data = await request(`/api/admin/pharmacies?status=${encodeURIComponent(status)}`);
  return Array.isArray(data.pharmacies) ? data.pharmacies : [];
}

// PATCH /api/admin/pharmacies/:id/account  { active } — suspending ends the
// store's session immediately (the API refuses a disabled account).
export async function setPharmacyActive(id, active) {
  return request(`/api/admin/pharmacies/${encodeURIComponent(id)}/account`, {
    method: 'PATCH',
    body: { active },
  });
}

// PATCH /api/admin/pharmacies/:id/verify  { decision, note }
export async function verifyPharmacy(id, { decision, note }) {
  return request(`/api/admin/pharmacies/${encodeURIComponent(id)}/verify`, {
    method: 'PATCH',
    body: { decision, ...(note ? { note } : {}) },
  });
}
