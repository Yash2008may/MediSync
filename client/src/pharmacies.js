// Live default shops: browser geolocation + the server's /api/stores endpoints.
// Nothing here invents a position or a distance — when a real lookup is not possible
// the caller is told exactly why so the UI can label its sample data.

import { apiUrl, expireSession, hasSession } from './api.js';

// Reasons a live lookup could not run. The UI shows the matching sentence instead of
// pretending the sample shops are real nearby results.
export const DEMO_REASON_TEXT = {
  seed: 'Sample shops bundled with the demo build — no location lookup has run yet.',
  denied: 'Location permission was blocked, so these are sample shops.',
  'no-default': 'No default location is saved yet, so these are sample shops.',
  unsupported: 'This browser cannot share a location, so these are sample shops.',
  insecure: 'Live location needs HTTPS (or localhost), so these are sample shops.',
  timeout: 'The GPS fix timed out, so these are sample shops.',
  unavailable: 'Your device could not get a position fix, so these are sample shops.',
  'auth-missing': 'No MediSync sign-in token is stored, so these are sample shops.',
  'auth-rejected': 'The server rejected the stored sign-in token, so these are sample shops.',
  'api-key-missing': 'GOOGLE_MAPS_SERVER_KEY is not set on the server, so these are sample shops.',
  'rate-limited': 'Too many map lookups in a minute, so these are sample shops.',
  offline: 'The MediSync server could not be reached, so these are sample shops.',
  'server-error': 'The server could not look up nearby shops, so these are sample shops.',
};

const geolocationCode = (error) => {
  if (error?.code === 1) return 'denied';
  if (error?.code === 3) return 'timeout';
  return 'unavailable';
};

// Resolves the device's real position. Rejects with a .code matching DEMO_REASON_TEXT.
export function requestLocation({ timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (code) => reject(Object.assign(new Error(code), { code }));

    if (typeof navigator === 'undefined' || !navigator.geolocation) return fail('unsupported');
    if (typeof window !== 'undefined' && !window.isSecureContext) return fail('insecure');

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          at: position.timestamp,
        }),
      (error) => fail(geolocationCode(error)),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

const EARTH_RADIUS_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Server store shape -> portal shop shape. Distances come from the server; when it only
// sends coordinates we measure from the fix we actually requested.
function normalizeStore(store, origin) {
  if (!store || !Number.isFinite(store.latitude) || !Number.isFinite(store.longitude)) return null;
  const distanceMeters = Number.isFinite(store.distanceMeters)
    ? store.distanceMeters
    : haversineMeters(origin.lat, origin.lng, store.latitude, store.longitude);

  return {
    id: store.id,
    placeId: store.placeId ?? null,
    source: store.source === 'registered' ? 'registered' : 'google',
    name: store.name ?? 'Pharmacy',
    address: store.address ?? null,
    phone: store.phone ?? null,
    lat: store.latitude,
    lng: store.longitude,
    distanceKm: distanceMeters / 1000,
    rating: Number.isFinite(store.rating) ? store.rating : null,
    open: typeof store.openNow === 'boolean' ? store.openNow : null,
    verified: store.source === 'registered',
    licence: store.licence ?? null,
    canOrderInApp: Boolean(store.canOrderInApp),
    mapsUrl: store.mapsUrl ?? null,
    directionsUrl: store.directionsUrl ?? null,
  };
}

// GET /api/stores/nearby — registered MediSync pharmacies + live Google Places results.
export async function fetchNearbyStores({ lat, lng, limit = 60, signal }) {
  if (!hasSession()) return { ok: false, error: 'auth-missing' };

  const url = apiUrl('/api/stores/nearby');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('limit', String(limit));

  try {
    const res = await fetch(url, {
      signal,
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 401) {
      // Dead session: clear the token and let the app shell return to sign-in.
      expireSession();
      return { ok: false, error: 'auth-rejected' };
    }
    if (res.status === 403) return { ok: false, error: 'auth-rejected' };
    if (res.status === 429) return { ok: false, error: 'rate-limited' };
    if (!res.ok) return { ok: false, error: 'server-error', status: res.status };

    const data = await res.json();
    const stores = (Array.isArray(data.stores) ? data.stores : [])
      .map((store) => normalizeStore(store, { lat, lng }))
      .filter(Boolean);

    return { ok: true, stores, googleAvailable: data.googleAvailable !== false };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, error: 'aborted' };
    return { ok: false, error: 'offline' };
  }
}

// The patient's saved default location (used by "Default location" ordering).
// GET /api/patients/me/default-location
export async function fetchDefaultLocation() {
  if (!hasSession()) return { location: null };
  try {
    const res = await fetch(apiUrl('/api/patients/me/default-location'), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 401) expireSession();
    if (!res.ok) return { location: null };
    const data = await res.json();
    const loc = data?.location;
    return {
      location:
        loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
          ? { lat: loc.lat, lng: loc.lng, label: loc.label ?? 'My default location' }
          : null,
    };
  } catch {
    return { location: null };
  }
}

// PUT /api/patients/me/default-location  { lat, lng, label }
export async function saveDefaultLocation({ lat, lng, label }) {
  if (!hasSession()) throw new Error('Sign in again to save a default location.');
  const res = await fetch(apiUrl('/api/patients/me/default-location'), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng, label }),
  });
  if (res.status === 401) {
    expireSession();
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Could not save the default location.');
  }
  const data = await res.json();
  return { location: data.location };
}

// POST /api/stores/geocode — resolves a typed place name to coordinates, or null.
// Returns null when Maps is not configured on the server, so callers can fall back.
export async function geocodePlace(address) {
  if (!hasSession()) return null;
  try {
    const res = await fetch(apiUrl('/api/stores/geocode'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (res.status === 401) expireSession();
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data?.location;
    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
    return {
      lat: loc.latitude,
      lng: loc.longitude,
      address: typeof loc.address === 'string' ? loc.address : null,
    };
  } catch {
    return null;
  }
}

// GET /api/config/maps — the browser key that lets the patient app draw a real map.
// Public and optional: without a key the portal keeps its schematic map.
export async function fetchMapsConfig() {
  try {
    const res = await fetch(apiUrl('/api/config/maps'), { headers: { Accept: 'application/json' } });
    if (!res.ok) return { browserKey: null, serverConfigured: false };
    const data = await res.json();
    return {
      browserKey: typeof data?.browserKey === 'string' && data.browserKey ? data.browserKey : null,
      serverConfigured: Boolean(data?.serverConfigured),
    };
  } catch {
    return { browserKey: null, serverConfigured: false };
  }
}

// POST /api/stores/reverse-geocode — human-readable label for the live fix, or null.
export async function reverseGeocode(lat, lng) {
  if (!hasSession()) return null;
  try {
    const res = await fetch(apiUrl('/api/stores/reverse-geocode'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lng }),
    });
    if (res.status === 401) expireSession();
    if (!res.ok) return null;
    const data = await res.json();
    return data?.resolved && typeof data.address === 'string' ? data.address : null;
  } catch {
    return null;
  }
}
