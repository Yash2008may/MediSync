// Loaded before the test files (node --import). Tests must not depend on the public
// OpenStreetMap service, so the keyless network fallback is disabled; the built-in
// locality index still resolves place names offline.
process.env.GEOCODER_NOMINATIM = 'false';
