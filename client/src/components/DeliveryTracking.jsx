import { useEffect, useState } from 'react';
import { Check, MapPin, Phone, Truck } from 'lucide-react';
import { TRACKING_STEPS } from '../data.js';
import { Badge, Card } from '../ui.jsx';
import StoreMap from './StoreMap.jsx';
import { fetchMapsConfig } from '../pharmacies.js';

export default function DeliveryTracking({ delivery, tracking }) {
  const { progress, eta, stepIndex } = tracking;
  const currentStep = TRACKING_STEPS[stepIndex];
  const [mapsKey, setMapsKey] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null);

  useEffect(() => {
    if (mapsKey) return;
    fetchMapsConfig().then((cfg) => {
      if (cfg?.browserKey) setMapsKey(cfg.browserKey);
    });
  }, [mapsKey]);

  const pharmacyCoords = { lat: 12.9098, lng: 77.5642 };
  const patientCoords = { lat: 12.9165, lng: 77.5718 };
  const ratio = Math.min(1, Math.max(0, progress / 100));
  const riderCoords = {
    id: 'active-rider',
    name: `Rider ${delivery.rider} (${eta} min away)`,
    lat: pharmacyCoords.lat + (patientCoords.lat - pharmacyCoords.lat) * ratio,
    lng: pharmacyCoords.lng + (patientCoords.lng - pharmacyCoords.lng) * ratio,
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
            <Truck className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-ink">Active Deliveries · Live Order & Route Tracking</h2>
            <p className="text-[11px] text-slate-500">
              {delivery.id} · {delivery.pharmacy}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="emerald">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {currentStep}
          </Badge>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium text-slate-500">Arriving in</p>
            <p className="font-mono text-lg font-bold text-ink">
              {eta} min <span className="text-[11px] font-medium text-slate-400">· {progress}% of route</span>
            </p>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>

          <ol className="mt-5 grid grid-cols-5 gap-1">
            {TRACKING_STEPS.map((step, index) => {
              const done = index < stepIndex;
              const active = index === stepIndex;
              return (
                <li key={step} className="relative flex flex-col items-center gap-1.5 text-center">
                  {index > 0 ? (
                    <span
                      className={`absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2 ${
                        index <= stepIndex ? 'bg-emerald-400' : 'bg-slate-200'
                      }`}
                    />
                  ) : null}
                  <span
                    className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                      done
                        ? 'bg-emerald-500 text-white'
                        : active
                          ? 'bg-brand-600 text-white ring-4 ring-brand-100'
                          : 'bg-slate-100 text-slate-400 ring-1 ring-slate-200'
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  <span className={`text-[10px] leading-tight ${active ? 'font-semibold text-ink' : 'text-slate-400'}`}>
                    {step}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-slate-600">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-[9px] font-bold text-white">
                RK
              </span>
              {delivery.rider}
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <Phone className="h-3.5 w-3.5 text-slate-400" />
              {delivery.riderPhone}
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              {delivery.items}
            </span>
          </div>

          {delivery.note ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 ring-1 ring-amber-100">
              Delivery note: “{delivery.note}”
            </p>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <StoreMap
            apiKey={mapsKey}
            centre={patientCoords}
            stores={[
              { id: 'pharmacy-origin', name: delivery.pharmacy, lat: pharmacyCoords.lat, lng: pharmacyCoords.lng },
              riderCoords,
            ]}
            selectedId="active-rider"
            height={210}
            fallback={
              <div className="flex h-[210px] items-center justify-center bg-slate-50 p-4 text-center text-xs text-slate-500">
                Rider {delivery.rider} en route from {delivery.pharmacy} ({progress}% complete)
              </div>
            }
          />
        </div>
      </div>
    </Card>
  );
}