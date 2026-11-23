import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Cpu,
  KeyRound,
  Pill,
  Plus,
  Truck,
  Volume2,
  Zap,
} from 'lucide-react';
import ScheduleList from '../components/ScheduleList.jsx';
import StockList from '../components/StockList.jsx';
import DeliveryTracking from '../components/DeliveryTracking.jsx';
import { Badge, Card, IconBadge, SectionHeading } from '../ui.jsx';
import { inr, refillPrice } from '../usePortal.js';

function AutomationBanner({ derived, settings, onGateways, onToggleSound, onTestAuto }) {
  return (
    <Card className="!border-transparent bg-ink text-white shadow-xl shadow-slate-900/10">
      <div className="flex flex-wrap items-center justify-between gap-5 p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600">
              <Cpu className="h-4 w-4" />
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-100 ring-1 ring-white/15">
              Automated server-to-patient dispatch active
            </span>
          </div>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">Next auto-dispatch in</p>
          <p className="mt-0.5 font-mono text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            {derived.dispatchCountdown}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Upcoming: <span className="font-medium text-slate-200">{derived.nextDose?.name} {derived.nextDose?.strength}</span>{' '}
            at {derived.nextDose?.time} → SMS + Email
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGateways}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Gateway API Keys
          </button>
          <button
            type="button"
            onClick={onToggleSound}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
              settings.sound
                ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                : 'border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'
            }`}
          >
            <Volume2 className="h-3.5 w-3.5" />
            {settings.sound ? 'Push & Sound On' : 'Enable Push & Sound'}
          </button>
          <button
            type="button"
            onClick={onTestAuto}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-500"
          >
            <Zap className="h-3.5 w-3.5" />
            Test Auto-Dispatch (10s)
          </button>
        </div>
      </div>
    </Card>
  );
}

function StockAlertBanner({ medicine, onReorder }) {
  if (!medicine) return null;
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-rose-600 ring-1 ring-rose-200">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <span className="inline-flex rounded-full bg-rose-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white">
              Stock empty · reorder available
            </span>
            <p className="mt-1.5 text-sm font-bold text-rose-900 sm:text-base">
              {medicine.name} {medicine.strength} — <span className="text-rose-600">0 pills remaining!</span>
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-rose-700/80">
              <span>
                MRP <span className="line-through">{inr(37.3)}</span>
              </span>
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">
                18% OFF
              </span>
              <span>
                3-pack refill <span className="font-bold text-rose-800">{inr(30.59)}</span>
              </span>
              <span className="text-rose-400">·</span>
              <span>{inr(refillPrice(medicine))} per strip</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onReorder(medicine)}
          className="btn shrink-0 bg-rose-600 px-4 py-2.5 text-xs text-white shadow-lg shadow-rose-600/20 hover:bg-rose-700"
        >
          Reorder &amp; Discuss Price
        </button>
      </div>
    </div>
  );
}

function KpiCard({ label, value, hint, icon, tone, valueClass = 'text-ink' }) {
  return (
    <Card className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={`mt-1 text-3xl font-bold leading-none tracking-tight ${valueClass}`}>{value}</p>
        <p className="mt-1.5 truncate text-[11px] text-slate-500">{hint}</p>
      </div>
      <IconBadge tone={tone}>{icon}</IconBadge>
    </Card>
  );
}

export default function Overview({
  state,
  derived,
  actions,
  onNavigate,
  onOpenGateways,
  onAddMedicine,
  onOpenInbox,
}) {
  const emptyMedicine = derived.emptyMeds[0] ?? state.medicines[0];
  const alerts = derived.emptyMeds.length + derived.lowMeds.length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <AutomationBanner
        derived={derived}
        settings={state.settings}
        onGateways={onOpenGateways}
        onToggleSound={() => actions.toggleSetting('sound')}
        onTestAuto={actions.testAutoDispatch}
      />

      <StockAlertBanner medicine={derived.emptyMeds[0] ?? emptyMedicine} onReorder={actions.startReorder}
            onCancel={actions.removeScheduledDose} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active Prescriptions"
          value={state.medicines.length}
          hint="Synced with schedule"
          tone="teal"
          icon={<Pill className="h-5 w-5" />}
        />
        <KpiCard
          label="Upcoming Doses Today"
          value={derived.pendingDoses.length}
          hint={`${derived.takenDoses.length} taken so far today`}
          tone="sky"
          valueClass="text-ink"
          icon={<Clock3 className="h-5 w-5" />}
        />
        <KpiCard
          label="Stock Alerts"
          value={alerts}
          hint={`${derived.emptyMeds.length} Empty • ${derived.lowMeds.length} Low Stock`}
          tone="rose"
          valueClass="text-rose-600"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <KpiCard
          label="Active Deliveries"
          value={1}
          hint="Pharmacy tracking live"
          tone="emerald"
          icon={<Truck className="h-5 w-5" />}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[1.85fr_1fr]">
        <Card>
          <div className="border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <SectionHeading
              title="Today's Medication Schedule"
              subtitle="Marking a dose as taken deducts one pill and triggers the SMS + email confirmation."
              action={
                <button type="button" onClick={onAddMedicine} className="btn-primary !px-3 !py-2 !text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  Add Medicine
                </button>
              }
            />
          </div>
          <ScheduleList
            doses={state.doses}
            medicines={state.medicines}
            onTaken={actions.markTaken}
            onReorder={actions.startReorder}
            onCancel={actions.removeScheduledDose}
            compact
          />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <div>
              <h2 className="text-sm font-bold text-ink">Medicine Stock &amp; Refill Pricing</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">Discounted refills from your default pharmacy</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('stock')}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-800"
            >
              View All
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-2 pb-2 pt-1">
            <StockList medicines={state.medicines} onReorder={actions.startReorder}
            onCancel={actions.removeScheduledDose} limit={5} />
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 sm:px-5">
            <Badge tone="teal">Generic alternatives available</Badge>
            <button
              type="button"
              onClick={onOpenInbox}
              className="text-[10px] font-semibold text-slate-400 transition hover:text-brand-700"
            >
              Refill alerts in inbox
            </button>
          </div>
        </Card>
      </div>

      <DeliveryTracking delivery={state.delivery} tracking={derived.tracking} />
    </div>
  );
}
