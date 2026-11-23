import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { googleForwardGeocode } from './googleMaps.js';
import { findKnownPlace } from './knownPlaces.js';

// Typed place name -> coordinates, without ever asking the patient for degrees.
// Order of attempts:
//   1. Google Geocoding (authoritative, needs GOOGLE_MAPS_SERVER_KEY)
//   2. the offline locality index (no key, typo-tolerant, covers the demo's city)
//   3. OpenStreetMap Nominatim (no key, one request per second, for everywhere else)
// Successful lookups are cached for 30 days, so repeat saves stay fast and survive an
// outage of the upstream provider.

const CACHE_DAYS = 30;
const TIMEOUT_MS = 8000;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

async function readCache(key) {
  try {
    const { rows } = await query(
      'SELECT result FROM geocode_cache WHERE cache_key = $1 AND expires_at > now()',
      [key]
    );
    const hit = rows[0]?.result;
    if (hit && Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)) return hit;
  } catch (err) {
    console.warn('[geocode] cache read failed:', err.message);
  }
  return null;
}

async function writeCache(key, result) {
  try {
    await query(
      `INSERT INTO geocode_cache (cache_key, result, expires_at)
       VALUES ($1, $2, now() + interval '${CACHE_DAYS} days')
       ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at`,
      [key, result]
    );
  } catch (err) {
    console.warn('[geocode] cache write failed:', err.message);
  }
}

// Nominatim's usage policy asks for at most one request per second and an identifying
// User-Agent, so lookups are queued behind each other instead of firing in parallel.
let nominatimQueue = Promise.resolve();
let lastNominatimAt = 0;

function nominatimSlot() {
  const wait = async () => {
    const pause = Math.max(0, 1000 - (Date.now() - lastNominatimAt));
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    lastNominatimAt = Date.now();
  };
  const slot = nominatimQueue.then(wait, wait);
  nominatimQueue = slot.catch(() => {});
  return slot;
}

async function nominatimForwardGeocode(address) {
  if (!env.geocoder.nominatim) return null;
  try {
    await nominatimSlot();
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', address.includes(',') ? address : `${address}, India`);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': env.geocoder.userAgent, 'Accept-Language': 'en' },
    });
    if (!res.ok) {
      console.warn('[geocode] nominatim status:', res.status);
      return null;
    }
    const results = await res.json();
    const best = Array.isArray(results) ? results[0] : null;
    const latitude = Number(best?.lat);
    const longitude = Number(best?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      address: typeof best.display_name === 'string' ? best.display_name : address,
      source: 'openstreetmap',
    };
  } catch (err) {
    console.warn('[geocode] nominatim failed:', err.message);
    return null;
  }
}

export async function geocodePlace(address) {
  const place = clean(address);
  if (place.length < 3) return null;

  const cacheKey = `place:${place.toLowerCase().slice(0, 180)}`;
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const result =
    (await googleForwardGeocode(place)) ??
    findKnownPlace(place) ??
    (await nominatimForwardGeocode(place));

  if (result) await writeCache(cacheKey, result);
  return result;
}
