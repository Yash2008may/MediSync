import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Badge, Card } from '../ui.jsx';
import { createInventoryItem, deleteInventoryItem, fetchMyInventory, updateInventoryItem } from '../catalog.js';

const inr = (value) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY = { medicineName: '', brand: '', packSize: '', mrp: '', discountPct: '0', stockQty: '', isScheduleH: false };

const LOW_STOCK = 10;

// The pharmacy's price list IS the orderable catalogue: patients can only order what is
// here, and the server quotes these prices (the browser never supplies one).
export default function InventoryManager({ notify = () => {} }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [savingId, setSavingId] = useState(null);
  const [busyAdd, setBusyAdd] = useState(false);
  const [draft, setDraft] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchMyInventory());
      setError(null);
    } catch (error_) {
      setError(error_.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (event) => {
    event.preventDefault();
    if (form.medicineName.trim().length < 2) return setError('Name the medicine.');
    if (form.mrp === '' || Number(form.mrp) < 0) return setError('Enter the MRP.');
    if (form.stockQty === '' || Number(form.stockQty) < 0) return setError('Enter the pack count in stock.');
    setBusyAdd(true);
    setError(null);
    try {
      const item = await createInventoryItem({
        medicineName: form.medicineName.trim(),
        brand: form.brand.trim() || undefined,
        packSize: form.packSize.trim() || undefined,
        mrp: Number(form.mrp),
        discountPct: Number(form.discountPct) || 0,
        stockQty: Number(form.stockQty),
        isScheduleH: form.isScheduleH,
      });
      setItems((prev) => [...prev, item].sort((a, b) => a.medicineName.localeCompare(b.medicineName)));
      setForm(EMPTY);
      notify('Medicine added', `${item.medicineName} is now orderable at ${inr(item.mrp)}.`, 'teal');
    } catch (error_) {
      setError(error_.message);
    } finally {
      setBusyAdd(false);
    }
  };

  const save = async (item) => {
    const patch = draft[item.id] ?? {};
    if (!Object.keys(patch).length) return;
    setSavingId(item.id);
    try {
      const updated = await updateInventoryItem(item.id, patch);
      setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setDraft((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      notify('Price list updated', `${updated.medicineName}: ${inr(updated.mrp)} · ${updated.stockQty} in stock`);
    } catch (error_) {
      setError(error_.message);
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove ${item.medicineName} from your price list? Patients will no longer be able to order it.`)) return;
    setSavingId(item.id);
    try {
      await deleteInventoryItem(item.id);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      notify('Medicine removed', `${item.medicineName} is no longer orderable.`, 'warning');
    } catch (error_) {
      setError(error_.message);
    } finally {
      setSavingId(null);
    }
  };

  const outOfStock = items.filter((item) => item.stockQty === 0).length;
  const lowStock = items.filter((item) => item.stockQty > 0 && item.stockQty <= LOW_STOCK).length;

  const input = 'h-9 w-full rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-brand-500';

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">Orderable price list</h2>
          <p className="text-[10px] text-slate-500">
            Patients order from these rows and MediSync quotes these prices. Nothing outside this list can be ordered.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {outOfStock ? <Badge tone="rose">{outOfStock} out of stock</Badge> : null}
          {lowStock ? <Badge tone="amber">{lowStock} low</Badge> : null}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700 ring-1 ring-rose-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </p>
      ) : null}

      <form onSubmit={add} className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label htmlFor="inv-name" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Medicine name
          </label>
          <input
            id="inv-name"
            value={form.medicineName}
            onChange={(event) => setForm({ ...form, medicineName: event.target.value })}
            placeholder="Atorvastatin 20mg"
            className={input}
          />
        </div>
        <div>
          <label htmlFor="inv-brand" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Brand (optional)
          </label>
          <input
            id="inv-brand"
            value={form.brand}
            onChange={(event) => setForm({ ...form, brand: event.target.value })}
            placeholder="Lipitor"
            className={input}
          />
        </div>
        <div>
          <label htmlFor="inv-pack" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Pack size
          </label>
          <input
            id="inv-pack"
            value={form.packSize}
            onChange={(event) => setForm({ ...form, packSize: event.target.value })}
            placeholder="30 tablets"
            className={input}
          />
        </div>
        <div>
          <label htmlFor="inv-mrp" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            MRP (₹)
          </label>
          <input
            id="inv-mrp"
            type="number"
            min="0"
            step="0.01"
            value={form.mrp}
            onChange={(event) => setForm({ ...form, mrp: event.target.value })}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="inv-discount" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Discount %
          </label>
          <input
            id="inv-discount"
            type="number"
            min="0"
            max="100"
            value={form.discountPct}
            onChange={(event) => setForm({ ...form, discountPct: event.target.value })}
            className={input}
          />
        </div>
        <div>
          <label htmlFor="inv-stock" className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
            Packs in stock
          </label>
          <input
            id="inv-stock"
            type="number"
            min="0"
            value={form.stockQty}
            onChange={(event) => setForm({ ...form, stockQty: event.target.value })}
            className={input}
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex h-9 flex-1 items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <input
              type="checkbox"
              checked={form.isScheduleH}
              onChange={(event) => setForm({ ...form, isScheduleH: event.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            Schedule H
          </label>
          <button
            type="submit"
            disabled={busyAdd}
            className="inline-flex h-9 items-center gap-1 rounded-lg bg-brand-600 px-2.5 text-[10px] font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busyAdd ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add
          </button>
        </div>
      </form>

      {loading && !items.length ? (
        <p className="mt-3 px-3 py-6 text-center text-xs text-slate-500">Loading price list…</p>
      ) : !items.length ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-6 text-center text-[11px] text-amber-800 ring-1 ring-amber-200">
          Your price list is empty, so patients cannot order yet. Add your first medicine above.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto scroll-slim">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-3">Medicine</th>
                <th className="py-2 pr-3">MRP</th>
                <th className="py-2 pr-3">Discount %</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Price to patient</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const patch = draft[item.id] ?? {};
                const mrp = patch.mrp ?? item.mrp;
                const discount = patch.discountPct ?? item.discountPct;
                const stock = patch.stockQty ?? item.stockQty;
                const dirty = Object.keys(patch).length > 0;
                return (
                  <tr key={item.id} className="border-t border-slate-100 text-xs">
                    <td className="py-2 pr-3">
                      <p className="font-semibold text-ink">{item.medicineName}</p>
                      <p className="text-[10px] text-slate-400">
                        {[item.brand, item.packSize].filter(Boolean).join(' · ') || '—'}
                        {item.isScheduleH ? ' · Rx' : ''}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={mrp}
                        onChange={(event) => setDraft((prev) => ({ ...prev, [item.id]: { ...patch, mrp: Number(event.target.value) } }))}
                        aria-label={`MRP for ${item.medicineName}`}
                        className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-brand-500"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={discount}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, [item.id]: { ...patch, discountPct: Number(event.target.value) } }))
                        }
                        aria-label={`Discount for ${item.medicineName}`}
                        className="h-8 w-20 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-brand-500"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="0"
                        value={stock}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, [item.id]: { ...patch, stockQty: Number(event.target.value) } }))
                        }
                        aria-label={`Stock for ${item.medicineName}`}
                        className={`h-8 w-20 rounded-lg border px-2 text-xs outline-none focus:border-brand-500 ${
                          item.stockQty === 0 ? 'border-rose-300 bg-rose-50' : 'border-slate-200'
                        }`}
                      />
                    </td>
                    <td className="py-2 pr-3 font-semibold text-ink">
                      {inr(Number(mrp) * (1 - Number(discount ?? 0) / 100))}
                    </td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => save(item)}
                          disabled={!dirty || savingId === item.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-brand-700 disabled:opacity-40"
                        >
                          {savingId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          disabled={savingId === item.id}
                          aria-label={`Remove ${item.medicineName}`}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
