import { env } from '../config/env.js';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/AppError.js';
import { reverseGeocode } from '../services/googleMaps.js';
import { geocodePlace } from '../services/geocoder.js';
import { findNearbyStores } from '../services/storeService.js';

// GET /api/stores/nearby?lat=&lng=&radius=&limit=
export const nearby = asyncHandler(async (req, res) => {
  const { lat, lng, radius = env.geo.nearbyRadiusMeters, limit = 20 } = req.query;
  const { stores, googleAvailable } = await findNearbyStores({ lat, lng, radiusM: radius, limit });
  res.json({ stores, googleAvailable });
});

// POST /api/stores/reverse-geocode  { latitude, longitude }
export const reverse = asyncHandler(async (req, res) => {
  const address = await reverseGeocode(req.body.latitude, req.body.longitude);
  res.json({ address, resolved: address !== null });
});

// POST /api/stores/geocode  { address } -> { location: { latitude, longitude, address } | null }
export const geocode = asyncHandler(async (req, res) => {
  const location = await geocodePlace(req.body.address);
  res.json({ location, resolved: location !== null });
});

// GET /api/stores/autocomplete?q=ku&lat=12.93&lng=77.56
export const autocomplete = asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ suggestions: [] });

  const rawLat = Number(req.query.lat);
  const rawLng = Number(req.query.lng);
  const biasLat = Number.isFinite(rawLat) ? rawLat : 12.9352;
  const biasLng = Number.isFinite(rawLng) ? rawLng : 77.5665;

  const suggestions = [];
  const seen = new Set();
  const pushUnique = (item) => {
    const key = `${item.mainText}|${item.secondaryText}`.toLowerCase();
    if (!item.mainText || seen.has(key)) return;
    seen.add(key);
    suggestions.push(item);
  };

  // 1A. Google Places Autocomplete (New API) — exact Google Maps predictions
  if (env.googleMapsKey) {
    try {
      const gRes = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.googleMapsKey,
        },
        body: JSON.stringify({
          input: q,
                    locationBias: {
            circle: {
              center: { latitude: biasLat, longitude: biasLng },
              radius: 35000.0,
            },
          },
        }),
        signal: AbortSignal.timeout(4000),
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        for (const item of (gData.suggestions ?? []).slice(0, 6)) {
          const pred = item.placePrediction;
          if (!pred) continue;
          const mainText = pred.structuredFormat?.mainText?.text || pred.text?.text || '';
          const secondaryText = pred.structuredFormat?.secondaryText?.text || '';
          const label = secondaryText ? `${mainText}, ${secondaryText}` : mainText;
          pushUnique({
            id: pred.placeId || label,
            label,
            mainText,
            secondaryText,
            lat: null,
            lng: null,
          });
        }
      }
    } catch {
      // Try legacy Google Places Autocomplete next
    }
  }

  // 1B. Google Places Autocomplete (Classic API) — works on keys with Classic Places enabled
  if (env.googleMapsKey && suggestions.length === 0) {
    try {
      const gUrl = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
      gUrl.searchParams.set('input', q);
      gUrl.searchParams.set('location', `${biasLat},${biasLng}`);
      gUrl.searchParams.set('radius', '35000');
            gUrl.searchParams.set('key', env.googleMapsKey);
      const gRes = await fetch(gUrl, { signal: AbortSignal.timeout(4000) });
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData.status === 'OK') {
          for (const pred of (gData.predictions ?? []).slice(0, 6)) {
            const mainText = pred.structured_formatting?.main_text || pred.description || '';
            const secondaryText = pred.structured_formatting?.secondary_text || '';
            const label = pred.description || (secondaryText ? `${mainText}, ${secondaryText}` : mainText);
            pushUnique({
              id: pred.place_id || label,
              label,
              mainText,
              secondaryText,
              lat: null,
              lng: null,
            });
          }
        }
      }
    } catch {
      // Fall back to Photon + Nominatim below
    }
  }

  // 1C. Geoapify Autocomplete API (Google Maps-style global predictions)
  const geoapifyKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (geoapifyKey && suggestions.length === 0) {
    try {
      const aUrl = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
      aUrl.searchParams.set('text', q);
      aUrl.searchParams.set('bias', `proximity:${biasLng},${biasLat}`);
      aUrl.searchParams.set('limit', '6');
      aUrl.searchParams.set('apiKey', geoapifyKey);
      const aRes = await fetch(aUrl, { signal: AbortSignal.timeout(4500) });
      if (aRes.ok) {
        const aData = await aRes.json();
        for (const feat of aData.features ?? []) {
          const p = feat.properties || {};
          const mainText = p.name || p.address_line1 || p.city || '';
          const secondaryText = p.address_line2 || [p.city, p.state, p.country].filter(Boolean).join(', ');
          const label = p.formatted || (secondaryText ? `${mainText}, ${secondaryText}` : mainText);
          pushUnique({
            id: p.place_id || label,
            label,
            mainText,
            secondaryText,
            lat: Number.isFinite(p.lat) ? p.lat : null,
            lng: Number.isFinite(p.lon) ? p.lon : null,
          });
        }
      }
    } catch {
      // Fall back to Photon/Nominatim
    }
  }

  // 2. High-precision local-biased OpenStreetMap (Photon + Nominatim) fallback
  // Photon supports true lat/lon proximity ranking + prefix matching like Google Maps
  if (suggestions.length === 0) {
    try {
      const pUrl = new URL('https://photon.komoot.io/api/');
      pUrl.searchParams.set('q', q);
      pUrl.searchParams.set('lat', String(biasLat));
      pUrl.searchParams.set('lon', String(biasLng));
      pUrl.searchParams.set('limit', '12');
      pUrl.searchParams.set('lang', 'en');

      const pRes = await fetch(pUrl, {
        headers: { 'User-Agent': 'MediSync-Healthcare-App/1.0' },
        signal: AbortSignal.timeout(4000),
      });

      if (pRes.ok) {
        const pData = await pRes.json();
        const qLower = q.toLowerCase();
        const rawItems = [];

        for (const feat of pData.features ?? []) {
          const props = feat.properties || {};
          
          const mainText = props.name || props.suburb || props.locality || props.city || '';
          if (!mainText) continue;

          const secParts = [
            props.suburb !== mainText ? props.suburb : null,
            props.city || props.district || props.county,
            props.state,
          ].filter(Boolean);
          const secondaryText = [...new Set(secParts)].join(', ');
          const label = secondaryText ? `${mainText}, ${secondaryText}` : mainText;

          const [lng, lat] = feat.geometry?.coordinates ?? [null, null];
          const distSq =
            Number.isFinite(lat) && Number.isFinite(lng)
              ? (lat - biasLat) ** 2 + (lng - biasLng) ** 2
              : 999;

          const startsWithQuery = mainText.toLowerCase().startsWith(qLower) ? 0 : 1;
          const isLocal = distSq < 0.25 ? 0 : 1; // ~50 km radius priority

          rawItems.push({
            id: `${props.osm_id || label}-${lat}-${lng}`,
            label,
            mainText,
            secondaryText,
            lat: Number.isFinite(lat) ? lat : null,
            lng: Number.isFinite(lng) ? lng : null,
            score: startsWithQuery * 10 + isLocal * 5 + Math.min(distSq, 4),
          });
        }

        rawItems.sort((a, b) => a.score - b.score);
        for (const item of rawItems) {
          pushUnique({
            id: item.id,
            label: item.label,
            mainText: item.mainText,
            secondaryText: item.secondaryText,
            lat: item.lat,
            lng: item.lng,
          });
          if (suggestions.length >= 6) break;
        }
      }
    } catch {
      // Final fallback to Nominatim if Photon times out
    }
  }

  if (suggestions.length === 0) {
    try {
      const nUrl = new URL('https://nominatim.openstreetmap.org/search');
      nUrl.searchParams.set('q', `${q}, Karnataka, India`);
      nUrl.searchParams.set('format', 'jsonv2');
      nUrl.searchParams.set('addressdetails', '1');
            nUrl.searchParams.set('limit', '6');

      const nRes = await fetch(nUrl, {
        headers: { 'User-Agent': 'MediSync-Healthcare-App/1.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (nRes.ok) {
        const rows = await nRes.json();
        for (const row of rows) {
          const parts = String(row.display_name || '').split(',').map((s) => s.trim()).filter(Boolean);
          const mainText = row.name || parts[0] || q;
          const secondaryText = parts.slice(1, 4).join(', ');
          const label = secondaryText ? `${mainText}, ${secondaryText}` : mainText;
          pushUnique({
            id: String(row.place_id || label),
            label,
            mainText,
            secondaryText,
            lat: Number(row.lat),
            lng: Number(row.lon),
          });
        }
      }
    } catch {
      // Ignore network errors
    }
  }

  res.json({ suggestions: suggestions.slice(0, 6) });
});
import crypto from 'node:crypto';

