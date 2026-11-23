import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Modal } from '../ui.jsx';

// Role-aware profile editor. Login identity (email, drug licence, verified store
// coordinates) is managed elsewhere and only shown here as read-only context.
export default function ProfileModal({ open, onClose, user, onSave }) {
  const profile = user?.profile ?? {};
  const role = user?.role ?? 'patient';
  const isPatient = role === 'patient';
  const isPharmacy = role === 'pharmacy';

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName((isPatient ? profile.name : isPharmacy ? profile.storeName : '') ?? '');
    setAddress(profile.address ?? '');
    setPhone(user?.phone ?? '');
    setError(null);
  }, [open, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const payload = { phone: phone.trim() };
    if (isPatient) payload.name = name.trim();
    if (isPatient || isPharmacy) payload.address = address.trim();
    if (isPharmacy) payload.storeName = name.trim();

    setBusy(true);
    setError(null);
    const result = await onSave(payload);
    setBusy(false);
    if (result?.ok) onClose();
    else setError(result?.error ?? 'Could not save your profile.');
  };

  const field =
    'mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-ink outline-none focus:border-brand-500';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit profile"
      subtitle="Changes are saved to your MediSync account."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {error ? <p className="text-[11px] font-medium text-rose-600">{error}</p> : <span />}
          <button type="button" onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500 ring-1 ring-slate-200">
          Signed in as <span className="font-semibold text-ink">{user?.email ?? '—'}</span>
          {isPharmacy ? ' · drug licence is verified by an admin and cannot be edited here.' : ''}
        </div>

        {isPatient || isPharmacy ? (
          <div>
            <label htmlFor="profile-name" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {isPharmacy ? 'Store name' : 'Full name'}
            </label>
            <input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} className={field} />
          </div>
        ) : null}

        {isPatient || isPharmacy ? (
          <div>
            <label htmlFor="profile-address" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {isPharmacy ? 'Store address' : 'Home address'}
            </label>
            <textarea
              id="profile-address"
              rows={2}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className={`${field} h-auto resize-none py-2`}
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="profile-phone" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Mobile number
          </label>
          <input
            id="profile-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            placeholder="10-digit mobile"
            className={field}
          />
          <p className="mt-1 text-[10px] text-slate-400">Used for OTP password recovery and order updates.</p>
        </div>
      </div>
    </Modal>
  );
}
