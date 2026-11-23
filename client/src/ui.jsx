import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export function Card({ className = '', children }) {
  return <section className={`card ${className}`}>{children}</section>;
}

const TONES = {
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  teal: 'bg-brand-50 text-brand-700 ring-brand-100',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  rose: 'bg-rose-50 text-rose-600 ring-rose-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  sky: 'bg-sky-50 text-sky-700 ring-sky-100',
  dark: 'bg-white/10 text-white ring-white/15',
};

export function Badge({ tone = 'slate', className = '', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ring-1 ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function IconBadge({ tone = 'teal', children, className = '' }) {
  return (
    <span
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const BAR_TONES = {
  ok: 'bg-emerald-500',
  low: 'bg-amber-400',
  empty: 'bg-rose-500',
};

export function ProgressBar({ value, level = 'ok', className = '' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${BAR_TONES[level]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SectionHeading({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-bold text-ink">{title}</h2>
        {subtitle ? <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Modal({ open, title, subtitle, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default bg-ink/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        } max-h-[92vh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl scroll-slim`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-ink">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-slate-200 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

const TOAST_STYLES = {
  success: { tone: 'emerald', Icon: CheckCircle2 },
  teal: { tone: 'teal', Icon: BellIcon },
  warning: { tone: 'amber', Icon: AlertTriangle },
  info: { tone: 'sky', Icon: Info },
  error: { tone: 'rose', Icon: AlertTriangle },
};

function BellIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ToastHost({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(id);
  }, [toast, onClose]);

  if (!toast) return null;
  const { tone, Icon } = TOAST_STYLES[toast.tone] ?? TOAST_STYLES.success;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] w-[min(92vw,380px)]">
      <div className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${TONES[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{toast.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{toast.text}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
