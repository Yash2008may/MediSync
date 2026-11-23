import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Pill, Plus, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui.jsx';

const EMPTY = {
  name: '',
  strength: '',
  dosage: '1 tablet after breakfast',
  time: '09:00',
  pills: '30',
  mrp: '60',
  discountPct: '10',
};

const INGREDIENT_GROUPS = [
  { group: 'Paracetamol / Acetaminophen', aliases: ['paracetamol', 'acetaminophen', 'dolo', 'crocin', 'calpol', 'pacimol'] },
  { group: 'NSAID / Pain Reliever', aliases: ['ibuprofen', 'diclofenac', 'naproxen', 'aceclofenac', 'aspirin', 'combiflam', 'voveran'] },
  { group: 'Statin (Cholesterol)', aliases: ['atorvastatin', 'rosuvastatin', 'simvastatin', 'lipitor', 'crestor'] },
  { group: 'Antidiabetic', aliases: ['metformin', 'glimepiride', 'sitagliptin', 'glycomet'] },
  { group: 'Antihypertensive', aliases: ['amlodipine', 'telmisartan', 'losartan', 'atenolol', 'metoprolol'] },
  { group: 'Macrolide Antibiotic', aliases: ['azithromycin', 'erythromycin', 'clarithromycin', 'azithral'] },
];

const INTERACTION_RULES = [
  {
    pair: ['NSAID / Pain Reliever', 'NSAID / Pain Reliever'],
    severity: 'Duplicate / GI Bleed Risk',
    note: 'Combining two NSAIDs increases stomach ulcer and kidney strain risk.',
  },
  {
    pair: ['Paracetamol / Acetaminophen', 'Paracetamol / Acetaminophen'],
    severity: 'Duplicate Active Ingredient',
    note: 'Both medicines contain Paracetamol — taking both risks accidental liver overdose.',
  },
  {
    pair: ['Statin (Cholesterol)', 'Macrolide Antibiotic'],
    severity: 'Drug Interaction Warning',
    note: 'Macrolide antibiotics can raise Statin blood levels and increase muscle ache risk.',
  },
  {
    pair: ['NSAID / Pain Reliever', 'Antihypertensive'],
    severity: 'Blood Pressure Interaction',
    note: 'NSAIDs can reduce the blood-pressure lowering effect of antihypertensives.',
  },
];

function classifyMed(name) {
  const lower = String(name || '').toLowerCase();
  return INGREDIENT_GROUPS.find((g) => g.aliases.some((alias) => lower.includes(alias)))?.group ?? null;
}

export default function AddMedicineModal({ open, onClose, onAdd, existingMedicines = [] }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError('');
    }
  }, [open]);

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const clinicalAlerts = useMemo(() => {
    const candidate = form.name.trim();
    if (candidate.length < 3) return [];
    const candidateGroup = classifyMed(candidate);
    const alerts = [];

    const existingList = existingMedicines.length
      ? existingMedicines
      : JSON.parse(window.localStorage.getItem('medisync.portal.v1') || '{}')?.medicines ?? [];

    for (const med of existingList) {
      if (String(med.name).toLowerCase() === candidate.toLowerCase()) {
        alerts.push({
          severity: 'Duplicate Medication',
          note: `${med.name} is already on your daily schedule at ${med.time}.`,
        });
        continue;
      }
      const existingGroup = classifyMed(med.name);
      if (!candidateGroup || !existingGroup) continue;

      const matched = INTERACTION_RULES.find(
        (r) =>
          (r.pair[0] === candidateGroup && r.pair[1] === existingGroup) ||
          (r.pair[1] === candidateGroup && r.pair[0] === existingGroup)
      );
      if (matched) {
        alerts.push({
          severity: `${matched.severity} (${candidate} + ${med.name})`,
          note: matched.note,
        });
      }
    }
    return alerts;
  }, [form.name, existingMedicines]);

  const submit = (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.strength.trim()) {
      setError('Medicine name and strength are required.');
      return;
    }
    if (!(Number(form.pills) > 0) || !(Number(form.mrp) > 0)) {
      setError('Enter a pill count and MRP greater than zero.');
      return;
    }
    onAdd({
      name: form.name.trim(),
      strength: form.strength.trim(),
      dosage: form.dosage.trim(),
      time: form.time,
      pills: Number(form.pills),
      mrp: Number(form.mrp),
      discountPct: Math.max(0, Math.min(90, Number(form.discountPct) || 0)),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add medicine"
      subtitle="Includes automatic duplicate-therapy & drug interaction screening."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="med-name" className="label">Medicine name</label>
            <input id="med-name" value={form.name} onChange={update('name')} className="field" placeholder="e.g. Dolo 650 or Atorvastatin" />
          </div>
          <div>
            <label htmlFor="med-strength" className="label">Strength</label>
            <input id="med-strength" value={form.strength} onChange={update('strength')} className="field" placeholder="20mg" />
          </div>
        </div>

        {clinicalAlerts.length > 0 ? (
          <div className="space-y-1.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
            {clinicalAlerts.map((alert, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-bold text-amber-950">{alert.severity}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">{alert.note}</p>
                </div>
              </div>
            ))}
          </div>
        ) : form.name.trim().length >= 3 ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            No duplicate therapy or major drug interactions detected with your active schedule.
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="med-time" className="label">Daily dose time</label>
            <input id="med-time" type="time" value={form.time} onChange={update('time')} className="field" />
          </div>
          <div>
            <label htmlFor="med-pills" className="label">Pills in stock</label>
            <input id="med-pills" type="number" min="1" max="300" value={form.pills} onChange={update('pills')} className="field" />
          </div>
        </div>

        <div>
          <label htmlFor="med-dosage" className="label">Dosage instruction</label>
          <input id="med-dosage" value={form.dosage} onChange={update('dosage')} className="field" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="med-mrp" className="label">MRP per strip (₹)</label>
            <input id="med-mrp" type="number" min="1" step="0.5" value={form.mrp} onChange={update('mrp')} className="field" />
          </div>
          <div>
            <label htmlFor="med-discount" className="label">Discount (%)</label>
            <input id="med-discount" type="number" min="0" max="90" value={form.discountPct} onChange={update('discountPct')} className="field" />
          </div>
        </div>

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 ring-1 ring-rose-100">{error}</p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-slate-400">
            <Pill className="h-3 w-3" /> Auto-synced to 5-min pre-dose SMS & Email scheduler.
          </p>
          <button type="submit" className="btn-primary">
            <Plus className="h-4 w-4" /> Add medicine
          </button>
        </div>
      </form>
    </Modal>
  );
}