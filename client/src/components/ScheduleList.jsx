import { useEffect, useState } from 'react';
import { Check, Clock3, Globe, HeartHandshake, Pill, Save, Trash2, Volume2 } from 'lucide-react';
import { Badge } from '../ui.jsx';
import { apiUrl, hasSession } from '../api.js';

const LANG_OPTIONS = [
  { id: 'en', label: 'English', bcp47: 'en-IN' },
  { id: 'kn', label: 'ಕನ್ನಡ (Kannada)', bcp47: 'kn-IN' },
  { id: 'hi', label: 'हिन्दी (Hindi)', bcp47: 'hi-IN' },
];

export function translateDosageToKannada(dosage) {
  const d = String(dosage || '').toLowerCase();
  if (!d) return 'ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
  if (d.includes('before breakfast') || d.includes('before food') || d.includes('before meal') || d.includes('empty stomach')) {
    return 'ಊಟಕ್ಕೆ ಮುಂಚೆ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
  }
  if (d.includes('after breakfast') || d.includes('after lunch') || d.includes('after dinner') || d.includes('after meal') || d.includes('after food')) {
    return 'ಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
  }
  if (d.includes('night') || d.includes('bedtime')) {
    return 'ರಾತ್ರಿ ಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
  }
  if (d.includes('morning')) {
    return 'ಬೆಳಿಗ್ಗೆ ಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
  }
  if (d.includes('2 tablet') || d.includes('two tablet')) {
    return 'ಊಟದ ನಂತರ ಎರಡು ಮಾತ್ರೆಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳಿ';
  }
  return 'ಊಟದ ನಂತರ ಒಂದು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಿ';
}

export function speakLocalizedDose(dose, lang = 'kn') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const langObj = LANG_OPTIONS.find((l) => l.id === lang) ?? LANG_OPTIONS[0];
  let text = `Time ${dose.time}. Take ${dose.name} ${dose.strength || ''}. ${dose.dosage || ''}.`;

  if (lang === 'kn') {
    const knInstruction = translateDosageToKannada(dose.dosage);
    text = `ಸಮಯ ${dose.time}. ${dose.name} ${dose.strength || ''} ಮಾತ್ರೆ. ${knInstruction}.`;
  } else if (lang === 'hi') {
    text = `समय ${dose.time}. कृपया ${dose.name} ${dose.strength || ''} दवा लें. ${dose.dosage || 'भोजन के बाद एक गोली लें'}.`;
  }

  const utter = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const matchedVoice =
    voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ||
    voices.find((v) => v.lang.toLowerCase().includes('in'));
  if (matchedVoice) utter.voice = matchedVoice;
  utter.lang = langObj.bcp47;
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

