import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  HeartHandshake,
  Mail,
  MessageSquareText,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Volume2,
} from 'lucide-react';
import { Badge, Card, SectionHeading } from '../ui.jsx';
import { apiUrl, hasSession } from '../api.js';

const FILTERS = ['All', 'SMS', 'Email'];

const formatTime = (iso) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function ChannelIcon({ channel }) {
  if (channel === 'Email') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
        <Mail className="h-4 w-4" />
      </span>
    );
  }
  if (channel === 'SMS') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
        <Smartphone className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-100">
      <Send className="h-4 w-4" />
    </span>
  );
}

export default function InboxPage({ state, actions }) {
  const [filter, setFilter] = useState('All');
  const [onlyUnread, setOnlyUnread] = useState(false);

  const [care, setCare] = useState({
    caregiverName: '',
    caregiverPhone: '',
    caregiverEmail: '',
    preferredLang: window.localStorage.getItem('medisync.preferredLang') || 'kn',
  });
  const [savingCare, setSavingCare] = useState(false);
  const [testingCare, setTestingCare] = useState(false);
  const [careStatus, setCareStatus] = useState(null);

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

  const handleSaveCare = async (e) => {
    e.preventDefault();
    setSavingCare(true);
    setCareStatus(null);
    window.localStorage.setItem('medisync.preferredLang', care.preferredLang);
    try {
      const res = await fetch(apiUrl('/api/notifications/care-settings'), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(care),
      });
      if (!res.ok) throw new Error('Could not save care settings');
      setCareStatus({ tone: 'ok', text: 'Caregiver escalation & language preferences saved to PostgreSQL.' });
    } catch (err) {
      setCareStatus({ tone: 'err', text: err.message });
    } finally {
      setSavingCare(false);
    }
  };

  const handleTestCaregiver = async () => {
    setTestingCare(true);
    setCareStatus(null);
    try {
      await fetch(apiUrl('/api/notifications/care-settings'), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(care),
      });
      const res = await fetch(apiUrl('/api/notifications/care-settings/test'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'Save a caregiver phone or email first.');
      setCareStatus({
        tone: 'ok',
        text: `Caregiver escalation SMS & Email dispatched to ${data.toPhone || ''} ${data.toEmail || ''}.`,
      });
    } catch (err) {
      setCareStatus({ tone: 'err', text: err.message });
    } finally {
      setTestingCare(false);
    }
  };

  const messages = useMemo(() => {
    return state.messages.filter((message) => {
      if (filter !== 'All' && !message.channel.includes(filter)) return false;
      if (onlyUnread && message.status === 'delivered') return false;
      return true;
    });
  }, [state.messages, filter, onlyUnread]);

  const smsCount = state.messages.filter((m) => m.channel.includes('SMS')).length;
  const emailCount = state.messages.filter((m) => m.channel.includes('Email')).length;
  const queued = state.messages.filter((m) => m.status === 'simulated').length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card className="p-4 sm:p-5">
        <SectionHeading
          title="Live SMS & Email Hub"
          subtitle="Real-time SMS via Traccar Gateway, Kannada/English Email via Gmail SMTP, and 5-minute pre-dose automation."
          action={
            <button type="button" onClick={actions.testFiveMinuteAlert} className="btn-primary !px-3 !py-2 !text-xs">
              <BellRing className="h-3.5 w-3.5" />
              Send test reminder (10s)
            </button>
          }
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">SMS</p>
              <Smartphone className="h-3.5 w-3.5 text-brand-600" />
            </div>
            <p className="mt-1 text-2xl font-bold text-ink">{smsCount}</p>
            <p className="text-[11px] text-slate-500">to {state.user.phone}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email</p>
              <Mail className="h-3.5 w-3.5 text-sky-500" />
            </div>
            <p className="mt-1 text-2xl font-bold text-ink">{emailCount}</p>
            <p className="truncate text-[11px] text-slate-500">{state.user.email}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Push &amp; sound</p>
              <Volume2 className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <p className="mt-1 text-2xl font-bold text-ink">{state.settings.sound ? 'On' : 'Off'}</p>
            <button
              type="button"
              onClick={() => actions.toggleSetting('sound')}
              className="text-[11px] font-semibold text-brand-700 transition hover:text-brand-800"
            >
              {state.settings.sound ? 'Turn off alerts' : 'Enable alerts'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-emerald-50 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-900 ring-1 ring-emerald-200">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <p>
            <span className="font-semibold">Live Gateways Connected:</span> Gmail SMTP (UTF-8 Kannada/English/Hindi) and
            Android Traccar SMS Gateway are active for automated 5-minute pre-dose alerts and 30-minute caregiver escalations.
          </p>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
            <HeartHandshake className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-ink">Caregiver Escalation Safety Net &amp; Alert Language</h3>
            <p className="text-[11px] text-slate-500">
              If a scheduled dose is not marked Taken within 30 minutes, MediSync automatically alerts your family caregiver via SMS &amp; Email.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveCare} className="mt-4 grid gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600">Caregiver Name</label>
            <input
              type="text"
              placeholder="e.g., Amma / Family"
              value={care.caregiverName}
              onChange={(e) => setCare({ ...care, caregiverName: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-ink focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600">Caregiver Phone (10-digit)</label>
            <input
              type="tel"
              placeholder="9876543210"
              value={care.caregiverPhone}
              onChange={(e) => setCare({ ...care, caregiverPhone: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-ink focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600">Caregiver Email</label>
            <input
              type="email"
              placeholder="caregiver@gmail.com"
              value={care.caregiverEmail}
              onChange={(e) => setCare({ ...care, caregiverEmail: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-ink focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600">Alert &amp; Voice Language</label>
            <select
              value={care.preferredLang}
              onChange={(e) => setCare({ ...care, preferredLang: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-ink focus:border-brand-500 focus:outline-none"
            >
              <option value="kn">ಕನ್ನಡ (Kannada + Kanglish SMS)</option>
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
            <button type="submit" disabled={savingCare} className="btn-primary !px-3.5 !py-2 !text-xs">
              <Save className="h-3.5 w-3.5" />
              {savingCare ? 'Saving...' : 'Save Caregiver Settings'}
            </button>
            <button
              type="button"
              disabled={testingCare}
              onClick={handleTestCaregiver}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              <BellRing className="mr-1.5 inline h-3.5 w-3.5" />
              {testingCare ? 'Sending...' : 'Test Caregiver Escalation Now'}
            </button>
            {careStatus ? (
              <span className={`text-xs font-medium ${careStatus.tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
                {careStatus.text}
              </span>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  filter === option ? 'bg-ink text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {option}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <button
              type="button"
              onClick={() => setOnlyUnread((value) => !value)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                onlyUnread ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Simulated only
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            {messages.length} message{messages.length === 1 ? '' : 's'} · {queued} simulated
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {messages.map((message) => (
            <li key={message.id} className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-slate-50/70 sm:px-5">
              <ChannelIcon channel={message.channel} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-xs font-semibold text-ink">{message.subject}</p>
                  <Badge tone={message.channel === 'Email' ? 'sky' : message.channel === 'SMS' ? 'teal' : 'amber'}>
                    {message.channel}
                  </Badge>
                  {message.status === 'simulated' ? <Badge tone="amber">Simulated</Badge> : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{message.body}</p>
                <p className="mt-1 truncate text-[10px] text-slate-400">
                  To {message.to} · {formatTime(message.at)}
                </p>
              </div>
              <CheckCircle2
                className={`mt-1 h-4 w-4 shrink-0 ${
                  message.status === 'delivered' ? 'text-emerald-500' : 'text-slate-300'
                }`}
              />
            </li>
          ))}
        </ul>

        {messages.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MessageSquareText className="mx-auto h-6 w-6 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-600">No messages in this filter.</p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}