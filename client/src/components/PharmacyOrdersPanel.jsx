import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { Badge, Card } from '../ui.jsx';
import {
  acceptPrescriptionOrder,
  advanceOrder,
  fetchOrders,
  openPrescriptionFile,
  rejectPrescriptionOrder,
} from '../orders.js';

const STATUS = {
  placed: { label: 'Waiting for you', tone: 'amber' },
  confirmed: { label: 'Accepted · prepare', tone: 'teal' },
  out_for_delivery: { label: 'Out for delivery', tone: 'sky' },
  delivered: { label: 'Delivered', tone: 'emerald' },
  rejected: { label: 'Declined', tone: 'rose' },
  cancelled: { label: 'Cancelled by patient', tone: 'slate' },
};

const FILTERS = [
  { id: 'waiting', label: 'Waiting', statuses: ['placed'] },
  { id: 'active', label: 'Preparing', statuses: ['confirmed', 'out_for_delivery'] },
  { id: 'closed', label: 'Completed', statuses: ['delivered', 'rejected', 'cancelled'] },
  { id: 'all', label: 'All', statuses: null },
];

const inr = (value) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

// The live prescription-order queue. Every action is a server transition, so the patient
// sees the same state (and stock is reserved/released in the same transaction).
export default function PharmacyOrdersPanel({ notify = () => {}, disabled = false }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('waiting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    if (disabled) return;
    setLoading(true);
    try {
      const { orders: rows } = await fetchOrders({ limit: 100 });
      setOrders(rows);
      setError(null);
    } catch (error_) {
      setError(error_.message);
    } finally {
      setLoading(false);
    }
  }, [disabled]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const base = { waiting: 0, active: 0, closed: 0, all: orders.length };
    for (const order of orders) {
      if (order.status === 'placed') base.waiting += 1;
      else if (['confirmed', 'out_for_delivery'].includes(order.status)) base.active += 1;
      else base.closed += 1;
    }
    return base;
  }, [orders]);

  const visible = useMemo(() => {
    const statuses = FILTERS.find((entry) => entry.id === filter)?.statuses;
    return statuses ? orders.filter((order) => statuses.includes(order.status)) : orders;
  }, [orders, filter]);

  const apply = async (order, action, success) => {
    setBusyId(order.id);
    try {
      const updated = await action();
      setOrders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      notify(success, `${order.patientName ?? 'Patient'} · ${updated.status.replaceAll('_', ' ')}`);
      setRejectingId(null);
      setReason('');
    } catch (error_) {
      notify('Could not update the order', error_.message, 'warning');
    } finally {
      setBusyId(null);
    }
  };

  const accept = (order) =>
    apply(order, () => acceptPrescriptionOrder(order.id), 'Order accepted — stock reserved');

  const reject = (order) => {
    if (reason.trim().length < 3) return;
    apply(order, () => rejectPrescriptionOrder(order.id, reason.trim()), 'Order declined');
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">Prescription orders from patients</h2>
          <p className="text-[10px] text-slate-500">
            Accepting reserves stock and approves the attached prescription. Declining tells the patient why.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading || disabled}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition ${
              filter === entry.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {entry.label} ({counts[entry.id] ?? 0})
          </button>
        ))}
      </div>

      {disabled ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-3 text-[11px] text-amber-800 ring-1 ring-amber-200">
          Your licence is still under admin review. Prescription orders reach this queue once the store is verified.
        </p>
      ) : error ? (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-3 text-[11px] text-rose-700 ring-1 ring-rose-200">{error}</p>
      ) : loading && !orders.length ? (
        <p className="mt-3 px-3 py-6 text-center text-xs text-slate-500">Loading orders…</p>
      ) : !visible.length ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          {filter === 'waiting' ? 'No patient orders waiting right now.' : 'Nothing in this list.'}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {visible.map((order) => {
            const status = STATUS[order.status] ?? { label: order.status, tone: 'slate' };
            const busy = busyId === order.id;
            const rejecting = rejectingId === order.id;
            const expanded = expandedId === order.id;
            return (
              <div key={order.id} className="rounded-xl border border-slate-200 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-ink">{order.patientName ?? 'Patient'}</p>
                  {order.patientPhone ? <span className="font-mono text-[10px] text-slate-500">{order.patientPhone}</span> : null}
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {order.fulfillment === 'pickup' ? <Badge tone="slate">Pickup</Badge> : null}
                  <span className="ml-auto text-[10px] text-slate-400">{when(order.createdAt)}</span>
                </div>

                <ul className="mt-1.5 space-y-0.5">
                  {(order.items ?? []).map((item) => (
                    <li key={item.id ?? item.medicineName} className="flex items-baseline gap-2 text-[11px] text-slate-600">
                      <span className="flex-1">
                        {item.medicineName} × {item.quantity}
                        {item.isScheduleH ? <span className="ml-1 text-[9px] font-bold text-rose-500">Rx</span> : null}
                      </span>
                      <span className="tabular-nums text-slate-500">{inr(item.lineTotal)}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-1 text-[11px] font-semibold text-ink">
                  Total {inr(order.finalPrice)}
                  <span className="ml-2 text-[10px] font-normal text-slate-400">
                    {String(order.paymentMethod ?? 'cod').toUpperCase()} · {order.deliveryAddress}
                  </span>
                </p>

                {order.rejectionReason ? (
                  <p className="mt-1 text-[10px] text-rose-600">Declined: {order.rejectionReason}</p>
                ) : null}
                {order.cancellationReason ? (
                  <p className="mt-1 text-[10px] text-slate-500">Cancelled: {order.cancellationReason}</p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {order.prescriptionId ? (
                    <button
                      type="button"
                      onClick={() =>
                        openPrescriptionFile(order.prescriptionId).catch((error) =>
                          notify('Could not open the prescription', error.message, 'warning')
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3 w-3" /> View prescription
                    </button>
                  ) : null}

                  {order.status === 'placed' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => accept(order)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {busy && !rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Accept order
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(rejecting ? null : order.id);
                          setReason('');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <X className="h-3 w-3" /> Decline
                      </button>
                    </>
                  ) : null}

                  {order.status === 'confirmed' ? (
                    <button
                      type="button"
                      onClick={() => apply(order, () => advanceOrder(order.id, 'out_for_delivery'), 'Marked out for delivery')}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Truck className="h-3 w-3" />}
                      Out for delivery
                    </button>
                  ) : null}

                  {order.status === 'out_for_delivery' ? (
                    <button
                      type="button"
                      onClick={() => apply(order, () => advanceOrder(order.id, 'delivered'), 'Marked delivered')}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Mark delivered
                    </button>
                  ) : null}

                  {['rejected', 'cancelled'].includes(order.status) ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                      <XCircle className="h-3 w-3" /> Closed
                    </span>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : order.id)}
                    className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700"
                    aria-expanded={expanded}
                  >
                    History {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>

                {rejecting ? (
                  <div className="mt-2 rounded-lg bg-rose-50/70 p-2.5 ring-1 ring-rose-100">
                    <label htmlFor={`reject-${order.id}`} className="text-[10px] font-semibold text-rose-700">
                      Why are you declining? (shown to the patient, min 3 characters)
                    </label>
                    <textarea
                      id={`reject-${order.id}`}
                      rows={2}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-rose-200 px-2 py-1.5 text-xs outline-none focus:border-rose-400"
                      placeholder="Prescription is not legible, or the medicine is out of stock."
                    />
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => reject(order)}
                        disabled={busy || reason.trim().length < 3}
                        className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        Confirm decline
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(null)}
                        className="text-[10px] font-semibold text-slate-500 hover:text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {expanded ? (
                  <ol className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {(order.history ?? []).map((entry, index) => (
                      <li key={`${entry.changedAt}-${index}`} className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                        <span className="font-semibold text-slate-700">{entry.status.replaceAll('_', ' ')}</span>
                        <span>{when(entry.changedAt)}</span>
                        {entry.note ? <span className="truncate">“{entry.note}”</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
