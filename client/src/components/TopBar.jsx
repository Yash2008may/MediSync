import { Menu, MessageSquareText, Timer } from 'lucide-react';
import NotificationBell from './NotificationBell.jsx';

export default function TopBar({ title, now, inboxCount, user, onOpenInbox, onTestFiveMin, onMenu }) {
  const clock = new Date(now).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={onMenu}
          className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold tracking-tight text-ink sm:text-xl">{title}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wide text-slate-500">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
            </span>
            {clock}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onOpenInbox} className="btn-ghost !py-2 !text-xs">
            <MessageSquareText className="h-4 w-4 text-slate-400" />
            <span className="hidden sm:inline">Phone &amp; Email Inbox</span>
            <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 ring-1 ring-brand-100">
              {inboxCount}
            </span>
          </button>

          <button
            type="button"
            onClick={onTestFiveMin}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 transition hover:bg-brand-100"
          >
            <Timer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Test 5-Min Alert</span> (10s)
          </button>

          <NotificationBell className="hidden sm:inline-flex" />

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
              {initials}
            </span>
            <div className="hidden leading-tight md:block">
              <p className="text-xs font-semibold text-ink">{user.name}</p>
              <p className="text-[10px] text-slate-500">{user.phone}</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
