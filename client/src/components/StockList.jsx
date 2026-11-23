import { ArrowRight, CalendarClock, PackageX } from 'lucide-react';
import { Badge, ProgressBar } from '../ui.jsx';
import { inr, refillPrice, stockLevel } from '../usePortal.js';

function predictDepletion(pills) {
  const count = Math.max(0, Number(pills) || 0);
  if (count === 0) return { daysLeft: 0, dateLabel: 'Depleted today', urgent: true };
  const target = new Date(Date.now() + count * 24 * 60 * 60 * 1000);
  const dateLabel = target.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return { daysLeft: count, dateLabel, urgent: count <= 3 };
}

export default function StockList({ medicines, onReorder, limit }) {
  const rows = typeof limit === 'number' ? medicines.slice(0, limit) : medicines;

  return (
    <ul className="space-y-1">
      {rows.map((med) => {
        const level = stockLevel(med);
        const pct = (med.pills / med.capacity) * 100;
        const price = refillPrice(med);
        const prediction = predictDepletion(med.pills);

        return (
          <li key={med.id} className="rounded-xl px-2 py-3 transition hover:bg-slate-50/80">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-ink">
                    {med.name} <span className="font-medium text-slate-500">{med.strength}</span>
                  </p>
                  {prediction.urgent ? (
                    <Badge tone="rose">
                      <CalendarClock className="h-3 w-3" />
                      {prediction.daysLeft === 0
                        ? 'Out now — Reorder'
                        : `Runs out in ${prediction.daysLeft}d (${prediction.dateLabel})`}
                    </Badge>
                  ) : (
                    <Badge tone="slate">Lasts until {prediction.dateLabel}</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {med.dosage} · {med.time}
                </p>
              </div>
              {level === 'ok' ? (
                <Badge tone="emerald">In Stock ({med.pills})</Badge>
              ) : level === 'low' ? (
                <Badge tone="amber">Low ({med.pills} left)</Badge>
              ) : (
                <Badge tone="rose">
                  <PackageX className="h-3 w-3" />
                  Empty (0 left)
                </Badge>
              )}
            </div>

            <div className="mt-2.5 flex items-center gap-3">
              <ProgressBar value={pct} level={level} className="flex-1" />
              <span className="w-14 text-right text-[10px] font-semibold tabular-nums text-slate-400">
                {med.pills}/{med.capacity}
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                <span className="font-semibold text-ink">{inr(price)}</span>
                {med.discountPct > 0 ? (
                  <span className="ml-1.5 text-emerald-600">({med.discountPct}% OFF)</span>
                ) : (
                  <span className="ml-1.5 text-slate-400">MRP {inr(med.mrp)}</span>
                )}
                <span className="mx-1 text-slate-300">·</span>
                per {med.packSize}-pill strip
              </p>
              <button
                type="button"
                onClick={() => onReorder(med)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 transition hover:text-brand-800"
              >
                {prediction.urgent ? 'One-Click Refill' : 'Reorder'}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}