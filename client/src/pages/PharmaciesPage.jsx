import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Building2,
  Compass,
  Crosshair,
  Home,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Save,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
} from 'lucide-react';
import { Badge, Card, SectionHeading } from '../ui.jsx';
import StoreMap from '../components/StoreMap.jsx';
import PrescriptionOrderCard from '../components/PrescriptionOrderCard.jsx';
import { DEMO_REASON_TEXT, fetchMapsConfig, geocodePlace, requestLocation } from '../pharmacies.js';
import { apiUrl } from '../api.js';

// Reasons where asking the browser again can still produce a position. A blocked permission
// or an insecure origin cannot, so those get guidance instead of a retry button.
const RETRYABLE_REASONS = new Set(['denied', 'timeout', 'unavailable']);
// Ask for a fix at most once per page session, so re-visiting the tab neither re-prompts an
// undecided patient nor retries a request that already timed out.
let askedForGps = false;

const km = (pharmacy) => (Number.isFinite(pharmacy?.distanceKm) ? pharmacy.distanceKm.toFixed(1) : '—');

const directionsLink = (pharmacy) =>
  pharmacy.directionsUrl ??
  `https://www.google.com/maps/dir/?api=1&destination=${pharmacy.lat},${pharmacy.lng}&travelmode=driving`;

const PAD = 14; // % inset so pins never touch the edge of the map card