const DEFAULT_CATALOGUE = [
  ['Paracetamol 500mg', 32.00, 10, 50, false],
  ['Amoxicillin 500mg', 115.00, 8, 30, true],
  ['Cetirizine 10mg', 28.00, 12, 45, false],
  ['Pantoprazole 40mg', 95.00, 10, 40, false],
  ['Azithromycin 500mg', 148.00, 8, 25, true],
  ['Metformin 500mg', 54.00, 10, 40, true],
  ['Vitamin D3 60K Cap', 120.00, 15, 35, false],
  ['ORS Hydration Sachet', 24.00, 5, 60, false],
];

export const ensurePartner = asyncHandler(async (req, res) => {
  const { id, name, address, latitude, longitude } = req.body ?? {};
  const cleanName = String(name ?? '').trim().slice(0, 140) || 'Nearby Medical Store';
  const cleanAddress = String(address ?? '').trim().slice(0, 260) || 'Local Pharmacy';
  const lat = Number.isFinite(Number(latitude)) ? Number(latitude) : 14.0706;
  const lng = Number.isFinite(Number(longitude)) ? Number(longitude) : 76.6096;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let pharmacyId = uuidRegex.test(String(id ?? '')) ? String(id) : null;

  if (pharmacyId) {
    const existing = await query('SELECT user_id FROM pharmacies WHERE user_id = $1', [pharmacyId]);
    if (!existing.rowCount) pharmacyId = null;
  }

  if (!pharmacyId) {
    const keySource = `${String(id ?? '').trim()}|${cleanName.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    const hex = crypto.createHash('sha256').update(keySource).digest('hex');
    pharmacyId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const slug = hex.slice(0, 12);

    await withTransaction(async (c) => {
      await c.query(
        `INSERT INTO users (id, email, phone, password_hash, role, email_verified, phone_verified)
         VALUES ($1, $2, $3, $4, 'pharmacy', TRUE, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [pharmacyId, `partner-${slug}@medisync.local`, `9${hex.slice(0, 9)}`, 'partner_auto_provisioned']
      );

      await c.query(
        `INSERT INTO pharmacies
           (user_id, store_name, license_number, address, latitude, longitude, place_id, maps_verified, verification_status, verified_at, verification_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'approved', now(), 'Auto-enabled for prescription fulfillment')
         ON CONFLICT (user_id) DO UPDATE
           SET store_name = EXCLUDED.store_name,
               address = EXCLUDED.address,
               verification_status = 'approved'`,
        [pharmacyId, cleanName, `LIC-${slug.toUpperCase()}`, cleanAddress, lat, lng, String(id ?? '') || null]
      );
    });
  }

  const countRes = await query('SELECT count(*)::int AS cnt FROM pharmacy_inventory WHERE pharmacy_id = $1', [pharmacyId]);
  if ((countRes.rows[0]?.cnt ?? 0) === 0) {
    for (const [medName, mrp, discountPct, stockQty, isScheduleH] of DEFAULT_CATALOGUE) {
      await query(
        `INSERT INTO pharmacy_inventory
           (pharmacy_id, medicine_name, mrp, discount_pct, stock_qty, is_schedule_h)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (pharmacy_id, medicine_name) DO NOTHING`,
        [pharmacyId, medName, mrp, discountPct, stockQty, isScheduleH]
      );
    }
  }

  const { rows: items } = await query(
    `SELECT id, pharmacy_id AS "pharmacyId", medicine_name AS "medicineName",
            mrp::float8 AS mrp, discount_pct::float8 AS "discountPct",
            stock_qty AS "stockQty", is_schedule_h AS "isScheduleH"
       FROM pharmacy_inventory WHERE pharmacy_id = $1 ORDER BY medicine_name`,
    [pharmacyId]
  );

  res.json({
    pharmacyId,
    storeName: cleanName,
    address: cleanAddress,
    items,
  });
});