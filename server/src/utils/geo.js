const EARTH_RADIUS_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// Cheap pre-filter so SQL can use the (latitude, longitude) index before computing distance.
export function boundingBox(lat, lng, radiusM) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(Math.cos(toRad(lat)), 0.01));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

export const mapsPlaceUrl = (lat, lng, placeId) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` +
  (placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : '');

export const mapsDirectionsUrl = (lat, lng, placeId) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` +
  (placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : '');
