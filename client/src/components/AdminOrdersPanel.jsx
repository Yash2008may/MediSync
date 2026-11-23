import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge, Card } from '../ui.jsx';
import { fetchAdminOrders } from '../api.js';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'placed', label: 'Waiting' },
  { id: 'confirmed', label: 'Accepted' },
  { id: 'out_for_delivery', label: 'On the way' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'rejected', label: 'Declined' },
  { id: 'cancelled', label: 'Cancelled' },
];

const TONE = {
  placed: 'amber',
  confirmed: 'teal',
  out_for_delivery: 'sky',
  delivered: 'emerald',
  rejected: 'rose',
  cancelled: 'slate',
};

const inr = (value) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

// Cross-pharmacy order oversight: the admin sees traffic, declines and cancellations
// without being able to change a clinical decision.
export default function AdminOrdersPanel() {
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (nextStatus = status) => {
    setLoading(true);
    try {
      const data = await fetchAdminOrders({ status: nextStatus, limit: 50 });
      setOrders(data.orders);
      setTotal(data.total);
      setError(null);
    } catch (error_) {
      setError(error_.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load(status);
  }, [load, status]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">Orders across pharmacies</h2>
          <p className="text-[10px] text-slate-500">
            Read-only oversight of prescription orders, declines and cancellations. Fulfilment stays with the pharmacy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(status)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {FILTERS.map((entry) => (
          <button
            key={entry.id || 'all'}
            type="button"
            onClick={() => setStatus(entry.id)}
            aria-pressed={status === entry.id}
            className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition ${
              status === entry.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-slate-400">{total} order{total === 1 ? '' : 's'}</span>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700 ring-1 ring-rose-200">{error}</p>
      ) : loading && !orders.length ? (
        <p className="mt-3 px-3 py-6 text-center text-xs text-slate-500">Loading orders…</p>
      ) : !orders.length ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">No orders in this state.</p>
      ) : (
        <div className="mt-3 overflow-x-auto scroll-slim">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-3">Placed</th>
                <th className="py-2 pr-3">Patient</th>
                <th className="py-2 pr-3">Pharmacy</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-slate-100 text-xs">
                  <td className="whitespace-nowrap py-2 pr-3 text-[10px] text-slate-500">{when(order.createdAt)}</td>
                  <td className="py-2 pr-3 font-semibold text-ink">{order.patientName ?? '—'}</td>
                  <td className="py-2 pr-3 text-slate-600">{order.pharmacyName ?? '—'}</td>
                  <td className="py-2 pr-3 font-semibold text-ink">{inr(order.finalPrice)}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={TONE[order.status] ?? 'slate'}>{order.status.replaceAll('_', ' ')}</Badge>
                  </td>
                  <td className="max-w-[220px] truncate py-2 text-[10px] text-slate-500">
                    {order.rejectionReason ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
