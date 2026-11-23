import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCheck, Loader2 } from 'lucide-react';
import { Modal } from '../ui.jsx';
import { hasSession } from '../api.js';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '../notifications.js';

const when = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

// Order notifications for any role: the pharmacy hears about new orders, the patient hears
// about acceptance, rejection and delivery. In-app rows are always written; email is sent
// when SMTP is configured on the server.
export default function NotificationBell({ tone = 'light', className = '' }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!hasSession()) return;
    setLoading(true);
    try {
      const data = await fetchNotifications();
      setItems(data.notifications);
      setUnread(data.unread);
      setError(null);
    } catch (error_) {
      setError(error_.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // A slow refresh keeps the badge current without hammering the API.
    const id = window.setInterval(load, 120000);
    return () => window.clearInterval(id);
  }, [load]);

  const openPanel = () => {
    setOpen(true);
    load();
  };

  const readAll = async () => {
    setItems((prev) => prev.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await markAllNotificationsRead().catch(() => {});
  };

  const readOne = async (id) => {
    const target = items.find((item) => item.id === id);
    if (!target || target.readAt) return;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)));
    setUnread((value) => Math.max(0, value - 1));
    await markNotificationRead(id).catch(() => {});
  };

  const buttonClass =
    tone === 'dark'
      ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50';

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className={`relative inline-flex items-center justify-center rounded-xl border p-2 transition ${buttonClass} ${className}`}
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        subtitle="Order updates for your account."
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">{unread ? `${unread} unread` : 'All caught up'}</span>
            <button
              type="button"
              onClick={readAll}
              disabled={!items.length || unread === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>
        }
      >
        {loading && !items.length ? (
          <p className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </p>
        ) : error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] text-rose-700 ring-1 ring-rose-200">{error}</p>
        ) : !items.length ? (
          <div className="py-8 text-center">
            <BellOff className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-2 text-xs text-slate-500">Nothing yet. Order updates will appear here.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => readOne(item.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    item.readAt ? 'border-slate-100 bg-white' : 'border-brand-100 bg-brand-50/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-ink">{item.title}</p>
                    {!item.readAt ? <span className="h-1.5 w-1.5 rounded-full bg-brand-600" /> : null}
                    <span className="ml-auto text-[10px] text-slate-400">{when(item.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{item.body}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
