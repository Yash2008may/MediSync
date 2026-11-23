import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Package,
  PackageCheck,
  Pill,
  Stethoscope,
  RefreshCw,
  Truck,
  UserCheck,
  UserRound,
  X,
} from 'lucide-react';
import { Badge, Card, Modal, ToastHost } from '../ui.jsx';
import StoreMap from '../components/StoreMap.jsx';
import ProfileModal from '../components/ProfileModal.jsx';
import { fetchMapsConfig } from '../pharmacies.js';
import PharmacyOrdersPanel from '../components/PharmacyOrdersPanel.jsx';
import InventoryManager from '../components/InventoryManager.jsx';
import NotificationBell from '../components/NotificationBell.jsx';

const STATUS_TONE = {
  approved: 'emerald',
  pending: 'amber',
  rejected: 'rose',
};

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const INITIAL_RX = [
  {
    id: 'rx-1041',
    patient: 'Yashavantha R.',
    distance: '1.2 km',
    doctor: 'Dr. S. Menon · Jayanagar Clinic',
    file: 'PDF',
    submittedAt: minutesAgo(4),
    medicine: 'Atorvastatin 20mg · 30 tablets',
    status: 'pending',
  },
  {
    id: 'rx-1042',
    patient: 'Meera Krishnan',
    distance: '2.4 km',
    doctor: 'Dr. A. Iyer · BSK Health Centre',
    file: 'JPG',
    submittedAt: minutesAgo(11),
    medicine: 'Metformin SR 500mg · 60 tablets',
    status: 'pending',
  },
  {
    id: 'rx-1043',
    patient: 'Rahul Deshpande',
    distance: '3.1 km',
    doctor: 'Dr. P. Rao · South City Hospital',
    file: 'PDF',
    submittedAt: minutesAgo(19),
    medicine: 'Dolo 650mg · 15 tablets',
    status: 'pending',
  },
];

const INITIAL_ORDERS = [
  {
    id: 'ORD-1042',
    patient: 'Yashavantha',
    medicine: 'Atorvastatin 20mg · 30 tablets',
    discount: 18,
    mrp: 320,
    delivery: 'Doorstep delivery',
    status: 'quoted',
  },
  {
    id: 'ORD-1043',
    patient: 'Meera Krishnan',
    medicine: 'Metformin SR 500mg · 60 tablets',
    discount: 15,
    mrp: 210,
    delivery: 'Store pickup',
    status: 'quoted',
  },
  {
    id: 'ORD-1044',
    patient: 'Rahul Deshpande',
    medicine: 'Dolo 650mg · 15 tablets',
    discount: 12,
    mrp: 45,
    delivery: 'Doorstep delivery',
    status: 'packed',
  },
  {
    id: 'ORD-1045',
    patient: 'Sana Fatima',
    medicine: 'Telma 40mg · 30 tablets',
    discount: 20,
    mrp: 190,
    delivery: 'Doorstep delivery',
    status: 'quoted',
  },
];

const INITIAL_INVENTORY = [
  { id: 'inv-1', name: 'Atorvastatin 20mg', batch: 'AT20-8841', expiry: '2027-04-30', strips: 24, discount: 18 },
  { id: 'inv-2', name: 'Metformin SR 500mg', batch: 'MF50-2210', expiry: '2027-01-15', strips: 9, discount: 15 },
  { id: 'inv-3', name: 'Dolo 650mg', batch: 'DL65-7712', expiry: '2026-12-20', strips: 3, discount: 12 },
  { id: 'inv-4', name: 'Telma 40mg', batch: 'TL40-3389', expiry: '2027-08-01', strips: 31, discount: 20 },
  { id: 'inv-5', name: 'Amoxicillin 500mg', batch: 'AM50-1190', expiry: '2026-11-30', strips: 6, discount: 10 },
  { id: 'inv-6', name: 'Pantoprazole 40mg', batch: 'PN40-5521', expiry: '2027-03-10', strips: 18, discount: 22 },
];

const INITIAL_DELIVERIES = [
  { id: 'ORD-1039', patient: 'Anil Kumar', rider: 'Ravi Kumar', eta: '9 mins', status: 'Out for delivery' },
  { id: 'ORD-1040', patient: 'Priya Nair', rider: 'Imran S.', eta: '17 mins', status: 'Out for delivery' },
];

