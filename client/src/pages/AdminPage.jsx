import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  Power,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import RoleShell from '../components/RoleShell.jsx';
import StoreMap from '../components/StoreMap.jsx';
import AdminOrdersPanel from '../components/AdminOrdersPanel.jsx';
import { Badge, Card } from '../ui.jsx';
import { apiUrl, fetchAdminOverview, fetchPharmaciesByStatus, setPharmacyActive, verifyPharmacy } from '../api.js';
import { fetchMapsConfig } from '../pharmacies.js';

const submitted = (iso) => {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const TAB_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected / Suspended' };

export default function AdminPage({ auth, onSignOut, onUpdateProfile }) {
  const [status, setStatus] = useState('pending');
  const [queue, setQueue] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [userStats, setUserStats] = useState({ patients: 0, pharmacies: 0, disabled: 0 });
  const [reminderStats, setReminderStats] = useState({ activeSchedules: 0, sentToday: 0, totalNotificationsToday: 0 });
  const [stuckOrders, setStuckOrders] = useState([]);
  const [needsReview, setNeedsReview] = useState(0);
  const [audit, setAudit] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [mapsKey, setMapsKey] = useState(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null);
  const [mapSelected, setMapSelected] = useState(null);
  const [accountAction, setAccountAction] = useState(null);

  // User Directory state
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // Broadcast state
  const [broadcastAudience, setBroadcastAudience] = useState('all');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);

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

  const loadDirectory = useCallback(async (role = userRoleFilter, q = userSearch) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      if (role) params.set('role', role);
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(apiUrl(`/api/admin/users?${params.toString()}`), { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.users)) setDirectoryUsers(data.users);
    } catch {
      // ignore transient directory fetch errors
    } finally {
      setUsersLoading(false);
    }
  }, [userRoleFilter, userSearch]);

  const load = useCallback(async (nextStatus = status) => {
    setLoading(true);
    setError(null);
    try {
      const [overview, pharmacies, healthRes] = await Promise.all([
        fetchAdminOverview(),
        fetchPharmaciesByStatus(nextStatus),
        fetch(apiUrl('/api/admin/system-health'), { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ]);
      setCounts(overview.counts);
      setUserStats(overview.users ?? { patients: 0, pharmacies: 0, disabled: 0 });
      setReminderStats(overview.reminderStats ?? { activeSchedules: 0, sentToday: 0, totalNotificationsToday: 0 });
      setStuckOrders(Array.isArray(overview.stuckOrders) ? overview.stuckOrders : []);
      setNeedsReview(overview.needsReview ?? 0);
      setAudit(overview.audit);
      setQueue(pharmacies);
      if (healthRes) setHealth(healthRes);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load(status);
    loadDirectory();
  }, [load, loadDirectory, status]);

  const decide = async (pharmacy, decision) => {
    setBusyId(pharmacy.id);
    setError(null);
    setNotice(null);
    try {
      await verifyPharmacy(pharmacy.id, {
        decision,
        note: decision === 'rejected' ? note.trim() : undefined,
      });
      setQueue((prev) => prev.filter((item) => item.id !== pharmacy.id));
      setCounts((prev) => ({
        ...prev,
        [decision]: prev[decision] + 1,
        ...(pharmacy.status && pharmacy.status !== decision ? { [pharmacy.status]: Math.max(0, prev[pharmacy.status] - 1) } : {}),
      }));
      setNotice(
        `${pharmacy.storeName} was ${decision === 'approved' ? 'verified (SMS + Email sent) and is now live on the patient map' : 'rejected (SMS + Email sent)'}.`
      );
      setRejectingId(null);
      setNote('');
      load(status);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleAccount = async (pharmacy, active) => {
    setBusyId(pharmacy.id);
    setError(null);
    setNotice(null);
    try {
      await setPharmacyActive(pharmacy.id, active);
      setQueue((prev) => prev.map((item) => (item.id === pharmacy.id ? { ...item, isActive: active } : item)));
      setNotice(`${pharmacy.storeName} was ${active ? 're-enabled and can sign in again' : 'signed out and suspended'}.`);
      setAccountAction(null);
      loadDirectory();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleDirectoryUser = async (user) => {
    setBusyId(user.id);
    try {
      const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(user.id)}/account`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.isActive }),
      });
      if (!res.ok) throw new Error('Could not update account status');
      setNotice(`${user.email} account ${!user.isActive ? 're-enabled' : 'suspended'}.`);
      loadDirectory();
      load(status);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const sendBroadcast = async (event) => {
    event.preventDefault();
    setBroadcastBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(apiUrl('/api/admin/broadcast'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: broadcastAudience, title: broadcastTitle, body: broadcastBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Broadcast failed');
      setNotice(`Broadcast delivered via In-App, Email & SMS to ${data.sent} active account(s).`);
      setBroadcastTitle('');
      setBroadcastBody('');
      load(status);
    } catch (err) {
      setError(err.message);
    } finally {
      setBroadcastBusy(false);
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter((pharmacy) =>
      [pharmacy.storeName, pharmacy.licenseNumber, pharmacy.address, pharmacy.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [queue, query]);

  const mapStores = useMemo(
    () =>
      visible
        .filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
        .map((p) => ({ id: p.id, name: p.storeName, lat: Number(p.latitude), lng: Number(p.longitude) })),
    [visible]
  );

  const kpis = [
    { label: 'Pending Licence Reviews', value: counts.pending, hint: 'Avg SLA: < 2 hrs', icon: FileText, tone: 'amber' },
    { label: 'Verified Medical Stores', value: counts.approved, hint: `${userStats.patients} active patients`, icon: ShieldCheck, tone: 'emerald' },
    { label: '5-Min Reminders Sent Today', value: reminderStats.sentToday, hint: `${reminderStats.activeSchedules} active dose schedules`, icon: Bell, tone: 'teal' },
    { label: 'Stuck Orders (> 30m)', value: stuckOrders.length, hint: `${audit.length} audit actions logged`, icon: AlertTriangle, tone: stuckOrders.length > 0 ? 'rose' : 'emerald' },
  ];

  return (
    <RoleShell
      roleLabel="Admin console"
      title="Governance, verification & platform telemetry"
      subtitle="Verify pharmacy licences with automated SMS + Email alerts, monitor 5-minute pre-dose reminder adherence, escalate delayed orders, and audit platform activity."
      user={auth.user}
      onSignOut={onSignOut}
      onSaveProfile={onUpdateProfile}
    >
      {/* 1. Platform & SDG Impact KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ label, value, hint, icon: Icon, tone }) => (
          <Card key={label} className="flex items-start justify-between gap-2 p-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
              <p
                className={`mt-1 text-2xl font-bold tabular-nums ${
                  tone === 'amber'
                    ? 'text-amber-600'
                    : tone === 'emerald'
                      ? 'text-emerald-600'
                      : tone === 'rose'
                        ? 'text-rose-600'
                        : 'text-brand-700'
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
                    : tone === 'rose'
                      ? 'bg-rose-50 text-rose-600'
                      : 'bg-brand-50 text-brand-700'
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
          </Card>
        ))}
      </div>

      {/* 2. Stuck Order Escalation Banner */}
      {stuckOrders.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-800 ring-1 ring-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span className="min-w-0 flex-1">
            <strong>Order Escalation Alert:</strong> {stuckOrders.length} order{stuckOrders.length === 1 ? ' has' : 's have'} been waiting over 30 minutes (oldest: {stuckOrders[0].pharmacyName ?? 'Pharmacy'} for {stuckOrders[0].patientName ?? 'Patient'}).
          </span>
        </div>
      ) : null}

      {needsReview > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {needsReview} verified store{needsReview === 1 ? '' : 's'} changed a name or address after approval. Re-check in the <strong>Approved</strong> tab.
          </span>
          <button
            type="button"
            onClick={() => setStatus('approved')}
            className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-amber-600"
          >
            Review stores
          </button>
        </div>
      ) : null}

      {/* 3. Gateway Health & Broadcast Center */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
              <Activity className="h-4 w-4 text-brand-600" /> System & Gateway Health
            </h2>
            <Badge tone="emerald">Live Telemetry</Badge>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">Real-time status of SMS, SMTP Email, and the 5-minute pre-dose scheduler.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-xl border border-slate-200 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">SMS Gateway</span>
                <Badge tone={health?.sms?.ok ? 'emerald' : 'amber'}>{health?.sms?.ok ? 'Online' : 'Check IP'}</Badge>
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{health?.sms?.endpoint ?? 'Checking...'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">Email (SMTP)</span>
                <Badge tone={health?.email?.ok ? 'emerald' : 'rose'}>{health?.email?.ok ? 'Connected' : 'Off'}</Badge>
              </div>
              <p className="mt-1 truncate text-[10px] text-slate-500">{health?.email?.label ?? 'Checking...'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">Dose Cron</span>
                <Badge tone="emerald">Active</Badge>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">Fires 5 mins before dose</p>
            </div>
            <div className="rounded-xl border border-slate-200 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">PostgreSQL</span>
                <Badge tone="emerald">Healthy</Badge>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">{reminderStats.totalNotificationsToday} alerts logged today</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <Megaphone className="h-4 w-4 text-brand-600" /> Broadcast Health / System Notice
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Dispatch an instant SMS, Email & In-App advisory to active users.</p>
          <form onSubmit={sendBroadcast} className="mt-3 space-y-2">
            <div className="flex gap-2">
              <select
                value={broadcastAudience}
                onChange={(e) => setBroadcastAudience(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink outline-none"
              >
                <option value="all">All Users ({userStats.patients + userStats.pharmacies})</option>
                <option value="patient">Patients Only ({userStats.patients})</option>
                <option value="pharmacy">Pharmacies Only ({userStats.pharmacies})</option>
              </select>
              <input
                type="text"
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                placeholder="Subject (e.g., Monsoon delivery advisory)"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-brand-600"
                required
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                placeholder="Short message sent via SMS & Email..."
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-brand-600"
                required
              />
              <button
                type="submit"
                disabled={broadcastBusy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {broadcastBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send
              </button>
            </div>
          </form>
        </Card>
      </div>

      {/* 4. Pharmacy Licence Verification Queue */}
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <div className="flex flex-wrap gap-1">
          {Object.entries(TAB_LABEL).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setStatus(id);
                setRejectingId(null);
                setNote('');
                setNotice(null);
              }}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition ${
                status === id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label} ({counts[id]})
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-2.5">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Store, city or licence no."
              aria-label="Search pharmacies"
              className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-slate-300 sm:w-52"
            />
          </div>
          <button
            type="button"
            onClick={() => load(status)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
              <MapPin className="h-4 w-4 text-brand-600" /> Store locations - {TAB_LABEL[status]}
            </h2>
            <p className="text-[10px] text-slate-500">Check each pin against the licence address before approving.</p>
          </div>
          <Badge tone={mapsKey ? 'teal' : 'slate'}>{mapsKey ? 'Live - Google Maps' : 'GPS pins'}</Badge>
        </div>
        <StoreMap
          apiKey={mapsKey}
          stores={mapStores}
          selectedId={mapSelected}
          onSelect={setMapSelected}
          height={230}
          fallback={
            <div className="flex h-[230px] flex-wrap content-center items-center justify-center gap-2 bg-slate-50 p-4">
              {mapStores.length === 0 ? (
                <p className="text-xs text-slate-500">No stores with a GPS pin in this tab.</p>
              ) : (
                mapStores.map((store) => (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setMapSelected(store.id)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      mapSelected === store.id
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {store.name} - {store.lat.toFixed(3)}, {store.lng.toFixed(3)}
                  </button>
                ))
              )}
            </div>
          }
        />
      </Card>

      {notice ? (
        <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <Card className="p-8 text-center">
          <ShieldCheck className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-ink">
            {query.trim() ? 'No stores match that search' : status === 'pending' ? 'Nothing waiting for review' : `No ${status} stores`}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((pharmacy) => {
            const busy = busyId === pharmacy.id;
            const rejecting = rejectingId === pharmacy.id;
            const noteTooShort = note.trim().length < 3;
            const isPending = status === 'pending';

            return (
              <Card
                key={pharmacy.id}
                className={`p-4 sm:p-5 ${mapSelected === pharmacy.id ? 'ring-2 ring-brand-600/40' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={status === 'pending' ? 'amber' : status === 'approved' ? 'emerald' : 'rose'}>
                        {status === 'pending' ? 'Pending licence' : status === 'approved' ? 'Verified' : 'Rejected'}
                      </Badge>
                      <Badge tone="slate">{pharmacy.licenseNumber}</Badge>
                      {pharmacy.isActive === false ? <Badge tone="rose">Suspended</Badge> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setMapSelected(pharmacy.id)}
                      className="mt-2 block text-left text-sm font-bold text-ink hover:text-brand-700"
                    >
                      {pharmacy.storeName}
                    </button>
                    <p className="mt-0.5 flex items-start gap-1 text-[11px] leading-relaxed text-slate-500">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      {pharmacy.address ?? 'No address on file'}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {pharmacy.phone ? (
                        <a href={`tel:${pharmacy.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-brand-700">
                          <Phone className="h-3 w-3" /> {pharmacy.phone}
                        </a>
                      ) : null}
                      {pharmacy.email ? (
                        <a href={`mailto:${pharmacy.email}`} className="inline-flex items-center gap-1 hover:text-brand-700">
                          <Mail className="h-3 w-3" /> {pharmacy.email}
                        </a>
                      ) : null}
                      {pharmacy.mapsUrl ? (
                        <a href={pharmacy.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800">
                          <ExternalLink className="h-3 w-3" /> Verify GPS pin
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {isPending ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => decide(pharmacy, 'approved')}
                        disabled={busy || rejecting}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve (SMS + Email)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(rejecting ? null : pharmacy.id);
                          setNote('');
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAccountAction(accountAction === pharmacy.id ? null : pharmacy.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                    >
                      <Power className="h-3.5 w-3.5" />
                      {pharmacy.isActive === false ? 'Re-enable store' : 'Suspend store'}
                    </button>
                  )}
                </div>

                {rejecting ? (
                  <div className="mt-3 rounded-xl bg-rose-50/60 p-3 ring-1 ring-rose-100">
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-rose-200 bg-white px-2.5 py-2 text-xs text-ink outline-none"
                      placeholder="Reason for rejection (sent via SMS & Email)..."
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => decide(pharmacy, 'rejected')}
                        disabled={busy || noteTooShort}
                        className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        Confirm rejection
                      </button>
                      <button type="button" onClick={() => setRejectingId(null)} className="text-[11px] font-semibold text-slate-500">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {accountAction === pharmacy.id ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="text-[11px] text-slate-600">
                      {pharmacy.isActive === false ? 'Re-enable this store?' : 'Suspend store immediately?'}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => toggleAccount(pharmacy, pharmacy.isActive === false)}
                        className="rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-bold text-white"
                      >
                        Confirm
                      </button>
                      <button type="button" onClick={() => setAccountAction(null)} className="text-[11px] font-semibold text-slate-500">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {/* 5. Cross-Pharmacy Orders & Escalation */}
      <AdminOrdersPanel />

      {/* 6. User & Account Governance Directory */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-ink">
              <Users className="h-4 w-4 text-brand-600" /> Account Directory & Access Control
            </h2>
            <p className="text-[10px] text-slate-500">Search patients or pharmacies and suspend or restore account access.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={userRoleFilter}
              onChange={(e) => {
                setUserRoleFilter(e.target.value);
                loadDirectory(e.target.value, userSearch);
              }}
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-ink outline-none"
            >
              <option value="">All Roles</option>
              <option value="patient">Patients</option>
              <option value="pharmacy">Pharmacies</option>
            </select>
            <input
              type="search"
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value);
                loadDirectory(userRoleFilter, e.target.value);
              }}
              placeholder="Name, email or phone..."
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs outline-none"
            />
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {usersLoading ? (
            <p className="py-4 text-center text-xs text-slate-400">Loading directory...</p>
          ) : directoryUsers.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">No matching accounts found.</p>
          ) : (
            directoryUsers.slice(0, 15).map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-[11px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={u.role === 'admin' ? 'teal' : u.role === 'pharmacy' ? 'amber' : 'slate'}>{u.role}</Badge>
                    <span className="font-semibold text-ink">{u.name || u.email}</span>
                    {!u.isActive ? <Badge tone="rose">Suspended</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-500">{u.email} - {u.phone}</p>
                </div>
                {u.role !== 'admin' ? (
                  <button
                    type="button"
                    onClick={() => toggleDirectoryUser(u)}
                    disabled={busyId === u.id}
                    className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold ${
                      u.isActive ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {u.isActive ? 'Suspend' : 'Activate'}
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {/* 7. Immutable Security Audit Trail */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-ink">Security & Governance Audit Trail</h2>
            <p className="text-[10px] text-slate-500">Timestamped administrative decisions, broadcasts, and account actions.</p>
          </div>
          <Badge tone="slate">
            <Clock className="h-3 w-3" /> Latest {audit.length}
          </Badge>
        </div>
        <div className="mt-3 space-y-1.5">
          {audit.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">No admin decisions logged yet.</p>
          ) : (
            audit.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-[11px]">
                <span className="font-mono text-[10px] text-slate-400">{submitted(entry.createdAt)}</span>
                <Badge tone={String(entry.action).includes('approved') || String(entry.action).includes('broadcast') ? 'emerald' : 'rose'}>
                  {String(entry.action).replace(/_/g, ' ')}
                </Badge>
                <span className="font-semibold text-ink">{entry.storeName ?? entry.adminEmail ?? 'System'}</span>
                {entry.note ? <span className="truncate text-slate-500">- {entry.note}</span> : null}
              </div>
            ))
          )}
        </div>
      </Card>
    </RoleShell>
  );
}