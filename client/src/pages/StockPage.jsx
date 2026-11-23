import { useMemo, useState } from 'react';
import { PackageSearch, Search, ShieldCheck, Wallet } from 'lucide-react';
import StockList from '../components/StockList.jsx';
import { Badge, Card, SectionHeading } from '../ui.jsx';
import { stockLevel } from '../usePortal.js';

export default function StockPage({ state, derived, actions }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.medicines;
    return state.medicines.filter(
      (m) => m.name.toLowerCase().includes(q) || m.strength.toLowerCase().includes(q)
    );
  }, [query, state.medicines]);

  const inStock = state.medicines.filter((m) => stockLevel(m) === 'ok').length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card className="p-4 sm:p-5">
        <SectionHeading
          title="Stock, Pricing & Reorder"
          subtitle="Stock deducts one pill per confirmed dose. Refill prices show the discounted amount from your default pharmacy."
          action={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search medicines"
                aria-label="Search medicines"
                className="field !w-56 !py-2 !pl-9 !text-xs"
              />
            </div>
          }
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone="emerald">In stock · {inStock}</Badge>
          <Badge tone="amber">Low stock · {derived.lowMeds.length}</Badge>
          <Badge tone="rose">Empty · {derived.emptyMeds.length}</Badge>
          <Badge tone="slate">{state.medicines.length} medicines tracked</Badge>
        </div>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-2 sm:p-3">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <h2 className="text-sm font-bold text-ink">All medicines</h2>
            <span className="text-[10px] text-slate-400">Tap Reorder to open checkout</span>
          </div>
          {filtered.length ? (
            <StockList medicines={filtered} onReorder={actions.startReorder} />
          ) : (
            <p className="px-3 py-10 text-center text-sm text-slate-500">No medicine matches “{query}”.</p>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-ink">
              <Wallet className="h-4 w-4 text-brand-600" />
              Refill pricing
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Prices include the partner pharmacy discount and are shown per {state.medicines[0]?.packSize ?? 10}-pill
              strip. Delivery is free on refills above ₹199; otherwise ₹25 is added at checkout.
            </p>
            <ul className="mt-3 space-y-1.5 text-[11px] text-slate-500">
              <li className="flex justify-between gap-3">
                <span>Payment methods</span>
                <span className="text-right font-medium text-slate-700">UPI · Card · Netbanking · COD</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>Prescription check</span>
                <span className="text-right font-medium text-slate-700">Pharmacist review required</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>Invoices</span>
                <span className="text-right font-medium text-slate-700">Emailed after billing</span>
              </li>
            </ul>
          </Card>

          <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
            <p className="flex items-center gap-2 text-xs font-bold text-brand-800">
              <PackageSearch className="h-4 w-4" />
              Empty stock blocks automatic refills
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-brand-800/80">
              {derived.emptyMeds.length
                ? `${derived.emptyMeds.map((m) => m.name).join(', ')} has no pills left. Doses still appear on the schedule but stock stays at zero until a refill is placed.`
                : 'Nothing is empty right now. Low-stock items are restocked before they run out.'}
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white p-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p className="text-[11px] leading-relaxed text-slate-500">
              Schedule H medicines are dispensed only after a verified pharmacist reviews the prescription in the
              MediSync server workflow.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
