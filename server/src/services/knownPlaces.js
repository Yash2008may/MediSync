// Offline place index used when no Google Maps key is configured (or when Google cannot
// resolve a name). It covers the neighbourhoods the demo serves in Bengaluru plus the
// major metro centres, and it tolerates the usual typos and spacing differences so a
// patient typing "kumars wamy layout" still lands on Kumaraswamy Layout.

const PLACES = [
  // Bengaluru localities (the demo's home city)
  { name: 'Indiranagar', city: 'Bengaluru', latitude: 12.9719, longitude: 77.6412 },
  { name: 'Koramangala', city: 'Bengaluru', latitude: 12.9352, longitude: 77.6245 },
  { name: 'Jayanagar', city: 'Bengaluru', latitude: 12.925, longitude: 77.5838 },
  { name: 'Kumaraswamy Layout', city: 'Bengaluru', latitude: 12.908, longitude: 77.553 },
  { name: 'Whitefield', city: 'Bengaluru', latitude: 12.9698, longitude: 77.75 },
  { name: 'HSR Layout', city: 'Bengaluru', latitude: 12.9121, longitude: 77.6446 },
  { name: 'Marathahalli', city: 'Bengaluru', latitude: 12.9592, longitude: 77.6974 },
  { name: 'BTM Layout', city: 'Bengaluru', latitude: 12.9166, longitude: 77.6101 },
  { name: 'Rajajinagar', city: 'Bengaluru', latitude: 12.9916, longitude: 77.5527 },
  { name: 'Malleshwaram', city: 'Bengaluru', latitude: 13.0035, longitude: 77.5648 },
  { name: 'Hebbal', city: 'Bengaluru', latitude: 13.0358, longitude: 77.597 },
  { name: 'Yelahanka', city: 'Bengaluru', latitude: 13.1007, longitude: 77.5963 },
  { name: 'Banashankari', city: 'Bengaluru', latitude: 12.9255, longitude: 77.5468 },
  { name: 'JP Nagar', city: 'Bengaluru', latitude: 12.9077, longitude: 77.5851 },
  { name: 'Bellandur', city: 'Bengaluru', latitude: 12.9304, longitude: 77.6784 },
  { name: 'Electronic City', city: 'Bengaluru', latitude: 12.8452, longitude: 77.6602 },
  { name: 'Basavanagudi', city: 'Bengaluru', latitude: 12.9422, longitude: 77.5738 },
  { name: 'Vijayanagar', city: 'Bengaluru', latitude: 12.9719, longitude: 77.533 },
  { name: 'Kammanahalli', city: 'Bengaluru', latitude: 13.0137, longitude: 77.638 },
  { name: 'Frazer Town', city: 'Bengaluru', latitude: 13.0012, longitude: 77.617 },
  { name: 'Ulsoor', city: 'Bengaluru', latitude: 12.9816, longitude: 77.6265 },
  { name: 'Domlur', city: 'Bengaluru', latitude: 12.9609, longitude: 77.6387 },
  { name: 'Sarjapur Road', city: 'Bengaluru', latitude: 12.901, longitude: 77.687 },
  { name: 'Hennur', city: 'Bengaluru', latitude: 13.035, longitude: 77.642 },
  { name: 'Kengeri', city: 'Bengaluru', latitude: 12.9172, longitude: 77.4838 },
  { name: 'Bengaluru', city: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 },
  { name: 'Bangalore', city: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 },

  // Other metro centres, so a city name is enough for a saved location elsewhere.
  { name: 'Mumbai', city: 'Maharashtra', latitude: 19.076, longitude: 72.8777 },
  { name: 'Delhi', city: 'Delhi', latitude: 28.6139, longitude: 77.209 },
  { name: 'New Delhi', city: 'Delhi', latitude: 28.6139, longitude: 77.209 },
  { name: 'Gurugram', city: 'Haryana', latitude: 28.4595, longitude: 77.0266 },
  { name: 'Noida', city: 'Uttar Pradesh', latitude: 28.5355, longitude: 77.391 },
  { name: 'Pune', city: 'Maharashtra', latitude: 18.5204, longitude: 73.8567 },
  { name: 'Hyderabad', city: 'Telangana', latitude: 17.385, longitude: 78.4867 },
  { name: 'Chennai', city: 'Tamil Nadu', latitude: 13.0827, longitude: 80.2707 },
  { name: 'Kolkata', city: 'West Bengal', latitude: 22.5726, longitude: 88.3639 },
  { name: 'Ahmedabad', city: 'Gujarat', latitude: 23.0225, longitude: 72.5714 },
  { name: 'Kochi', city: 'Kerala', latitude: 9.9312, longitude: 76.2673 },
];

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const compact = (value) => normalize(value).replace(/\s+/g, '');

// Edit distance, two rows at a time (place names are short).
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// Longer names may differ by more characters before we stop believing it is the same place.
const tolerance = (length) => (length >= 14 ? 3 : length >= 8 ? 2 : 1);

// Best offline match for a typed name, or null when nothing is close enough.
export function findKnownPlace(query) {
  const typed = compact(query);
  if (typed.length < 4) return null;

  let best = null;
  for (const place of PLACES) {
    for (const candidate of [compact(place.name), compact(`${place.name} ${place.city}`)]) {
      if (candidate.length < 4) continue;
      const diff = distance(typed, candidate);
      if (diff > tolerance(Math.max(typed.length, candidate.length))) continue;
      if (!best || diff < best.diff) best = { place, diff, candidate };
    }
  }
  if (!best) return null;

  const { place } = best;
  return {
    latitude: place.latitude,
    longitude: place.longitude,
    address: `${place.name}, ${place.city}`,
    source: 'index',
  };
}
