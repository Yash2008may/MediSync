import { useState } from 'react';
import { LogOut, Pill, UserRound } from 'lucide-react';
import ProfileModal from './ProfileModal.jsx';
import NotificationBell from './NotificationBell.jsx';

export default function RoleShell({ roleLabel, title, subtitle, user, onSignOut, onSaveProfile, children }) {
  const name = user?.profile?.storeName ?? user?.profile?.name ?? user?.email ?? 'Signed in';
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-3 py-3 sm:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Pill className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight text-ink">MediSync</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-700">{roleLabel}</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-[220px] truncate text-xs font-semibold text-ink">{name}</p>
              {user?.email ? <p className="max-w-[220px] truncate text-[10px] text-slate-500">{user.email}</p> : null}
            </div>
            <NotificationBell />
            {onSaveProfile && user ? (
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-ink"
              >
                <UserRound className="h-3.5 w-3.5" />
                Edit profile
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-ink"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-3 py-5 sm:px-6">
        <h1 className="text-lg font-bold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">{subtitle}</p> : null}
        <div className="mt-4 space-y-4">{children}</div>
      </main>

      {onSaveProfile ? (
        <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} user={user} onSave={onSaveProfile} />
      ) : null}
    </div>
  );
}
