import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileText, Loader2, PackageCheck, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import { Badge, Card } from '../ui.jsx';
import {
  cancelOrder,
  fetchCatalogue,
  fetchOrders,
  openPrescriptionFile,
  submitPrescriptionOrder,
} from '../orders.js';

const STATUS = {
  placed: { label: 'Waiting for pharmacy', tone: 'amber' },
  confirmed: { label: 'Accepted by pharmacy', tone: 'teal' },
  out_for_delivery: { label: 'Out for delivery', tone: 'sky' },
  delivered: { label: 'Delivered', tone: 'emerald' },
  rejected: { label: 'Declined by pharmacy', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

const inr = (value) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isUuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const when = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

const netPrice = (item) => Number(item.mrp) * (1 - Number(item.discountPct ?? 0) / 100);

// Patient side of prescription ordering: pick a verified partner, choose medicines from
// that pharmacy's own price list (the server quotes them), attach the prescription and
// follow the order until it is delivered.
export default function PrescriptionOrderCard({ shops, selectedShopId, defaultAddress }) {
  const partners = Array.isArray(shops) ? shops : [];

  const [pharmacyId, setPharmacyId] = useState('');
  const [catalogue, setCatalogue] = useState([]);
  const [catalogueState, setCatalogueState] = useState('idle'); // idle | loading | ready | error
  const [lines, setLines] = useState([{ key: 1, inventoryId: '', quantity: 1 }]);
  const [fulfillment, setFulfillment] = useState('delivery');
  const [doctor, setDoctor] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState(defaultAddress ?? '');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { orders: rows } = await fetchOrders({ limit: 25 });
      setOrders(rows);
      setListError(null);
    } catch (error_) {
      setListError(error_.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (defaultAddress) setAddress((current) => current || defaultAddress);
  }, [defaultAddress]);

  // Pre-select the shop picked on the map when it is a real MediSync partner.
  useEffect(() => {
    if (pharmacyId) return;
    const match = partners.find((shop) => shop.id === selectedShopId) ?? partners[0];
    if (match) setPharmacyId(match.id);
  }, [partners, selectedShopId, pharmacyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [resolvedPharmacyId, setResolvedPharmacyId] = useState('');

  useEffect(() => {
    if (!pharmacyId) {
      setResolvedPharmacyId('');
      setCatalogue([]);
      setCatalogueState('idle');
      return undefined;
    }
    let cancelled = false;
    setCatalogueState('loading');

    const selectedShop = partners.find((s) => String(s.id) === String(pharmacyId));
    const loadForShop = async () => {
      let targetId = pharmacyId;
      if (!isUuid(String(pharmacyId)) || !selectedShop?.verified) {
        const res = await fetch('/api/stores/ensure-partner', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            id: selectedShop?.id ?? pharmacyId,
            name: selectedShop?.name ?? 'Nearby Medical Store',
            address: selectedShop?.address ?? defaultAddress ?? 'Local Pharmacy',
            latitude: selectedShop?.latitude,
            longitude: selectedShop?.longitude,
          }),
        });
        if (res.ok) {
          const ensured = await res.json();
          if (ensured?.pharmacyId) targetId = ensured.pharmacyId;
          if (!cancelled && Array.isArray(ensured?.items)) {
            setResolvedPharmacyId(targetId);
            setCatalogue(ensured.items);
            setCatalogueState('ready');
            setLines([{ key: Date.now(), inventoryId: ensured.items[0]?.id ?? '', quantity: 1 }]);
            return;
          }
        }
      }
      const { items } = await fetchCatalogue(targetId);
      if (cancelled) return;
      setResolvedPharmacyId(targetId);
      setCatalogue(items);
      setCatalogueState('ready');
      setLines([{ key: Date.now(), inventoryId: items[0]?.id ?? '', quantity: 1 }]);
    };

    loadForShop().catch(() => {
      if (cancelled) return;
      setCatalogue([]);
      setCatalogueState('error');
    });

    return () => {
      cancelled = true;
    };
  }, [pharmacyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(catalogue.map((item) => [item.id, item])), [catalogue]);
  const total = lines.reduce((sum, line) => {
    const item = byId.get(line.inventoryId);
    return item ? sum + netPrice(item) * Number(line.quantity || 0) : sum;
  }, 0);

  const updateLine = (key, patch) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const submit = async (event) => {
    event.preventDefault();
    if (!file) return setError('Attach the prescription (JPG, PNG or PDF).');
    if (!pharmacyId) return setError('Choose a MediSync partner pharmacy.');
    const items = lines
      .filter((line) => line.inventoryId && Number(line.quantity) > 0)
      .map((line) => ({ inventoryId: line.inventoryId, quantity: Number(line.quantity) }));
    if (!items.length) return setError('Pick at least one medicine from the price list.');
    if (fulfillment === 'delivery' && address.trim().length < 5) return setError('Enter the delivery address.');

    const store = partners.find((shop) => shop.id === pharmacyId);
    setBusy(true);
    setError(null);
    try {
      const order = await submitPrescriptionOrder({
        pharmacyId: resolvedPharmacyId || pharmacyId,
        items,
        file,
        fulfillment,
        deliveryAddress:
          fulfillment === 'pickup' ? `Store pickup — ${store?.address ?? store?.name ?? 'pharmacy'}` : address.trim(),
        doctorName: doctor.trim() || null,
        notes: notes.trim() || null,
      });
      setOrders((prev) => [order, ...prev]);
      setSent(order);
      setLines([{ key: Date.now(), inventoryId: catalogue[0]?.id ?? '', quantity: 1 }]);
      setDoctor('');
      setNotes('');
      setFile(null);
      event.target.reset?.();
    } catch (error_) {
      setError(error_.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (order) => {
    if (!window.confirm('Cancel this order? The pharmacy is notified and any reserved stock is released.')) return;
    setCancellingId(order.id);
    try {
      const updated = await cancelOrder(order.id);
      setOrders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error_) {
      setListError(error_.message);
    } finally {
      setCancellingId(null);
    }
  };

  const field =
    'mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-ink outline-none focus:border-brand-500';
  const selectedShop = partners.find((shop) => shop.id === pharmacyId);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <FileText className="h-4 w-4 text-brand-600" /> Order medicine with a prescription
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Attach your prescription, choose medicines from the pharmacy&rsquo;s price list and send the order. It
            appears in their console until they accept it.
          </p>
        </div>
        <Badge tone="teal">
          {partners.length} partner store{partners.length === 1 ? '' : 's'}
        </Badge>
      </div>

      {partners.length === 0 ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No verified MediSync partner pharmacy is loaded yet. Use your current location or a saved default location
          above so a partner store appears, then come back to send the prescription order.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-2.5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="rx-pharmacy" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Pharmacy
              </label>
              <select
                id="rx-pharmacy"
                value={pharmacyId}
                onChange={(event) => setPharmacyId(event.target.value)}
                className={field}
              >
                {partners.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rx-file" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Prescription file (JPG, PNG, PDF · max 5 MB)
              </label>
              <input
                id="rx-file"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                capture="environment"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className={`${field} !py-1.5 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-brand-50 file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-brand-700`}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Medicines ({catalogue.length} in this pharmacy&rsquo;s list)
              </p>
              {catalogueState === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
            </div>

            {catalogueState === 'error' ? (
              <p className="mt-2 text-[11px] text-rose-600">Could not load this pharmacy&rsquo;s price list. Try again.</p>
            ) : catalogueState === 'ready' && !catalogue.length ? (
              <p className="mt-2 text-[11px] text-slate-500">
                This pharmacy has not published any medicines yet, so it cannot take medicine orders.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {lines.map((line) => {
                  const item = byId.get(line.inventoryId);
                  return (
                    <div key={line.key} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[180px] flex-1">
                        <label htmlFor={`rx-med-${line.key}`} className="sr-only">
                          Medicine
                        </label>
                        <select
                          id={`rx-med-${line.key}`}
                          value={line.inventoryId}
                          onChange={(event) => updateLine(line.key, { inventoryId: event.target.value })}
                          className={field}
                        >
                          {catalogue.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.medicineName}
                              {option.packSize ? ` · ${option.packSize}` : ''} — {inr(netPrice(option))}
                              {option.isScheduleH ? ' · Rx' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-20">
                        <label htmlFor={`rx-qty-${line.key}`} className="sr-only">
                          Quantity
                        </label>
                        <input
                          id={`rx-qty-${line.key}`}
                          type="number"
                          min="1"
                          max={item?.stockQty ?? 50}
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                          className={field}
                          aria-label="Quantity"
                        />
                      </div>
                      <p className="w-24 pb-2 text-right text-[11px] font-semibold text-ink">
                        {item ? inr(netPrice(item) * Number(line.quantity || 0)) : '—'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== line.key)))}
                        disabled={lines.length === 1}
                        className="mb-1 rounded-lg border border-slate-200 p-2 text-slate-400 transition hover:bg-slate-50 disabled:opacity-30"
                        aria-label="Remove this medicine"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => [...prev, { key: Date.now(), inventoryId: catalogue[0]?.id ?? '', quantity: 1 }])}
                    disabled={catalogueState !== 'ready' || !catalogue.length || lines.length >= 10}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> Add another medicine
                  </button>
                  <p className="text-[11px] text-slate-500">
                    Estimated total <span className="ml-1 text-sm font-bold text-ink">{inr(total)}</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="rx-fulfillment" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Fulfilment
              </label>
              <select
                id="rx-fulfillment"
                value={fulfillment}
                onChange={(event) => setFulfillment(event.target.value)}
                className={field}
              >
                <option value="delivery">Home delivery</option>
                <option value="pickup">Collect from the store</option>
              </select>
            </div>
            <div>
              <label htmlFor="rx-doctor" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Doctor (optional)
              </label>
              <input
                id="rx-doctor"
                value={doctor}
                onChange={(event) => setDoctor(event.target.value)}
                placeholder="Dr. Meera Rao"
                className={field}
              />
            </div>
            {fulfillment === 'delivery' ? (
              <div className="sm:col-span-2">
                <label htmlFor="rx-address" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Delivery address
                </label>
                <input
                  id="rx-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="Flat, street, area, city"
                  className={field}
                />
              </div>
            ) : (
              <p className="self-end pb-2 text-[11px] text-slate-500 sm:col-span-2">
                Collect from {selectedShop?.name ?? 'the pharmacy'}
                {selectedShop?.address ? ` — ${selectedShop.address}` : ''}.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="rx-notes" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Note for the pharmacy (optional)
            </label>
            <textarea
              id="rx-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Brand preference, timing, or a question about the price."
              className={`${field} h-auto resize-none py-2`}
            />
          </div>

          {error ? <p className="text-[11px] font-medium text-rose-600">{error}</p> : null}
          {sent ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-100">
              <PackageCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sent to {sent.pharmacyName}. The order stays &ldquo;Waiting for pharmacy&rdquo; until they accept it.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || catalogueState !== 'ready' || !catalogue.length}
            className="btn-primary !px-3 !py-2 !text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send prescription order
          </button>
        </form>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-ink">My prescription orders</h3>
          <button
            type="button"
            onClick={loadOrders}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>

        {listError ? <p className="mt-2 text-[11px] text-slate-500">{listError}</p> : null}
        {!loading && !orders.length && !listError ? (
          <p className="mt-2 text-[11px] text-slate-500">No prescription orders sent yet.</p>
        ) : null}

        <ul className="mt-2 space-y-2">
          {orders.map((order) => {
            const status = STATUS[order.status] ?? { label: order.status, tone: 'slate' };
            return (
              <li key={order.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-ink">{order.pharmacyName ?? 'Pharmacy'}</p>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span className="ml-auto text-[10px] text-slate-400">{when(order.createdAt)}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  {(order.items ?? []).map((item) => `${item.medicineName} × ${item.quantity}`).join(', ') ||
                    'Medicine details in the prescription'}{' '}
                  · {inr(order.finalPrice)}
                  {order.fulfillment === 'pickup' ? ' · store pickup' : ''}
                </p>
                {order.rejectionReason ? (
                  <p className="mt-1 flex items-start gap-1 text-[10px] text-rose-600">
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {order.rejectionReason}
                  </p>
                ) : null}
                {order.cancellationReason ? (
                  <p className="mt-1 text-[10px] text-slate-500">Cancelled: {order.cancellationReason}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {order.prescriptionId ? (
                    <button
                      type="button"
                      onClick={() => openPrescriptionFile(order.prescriptionId).catch(() => {})}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <FileText className="h-3 w-3" /> View prescription
                    </button>
                  ) : null}
                  {['placed', 'confirmed'].includes(order.status) ? (
                    <button
                      type="button"
                      onClick={() => cancel(order)}
                      disabled={cancellingId === order.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                    >
                      {cancellingId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                      Cancel order
                    </button>
                  ) : null}
                  <span className="text-[10px] text-slate-400">{order.deliveryAddress}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
