import { env } from '../config/env.js';
import { query } from '../config/db.js';

const TIMEOUT_MS = 8000;
const PLACE_FIELDS =
  'id,displayName,formattedAddress,location,googleMapsUri,rating,userRatingCount,nationalPhoneNumber,' +
  'regularOpeningHours.openNow,businessStatus';
// Medical stores: pharmacies and drugstores/chemists carry the same supply.
const MEDICAL_STORE_TYPES = ['pharmacy', 'drugstore'];
const MAX_PAGES = 3; // Places API (New) returns at most 20 per page, 60 in total

export const googleEnabled = () => Boolean(env.googleMapsKey);

// Live GPS -> human-readable current address. Returns null if unavailable (never a fake address).
// Successful addresses are cached for 30 days (the Maps terms allow address caching), so a
// Maps outage or quota spike still resolves the usual places instead of blanking the checkout.
export async function reverseGeocode(lat, lng) {
  if (!googleEnabled()) return null;
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;

  try {
    const cached = await query(
      'SELECT result FROM geocode_cache WHERE cache_key = $1 AND expires_at > now()',
      [cacheKey]
    );
    if (cached.rows[0]) return cached.rows[0].result?.address ?? null;
  } catch (err) {
    console.warn('[maps] geocode cache read failed:', err.message);
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', env.googleMapsKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json();
    if (data.status !== 'OK') {
      console.warn('[maps] reverse geocode status:', data.status, data.error_message ?? '');
      return null;
    }
    const address = data.results?.[0]?.formatted_address ?? null;
    if (address) {
      await query(
        `INSERT INTO geocode_cache (cache_key, result, expires_at)
         VALUES ($1, $2, now() + interval '30 days')
         ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at`,
        [cacheKey, { address }]
      ).catch((err) => console.warn('[maps] geocode cache write failed:', err.message));
    }
    return address;
  } catch (err) {
    console.warn('[maps] reverse geocode failed:', err.message);
    return null;
  }
}

// Place name -> coordinates, so a patient can save a default location by name only.
// Caching and provider fallbacks live in services/geocoder.js; null when Maps is not
// configured or the name is too vague.
export async function googleForwardGeocode(address) {
  if (!googleEnabled()) return null;
  const clean = String(address ?? '').trim();
  if (clean.length < 3) return null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', clean);
    url.searchParams.set('key', env.googleMapsKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = await res.json();
    if (data.status !== 'OK') {
      console.warn('[maps] forward geocode status:', data.status, data.error_message ?? '');
      return null;
    }
    const best = data.results?.[0];
    const point = best?.geometry?.location;
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
    return {
      latitude: point.lat,
      longitude: point.lng,
      address: best.formatted_address ?? clean,
      source: 'google',
    };
  } catch (err) {
    console.warn('[maps] forward geocode failed:', err.message);
    return null;
  }
}

// Google Places API (New) – Nearby Search across every medical store in the radius.
// Places pages 20 results at a time, so walk the pages to return all nearby stores.
export async function searchNearbyPharmacies(lat, lng, radiusM, limit = 20) {
  if (!googleEnabled()) return { available: false, places: [] };

  const wanted = Math.min(Math.max(Number(limit) || 20, 1), MAX_PAGES * 20);
  const fieldMask = PLACE_FIELDS.split(',').map((f) => `places.${f}`).join(',');
  const seen = new Set();
  const places = [];
  let pageToken;

  try {
    for (let page = 0; page < MAX_PAGES && places.length < wanted; page += 1) {
      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.googleMapsKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify({
          includedTypes: MEDICAL_STORE_TYPES,
          maxResultCount: Math.min(wanted - places.length, 20),
          rankPreference: 'DISTANCE',
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.warn('[maps] places nearby error:', data?.error?.message ?? res.statusText);
        // Keep whatever an earlier page already returned.
        return places.length ? { available: true, places } : { available: false, places: [] };
      }
      for (const raw of data.places ?? []) {
        const place = normalizePlace(raw);
        if (place && !seen.has(place.placeId)) {
          seen.add(place.placeId);
          places.push(place);
        }
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return { available: true, places: places.slice(0, wanted) };
  } catch (err) {
    console.warn('[maps] places nearby failed:', err.message);
    return places.length ? { available: true, places } : { available: false, places: [] };
  }
}

export async function getPlaceDetails(placeId) {
  if (!googleEnabled()) return null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'X-Goog-Api-Key': env.googleMapsKey, 'X-Goog-FieldMask': PLACE_FIELDS },
    });
    if (!res.ok) return null;
    return normalizePlace(await res.json());
  } catch {
    return null;
  }
}

function normalizePlace(p) {
  if (!p?.id || p.location?.latitude === undefined) return null;
  if (p.businessStatus === 'CLOSED_PERMANENTLY') return null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? 'Pharmacy',
    address: p.formattedAddress ?? null,
    latitude: p.location.latitude,
    longitude: p.location.longitude,
    googleMapsUri: p.googleMapsUri ?? null,
    rating: Number.isFinite(p.rating) ? p.rating : null,
    ratingCount: Number.isFinite(p.userRatingCount) ? p.userRatingCount : null,
    phone: p.nationalPhoneNumber ?? null,
    openNow: typeof p.regularOpeningHours?.openNow === 'boolean' ? p.regularOpeningHours.openNow : null,
  };
}
