import { KeyRound, Radio, Volume2 } from 'lucide-react';
import { Badge, Modal } from '../ui.jsx';

const GATEWAYS = [
  {
    name: 'SMS · India',
    provider: 'Console provider (dev)',
    detail: 'Live sending needs DLT registration: entity ID, sender ID and approved templates.',
    tone: 'amber',
    status: 'DLT pending',
  },
  {
    name: 'Email · SMTP',
    provider: 'Nodemailer',
    detail: 'Set SMTP_HOST, SMTP_USER and SMTP_PASS in server/.env to deliver real email.',
    tone: 'emerald',
    status: 'Configured',
  },
  {
    name: 'Payments',
    provider: 'Razorpay (UPI · card · netbanking) + COD',
    detail: 'Checkout in this build is simulated. Add live keys on the server before charging patients.',
    tone: 'amber',
    status: 'Sandbox',
  },
  {
    name: 'Push notifications',
    provider: 'Browser push + sound',
    detail: 'Toggle it in the automation banner to allow in-browser reminders.',
    tone: 'sky',
    status: 'Optional',
  },
];

export default function GatewaysModal({ open, onClose, settings, onToggleSetting }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Gateway API keys"
      subtitle="Where each reminder and payment leaves the app."
    >
      <div className="space-y-2.5">
        {GATEWAYS.map((gateway) => (
          <div key={gateway.name} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200">
              <Radio className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-ink">{gateway.name}</p>
                <Badge tone={gateway.tone}>{gateway.status}</Badge>
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-slate-500">{gateway.provider}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{gateway.detail}</p>
            </div>
          </div>
        ))}

        <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
          <p className="flex items-center gap-1.5 font-semibold text-slate-600">
            <KeyRound className="h-3.5 w-3.5" />
            Keys stay on the server
          </p>
          <p className="mt-1">
            Google Maps, SMS, SMTP and payment secrets belong in <code className="rounded bg-white px-1">server/.env</code>,
            never in the browser bundle. Google browser keys should be restricted by HTTP referrer.
          </p>
        </div>

        <button type="button" onClick={() => onToggleSetting('sound')} className="btn-ghost w-full justify-between">
          <span className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-slate-400" />
            Push &amp; sound alerts
          </span>
          <span className={`text-xs font-semibold ${settings.sound ? 'text-emerald-600' : 'text-slate-400'}`}>
            {settings.sound ? 'On' : 'Off'}
          </span>
        </button>
      </div>
    </Modal>
  );
}