// Place pins by real coordinates, relative to the live fix, so the map matches the lookup.
function mapPositions(items, centre) {
  const positioned = items.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const points = centre ? [...positioned, { id: '__me', lat: centre.lat, lng: centre.lng }] : positioned;
  const positions = {};
  const centreFallback = () => {
    items.forEach((pharmacy) => {
      positions[pharmacy.id] = { top: '50%', left: '50%' };
    });
    return positions;
  };

  if (!items.length) return positions;
  if (points.length < 2) {
    if (centre) positions.__me = { top: '50%', left: '50%' };
    return Object.keys(positions).length ? positions : centreFallback();
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const maxLat = Math.max(...lats);
  const minLat = Math.min(...lats);
  const maxLng = Math.max(...lngs);
  const minLng = Math.min(...lngs);
  const spanLat = maxLat - minLat || 0.01;
  const spanLng = maxLng - minLng || 0.01;

  const place = (lat, lng) => ({
    top: `${(PAD + ((maxLat - lat) / spanLat) * (100 - PAD * 2)).toFixed(1)}%`,
    left: `${(PAD + ((lng - minLng) / spanLng) * (100 - PAD * 2)).toFixed(1)}%`,
  });

  if (centre) positions.__me = place(centre.lat, centre.lng);
  items.forEach((pharmacy) => {
    positions[pharmacy.id] =
      Number.isFinite(pharmacy.lat) && Number.isFinite(pharmacy.lng)
        ? place(pharmacy.lat, pharmacy.lng)
        : { top: '50%', left: '50%' };
  });
  return positions;
}

// Keyless fallback: a schematic plot of the same coordinates, used until a Google
// Maps browser key is configured on the server.
function SketchMap({ items, positions, centre, selectedId, onSelect, defaultShops, live }) {
  return (
    <div
      className="relative h-[300px] overflow-hidden bg-slate-100"
      style={{
        backgroundImage:
          'linear-gradient(0deg, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.16) 1px, transparent 1px)',
        backgroundSize: '38px 38px',
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white/40 to-brand-50/60" />
      <div className="absolute left-[8%] top-[12%] h-16 w-24 rounded-lg bg-slate-200/60" />
      <div className="absolute bottom-[10%] right-[6%] h-20 w-32 rounded-xl bg-slate-200/50" />
      <div className="absolute left-[45%] top-[55%] h-24 w-24 rounded-full bg-emerald-100/70" />

      <span
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
        style={positions.__me ?? { top: '50%', left: '50%' }}
        title={centre ? 'Your location' : 'Sample location (demo)'}
      >
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-70" />
          <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-brand-600" />
        </span>
      </span>

      {items.map((pharmacy) => {
        const isDefault = defaultShops.some((shop) => shop.id === pharmacy.id);
        const isSelected = selectedId === pharmacy.id;
        return (
          <button
            key={pharmacy.id}
            type="button"
            onClick={() => onSelect(pharmacy.id)}
            style={positions[pharmacy.id] ?? { top: '50%', left: '50%' }}
            className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-2 py-1 text-[10px] font-bold shadow-lg transition ${
              isDefault ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'
            } ${isSelected ? 'scale-110 ring-2 ring-brand-300' : 'hover:scale-105'}`}
            title={`${pharmacy.name} · ${km(pharmacy)} km`}
          >
            {pharmacy.name.split(' ')[0]}
          </button>
        );
      })}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-sm backdrop-blur">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {live ? 'Schematic map' : 'Demo pins'}
        </p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
          Add GOOGLE_MAPS_BROWSER_KEY on the server to replace this plot with a live Google map.
        </p>
      </div>
    </div>
  );
}

// The patient saves this themselves — no address is pre-filled by the server.
function DefaultLocationCard({ saved, onSave, biasCoords }) {
  const [label, setLabel] = useState(saved?.label ?? '');
  const [suggestions, setSuggestions] = useState([]);
  const [openDropdown, setOpenDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pickedCoords, setPickedCoords] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!saved) return;
    setLabel(saved.label ?? '');
  }, [saved]);

  useEffect(() => {
    const q = label.trim();
    if (!openDropdown || q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(apiUrl(`/api/stores/autocomplete?q=${encodeURIComponent(q)}${biasCoords ? `&lat=${biasCoords.lat}&lng=${biasCoords.lng}` : ""}`), {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [label, openDropdown]);

  const handleSelectSuggestion = async (item) => {
    setLabel(item.label);
    setOpenDropdown(false);
    setSuggestions([]);
    setError(null);
    setBusy(true);
    try {
      let coords =
        Number.isFinite(item.lat) && Number.isFinite(item.lng)
          ? { lat: item.lat, lng: item.lng }
          : await geocodePlace(item.label);
      if (coords) {
        setPickedCoords(coords);
        await onSave({ lat: coords.lat, lng: coords.lng, label: item.label });
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setOpenDropdown(false);
    const place = label.trim();
    if (place.length < 2) return setError('Type a place name, for example "Kumaraswamy Layout, Bengaluru".');
    setBusy(true);
    setError(null);
    let coords = pickedCoords ?? (await geocodePlace(place));
    if (!coords) {
      try {
        const fix = await requestLocation();
        coords = { lat: fix.lat, lng: fix.lng };
      } catch {
        coords = null;
      }
    }
    if (!coords) {
      setBusy(false);
      return setError(`We could not find "${place}". Pick a suggestion from the dropdown list.`);
    }
    await onSave({ lat: coords.lat, lng: coords.lng, label: place });
    setBusy(false);
  };

  const fieldClass =
    'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pr-9 text-sm text-ink outline-none focus:border-brand-500';

  return (
    <div id="default-location-card">
      <Card className="!overflow-visible p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
              <Home className="h-4 w-4 text-brand-600" /> My default location
            </h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Somewhere you order from often. &ldquo;Default location&rdquo; then finds shops around it without asking for GPS.
            </p>
          </div>
          {saved ? <Badge tone="teal">Saved</Badge> : null}
        </div>

        <form onSubmit={submit} className="mt-3 space-y-2.5">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              PLACE NAME
            </label>
            <div className="relative mt-1">
              <input
                type="text"
                value={label}
                onFocus={() => setOpenDropdown(true)}
                onBlur={() => setTimeout(() => setOpenDropdown(false), 180)}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setPickedCoords(null);
                  setOpenDropdown(true);
                }}
                placeholder="Search area or landmark, e.g. Kumaraswamy Layout..."
                className={fieldClass}
                maxLength={120}
                autoComplete="off"
              />
              {searching ? (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
              ) : null}
              {openDropdown && suggestions.length > 0 ? (
                <ul className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/10">
                  {suggestions.map((item) => (
                    <li key={item.id} className="border-b border-slate-100 last:border-none">
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSuggestion(item);
                        }}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-slate-50"
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate text-xs">
                          <span className="font-semibold text-ink">{item.mainText}</span>
                          {item.secondaryText ? (
                            <span className="ml-1.5 text-slate-400">{item.secondaryText}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Start typing a neighbourhood, area or landmark to pick from live map suggestions.
            </p>
          </div>

          {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="btn-primary !px-3.5 !py-2 !text-xs">
              <Save className="h-3.5 w-3.5" />
              {busy ? 'Saving...' : 'Save as my default'}
            </button>
            {saved?.label ? <span className="text-xs text-slate-400">{saved.label}</span> : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
function ShopCard({ pharmacy, rank, isDemo, selected, onSelect, onOrder }) {
  const isDefault = rank <= 3;
  return (
    <Card
      className={`flex flex-col justify-between p-4 transition ${
        selected ? 'ring-2 ring-brand-500 bg-brand-50/20' : 'hover:border-slate-300'
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700 ring-1 ring-brand-100">
                #{rank}
              </span>
              <h3 className="truncate text-xs font-bold text-ink">{pharmacy.name}</h3>
              {pharmacy.verified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-600" /> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
              {pharmacy.address || 'Address listed on Google Maps'}
            </p>
          </div>
          {isDemo ? (
            <Badge tone="amber">Demo</Badge>
          ) : pharmacy.verified ? (
            <Badge tone="teal">Partner</Badge>
          ) : (
            <Badge tone="slate">Google listing</Badge>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1 font-semibold text-ink">
            <Compass className="h-3 w-3 text-brand-600" />
            {km(pharmacy)} km
          </span>
          {pharmacy.rating != null ? (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {pharmacy.rating}
              {pharmacy.reviews ? ` (${pharmacy.reviews})` : ''}
            </span>
          ) : null}
          {pharmacy.open != null ? (
            <span className={pharmacy.open ? 'font-semibold text-emerald-600' : 'text-rose-500'}>
              {pharmacy.open ? 'Open now' : 'Closed'}
            </span>
          ) : null}
          {pharmacy.phone ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3 text-slate-400" />
              {pharmacy.phone}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => onSelect(pharmacy.id)}
          className={`flex-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition ${
            selected
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {selected ? 'Selected shop' : isDefault ? 'Order here' : 'Select shop'}
        </button>
        {onOrder ? (
          <button
            type="button"
            onClick={() => onOrder(pharmacy)}
            className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800"
          >
            <ShoppingBag className="h-3 w-3" />
            Refill
          </button>
        ) : null}
        <a
          href={directionsLink(pharmacy)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
          title="Open directions in Google Maps"
        >
          <Navigation className="h-3 w-3" />
        </a>
      </div>
    </Card>
  );
}

export default function PharmaciesPage({ state, derived, actions, lookingUp, onOrder, patientAddress }) {
  const { pharmacies } = state;
  const live = pharmacies.source === 'live';
  const isDefaultMode = pharmacies.mode === 'default';
  const savedDefault = pharmacies.defaultLocation ?? null;
  const canRetryLocation = RETRYABLE_REASONS.has(pharmacies.demoReason);
  const [mapsKey, setMapsKey] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null);
  const selectedShop =
    pharmacies.items.find((p) => p.id === pharmacies.selectedId) ?? derived.defaultShops[0] ?? null;
  const positions = useMemo(() => mapPositions(pharmacies.items, pharmacies.coords), [pharmacies.items, pharmacies.coords]);

  // A browser key can arrive at runtime from the server, so restores do not need a client rebuild.
  useEffect(() => {
    if (mapsKey) return undefined;
    let cancelled = false;
    fetchMapsConfig().then((config) => {
      if (!cancelled && config.browserKey) setMapsKey(config.browserKey);
    });
    return () => {
      cancelled = true;
    };
  }, [mapsKey]);

  // Ask for a location fix on arrival. When the browser has not decided yet this is what
  // shows its permission dialog; a remembered block cannot be re-prompted, so that case is
  // left to the "Allow location & retry" guidance above.
  useEffect(() => {
    if (live || askedForGps) return undefined;
    let cancelled = false;
    const ask = () => {
      if (cancelled || askedForGps) return;
      askedForGps = true;
      actions.refreshPharmacies({ mode: 'gps' });
    };
    if (!navigator.permissions?.query) {
      ask();
    } else {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          // Granted: refresh quietly. Undecided: this is the one prompt the patient asked for.
          // Denied: the browser will not ask again, so leave it to the retry guidance below.
          if (status.state !== 'denied') ask();
        })
        .catch(ask);
    }
    return () => {
      cancelled = true;
    };
  }, [live, actions.refreshPharmacies]);

  const updated = new Date(pharmacies.updatedAt).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const accuracy = Number.isFinite(pharmacies.coords?.accuracy) ? Math.round(pharmacies.coords.accuracy) : null;
  const reasonText = DEMO_REASON_TEXT[pharmacies.demoReason] ?? DEMO_REASON_TEXT.seed;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card className="p-4 sm:p-5">
        <SectionHeading
          title="Google Maps Pharmacies"
          subtitle="Every medical store around you — MediSync partners you can order from, plus live Google Maps listings."
          action={
            <button
              type="button"
              onClick={() => actions.refreshPharmacies({ mode: 'gps' })}
              disabled={lookingUp}
              className="btn-primary !px-3 !py-2 !text-xs"
            >
              {lookingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : live ? <RefreshCw className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />}
              {lookingUp ? 'Locating…' : live ? 'Refresh nearby' : 'Use my location'}
            </button>
          }
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => actions.refreshPharmacies({ mode: 'gps' })}
            disabled={lookingUp}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition ${
              live && !isDefaultMode
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" /> Current location
          </button>
          <button
            type="button"
            onClick={() =>
              savedDefault
                ? actions.refreshPharmacies({ mode: 'default' })
                : document.getElementById('default-location-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            disabled={lookingUp}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition ${
              live && isDefaultMode
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            {savedDefault ? savedDefault.label : 'Set default location'}
          </button>
          <span className="text-[10px] text-slate-400">
            Orders go to the shop you select below.
          </span>
        </div>

        <div
          className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-3.5 py-3 ring-1 ${
            live ? 'bg-brand-50 ring-brand-100' : 'bg-amber-50 ring-amber-200'
          }`}
        >
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${live ? 'text-brand-800' : 'text-amber-900'}`}>
            <MapPin className="h-3.5 w-3.5" />
            {pharmacies.location}
            {live ? (isDefaultMode ? ' · default' : ' · live GPS') : ' · demo data'}
          </span>
          {live ? (
            <>
              <span className="text-[11px] text-brand-800/70">Updated {updated}</span>
              {accuracy != null && !isDefaultMode ? (
                <span className="text-[11px] text-brand-800/70">±{accuracy} m</span>
              ) : null}
              <span className="text-[11px] text-brand-800/70">
                {pharmacies.items.length} medical store{pharmacies.items.length === 1 ? '' : 's'} nearby
              </span>
            </>
          ) : (
            <span className="text-[11px] text-amber-900/80">{reasonText}</span>
          )}
          {!live && canRetryLocation ? (
            <button
              type="button"
              onClick={() => actions.refreshPharmacies({ mode: 'gps' })}
              disabled={lookingUp}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:bg-amber-600 disabled:opacity-60"
            >
              {lookingUp ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crosshair className="h-3 w-3" />}
              Allow location &amp; retry
            </button>
          ) : null}
          <span className={`ml-auto text-[10px] font-medium ${live ? 'text-brand-700/80' : 'text-amber-800/80'}`}>
            Lookup #{pharmacies.lookups}
          </span>
        </div>

        {!live && pharmacies.demoReason === 'denied' ? (
          <p className="mt-2 text-[10px] leading-relaxed text-amber-800/90">
            Your browser remembers the earlier block. Open the padlock / site settings next to the address bar, set
            Location to “Allow”, then press <span className="font-semibold">Allow location &amp; retry</span>. You can
            also order from a saved default location — just enter a place name below.
          </p>
        ) : null}

        {pharmacies.notice ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 ring-1 ring-slate-200">
            {pharmacies.notice}
          </p>
        ) : null}
      </Card>

      <DefaultLocationCard saved={savedDefault} onSave={actions.setDefaultLocation} biasCoords={pharmacies.coords} />

      <PrescriptionOrderCard
        shops={derived.defaultShops}
        selectedShopId={selectedShop?.id ?? null}
        defaultAddress={patientAddress ?? ''}
      />

      {derived.defaultShops.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {derived.defaultShops.map((pharmacy, index) => (
            <ShopCard
              key={pharmacy.id}
              pharmacy={pharmacy}
              rank={index + 1}
              isDemo={!live}
              selected={selectedShop?.id === pharmacy.id}
              onSelect={actions.selectPharmacy}
              onOrder={onOrder}
            />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <MapPin className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-ink">No pharmacies near you yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
            The live lookup returned no shops within 5 km. Add MediSync partner pharmacies in your area, or widen
            NEARBY_RADIUS_METERS on the server.
          </p>
        </Card>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_1.1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold text-ink">Nearby map</h2>
            <Badge tone={live ? 'teal' : 'amber'}>
              {mapsKey ? (live ? 'Live · Google Maps' : 'Google Maps (demo pins)') : 'Live · OpenStreetMap'}
            </Badge>
          </div>
          <StoreMap
            apiKey={mapsKey}
            centre={pharmacies.coords}
            stores={pharmacies.items}
            selectedId={selectedShop?.id ?? null}
            onSelect={actions.selectPharmacy}
            fallback={
              <SketchMap
                items={pharmacies.items}
                positions={positions}
                centre={pharmacies.coords}
                selectedId={selectedShop?.id ?? null}
                onSelect={actions.selectPharmacy}
                defaultShops={derived.defaultShops}
                live={live}
              />
            }
          />
          <div className="border-t border-slate-200 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Selected shop</p>
            <p className="mt-0.5 truncate text-xs font-bold text-ink">{selectedShop?.name ?? 'No shop selected'}</p>
            <p className="truncate text-[10px] text-slate-500">
              {selectedShop
                ? `${selectedShop.address ?? 'Address not provided'} · ${km(selectedShop)} km`
                : 'Pick a store to send your next refill there.'}
            </p>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-ink">All medical stores nearby</h2>
              {pharmacies.coords ? (
                <a
                  href={`https://www.google.com/maps/search/medical+stores+pharmacy/@${pharmacies.coords.lat},${pharmacies.coords.lng},15z`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-semibold text-brand-700 hover:underline"
                >
                  Open in Google Maps ↗
                </a>
              ) : null}
            </div>
            <Badge tone={live ? 'teal' : 'amber'}>
              {live ? `${derived.defaultShops.length} auto-selected` : 'Demo data'}
            </Badge>
          </div>
          <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto scroll-slim">
            {pharmacies.items
              .slice()
              .sort((a, b) => a.distanceKm - b.distanceKm)
              .map((pharmacy) => {
                const isDefault = derived.defaultShops.some((shop) => shop.id === pharmacy.id);
                const isSelected = selectedShop?.id === pharmacy.id;
                return (
                  <li
                    key={pharmacy.id}
                    className={`flex items-center gap-3 px-4 py-3 ${isSelected ? 'bg-brand-50/60' : ''}`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${
                        isDefault
                          ? 'bg-brand-50 text-brand-700 ring-brand-100'
                          : 'bg-slate-50 text-slate-400 ring-slate-200'
                      }`}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                    </span>
                    <button
                      type="button"
                      onClick={() => actions.selectPharmacy(pharmacy.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-semibold text-ink">{pharmacy.name}</p>
                        {pharmacy.verified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-600" /> : null}
                      </div>
                      <p className="truncate text-[10px] text-slate-500">
                        {km(pharmacy)} km
                        {pharmacy.rating != null ? ` · ⭐ ${pharmacy.rating}` : ''}
                        {pharmacy.open == null ? ' · hours in Maps' : ` · ${pharmacy.open ? 'Open' : 'Closed'}`}
                      </p>
                    </button>
                    {isSelected ? <Badge tone="teal">Order here</Badge> : null}
                    {isDefault && !isSelected ? <Badge tone="slate">Default</Badge> : null}
                    <a
                      href={directionsLink(pharmacy)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-brand-700"
                      aria-label={`Directions to ${pharmacy.name}`}
                    >
                      <Navigation className="h-3.5 w-3.5" />
                    </a>
                  </li>
                );
              })}
          </ul>
          <p className="border-t border-slate-100 px-4 py-2.5 text-[10px] leading-relaxed text-slate-400">
            {live
              ? 'Distances come from the MediSync server: registered partner pharmacies plus live Google Places results for your chosen location. Google listings open in Maps.'
              : 'These sample shops stand in for a live lookup. Choose current or default location to see real nearby pharmacies and distances.'}
          </p>
        </Card>
      </div>
    </div>
  );
}