const inr = (value) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const netPrice = (mrp, discount) => Number((mrp * (1 - discount / 100)).toFixed(2));
const idOf = (prefix) => `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
const clock = (date) => date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

const daysToExpiry = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

export default function PharmacyPage({ auth, onSignOut, onUpdateProfile }) {
  const profile = auth.user?.profile ?? {};
  const storeName = profile.storeName ?? 'Your medical store';
  const licence = profile.licenseNumber ?? 'Licence not on file';
  const address = profile.address ?? 'Store address not on file';
  const pharmacistName = profile.pharmacistName ?? 'Not set';
  const pharmacistRegNo = profile.pharmacistRegNo ?? '—';
  const verification = profile.verificationStatus ?? 'pending';
  const storeLat = Number(profile.latitude);
  const storeLng = Number(profile.longitude);
  const storePoint =
    Number.isFinite(storeLat) && Number.isFinite(storeLng) ? { lat: storeLat, lng: storeLng } : null;

  const [tab, setTab] = useState('overview');
  const [mapsKey, setMapsKey] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null);
  const [now, setNow] = useState(() => new Date());
  const [accepting, setAccepting] = useState(true);
  const [sound, setSound] = useState(true);
  const [rxQueue, setRxQueue] = useState(INITIAL_RX);
  const [orders, setOrders] = useState(INITIAL_ORDERS);
  const [inventory, setInventory] = useState(INITIAL_INVENTORY);
  const [deliveries, setDeliveries] = useState(INITIAL_DELIVERIES);
  const [audit, setAudit] = useState([]);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [preview, setPreview] = useState(null);
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newStock, setNewStock] = useState({ name: '', batch: '', expiry: '', strips: '', discount: '15' });
  const [counterFor, setCounterFor] = useState(null);
  const [counterValue, setCounterValue] = useState('15');
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Same runtime browser key the patient map uses (server .env, no rebuild needed).
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

  const notify = (title, text, tone = 'success') => setToast({ id: Math.random(), title, text, tone });

  const record = (action, target) =>
    setAudit((prev) => [
      { id: Math.random(), at: new Date().toISOString(), action, target, by: `${pharmacistName} · ${pharmacistRegNo}` },
      ...prev,
    ]);

  const pendingRx = rxQueue.filter((item) => item.status === 'pending');
  const activeOrders = orders.filter((item) => item.status !== 'delivered');
  const lowStock = inventory.filter((item) => item.strips <= 10);
  const revenue = orders
    .filter((item) => item.status === 'packed' || item.status === 'dispatched')
    .reduce((sum, item) => sum + netPrice(item.mrp, item.discount), 0);

  const visibleRx = useMemo(
    () => rxQueue.filter((item) => (filter === 'pending' ? item.status === 'pending' : item.status === filter)),
    [rxQueue, filter]
  );

  const visibleStock = useMemo(() => {
    const q = inventoryQuery.trim().toLowerCase();
    return q ? inventory.filter((item) => item.name.toLowerCase().includes(q) || item.batch.toLowerCase().includes(q)) : inventory;
  }, [inventory, inventoryQuery]);

  const nav = [
    { id: 'overview', label: 'Store Overview', icon: LayoutDashboard },
    { id: 'rx', label: 'Rx Verification Queue', icon: FileText, badge: pendingRx.length ? `${pendingRx.length} Pending` : null, tone: 'amber' },
    { id: 'orders', label: 'Refill Orders & Quotes', icon: Package, badge: `${activeOrders.length} Active`, tone: 'teal' },
    { id: 'inventory', label: 'Inventory & Batch Stock', icon: Pill, badge: lowStock.length ? `${lowStock.length} Low` : null, tone: 'rose' },
    { id: 'delivery', label: 'Delivery & Dispatch', icon: Truck, badge: `${deliveries.length} Out`, tone: 'emerald' },
    { id: 'credentials', label: 'Pharmacist Credentials', icon: UserCheck, badge: 'Verified', tone: 'emerald' },
  ];

  const openPreview = (rx) => {
    setPreview(rx);
    const inAWeek = new Date(Date.now() + 7 * 86400000);
    setValidUntil(inAWeek.toISOString().slice(0, 10));
    setNote('');
  };

  const decideRx = (rx, decision) => {
    setRxQueue((prev) => prev.map((item) => (item.id === rx.id ? { ...item, status: decision, note, validUntil } : item)));
    record(decision === 'approved' ? 'Prescription approved' : 'Prescription rejected', `${rx.id} · ${rx.patient}`);
    setPreview(null);
    notify(
      decision === 'approved' ? 'Prescription approved' : 'Prescription rejected',
      decision === 'approved'
        ? `${rx.patient} can now order ${rx.medicine}. Signed off by ${pharmacistName} (${pharmacistRegNo}).`
        : `${rx.patient} was notified. The rejection is in the audit trail with your registration number.`,
      decision === 'approved' ? 'success' : 'warning'
    );
  };

  const simulateRx = () => {
    const rx = {
      id: idOf('rx'),
      patient: 'Walk-in patient',
      distance: '0.6 km',
      doctor: 'Dr. K. Rao · Local Clinic',
      file: 'JPG',
      submittedAt: new Date().toISOString(),
      medicine: 'Azithromycin 500mg · 5 tablets',
      status: 'pending',
    };
    setRxQueue((prev) => [rx, ...prev]);
    setTab('rx');
    setFilter('pending');
    notify('New prescription received', `${rx.patient} uploaded a Schedule H prescription. Review it before dispensing.`, 'teal');
  };

  const acceptOrder = (order) => {
    setOrders((prev) => prev.map((item) => (item.id === order.id ? { ...item, status: 'packed' } : item)));
    record('Order accepted & packed', `${order.id} · ${order.patient}`);
    notify('Quote accepted', `${order.id} is packed at ${inr(netPrice(order.mrp, order.discount))}. Assign a rider to dispatch.`);
  };

  const counterOffer = (order) => {
    const value = Number(counterValue);
    if (!Number.isFinite(value) || value < 0 || value > 40) return;
    setOrders((prev) => prev.map((item) => (item.id === order.id ? { ...item, discount: value } : item)));
    record('Counter offer sent', `${order.id} · ${value}% off`);
    setCounterFor(null);
    notify('Counter offer sent', `${order.patient} sees ${value}% OFF (${inr(netPrice(order.mrp, value))}) for ${order.id}.`, 'teal');
  };

  const assignRider = (order) => {
    setOrders((prev) => prev.map((item) => (item.id === order.id ? { ...item, status: 'dispatched' } : item)));
    setDeliveries((prev) => [
      { id: order.id, patient: order.patient, rider: 'Ravi Kumar', eta: '18 mins', status: 'Out for delivery' },
      ...prev,
    ]);
    record('Rider assigned', `${order.id} · Ravi Kumar`);
    notify('Rider assigned', `${order.id} is out for delivery with Ravi Kumar. ETA 18 mins.`);
  };

  const addStock = (event) => {
    event.preventDefault();
    if (!newStock.name.trim() || !newStock.strips) return;
    setInventory((prev) => [
      {
        id: idOf('inv'),
        name: newStock.name.trim(),
        batch: newStock.batch.trim() || 'NEW',
        expiry: newStock.expiry || '2027-12-31',
        strips: Number(newStock.strips),
        discount: Number(newStock.discount),
      },
      ...prev,
    ]);
    record('Stock added', `${newStock.name.trim()} · ${newStock.strips} strips`);
    setNewStock({ name: '', batch: '', expiry: '', strips: '', discount: '15' });
    setAddOpen(false);
    notify('Stock added', `${newStock.name.trim()} is now in the batch stock list.`);
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[250px] flex-col bg-ink px-4 py-5 lg:flex">
        <div className="flex items-center gap-3 px-1">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Pill className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-white">MediSync</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-200">Medical Store Portal</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 ring-1 ring-white/10">
          <span className={`h-1.5 w-1.5 rounded-full ${accepting ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          <span className="truncate text-[10px] font-semibold text-slate-300">
            {accepting ? 'Store Online' : 'Store Paused'} • {verification === 'approved' ? 'Verified' : 'Pending review'}
          </span>
        </div>

        <nav className="mt-5 space-y-1" aria-label="Store sections">
          {nav.map(({ id, label, icon: Icon, badge, tone }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition ${
                  active ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {badge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                      active
                        ? 'bg-white/20 text-white'
                        : tone === 'rose'
                          ? 'bg-rose-500/15 text-rose-300'
                          : tone === 'amber'
                            ? 'bg-amber-400/15 text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-slate-300">Accepting Orders</span>
              <button
                type="button"
                role="switch"
                aria-checked={accepting}
                onClick={() => {
                  setAccepting((value) => !value);
                  notify(accepting ? 'Orders paused' : 'Orders resumed', accepting ? 'New orders will queue until you resume.' : 'You are accepting new refill orders again.', accepting ? 'warning' : 'success');
                }}
                className={`relative h-5 w-9 rounded-full transition ${accepting ? 'bg-brand-500' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${accepting ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
            <p className="mt-2 truncate font-mono text-[10px] text-slate-400">{licence}</p>
            <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{address}</p>
          </div>
          {onUpdateProfile ? (
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              <UserRound className="h-3.5 w-3.5" /> Edit Profile
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      <div className="lg:pl-[250px]">
        {/* Top header */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-6">
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-ink">
                {nav.find((item) => item.id === tab)?.label ?? 'Store Overview'}
              </h1>
              <p className="flex items-center gap-2 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1 font-mono text-slate-600">
                  <Clock className="h-3 w-3" /> {clock(now)}
                </span>
                <span className="inline-flex items-center gap-1 truncate">
                  <MapPin className="h-3 w-3 shrink-0" /> {address}
                </span>
              </p>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <NotificationBell />
              <button
                type="button"
                onClick={() => setSound((value) => !value)}
                aria-pressed={sound}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-semibold transition ${
                  sound ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <BellRing className="h-3.5 w-3.5" /> Rx alert sound {sound ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                onClick={simulateRx}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <FileText className="h-3.5 w-3.5" /> Simulate Incoming Rx
              </button>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold uppercase text-white">
                  {storeName.slice(0, 1)}
                </span>
                <div className="hidden min-w-0 sm:block">
                  <p className="max-w-[150px] truncate text-[11px] font-semibold text-ink">{storeName}</p>
                  <p className="max-w-[150px] truncate text-[9px] text-slate-500">Pharmacist · {pharmacistName}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile section nav */}
          <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 scroll-slim lg:hidden" aria-label="Store sections">
            {nav.map(({ id, label, badge }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition ${
                  tab === id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {label}
                {badge ? <span className="ml-1 opacity-70">({badge.split(' ')[0]})</span> : null}
              </button>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1280px] space-y-3 px-3 py-4 sm:px-6">
          {tab === 'overview' ? (
            <>
              <section className="rounded-2xl bg-ink px-4 py-4 text-white sm:px-5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-brand-200 ring-1 ring-brand-400/30">
                      <UserCheck className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/30">
                        <CheckCircle2 className="h-3 w-3" /> On-duty registered pharmacist verified
                      </span>
                      <p className="mt-1 text-sm font-bold">
                        {pharmacistName} <span className="font-mono text-[11px] font-normal text-slate-400">{pharmacistRegNo}</span>
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Drug licence <span className="font-mono">{licence}</span> ·{' '}
                        {verification === 'approved' ? 'Approved · Form 20/21' : 'Awaiting admin approval'}
                      </p>
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setTab('credentials')}
                      className="rounded-xl border border-white/15 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/5"
                    >
                      Update Shift Pharmacist
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab('rx')}
                      className="rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-brand-700"
                    >
                      Open Rx Review Queue
                    </button>
                  </div>
                </div>
              </section>

              <div className="grid items-stretch gap-3 lg:grid-cols-[1.4fr_1fr]">
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div>
                      <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                        <MapPin className="h-4 w-4 text-brand-600" /> Your store on Google Maps
                      </h2>
                      <p className="text-[10px] text-slate-500">This is the pin patients see in their nearby list.</p>
                    </div>
                    <Badge tone={mapsKey ? 'teal' : 'slate'}>{mapsKey ? 'Live map' : 'GPS pin'}</Badge>
                  </div>
                  <StoreMap
                    apiKey={mapsKey}
                    centre={storePoint}
                    stores={storePoint ? [{ id: 'my-store', name: storeName, lat: storePoint.lat, lng: storePoint.lng }] : []}
                    height={230}
                    fallback={
                      <div className="flex h-[230px] flex-col items-center justify-center gap-2 bg-slate-50 px-4 text-center">
                        <MapPin className="h-5 w-5 text-slate-300" />
                        <p className="text-xs font-semibold text-ink">
                          {storePoint ? `${storeLat.toFixed(5)}, ${storeLng.toFixed(5)}` : 'No GPS pin on file'}
                        </p>
                        <p className="max-w-[260px] text-[10px] leading-relaxed text-slate-500">
                          Add GOOGLE_MAPS_BROWSER_KEY on the server to draw the live Google map here.
                        </p>
                      </div>
                    }
                  />
                </Card>

                <Card className="p-4">
                  <h2 className="text-sm font-bold text-ink">Store details patients see</h2>
                  <dl className="mt-2 space-y-1.5 text-[11px]">
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Address</dt>
                      <dd className="leading-relaxed text-slate-600">{address}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Drug licence</dt>
                      <dd className="font-mono text-slate-600">{licence}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Coordinates</dt>
                      <dd className="font-mono text-slate-600">
                        {storePoint ? `${storeLat.toFixed(5)}, ${storeLng.toFixed(5)}` : 'Not set'}
                      </dd>
                    </div>
                  </dl>
                  {storePoint ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${storeLat},${storeLng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 hover:text-brand-800"
                    >
                      <ExternalLink className="h-3 w-3" /> Open in Google Maps
                    </a>
                  ) : null}
                </Card>
              </div>

              {pendingRx[0] ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-amber-700">Action required — Schedule H prescription</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-ink">
                      {pendingRx[0].patient} · {pendingRx[0].distance} away
                    </p>
                    <p className="truncate text-[10px] text-amber-900/80">{pendingRx[0].doctor}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPreview(pendingRx[0])}
                    className="ml-auto rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-amber-600"
                  >
                    Review &amp; Verify Rx Now
                  </button>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: 'Pending Prescriptions', value: pendingRx.length, hint: 'Avg review time: 4m', icon: FileText, tone: 'amber' },
                  { label: 'Active Refill Orders', value: activeOrders.length, hint: `${orders.filter((o) => o.status === 'quoted').length} awaiting price quote`, icon: Package, tone: 'teal' },
                  { label: 'Out for Delivery', value: deliveries.length, hint: 'Local riders tracking live', icon: Truck, tone: 'sky' },
                  { label: "Today's Revenue", value: inr(revenue), hint: `${orders.length} orders fulfilled`, icon: CheckCircle2, tone: 'emerald' },
                ].map(({ label, value, hint, icon: Icon, tone }) => (
                  <Card key={label} className="flex items-start justify-between gap-2 p-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                      <p
                        className={`mt-1 text-2xl font-bold tabular-nums ${
                          tone === 'amber' ? 'text-amber-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'sky' ? 'text-sky-600' : 'text-brand-700'
                        }`}
                      >
                        {value}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>
                    </div>
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        tone === 'amber'
                          ? 'bg-amber-50 text-amber-600'
                          : tone === 'emerald'
                            ? 'bg-emerald-50 text-emerald-600'
                            : tone === 'sky'
                              ? 'bg-sky-50 text-sky-600'
                              : 'bg-brand-50 text-brand-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                  </Card>
                ))}
              </div>

              <div className="grid gap-3 xl:grid-cols-[3fr_2fr]">
                <Card className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-ink">Digital Prescription Verification Queue</h2>
                      <p className="text-[10px] text-slate-500">Schedule H / H1 drugs need a registered pharmacist sign-off.</p>
                    </div>
                    <button type="button" onClick={() => setTab('rx')} className="text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                      Open queue →
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {pendingRx.length === 0 ? (
                      <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">No prescriptions waiting. You are all caught up.</p>
                    ) : (
                      pendingRx.map((rx) => (
                        <div key={rx.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-ink">
                              {rx.patient} <span className="font-normal text-slate-400">· {rx.distance}</span>
                            </p>
                            <p className="truncate text-[10px] text-slate-500">{rx.doctor}</p>
                          </div>
                          <Badge tone="slate">{rx.file}</Badge>
                          <button type="button" onClick={() => openPreview(rx)} className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-brand-700">
                            Preview Rx
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-ink">Incoming Refill &amp; Price Quote Requests</h2>
                    <button type="button" onClick={() => setTab('orders')} className="text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                      View All →
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {orders.slice(0, 3).map((order) => (
                      <div key={order.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-ink">{order.patient}</p>
                          <Badge tone={order.status === 'quoted' ? 'amber' : 'teal'}>{order.status === 'quoted' ? 'Quote' : order.status}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">{order.medicine}</p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-slate-500">
                            <span className="font-semibold text-brand-700">{order.discount}% OFF</span> · {inr(netPrice(order.mrp, order.discount))}
                          </p>
                          {order.status === 'quoted' ? (
                            <button type="button" onClick={() => acceptOrder(order)} className="rounded-lg bg-brand-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-brand-700">
                              Accept Quote
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          ) : null}

          {tab === 'rx' ? (
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-ink">Digital Prescription Verification Queue</h2>
                  <p className="text-[10px] text-slate-500">Pharmacist registration is required before dispensing Schedule H / H1 medicines.</p>
                </div>
                <div className="flex gap-1">
                  {[
                    { id: 'pending', label: `Pending (${rxQueue.filter((r) => r.status === 'pending').length})` },
                    { id: 'approved', label: 'Approved' },
                    { id: 'rejected', label: 'Rejected' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilter(item.id)}
                      className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition ${
                        filter === item.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {visibleRx.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">Nothing in this filter.</p>
                ) : (
                  visibleRx.map((rx) => (
                    <div key={rx.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-xs font-semibold text-ink">{rx.patient}</p>
                          <Badge tone={STATUS_TONE[rx.status]}>{rx.status}</Badge>
                        </div>
                        <p className="truncate text-[10px] text-slate-500">
                          {rx.doctor} · {rx.medicine}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => openPreview(rx)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">
                          Preview Rx
                        </button>
                        {rx.status === 'pending' ? (
                          <>
                            <button type="button" onClick={() => decideRx(rx, 'approved')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700">
                              <Check className="h-3 w-3" /> Approve
                            </button>
                            <button type="button" onClick={() => decideRx(rx, 'rejected')} className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100">
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          ) : null}

          {tab === 'orders' ? (
            <>
              <PharmacyOrdersPanel notify={notify} disabled={verification !== 'approved'} />

              <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-ink">Refill Orders &amp; Quotes</h2>
                  <p className="text-[10px] text-slate-500">Stock is deducted when an order is packed. Riders can be assigned after packing.</p>
                </div>
                <Badge tone={accepting ? 'emerald' : 'rose'}>{accepting ? 'Accepting orders' : 'Orders paused'}</Badge>
              </div>

              <div className="mt-3 space-y-2">
                {orders.map((order) => (
                  <div key={order.id} className="rounded-xl border border-slate-200 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-[10px] font-semibold text-slate-400">{order.id}</p>
                      <p className="text-xs font-semibold text-ink">{order.patient}</p>
                      <Badge tone={order.status === 'quoted' ? 'amber' : order.status === 'packed' ? 'teal' : 'emerald'}>
                        {order.status === 'quoted' ? 'Awaiting quote' : order.status === 'packed' ? 'Packed' : 'Out for delivery'}
                      </Badge>
                      <p className="ml-auto text-[10px] text-slate-500">{order.delivery}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{order.medicine}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="text-[11px] text-slate-500">
                        <span className="font-semibold text-brand-700">{order.discount}% OFF</span> ·{' '}
                        <span className="line-through">{inr(order.mrp)}</span>{' '}
                        <span className="font-bold text-ink">{inr(netPrice(order.mrp, order.discount))}</span>
                      </p>
                      <div className="ml-auto flex flex-wrap gap-1.5">
                        {order.status === 'quoted' ? (
                          <>
                            <button type="button" onClick={() => acceptOrder(order)} className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-brand-700">
                              Accept Quote &amp; Pack
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCounterFor(counterFor === order.id ? null : order.id);
                                setCounterValue(String(order.discount));
                              }}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Counter Offer
                            </button>
                          </>
                        ) : null}
                        {order.status === 'packed' ? (
                          <button type="button" onClick={() => assignRider(order)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700">
                            <Truck className="h-3 w-3" /> Assign Rider
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {counterFor === order.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
                        <label htmlFor={`counter-${order.id}`} className="text-[10px] font-semibold text-slate-600">
                          Counter discount %
                        </label>
                        <input
                          id={`counter-${order.id}`}
                          type="number"
                          min="0"
                          max="40"
                          value={counterValue}
                          onChange={(event) => setCounterValue(event.target.value)}
                          className="h-8 w-20 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-brand-500"
                        />
                        <span className="text-[10px] text-slate-500">New price {inr(netPrice(order.mrp, Number(counterValue) || 0))}</span>
                        <button type="button" onClick={() => counterOffer(order)} className="ml-auto rounded-lg bg-ink px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-slate-800">
                          Send
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              </Card>
            </>
          ) : null}

          {tab === 'inventory' ? (
            <>
              <InventoryManager notify={notify} />
              <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-ink">Inventory &amp; Batch Stock</h2>
                  <p className="text-[10px] text-slate-500">Batches expiring in under 90 days are highlighted amber.</p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={inventoryQuery}
                    onChange={(event) => setInventoryQuery(event.target.value)}
                    placeholder="Search medicine or batch…"
                    aria-label="Search inventory"
                    className="h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500 sm:w-56"
                  />
                  <button type="button" onClick={() => setAddOpen(true)} className="rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-brand-700">
                    + Add Stock
                  </button>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto scroll-slim">
                <table className="w-full min-w-[620px] border-collapse text-left">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="py-2 pr-3">Medicine</th>
                      <th className="py-2 pr-3">Batch</th>
                      <th className="py-2 pr-3">Expiry</th>
                      <th className="py-2 pr-3">Strips left</th>
                      <th className="py-2 pr-3">Refill discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStock.map((item) => {
                      const days = daysToExpiry(item.expiry);
                      return (
                        <tr key={item.id} className="border-t border-slate-100 text-xs">
                          <td className="py-2.5 pr-3 font-semibold text-ink">{item.name}</td>
                          <td className="py-2.5 pr-3 font-mono text-[10px] text-slate-500">{item.batch}</td>
                          <td className={`py-2.5 pr-3 text-[11px] ${days < 90 ? 'font-semibold text-amber-600' : 'text-slate-500'}`}>
                            {new Date(item.expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {days < 90 ? <span className="ml-1 text-[9px]">({days}d)</span> : null}
                          </td>
                          <td className="py-2.5 pr-3">
                            <Badge tone={item.strips === 0 ? 'rose' : item.strips <= 10 ? 'amber' : 'emerald'}>{item.strips} strips</Badge>
                          </td>
                          <td className="py-2.5 pr-3 font-semibold text-brand-700">{item.discount}% OFF</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            </>
          ) : null}

          {tab === 'delivery' ? (
            <Card className="p-4">
              <h2 className="text-sm font-bold text-ink">Delivery &amp; Dispatch</h2>
              <p className="text-[10px] text-slate-500">Live rider progress for packed orders. Assign a rider from the orders tab.</p>
              <div className="mt-3 space-y-2">
                {deliveries.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-8 text-center text-xs text-slate-500">No deliveries out right now.</p>
                ) : (
                  deliveries.map((delivery) => (
                    <div key={delivery.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                        <Truck className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-ink">
                          {delivery.id} · {delivery.patient}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Rider {delivery.rider} · ETA {delivery.eta}
                        </p>
                      </div>
                      <Badge tone="emerald">{delivery.status}</Badge>
                    </div>
                  ))
                )}
              </div>
            </Card>
          ) : null}

          {tab === 'credentials' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Card className="p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Store licence</p>
                  <p className="mt-1 font-mono text-sm font-bold text-ink">{licence}</p>
                  <Badge tone={STATUS_TONE[verification] ?? 'amber'} className="mt-2">
                    {verification === 'approved' ? 'Approved · Form 20/21' : verification === 'rejected' ? 'Rejected' : 'Pending admin review'}
                  </Badge>
                  <p className="mt-3 flex items-start gap-1 text-[11px] leading-relaxed text-slate-500">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {address}
                  </p>
                  {Number.isFinite(profile.latitude) && Number.isFinite(profile.longitude) ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${profile.latitude},${profile.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-800"
                    >
                      <ExternalLink className="h-3 w-3" /> Verify GPS pin on Google Maps
                    </a>
                  ) : null}
                  {profile.verificationNote ? (
                    <p className="mt-3 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] leading-relaxed text-rose-700">
                      Admin note: {profile.verificationNote}
                    </p>
                  ) : null}
                </Card>

                <Card className="p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Registered pharmacist</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-ink">
                    <Stethoscope className="h-4 w-4 text-brand-600" /> {pharmacistName}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    State Pharmacy Council reg. no. <span className="font-mono font-semibold text-ink">{pharmacistRegNo}</span>
                  </p>
                  <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
                    Schedule H / H1 prescriptions can only be verified while an on-duty registered pharmacist is signed
                    in. Changing the shift pharmacist is not wired to the server yet.
                  </p>
                </Card>
              </div>

              <Card className="p-4">
                <h2 className="text-sm font-bold text-ink">Local audit trail</h2>
                <p className="text-[10px] text-slate-500">Actions taken in this browser session, with the pharmacist registration number.</p>
                <div className="mt-3 space-y-1.5">
                  {audit.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">No actions yet in this session.</p>
                  ) : (
                    audit.map((entry) => (
                      <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-[11px]">
                        <span className="font-mono text-[10px] text-slate-400">
                          {new Date(entry.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                        </span>
                        <span className="font-semibold text-ink">{entry.action}</span>
                        <span className="text-slate-500">{entry.target}</span>
                        <span className="ml-auto text-[10px] text-slate-400">by {entry.by}</span>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </>
          ) : null}

          <p className="pb-2 text-center text-[10px] text-slate-400">
            Prescription review, inventory and dispatch on this screen are demo interactions — they are not yet stored
            on the MediSync server.
          </p>
        </main>
      </div>

      <Modal
        open={Boolean(preview)}
        title="Prescription preview & sign-off"
        subtitle={preview ? `${preview.patient} · ${preview.id}` : undefined}
        onClose={() => setPreview(null)}
        size="lg"
        footer={
          preview ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => decideRx(preview, 'approved')}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-700"
              >
                Approve &amp; Sign Off
              </button>
              <button
                type="button"
                onClick={() => decideRx(preview, 'rejected')}
                className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100"
              >
                Reject Prescription
              </button>
              <button type="button" onClick={() => setPreview(null)} className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-slate-700">
                Cancel
              </button>
            </div>
          ) : null
        }
      >
        {preview ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Digital prescription</p>
                  <p className="mt-1 text-sm font-bold text-ink">{preview.doctor}</p>
                  <p className="text-[11px] text-slate-500">
                    Patient: {preview.patient} · Submitted {new Date(preview.submittedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </p>
                </div>
                <Badge tone="slate">{preview.file}</Badge>
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4">
                <p className="text-xs font-semibold text-ink">Rx</p>
                <p className="mt-1 text-[11px] text-slate-600">{preview.medicine}</p>
                <p className="mt-1 text-[10px] text-slate-400">Signature on file · Schedule H</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="valid-until" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Valid until
                </label>
                <input
                  id="valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label htmlFor="pharmacist-note" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Pharmacist note (optional)
                </label>
                <input
                  id="pharmacist-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Dosage verified against prescriber"
                  className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500"
                />
              </div>
            </div>

            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-900">
              <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" />
              Sign-off is recorded with {pharmacistName} ({pharmacistRegNo}). This demo does not yet persist to the server.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={addOpen}
        title="Add batch stock"
        subtitle="New stock appears in the inventory table immediately."
        onClose={() => setAddOpen(false)}
        footer={
          <div className="flex items-center gap-2">
            <button type="submit" form="add-stock-form" className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-brand-700">
              <PackageCheck className="h-3.5 w-3.5" /> Add stock
            </button>
            <button type="button" onClick={() => setAddOpen(false)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700">
              Cancel
            </button>
          </div>
        }
      >
        <form id="add-stock-form" onSubmit={addStock} className="space-y-3">
          <div>
            <label htmlFor="stock-name" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Medicine name &amp; strength
            </label>
            <input
              id="stock-name"
              value={newStock.name}
              onChange={(event) => setNewStock((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Atorvastatin 20mg"
              className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="stock-batch" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Batch no.
              </label>
              <input
                id="stock-batch"
                value={newStock.batch}
                onChange={(event) => setNewStock((prev) => ({ ...prev, batch: event.target.value }))}
                placeholder="AT20-8842"
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor="stock-expiry" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Expiry
              </label>
              <input
                id="stock-expiry"
                type="date"
                value={newStock.expiry}
                onChange={(event) => setNewStock((prev) => ({ ...prev, expiry: event.target.value }))}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="stock-strips" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Strips
              </label>
              <input
                id="stock-strips"
                type="number"
                min="1"
                value={newStock.strips}
                onChange={(event) => setNewStock((prev) => ({ ...prev, strips: event.target.value }))}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor="stock-discount" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Refill discount %
              </label>
              <input
                id="stock-discount"
                type="number"
                min="0"
                max="40"
                value={newStock.discount}
                onChange={(event) => setNewStock((prev) => ({ ...prev, discount: event.target.value }))}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-brand-500"
              />
            </div>
          </div>
        </form>
      </Modal>

      {onUpdateProfile ? (
        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          user={auth.user}
          onSave={onUpdateProfile}
        />
      ) : null}

      <ToastHost toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
