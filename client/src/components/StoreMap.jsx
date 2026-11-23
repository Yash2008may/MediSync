import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, LocateFixed } from 'lucide-react';

const SCRIPT_ID = 'medisync-google-maps';
const LEAFLET_JS_ID = 'medisync-leaflet-js';
const LEAFLET_CSS_ID = 'medisync-leaflet-css';
let mapsLoader = null;
let leafletLoader = null;

function loadGoogleMaps(key) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google?.maps));
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async`;
    script.addEventListener('load', () => resolve(window.google?.maps));
    script.addEventListener('error', () => {
      mapsLoader = null;
      reject(new Error('Google Maps failed to load'));
    });
    document.head.appendChild(script);
  });
  return mapsLoader;
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoader) return leafletLoader;

  leafletLoader = new Promise((resolve, reject) => {
    if (!document.getElementById(LEAFLET_CSS_ID)) {
      const link = document.createElement('link');
      link.id = LEAFLET_CSS_ID;
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const existing = document.getElementById(LEAFLET_JS_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L));
      existing.addEventListener('error', () => reject(new Error('Leaflet failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.id = LEAFLET_JS_ID;
    script.async = true;
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.addEventListener('load', () => resolve(window.L));
    script.addEventListener('error', () => {
      leafletLoader = null;
      reject(new Error('Leaflet failed to load'));
    });
    document.head.appendChild(script);
  });
  return leafletLoader;
}

const googlePin = (map, { lat, lng }, title, selected, fillColor) => {
  const g = window.google.maps;
  return new g.Marker({
    map,
    position: { lat, lng },
    title,
    zIndex: selected ? 999 : 1,
    icon: {
      path: g.SymbolPath.CIRCLE,
      scale: selected ? 11 : 9,
      fillColor: fillColor ?? (selected ? '#0D9488' : '#0F172A'),
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
    },
  });
};

export default function StoreMap({ apiKey, centre, stores = [], selectedId, onSelect, fallback, height = 300 }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const liveMarkerRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const [mode, setMode] = useState(null); // 'google' | 'osm' | 'failed'
  const [locating, setLocating] = useState(false);
  const [geoHint, setGeoHint] = useState(null);

  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    let cancelled = false;
    setMode(null);

    const initOsm = () =>
      loadLeaflet()
        .then((L) => {
          if (cancelled || !hostRef.current || !L) return;
          const map = L.map(hostRef.current, {
            center: centre ? [centre.lat, centre.lng] : [12.9081, 77.5666],
            zoom: centre ? 14 : 12,
          });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors',
          }).addTo(map);
          mapRef.current = map;
          setMode('osm');
        })
        .catch(() => {
          if (!cancelled) setMode('failed');
        });

    if (apiKey) {
      loadGoogleMaps(apiKey)
        .then((maps) => {
          if (cancelled || !hostRef.current || !maps) return;
          mapRef.current = new maps.Map(hostRef.current, {
            center: centre ?? { lat: 12.9081, lng: 77.5666 },
            zoom: centre ? 14 : 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            clickableIcons: false,
          });
          setMode('google');
        })
        .catch(() => {
          if (!cancelled) initOsm();
        });
    } else {
      initOsm();
    }

    return () => {
      cancelled = true;
      liveMarkerRef.current?.setMap?.(null);
      liveMarkerRef.current?.remove?.();
      liveMarkerRef.current = null;
      if (mode === 'osm' && mapRef.current?.remove) {
        mapRef.current.remove();
      } else {
        markersRef.current.forEach((m) => m?.setMap?.(null));
      }
      markersRef.current = [];
      mapRef.current = null;
    };
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mode || mode === 'failed') return;

    if (mode === 'google') {
      const g = window.google.maps;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];

      if (centre) {
        markersRef.current.push(googlePin(map, centre, 'Your location', false, '#2563eb'));
      }

      stores.forEach((store) => {
        if (!Number.isFinite(store.lat) || !Number.isFinite(store.lng)) return;
        const marker = googlePin(map, { lat: store.lat, lng: store.lng }, store.name, store.id === selectedId);
        marker.addListener('click', () => onSelectRef.current?.(store.id));
        markersRef.current.push(marker);
      });

      const bounds = new g.LatLngBounds();
      if (centre) bounds.extend(centre);
      stores.forEach((store) => {
        if (Number.isFinite(store.lat) && Number.isFinite(store.lng)) {
          bounds.extend({ lat: store.lat, lng: store.lng });
        }
      });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
        if (stores.length <= 1 && !centre) map.setZoom(14);
      }
      return;
    }

    if (mode === 'osm' && window.L) {
      const L = window.L;
      markersRef.current.forEach((layer) => layer.remove());
      markersRef.current = [];

      const pts = [];
      if (centre && Number.isFinite(centre.lat) && Number.isFinite(centre.lng)) {
        const you = L.circleMarker([centre.lat, centre.lng], {
          radius: 9,
          fillColor: '#2563eb',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 1,
        })
          .bindTooltip('Your location')
          .addTo(map);
        markersRef.current.push(you);
        pts.push([centre.lat, centre.lng]);
      }

      stores.forEach((store) => {
        if (!Number.isFinite(store.lat) || !Number.isFinite(store.lng)) return;
        const isSel = store.id === selectedId;
        const marker = L.circleMarker([store.lat, store.lng], {
          radius: isSel ? 11 : 8,
          fillColor: isSel ? '#0D9488' : '#0F172A',
          color: '#ffffff',
          weight: 2,
          fillOpacity: 1,
        })
          .bindTooltip(store.name)
          .on('click', () => onSelectRef.current?.(store.id))
          .addTo(map);
        if (isSel) marker.openTooltip();
        markersRef.current.push(marker);
        pts.push([store.lat, store.lng]);
      });

      if (pts.length > 0) {
        map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 15 });
      }
    }
  }, [mode, centre, stores, selectedId]);

  const panToCoords = useCallback(
    (coords, label = 'My live location') => {
      const map = mapRef.current;
      if (!map || !coords) return;

      if (mode === 'google' && window.google?.maps) {
        liveMarkerRef.current?.setMap?.(null);
        liveMarkerRef.current = googlePin(map, coords, label, true, '#2563eb');
        map.panTo(coords);
        map.setZoom(15);
      } else if (mode === 'osm' && window.L) {
        const L = window.L;
        liveMarkerRef.current?.remove?.();
        liveMarkerRef.current = L.circleMarker([coords.lat, coords.lng], {
          radius: 9,
          fillColor: '#2563eb',
          color: '#ffffff',
          weight: 2.5,
          fillOpacity: 1,
        })
          .bindTooltip(label)
          .addTo(map);
        map.setView([coords.lat, coords.lng], 15, { animate: true });
      }
    },
    [mode]
  );

  const recenterToMyLocation = useCallback(() => {
    setGeoHint(null);
    if (!navigator.geolocation) {
      if (centre && Number.isFinite(centre.lat) && Number.isFinite(centre.lng)) {
        panToCoords(centre, 'Saved pin');
        setGeoHint('Centered on saved pin');
      } else {
        setGeoHint('Location unavailable in this browser');
      }
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        panToCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'My live location');
      },
      () => {
        setLocating(false);
        if (centre && Number.isFinite(centre.lat) && Number.isFinite(centre.lng)) {
          panToCoords(centre, 'Saved pin');
          setGeoHint('GPS blocked — centered on saved pin');
        } else {
          setGeoHint('Allow location permission to re-center');
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
    );
  }, [centre, panToCoords]);

  if (mode === 'failed') return fallback;

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={hostRef} style={{ height }} className="w-full rounded-xl bg-slate-100 z-0" />
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={recenterToMyLocation}
          disabled={locating || !mode}
          title="Re-center map to your current GPS location"
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 text-[11px] font-bold text-ink shadow-md backdrop-blur transition hover:bg-brand-50 hover:text-brand-700 disabled:opacity-60"
        >
          {locating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
          ) : (
            <LocateFixed className="h-3.5 w-3.5 text-brand-600" />
          )}
          Re-center to My Location
        </button>
        {geoHint ? (
          <span className="pointer-events-auto rounded-lg bg-ink/85 px-2.5 py-1 text-[10px] font-medium text-white shadow">
            {geoHint}
          </span>
        ) : null}
      </div>
    </div>
  );
}