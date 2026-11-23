import { useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, Plus, Send } from 'lucide-react';
import ScheduleList from '../components/ScheduleList.jsx';
import { Badge, Card, ProgressBar, SectionHeading } from '../ui.jsx';

const FILTERS = [
  { id: 'all', label: 'All doses' },
  { id: 'pending', label: 'Pending' },
  { id: 'taken', label: 'Taken' },
];

export default function SchedulePage({ state, derived, actions, onAddMedicine, onOpenInbox }) {
  const [filter, setFilter] = useState('all');
  const total = state.doses.length;
  const taken = derived.takenDoses.length;
  const adherence = total ? Math.round((taken / total) * 100) : 0;

  const doses =
    filter === 'pending' ? derived.pendingDoses : filter === 'taken' ? derived.takenDoses : state.doses;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card className="p-4 sm:p-5">
        <SectionHeading
          title="Medication Schedule"
          subtitle="Every dose is deducted from stock when marked as taken, then confirmed by SMS and email."
          action={
            <button type="button" onClick={onAddMedicine} className="btn-primary !px-3 !py-2 !text-xs">
              <Plus className="h-3.5 w-3.5" />
              Add Medicine
            </button>
          }
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <CalendarClock className="h-3.5 w-3.5" /> Today
            </p>
            <p className="mt-1 text-2xl font-bold text-ink">{total}</p>
            <p className="text-[11px] text-slate-500">scheduled doses</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Taken
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{taken}</p>
            <p className="text-[11px] text-emerald-700/70">confirmed by SMS + email</p>
          </div>
          <div className="rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
              <Clock3 className="h-3.5 w-3.5" /> Still due
            </p>
            <p className="mt-1 text-2xl font-bold text-brand-800">{derived.pendingDoses.length}</p>
            <p className="text-[11px] text-brand-800/70">reminders queued</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-600">Today's adherence</span>
            <span className="font-bold text-slate-700">{adherence}%</span>
          </div>
          <ProgressBar value={adherence} level={adherence >= 60 ? 'ok' : 'low'} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  filter === option.id
                    ? 'bg-ink text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onOpenInbox}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 hover:text-brand-800"
          >
            <Send className="h-3.5 w-3.5" />
            Dispatch log
          </button>
        </div>

        {doses.length ? (
          <ScheduleList
            doses={doses}
            medicines={state.medicines}
            onTaken={actions.markTaken}
            onReorder={actions.startReorder}
            onCancel={actions.removeScheduledDose}
          />
        ) : (
          <div className="px-4 py-10 text-center">
            <Badge tone="emerald">All caught up</Badge>
            <p className="mt-2 text-sm font-medium text-slate-600">No doses in this filter.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