export default function ScheduleList({ doses, medicines, onTaken, onReorder, onCancel, compact = false }) {
  const sorted = doses.slice().sort((a, b) => a.time.localeCompare(b.time));
  const [care, setCare] = useState({ caregiverName: '', caregiverPhone: '', caregiverEmail: '', preferredLang: 'kn' });
  const [careOpen, setCareOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    window.localStorage.setItem('medisync.preferredLang', care.preferredLang);
  }, [care.preferredLang]);

  useEffect(() => {
    if (!hasSession()) return;
    fetch(apiUrl('/api/notifications/care-settings'), { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setCare((prev) => ({ ...prev, ...data }));
          if (data.preferredLang) {
            window.localStorage.setItem('medisync.preferredLang', data.preferredLang);
          }
        }
      })
      .catch(() => {});
  }, []);

  const saveSettings = async (nextCare) => {
    setSaving(true);
    setSavedBanner(false);
    window.localStorage.setItem('medisync.preferredLang', nextCare.preferredLang);
    try {
      if (hasSession()) {
        await fetch(apiUrl('/api/notifications/care-settings'), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextCare),
        });
      }
      setSavedBanner(true);
      setTimeout(() => setSavedBanner(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {!compact ? (
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600">
                <Globe className="h-3.5 w-3.5 text-brand-600" /> Voice & SMS Language:
              </span>
              <select
                value={care.preferredLang}
                onChange={(e) => {
                  const next = { ...care, preferredLang: e.target.value };
                  setCare(next);
                  saveSettings(next);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-ink outline-none"
              >
                {LANG_OPTIONS.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setCareOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
            >
              <HeartHandshake className="h-3.5 w-3.5" />
              {care.caregiverPhone || care.caregiverEmail
                ? `Caregiver: ${care.caregiverName || care.caregiverPhone}`
                : 'Set Caregiver Escalation'}
            </button>
          </div>

          {careOpen ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-[11px] text-slate-600">
                If a scheduled dose is not marked <strong>Taken</strong> within <strong>30 minutes</strong>, MediSync automatically sends an SMS & Email escalation alert to your family caregiver.
              </p>
              <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={care.caregiverName}
                  onChange={(e) => setCare((p) => ({ ...p, caregiverName: e.target.value }))}
                  placeholder="Caregiver name (e.g. Amma)"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none"
                />
                <input
                  type="tel"
                  value={care.caregiverPhone}
                  onChange={(e) => setCare((p) => ({ ...p, caregiverPhone: e.target.value }))}
                  placeholder="Mobile (10 digits)"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none"
                />
                <input
                  type="email"
                  value={care.caregiverEmail}
                  onChange={(e) => setCare((p) => ({ ...p, caregiverEmail: e.target.value }))}
                  placeholder="Caregiver email"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none"
                />
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveSettings(care)}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-brand-700"
                >
                  <Save className="h-3.5 w-3.5" /> Save Caregiver Safety Net
                </button>
                {savedBanner ? <span className="text-[11px] font-semibold text-emerald-600">Saved!</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y divide-slate-100">
        {sorted.map((dose) => {
          const med = medicines.find((m) => m.id === dose.medicineId);
          const empty = !med || med.pills <= 0;
          const knPreview = care.preferredLang === 'kn' ? translateDosageToKannada(dose.dosage) : null;
          return (
            <li
              key={dose.id}
              className={`flex flex-wrap items-center gap-3 px-4 transition hover:bg-slate-50/70 sm:px-5 ${
                compact ? 'py-3.5' : 'py-4'
              }`}
            >
              <div className="flex w-16 shrink-0 flex-col items-start gap-1 rounded-lg bg-slate-50 px-2 py-1.5">
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <Clock3 className="h-3 w-3" />
                  Dose
                </span>
                <span className="font-mono text-[13px] font-bold text-ink">{dose.time}</span>
              </div>

              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${
                  dose.taken
                    ? 'bg-emerald-50 text-emerald-600 ring-emerald-100'
                    : empty
                      ? 'bg-rose-50 text-rose-500 ring-rose-100'
                      : 'bg-brand-50 text-brand-700 ring-brand-100'
                }`}
              >
                <Pill className="h-4 w-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-ink">
                    {dose.name} <span className="font-medium text-slate-500">{dose.strength}</span>
                  </p>
                  {empty && !dose.taken ? <Badge tone="rose">Out of stock</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-xs capitalize text-slate-500">
                  {dose.dosage}
                  {knPreview ? <span className="ml-1.5 font-medium text-brand-700">· {knPreview}</span> : null}
                </p>
              </div>

              <button
                type="button"
                onClick={() => speakLocalizedDose(dose, care.preferredLang)}
                title="Read dose instructions aloud"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Volume2 className="h-3.5 w-3.5 text-brand-600" />
                <span className="hidden sm:inline">{care.preferredLang === 'kn' ? 'ಕೇಳಿ (Speak)' : 'Speak'}</span>
              </button>

              {dose.taken ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                  <Check className="h-3.5 w-3.5" />
                  Taken
                </span>
              ) : empty ? (
                <button
                  type="button"
                  onClick={() => onReorder(med)}
                  className="btn bg-rose-50 px-3 py-2 text-xs text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100"
                >
                  Reorder Now
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onTaken(dose.id)}
                  className="btn bg-brand-50 px-3 py-2 text-xs text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100"
                >
                  Mark as Taken
                </button>
              )}

              {onCancel ? (
                <button
                  type="button"
                  onClick={() => onCancel(dose.id)}
                  title="Cancel this scheduled medicine"
                  className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50/70 px-2.5 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Cancel</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}