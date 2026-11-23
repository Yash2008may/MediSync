import {
  CalendarClock,
  LayoutDashboard,
  Mail,
  MapPin,
  PackageSearch,
  Pill,
  RotateCcw,
  LogOut,
  X,
  ChevronRight,
  UserRound,
} from 'lucide-react';

const itemClass = (active) =>
  `group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
    active
      ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20'
      : 'text-slate-300 hover:bg-white/5 hover:text-white'
  }`;

const badgeClass = (active, tone) => {
  if (active) return 'bg-white/20 text-white';
  if (tone === 'rose') return 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30';
  if (tone === 'teal') return 'bg-brand-500/15 text-brand-100 ring-1 ring-brand-500/30';
  return 'bg-white/10 text-slate-200';
};

export default function Sidebar({
  active,
  onNavigate,
  counts,
  user,
  onOpenInbox,
  onReset,
  onSignOut,
  onEditProfile,
  open,
  onClose,
}) {
  const nav = [
    { id: 'overview', label: 'Overview Dashboard', icon: LayoutDashboard },
    { id: 'schedule', label: 'Medication Schedule', icon: CalendarClock, badge: String(counts.doses), tone: 'slate' },
    {
      id: 'stock',
      label: 'Stock, Pricing & Reorder',
      icon: PackageSearch,
      badge: `${counts.empty} Alerts`,
      tone: 'rose',
    },
    {
      id: 'pharmacies',
      label: 'Google Maps Pharmacies',
      icon: MapPin,
      badge: `${counts.activeDeliveries} Active`,
      tone: 'teal',
    },
    { id: 'inbox', label: 'Live SMS & Email Hub', icon: Mail, badge: String(counts.messages), tone: 'slate' },
  ];

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-ink/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col bg-ink px-4 pb-4 pt-5 transition-transform duration-300 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
              <Pill className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[15px] font-bold leading-tight text-white">MediSync</p>
              <p className="text-[11px] font-medium text-slate-400">Patient Care Portal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="mt-7 flex-1 space-y-1.5" aria-label="Portal sections">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Care workspace
          </p>
          {nav.map(({ id, label, icon: Icon, badge, tone }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onNavigate(id);
                  onClose();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={itemClass(isActive)}
              >
                <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-brand-100'}`} />
                <span className="flex-1 leading-snug">{label}</span>
                {badge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${badgeClass(
                      isActive,
                      tone
                    )}`}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <p className="text-[11px] font-semibold text-emerald-300">Live Dispatch Ready</p>
          </div>
          <button
            type="button"
            onClick={onOpenInbox}
            className="mt-2 flex w-full items-center justify-between text-[11px] font-medium text-slate-300 transition hover:text-white"
          >
            Open Inbox
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5 text-[10px] leading-relaxed text-slate-400">
            <p className="truncate" title={user.email}>
              {user.email}
            </p>
            <p className="truncate" title={user.phone}>
              {user.phone}
            </p>
          </div>
        </div>

        {onEditProfile ? (
          <button
            type="button"
            onClick={onEditProfile}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <UserRound className="h-3.5 w-3.5" />
            Edit profile
          </button>
        ) : null}

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Data
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
