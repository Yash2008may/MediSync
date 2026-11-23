import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../utils/AppError.js';
import { hasConsent } from '../services/consentService.js';
import { reverseGeocode } from '../services/googleMaps.js';
import { getDefaultStores, refreshDefaultStores } from '../services/storeService.js';

// PUT /api/patients/me/location
// Body comes straight from navigator.geolocation: { latitude, longitude, altitude, accuracy }.
// The server stores exactly what the device reports. It never substitutes a default location.
export const updateLiveLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude, altitude = null, accuracy = null } = req.body;

  if (!(await hasConsent(req.user.id, 'location'))) {
    throw new AppError(403, 'Location consent is required. Please allow location access first.');
  }
  if (accuracy !== null && accuracy > env.geo.maxAccuracyMeters) {
    throw new AppError(422, `Location is too imprecise (±${Math.round(accuracy)} m). Move outdoors or turn on GPS/precise location.`);
  }

  const address = await reverseGeocode(latitude, longitude); // null when Maps isn't configured
  const { rows } = await query(
    `UPDATE patients
        SET live_lat = $2, live_lng = $3, live_alt = $4, live_accuracy_m = $5,
            live_address = $6, live_updated_at = now()
      WHERE user_id = $1
      RETURNING live_updated_at`,
    [req.user.id, latitude, longitude, altitude, accuracy, address]
  );

  const defaultStores = await refreshDefaultStores(req.user.id, latitude, longitude);
  res.json({
    location: { latitude, longitude, altitude, accuracy, address, addressResolved: address !== null, updatedAt: rows[0].live_updated_at },
    defaultStores,
  });
});

export const clearLiveLocation = asyncHandler(async (req, res) => {
  await query(
    `UPDATE patients SET live_lat = NULL, live_lng = NULL, live_alt = NULL, live_accuracy_m = NULL,
            live_address = NULL, live_updated_at = NULL WHERE user_id = $1`,
    [req.user.id]
  );
  await query('DELETE FROM patient_default_stores WHERE patient_id = $1', [req.user.id]);
  res.json({ message: 'Live location removed.' });
});

export const listDefaultStores = asyncHandler(async (req, res) => {
  res.json({ stores: await getDefaultStores(req.user.id) });
});

// GET /api/patients/me/default-location — the location the patient saved themselves.
export const getDefaultLocation = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT default_lat, default_lng, default_label FROM patients WHERE user_id = $1',
    [req.user.id]
  );
  const row = rows[0];
  const saved = row && Number.isFinite(row.default_lat) && Number.isFinite(row.default_lng);
  res.json({
    location: saved
      ? { lat: row.default_lat, lng: row.default_lng, label: row.default_label ?? 'My default location' }
      : null,
  });
});

// PUT /api/patients/me/default-location  { lat, lng, label }
// Overwrites the saved default location; there is no server-side fallback address.
export const saveDefaultLocation = asyncHandler(async (req, res) => {
  const { lat, lng, label } = req.body;
  const { rows } = await query(
    `UPDATE patients SET default_lat = $2, default_lng = $3, default_label = $4
      WHERE user_id = $1
      RETURNING default_lat, default_lng, default_label`,
    [req.user.id, lat, lng, label]
  );
  if (!rows[0]) throw new AppError(404, 'Patient profile not found');
  res.json({ location: { lat: rows[0].default_lat, lng: rows[0].default_lng, label: rows[0].default_label } });
});

export const getPortalState = asyncHandler(async (req, res) => {
  await query(`
    CREATE TABLE IF NOT EXISTS patient_portal_state (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      medicines JSONB NOT NULL DEFAULT '[]'::jsonb,
      doses JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await query(
    'SELECT medicines, doses FROM patient_portal_state WHERE user_id = $1',
    [req.user.id]
  );
  res.json(rows[0] ?? null);
});

export const savePortalState = asyncHandler(async (req, res) => {
  await query(`
    CREATE TABLE IF NOT EXISTS patient_portal_state (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      medicines JSONB NOT NULL DEFAULT '[]'::jsonb,
      doses JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const medicines = Array.isArray(req.body?.medicines) ? req.body.medicines : [];
  const doses = Array.isArray(req.body?.doses) ? req.body.doses : [];
  await query(
    `INSERT INTO patient_portal_state (user_id, medicines, doses, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET
       medicines = EXCLUDED.medicines,
       doses = EXCLUDED.doses,
       updated_at = now()`,
    [req.user.id, JSON.stringify(medicines), JSON.stringify(doses)]
  );
  res.json({ saved: true });
});