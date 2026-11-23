import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CreditCard,
  Info,
  Landmark,
  Minus,
  Plus,
  ShieldCheck,
  Smartphone,
  Store,
  Truck,
} from 'lucide-react';
import { PAYMENT_METHODS } from '../data.js';
import { Badge, Modal } from '../ui.jsx';
import { inr, refillPrice } from '../usePortal.js';

const ICONS = { upi: Smartphone, card: CreditCard, netbanking: Landmark, cash: Banknote };

export default function CheckoutModal({ medicine, pharmacy = null, onClose, onPlace }) {
  const [packs, setPacks] = useState(3);
  const [paymentId, setPaymentId] = useState('upi');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (medicine) {
      setPacks(3);
      setPaymentId('upi');
      setNote('');
    }
  }, [medicine]);

  const totals = useMemo(() => {
    if (!medicine) return { subtotal: 0, delivery: 0, total: 0, pills: 0, saved: 0 };
    const unit = refillPrice(medicine);
    const subtotal = Number((unit * packs).toFixed(2));
    const delivery = subtotal >= 199 ? 0 : 25;
    return {
      unit,
      subtotal,
      delivery,
      total: Number((subtotal + delivery).toFixed(2)),
      pills: packs * medicine.packSize,
      saved: Number(((medicine.mrp - unit) * packs).toFixed(2)),
    };
  }, [medicine, packs]);

  const open = Boolean(medicine);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={medicine ? `Reorder ${medicine.name} ${medicine.strength}` : 'Reorder'}
      subtitle="Confirm the refill, price and payment method before dispatch."
      footer={
        <div className="space-y-3">
          <label htmlFor="price-note" className="label mb-0">
            Note for the pharmacist (price discussion)
          </label>
          <textarea
            id="price-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Is a 3-month pack cheaper? Please confirm before billing."
            className="field resize-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Total <span className="text-base font-bold text-ink">{inr(totals.total)}</span>
              <span className="ml-1 text-[11px] text-slate-400">incl. {totals.delivery === 0 ? 'free delivery' : 'delivery'}</span>
            </p>
            <button
              type="button"
              onClick={() => onPlace({ medicineId: medicine.id, packs, paymentId, note })}
              className="btn-primary"
            >
              <ShieldCheck className="h-4 w-4" />
              {paymentId === 'cod' ? 'Place COD order' : `Pay ${inr(totals.total)}`}
            </button>
          </div>
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 ring-1 ring-amber-100">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            Demo checkout — no money is charged. Connect the Razorpay keys on the server to take live UPI, card and
            netbanking payments.
          </p>
        </div>
      }
    >
      {medicine ? (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                {medicine.name} {medicine.strength} · {medicine.packSize} pills / strip
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                MRP {inr(medicine.mrp)} · {medicine.discountPct}% OFF · {medicine.dosage}
              </p>
            </div>
            <Badge tone="teal">Rx verified</Badge>
          </div>

          <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-700/80">Fulfilling store</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-ink">
              <Store className="h-3.5 w-3.5 text-brand-700" />
              {pharmacy?.name ?? 'Apollo Pharmacy, Indiranagar'}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500">
              {pharmacy
                ? `${pharmacy.address ?? 'Address not provided'} · ${Number.isFinite(pharmacy.distanceKm) ? pharmacy.distanceKm.toFixed(1) : '—'} km away`
                : 'Pick a shop on the Pharmacies tab to change who fulfils this refill.'}
            </p>
          </div>

          <div>
            <p className="label">Strips</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPacks((p) => Math.max(1, p - 1))}
                className="btn-ghost h-10 w-10 !p-0"
                aria-label="Decrease strips"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="w-16 rounded-xl border border-slate-200 bg-white py-2 text-center text-sm font-bold text-ink">
                {packs}
              </div>
              <button
                type="button"
                onClick={() => setPacks((p) => Math.min(9, p + 1))}
                className="btn-ghost h-10 w-10 !p-0"
                aria-label="Increase strips"
              >
                <Plus className="h-4 w-4" />
              </button>
              <p className="text-xs text-slate-500">
                = <span className="font-semibold text-ink">{totals.pills} pills</span>
              </p>
            </div>
          </div>

          <div>
            <p className="label">Payment method</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PAYMENT_METHODS.map((method) => {
                const Icon = ICONS[method.icon] ?? Smartphone;
                const selected = paymentId === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => setPaymentId(method.id)}
                    aria-pressed={selected}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-brand-600 bg-brand-50/70 ring-1 ring-brand-600'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${selected ? 'text-brand-700' : 'text-slate-400'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-ink">{method.label}</span>
                      <span className="block truncate text-[10px] text-slate-500">{method.hint}</span>
                    </span>
                    <span
                      className={`h-3.5 w-3.5 rounded-full border ${
                        selected ? 'border-[4px] border-brand-600' : 'border-slate-300'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-3 text-xs">
            <div className="flex items-center justify-between py-0.5 text-slate-500">
              <span>Refill ({packs} × {inr(totals.unit)})</span>
              <span className="font-medium text-slate-700">{inr(totals.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5 text-slate-500">
              <span className="flex items-center gap-1">
                <Truck className="h-3 w-3" /> Delivery
              </span>
              <span className="font-medium text-slate-700">{totals.delivery === 0 ? 'Free' : inr(totals.delivery)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between border-t border-dashed border-slate-200 pt-1.5 text-slate-500">
              <span>You save</span>
              <span className="font-semibold text-emerald-600">{inr(totals.saved)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
