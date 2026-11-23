import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { boundingBox, haversineMeters, mapsDirectionsUrl, mapsPlaceUrl } from '../utils/geo.js';
import { getPlaceDetails, searchNearbyPharmacies } from './googleMaps.js';

const shape = (s) => ({
  ...s,
  distanceMeters: Math.round(s.distanceMeters),
  mapsUrl: mapsPlaceUrl(s.latitude, s.longitude, s.placeId),
  directionsUrl: mapsDirectionsUrl(s.latitude, s.longitude, s.placeId),
});

// Geoapify Places API (3,000 free req/day — global pharmacies, street addresses & phones)
async function searchGeoapifyPharmacies(lat, lng, radiusM = 6000, limit = 25) {
  const apiKey = process.env.GEOAPIFY_API_KEY?.trim();
  if (!apiKey) return [];
  const tryRadius = async (r) => {
    try {
      const url = new URL('https://api.geoapify.com/v2/places');
      url.searchParams.set('categories', 'healthcare.pharmacy,commercial.health_and_beauty.pharmacy');
      url.searchParams.set('filter', `circle:${lng},${lat},${r}`);
      url.searchParams.set('bias', `proximity:${lng},${lat}`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('apiKey', apiKey);

      const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.features ?? [])
        .map((f) => {
          const p = f.properties || {};
          if (p.lat == null || p.lon == null) return null;
          return {
            placeId: null,
            osmId: `geoapify_${p.place_id || `${p.lat}_${p.lon}`}`,
            name: p.name || p.address_line1 || 'Medical Store / Pharmacy',
            address: p.formatted || p.address_line2 || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
            phone: p.contact?.phone || p.datasource?.raw?.phone || null,
            rating: null,
            openNow: null,
            latitude: p.lat,
            longitude: p.lon,
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  let results = await tryRadius(Math.max(radiusM, 8000));
  if (results.length < 3) {
    results = await tryRadius(25000);
  }
  return results;
}
// 100% Free Global Search (No API Key Required):
// Combines Overpass API + Nominatim Bounded Search + Photon POI Search worldwide
async function searchOsmPharmacies(lat, lng, radiusM = 6000, limit = 25) {
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  const collected = [];

  const pushPlace = (p) => {
    if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return;
    // Deduplicate stores within 45 meters of an already-collected store
    const duplicate = collected.some(
      (existing) => haversineMeters(existing.latitude, existing.longitude, p.latitude, p.longitude) < 45
    );
    if (duplicate) return;
    collected.push(p);
  };

  // 1. OpenStreetMap Overpass query (pharmacies, chemists, medical stores)
  const queryOverpass = async (r) => {
    const overpassQuery = `
      [out:json][timeout:14];
      (
        node["amenity"="pharmacy"](around:${r},${lat},${lng});
        way["amenity"="pharmacy"](around:${r},${lat},${lng});
        node["healthcare"="pharmacy"](around:${r},${lat},${lng});
        way["healthcare"="pharmacy"](around:${r},${lat},${lng});
        node["shop"~"chemist|medical_supply"](around:${r},${lat},${lng});
        way["shop"~"chemist|medical_supply"](around:${r},${lat},${lng});
        node["name"~"medical|pharmacy|chemist|pharma|medplus|apollo|wellness",i](around:${r},${lat},${lng});
        way["name"~"medical|pharmacy|chemist|pharma|medplus|apollo|wellness",i](around:${r},${lat},${lng});
      );
      out center ${limit};
    `;

    for (const endpoint of mirrors) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'MediSync-Healthcare-App/1.0',
          },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) continue;

        const data = await res.json();
        for (const el of data.elements || []) {
          const latitude = el.lat ?? el.center?.lat;
          const longitude = el.lon ?? el.center?.lon;
          if (latitude == null || longitude == null) continue;
          const tags = el.tags || {};
          const rawName = tags.name || tags['name:en'] || tags.operator || '';
          const road = tags['addr:street'] || tags['addr:suburb'] || tags['addr:neighbourhood'] || '';
          const city = tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || tags['addr:district'] || '';
          const addr = [tags['addr:housenumber'], road, city, tags['addr:state'], tags['addr:country']]
            .filter(Boolean)
            .join(', ');

          pushPlace({
            placeId: null,
            osmId: `osm_${el.type}_${el.id}`,
            name: rawName || (road ? `Pharmacy (${road})` : 'Medical Store / Pharmacy'),
            address: addr || `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}`,
            phone: tags.phone || tags['contact:phone'] || null,
            rating: null,
            openNow: null,
            latitude: Number(latitude),
            longitude: Number(longitude),
          });
        }
        if (collected.length > 0) break;
      } catch {
        // Try next mirror
      }
    }
  };

  await queryOverpass(Math.max(radiusM, 6000));
  if (collected.length < 5) {
    await queryOverpass(20000);
  }

  // 2. Nominatim bounded viewbox search for local named pharmacies/medicals
  const delta = 0.09; // ~10 km viewbox
  const viewbox = `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`;
  for (const term of ['pharmacy', 'medical', 'chemist']) {
    if (collected.length >= limit) break;
    try {
      const nUrl = new URL('https://nominatim.openstreetmap.org/search');
      nUrl.searchParams.set('q', term);
      nUrl.searchParams.set('format', 'jsonv2');
      nUrl.searchParams.set('addressdetails', '1');
      nUrl.searchParams.set('viewbox', viewbox);
      nUrl.searchParams.set('bounded', '1');
      nUrl.searchParams.set('limit', '15');

      const nRes = await fetch(nUrl, {
        headers: { 'User-Agent': 'MediSync-Healthcare-App/1.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (!nRes.ok) continue;
      const rows = await nRes.json();
      for (const row of rows) {
        const fLat = Number(row.lat);
        const fLng = Number(row.lon);
        const parts = String(row.display_name || '').split(',').map((s) => s.trim()).filter(Boolean);
        pushPlace({
          placeId: null,
          osmId: `nom_${row.place_id}`,
          name: row.name || parts[0] || 'Medical Store / Pharmacy',
          address: parts.slice(0, 4).join(', '),
          phone: null,
          rating: null,
          openNow: null,
          latitude: fLat,
          longitude: fLng,
        });
      }
    } catch {
      // Continue
    }
  }

  // 3. Photon POI search biased around (lat, lng)
  for (const term of ['pharmacy', 'medical']) {
    if (collected.length >= limit) break;
    try {
      const pUrl = new URL('https://photon.komoot.io/api/');
      pUrl.searchParams.set('q', term);
      pUrl.searchParams.set('lat', String(lat));
      pUrl.searchParams.set('lon', String(lng));
      pUrl.searchParams.set('limit', '12');

      const pRes = await fetch(pUrl, {
        headers: { 'User-Agent': 'MediSync-Healthcare-App/1.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (!pRes.ok) continue;
      const pData = await pRes.json();
      for (const feat of pData.features ?? []) {
        const [fLng, fLat] = feat.geometry?.coordinates ?? [null, null];
        if (!Number.isFinite(fLat) || !Number.isFinite(fLng)) continue;
        if (haversineMeters(lat, lng, fLat, fLng) > 25000) continue;
        const props = feat.properties || {};
        const addr = [props.street, props.suburb, props.city || props.district, props.state, props.country]
          .filter(Boolean)
          .join(', ');
        pushPlace({
          placeId: null,
          osmId: `photon_${props.osm_id || `${fLat}_${fLng}`}`,
          name: props.name || 'Medical Store / Pharmacy',
          address: addr || `${fLat.toFixed(4)}, ${fLng.toFixed(4)}`,
          phone: null,
          rating: null,
          openNow: null,
          latitude: fLat,
          longitude: fLng,
        });
      }
    } catch {
      // Continue
    }
  }

    return { available: collected.length > 0, places: collected.slice(0, limit) };
}
// Approved, registered MediSync pharmacies (can take in-app orders), nearest first.
export async function findRegisteredNearby({ lat, lng, radiusM, limit }) {
  const b = boundingBox(lat, lng, radiusM);
  const { rows } = await query(
    `SELECT * FROM (
       SELECT p.user_id, p.store_name, p.address, p.latitude, p.longitude, p.place_id, u.phone,
              6371000 * 2 * asin(sqrt(
                power(sin(radians(p.latitude - $1::float8) / 2), 2) +
                cos(radians($1::float8)) * cos(radians(p.latitude)) *
                power(sin(radians(p.longitude - $2::float8) / 2), 2))) AS distance_m
         FROM pharmacies p
         JOIN users u ON u.id = p.user_id
        WHERE p.verification_status = 'approved' AND u.is_active
          AND p.latitude  BETWEEN $3 AND $4
          AND p.longitude BETWEEN $5 AND $6
     ) t
     WHERE distance_m <= $7
     ORDER BY distance_m
     LIMIT $8`,
    [lat, lng, b.minLat, b.maxLat, b.minLng, b.maxLng, radiusM, limit]
  );
  return rows.map((r) =>
    shape({
      source: 'registered',
      id: r.user_id,
      placeId: r.place_id,
      name: r.store_name,
      address: r.address,
      phone: r.phone,
      rating: null,
      openNow: null,
      latitude: r.latitude,
      longitude: r.longitude,
      distanceMeters: r.distance_m,
      canOrderInApp: true,
    })
  );
}

// Registered pharmacies + Google Maps (or free OpenStreetMap) pharmacies, sorted by distance.
export async function findNearbyStores({ lat, lng, radiusM = env.geo.nearbyRadiusMeters, limit = 20 }) {
  const [registered, google] = await Promise.all([
    findRegisteredNearby({ lat, lng, radiusM, limit }),
    searchNearbyPharmacies(lat, lng, radiusM, limit),
  ]);

  let mapResult = google;
  if (!mapResult.available) {
    const [geoPlaces, osmRes] = await Promise.all([
      searchGeoapifyPharmacies(lat, lng, radiusM, limit),
      searchOsmPharmacies(lat, lng, Math.max(radiusM, 6000), limit),
    ]);
    const combined = [...geoPlaces];
    for (const p of osmRes.places ?? []) {
      if (!combined.some((g) => haversineMeters(g.latitude, g.longitude, p.latitude, p.longitude) < 45)) {
        combined.push(p);
      }
    }
    mapResult = { available: combined.length > 0, places: combined };
  }

  const externalStores = mapResult.places
    .filter((g) => !registered.some((r) => (r.placeId && r.placeId === g.placeId) ||
      haversineMeters(r.latitude, r.longitude, g.latitude, g.longitude) < 40))
    .map((g) =>
      shape({
        source: google.available ? 'google' : 'osm',
        id: g.placeId || g.osmId,
        placeId: g.placeId,
        name: g.name,
        address: g.address,
        phone: g.phone ?? null,
        rating: g.rating ?? null,
        openNow: g.openNow ?? null,
        latitude: g.latitude,
        longitude: g.longitude,
        distanceMeters: haversineMeters(lat, lng, g.latitude, g.longitude),
        canOrderInApp: false,
      })
    );

  const stores = [...registered, ...externalStores].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, limit);
  return { stores, googleAvailable: mapResult.available };
}

// Called whenever the patient's live location updates: nearest 3 shops become their defaults.
export async function refreshDefaultStores(patientId, lat, lng) {
  const { stores } = await findNearbyStores({ lat, lng, limit: 10 });
  const top = stores.slice(0, 3);

  await withTransaction(async (c) => {
    await c.query('DELETE FROM patient_default_stores WHERE patient_id = $1', [patientId]);
    for (const [i, s] of top.entries()) {
      await c.query(
        `INSERT INTO patient_default_stores
           (patient_id, rank, source, pharmacy_id, place_id, latitude, longitude, distance_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [patientId, i + 1, s.source, s.source === 'registered' ? s.id : null,
         s.source === 'google' ? s.placeId : null, s.latitude, s.longitude, s.distanceMeters]
      );
    }
  });
  return top;
}

export async function getDefaultStores(patientId) {
  const { rows } = await query(
    `SELECT d.rank, d.source, d.pharmacy_id, d.place_id, d.latitude, d.longitude, d.distance_m,
            p.store_name, p.address, u.phone
       FROM patient_default_stores d
       LEFT JOIN pharmacies p ON p.user_id = d.pharmacy_id
       LEFT JOIN users u ON u.id = d.pharmacy_id
      WHERE d.patient_id = $1
      ORDER BY d.rank`,
    [patientId]
  );

  return Promise.all(
    rows.map(async (r) => {
      if (r.source === 'registered') {
        return { rank: r.rank, ...shape({
          source: 'registered', id: r.pharmacy_id, placeId: null, name: r.store_name, address: r.address,
          phone: r.phone, rating: null, openNow: null, latitude: r.latitude, longitude: r.longitude,
          distanceMeters: r.distance_m, canOrderInApp: true,
        }) };
      }
      if (r.source === 'osm' || !r.place_id) {
        return { rank: r.rank, ...shape({
          source: 'osm', id: `osm_${r.rank}`, placeId: null, name: 'Nearby Pharmacy (OpenStreetMap)',
          address: null, phone: null, rating: null, openNow: null, latitude: r.latitude, longitude: r.longitude,
          distanceMeters: r.distance_m, canOrderInApp: false,
        }) };
      }
      const d = await getPlaceDetails(r.place_id);
      return { rank: r.rank, ...shape({
        source: 'google', id: r.place_id, placeId: r.place_id, name: d?.name ?? 'Pharmacy (Google Maps)',
        address: d?.address ?? null, phone: d?.phone ?? null, rating: d?.rating ?? null,
        openNow: d?.openNow ?? null, latitude: r.latitude, longitude: r.longitude,
        distanceMeters: r.distance_m, canOrderInApp: false,
      }) };
    })
  );
}