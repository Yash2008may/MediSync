import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  LocateFixed,
  Lock,
  Mail,
  MapPin,
  Pill,
  ShieldCheck,
  UserRound,
  WifiOff,
} from 'lucide-react';
import {
  adminSignupAvailable,
  requestPasswordReset,
  resetPassword,
  verifyResetOtp,
} from '../api.js';
import { requestLocation } from '../pharmacies.js';

const ROLES = [
  {
    id: 'patient',
    label: 'Patient',
    icon: UserRound,
    signInHeading: 'Patient sign in',
    signInIdentifierLabel: 'Email or mobile number',
    signInPlaceholder: 'ananya.sharma@example.com',
    signInHint: 'Use the email or mobile number your pharmacy registered, and your password.',
    signInSubmit: 'Sign in to Patient Dashboard',
    signUpHeading: 'Create a patient account',
    signUpSubmit: 'Create Patient Account',
    signUpHint: 'Your mobile and email receive dose reminders. Home address is used for doorstep delivery.',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    icon: Building2,
    signInHeading: 'Pharmacy sign in',
    signInIdentifierLabel: 'Email or drug licence number',
    signInPlaceholder: 'KA-B-2019-44821',
    signInHint: 'Use the store email or the drug licence number you registered with.',
    signInSubmit: 'Sign in to Pharmacy Console',
    signUpHeading: 'Register your medical store',
    signUpSubmit: 'Submit Store Registration',
    signUpHint: 'A new store starts in "pending". It only appears on the patient map after an admin verifies the drug licence.',
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: ShieldCheck,
    signInHeading: 'Admin sign in',
    signInIdentifierLabel: 'Admin email',
    signInPlaceholder: 'admin@medisync.example',
    signInHint: 'Official admin email and master password.',
    signInSubmit: 'Sign in to Admin Console',
    signUpHeading: 'Bootstrap the first admin',
    signUpSubmit: 'Create Admin Account',
    signUpHint: 'One-time setup: this works only until the first admin account exists. After that, admins sign in.',
  },
];

const BENEFITS = [
  { icon: BellRing, title: 'Server-to-patient dispatch', text: 'Dose reminders go out by SMS and email on your schedule.' },
  { icon: Pill, title: 'Stock and refill alerts', text: 'See what is running out and reorder before the last strip.' },
  { icon: MapPin, title: 'Nearest default shops', text: 'Your three default pharmacies follow your live location.' },
];

const EMPTY = {
  identifier: '',
  password: '',
  email: '',
  phone: '',
  name: '',
  address: '',
  storeName: '',
  licenseNumber: '',
  pharmacistName: '',
  pharmacistRegNo: '',
  latitude: '',
  longitude: '',
};

// Forgot password: request an OTP, verify it, then set a new password.
// The OTP arrives privately via registered email and mobile SMS only.
function ForgotPasswordPanel({ role, initialIdentifier, onBack, onDone }) {
  const minLength = role === 'admin' ? 10 : 8;
  const [step, setStep] = useState('request');
  const [identifier, setIdentifier] = useState(initialIdentifier ?? '');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const field = (id, label, props = {}) => (
    <div>
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-600/20">
        <input
          id={id}
          className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-300"
          {...props}
        />
      </div>
    </div>
  );

  const requestOtp = async (event) => {
    event.preventDefault();
    setError(null);
    if (identifier.trim().length < 3) return setError('Enter your email, mobile or licence number.');
    setBusy(true);
    try {
      const result = await requestPasswordReset(role, identifier.trim());
      setNotice(result.message);
      setStep('otp');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (event) => {
    event.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otp.trim())) return setError('Enter the 6-digit code.');
    setBusy(true);
    try {
      setResetToken(await verifyResetOtp(role, identifier.trim(), otp.trim()));
      setStep('password');
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setError(null);
    if (password.length < minLength) return setError(`Password must be at least ${minLength} characters.`);
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return setError('Password must contain a letter and a number.');
    }
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await resetPassword(resetToken, password);
      onDone('Password updated. Sign in with your new password.');
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 space-y-3.5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink">Reset your password</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {role === 'patient'
              ? 'Use your patient email or mobile number.'
              : role === 'pharmacy'
                ? 'Use the store email or drug licence number.'
                : 'Use the admin email.'}
          </p>
        </div>
        <button type="button" onClick={onBack} className="text-[11px] font-semibold text-brand-700 hover:underline">
          Back to sign in
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        {['request', 'otp', 'password'].map((id, index) => (
          <span
            key={id}
            className={`rounded-full px-2 py-0.5 ${
              step === id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {index + 1}. {id === 'request' ? 'Request code' : id === 'otp' ? 'Enter code' : 'New password'}
          </span>
        ))}
      </div>

      {notice && step !== 'request' ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
          {notice}
        </p>
      ) : null}

      {step === 'request' ? (
        <form onSubmit={requestOtp} className="space-y-3.5" noValidate>
          {field('reset-identifier', role === 'pharmacy' ? 'Email or licence number' : 'Email or mobile number', {
            value: identifier,
            onChange: (event) => setIdentifier(event.target.value),
            autoFocus: true,
            autoComplete: 'username',
          })}
          <button type="submit" disabled={busy} className="btn-primary w-full !py-3 !text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send reset code
          </button>
        </form>
      ) : null}

      {step === 'otp' ? (
        <form onSubmit={submitOtp} className="space-y-3.5" noValidate>
          {field('reset-otp', '6-digit code', {
            value: otp,
            onChange: (event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)),
            inputMode: 'numeric',
            autoComplete: 'one-time-code',
            autoFocus: true,
            placeholder: '123456',
          })}
          <button type="submit" disabled={busy} className="btn-primary w-full !py-3 !text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Verify code
          </button>
          <button
            type="button"
            onClick={() => setStep('request')}
            className="w-full text-[11px] font-semibold text-slate-500 hover:text-slate-700"
          >
            Use a different account
          </button>
        </form>
      ) : null}

      {step === 'password' ? (
        <form onSubmit={submitPassword} className="space-y-3.5" noValidate>
          {field('reset-password', `New password (min ${minLength} characters)`, {
            type: 'password',
            value: password,
            onChange: (event) => setPassword(event.target.value),
            autoComplete: 'new-password',
            autoFocus: true,
          })}
          {field('reset-confirm', 'Confirm new password', {
            type: 'password',
            value: confirm,
            onChange: (event) => setConfirm(event.target.value),
            autoComplete: 'new-password',
          })}
          <button type="submit" disabled={busy} className="btn-primary w-full !py-3 !text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Set new password
          </button>
        </form>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function LoginPage({ auth, onLogin, onRegister, onDemo, onClearError }) {
  const [mode, setMode] = useState('signin');
  const [role, setRole] = useState('patient');
  const [form, setForm] = useState(EMPTY);
  const [notifications, setNotifications] = useState(true);
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [adminCheck, setAdminCheck] = useState({ loading: false, available: true, error: null });
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetDone, setResetDone] = useState(null);

  const active = ROLES.find((item) => item.id === role) ?? ROLES[0];
  const signingUp = mode === 'signup';
  const pending = auth?.pending ?? false;
  const offline = auth?.offline ?? false;
  const error = auth?.error ?? null;
  const expired = Boolean(auth?.expired);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // The admin sign-up is a one-time bootstrap; ask the server if it is still open.
  useEffect(() => {
    if (mode !== 'signup' || role !== 'admin') return undefined;
    let cancelled = false;
    setAdminCheck({ loading: true, available: true, error: null });
    adminSignupAvailable().then((result) => {
      if (cancelled) return;
      setAdminCheck({ loading: false, available: result.available, error: result.error ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [mode, role]);

  const resetForm = (nextRole, nextMode) => {
    setRole(nextRole);
    setMode(nextMode);
    setForgotOpen(false);
    setResetDone(null);
    setForm(EMPTY);
    setTouched(false);
    setFormError(null);
    setGeoError(null);
    setConsent(false);
    setNotifications(true);
    onClearError?.();
  };

  const useStoreLocation = async () => {
    setGeoBusy(true);
    setGeoError(null);
    try {
      const fix = await requestLocation();
      setForm((prev) => ({ ...prev, latitude: fix.lat.toFixed(6), longitude: fix.lng.toFixed(6) }));
    } catch (locationError) {
      setGeoError(
        locationError?.code === 'denied'
          ? 'Location permission was blocked. Enter the store coordinates manually.'
          : 'Could not read your location. Enter the store coordinates manually.'
      );
    } finally {
      setGeoBusy(false);
    }
  };

  const passwordIssue = (value) => {
    const min = role === 'admin' ? 10 : 8;
    if (value.length < min) return `Password must be at least ${min} characters.`;
    if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'Password must contain a letter and a number.';
    return null;
  };

  const submit = (event) => {
    event.preventDefault();
    setTouched(true);
    setFormError(null);

    if (!signingUp) {
      if (form.identifier.trim().length < 3 || !form.password) return;
      onLogin({ role, identifier: form.identifier.trim(), password: form.password });
      return;
    }

    const passwordError = passwordIssue(form.password);
    if (role === 'admin') {
      if (adminCheck.loading) return;
      if (!adminCheck.available) {
        setFormError('An admin account already exists. Switch to Sign in.');
        return;
      }
      if (!form.email.includes('@') || form.phone.replace(/\D/g, '').length < 10) {
        setFormError('Enter the official admin email and a 10-digit mobile number.');
        return;
      }
      if (passwordError) {
        setFormError(passwordError);
        return;
      }
      onRegister({ role, payload: { email: form.email.trim(), phone: form.phone.trim(), password: form.password } });
      return;
    }

    if (role === 'patient') {
      if (!form.name.trim() || form.name.trim().length < 2) {
        setFormError('Enter your full name.');
        return;
      }
      if (!form.email.includes('@') || form.phone.replace(/\D/g, '').length < 10 || form.address.trim().length < 5) {
        setFormError('Enter your email, a 10-digit mobile number and your full home address.');
        return;
      }
      if (passwordError) {
        setFormError(passwordError);
        return;
      }
      if (!consent) {
        setFormError('Accept the Privacy Policy and health-data consent to create an account.');
        return;
      }
      onRegister({
        role,
        payload: {
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          password: form.password,
          consents: { privacyPolicy: true, healthData: true, notifications },
        },
      });
      return;
    }

    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.storeName.trim() || form.licenseNumber.trim().length < 5) {
      setFormError('Enter the store name and its drug licence (Form 20/21) number.');
      return;
    }
    if (!form.email.includes('@') || form.phone.replace(/\D/g, '').length < 10 || form.address.trim().length < 5) {
      setFormError('Enter the store email, a 10-digit mobile number and the full store address.');
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setFormError('Set the store GPS pin with "Use my store location", or type latitude and longitude.');
      return;
    }
    if (passwordError) {
      setFormError(passwordError);
      return;
    }
    if (!consent) {
      setFormError('Accept the Privacy Policy to register the store.');
      return;
    }
    onRegister({
      role,
      payload: {
        storeName: form.storeName.trim(),
        licenseNumber: form.licenseNumber.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        password: form.password,
        latitude: lat,
        longitude: lng,
        ...(form.pharmacistName.trim() ? { pharmacistName: form.pharmacistName.trim() } : {}),
        ...(form.pharmacistRegNo.trim() ? { pharmacistRegNo: form.pharmacistRegNo.trim() } : {}),
        consents: { privacyPolicy: true },
      },
    });
  };

  const inputClass = (invalid) =>
    `mt-1.5 flex items-center gap-2 rounded-xl border bg-white px-3 focus-within:ring-2 focus-within:ring-brand-600/20 ${
      invalid ? 'border-rose-300' : 'border-slate-200 focus-within:border-brand-500'
    }`;

  const field = (key, label, props = {}) => (
    <div>
      <label htmlFor={key} className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <div className={inputClass(false)}>
        <input
          id={key}
          name={key}
          value={form[key]}
          onChange={(event) => set(key, event.target.value)}
          className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-300"
          {...props}
        />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-ink">
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden px-10 py-10 lg:flex xl:px-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(0deg, #fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '46px 46px',
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
              <Pill className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-bold leading-tight text-white">MediSync</p>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand-200">
                Smart Pharmacy &amp; Care Network
              </p>
            </div>
          </div>

          <h1 className="mt-14 max-w-md text-[30px] font-bold leading-tight text-white">
            Connected care between patients and nearby pharmacies.
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
            One sign-in for patients, partner pharmacies and the admin team that verifies drug licences.
          </p>

          <ul className="mt-9 space-y-4">
            {BENEFITS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-brand-200 ring-1 ring-white/10">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-slate-100">{title}</p>
                  <p className="mt-0.5 max-w-sm text-[11px] leading-relaxed text-slate-400">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-[11px] leading-relaxed text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-brand-300" />
          Health data is processed only after you accept the Privacy Policy and health-data consent.
        </p>
      </aside>

      <main className="flex w-full flex-1 items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-[460px]">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
              <Pill className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold leading-tight text-white">MediSync</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-brand-200">
                Smart Pharmacy &amp; Care Network
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
            {forgotOpen ? null : (
              <div role="tablist" aria-label="Sign in or sign up" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                {[
                  { id: 'signin', label: 'Sign In' },
                  { id: 'signup', label: 'Sign Up' },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={mode === id}
                    onClick={() => resetForm(role, id)}
                    className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                      mode === id ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div role="tablist" aria-label="Account type" className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
              {ROLES.map(({ id, label, icon: Icon }) => {
                const selected = id === role;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => resetForm(id, mode)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                      selected ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${selected ? 'text-brand-600' : ''}`} />
                    {label}
                  </button>
                );
              })}
            </div>

            {forgotOpen ? null : (
              <>
                <h2 className="mt-5 text-xl font-bold tracking-tight text-ink">
                  {signingUp ? active.signUpHeading : active.signInHeading}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {signingUp ? active.signUpHint : active.signInHint}
                </p>
              </>
            )}

            {forgotOpen ? (
              <ForgotPasswordPanel
                role={role}
                initialIdentifier={form.identifier}
                onBack={() => setForgotOpen(false)}
                onDone={(message) => {
                  setForgotOpen(false);
                  setMode('signin');
                  setResetDone(message);
                  setForm((prev) => ({ ...prev, password: '' }));
                }}
              />
            ) : (
            <form onSubmit={submit} className="mt-5 space-y-3.5" noValidate>
              {!signingUp ? (
                <>
                  <div>
                    <label htmlFor="identifier" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {active.signInIdentifierLabel}
                    </label>
                    <div className={inputClass(touched && form.identifier.trim().length < 3)}>
                      <span className="text-slate-400">@</span>
                      <input
                        id="identifier"
                        name="identifier"
                        type="text"
                        inputMode="email"
                        autoComplete="username"
                        autoFocus
                        value={form.identifier}
                        onChange={(event) => set('identifier', event.target.value)}
                        placeholder={active.signInPlaceholder}
                        className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-300"
                      />
                    </div>
                    {touched && form.identifier.trim().length < 3 ? (
                      <p className="mt-1 text-[11px] text-rose-600">Enter your email, mobile number or licence number.</p>
                    ) : null}
                  </div>

                  <div>
                    <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Password
                    </label>
                    <div className={inputClass(touched && !form.password)}>
                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={form.password}
                        onChange={(event) => set('password', event.target.value)}
                        placeholder="Your password"
                        className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="rounded-md p-1 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {touched && !form.password ? (
                      <p className="mt-1 text-[11px] text-rose-600">Enter your password.</p>
                    ) : null}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotOpen(true);
                        setResetDone(null);
                        onClearError?.();
                      }}
                      className="text-[11px] font-semibold text-brand-700 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                </>
              ) : null}

              {signingUp ? (
                <>
                  {role === 'patient' ? (
                    <>
                      {field('name', 'Full name', { autoComplete: 'name', placeholder: 'Ananya Sharma' })}
                      {field('email', 'Email', { type: 'email', autoComplete: 'email', placeholder: 'ananya.sharma@example.com' })}
                      {field('phone', 'Mobile number', { type: 'tel', autoComplete: 'tel', placeholder: '98765 43210' })}
                      {field('address', 'Home address', { autoComplete: 'street-address', placeholder: '14, 2nd Cross, Banashankari, Bengaluru' })}
                    </>
                  ) : null}

                  {role === 'pharmacy' ? (
                    <>
                      {field('storeName', 'Store name', { autoComplete: 'organization', placeholder: 'Sri Venkateshwara Medicals' })}
                      {field('licenseNumber', 'Drug licence (Form 20/21)', { placeholder: 'KA-BNG-20-194821' })}
                      {field('email', 'Store email', { type: 'email', autoComplete: 'email', placeholder: 'store@example.com' })}
                      {field('phone', 'Store mobile number', { type: 'tel', autoComplete: 'tel', placeholder: '98765 43210' })}
                      {field('address', 'Full store address', { autoComplete: 'street-address', placeholder: 'Shop 4, 30th Main, Banashankari, Bengaluru' })}
                      <div className="grid grid-cols-2 gap-3">
                        {field('pharmacistName', 'Pharmacist name', { placeholder: 'Dr. R. Kulkarni' })}
                        {field('pharmacistRegNo', 'Council reg. no.', { placeholder: 'KSPC-48291' })}
                      </div>

                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Store GPS pin</p>
                        <div className="mt-1.5 grid grid-cols-2 gap-3">
                          {field('latitude', 'Latitude', { inputMode: 'decimal', placeholder: '12.9254' })}
                          {field('longitude', 'Longitude', { inputMode: 'decimal', placeholder: '77.5468' })}
                        </div>
                        <button
                          type="button"
                          onClick={useStoreLocation}
                          disabled={geoBusy}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                        >
                          {geoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
                          Use my store location
                        </button>
                        {geoError ? <p className="mt-1 text-[11px] text-amber-700">{geoError}</p> : null}
                      </div>
                    </>
                  ) : null}

                  {role === 'admin' ? (
                    <>
                      {field('email', 'Official admin email', { type: 'email', autoComplete: 'email', placeholder: 'admin@medisync.example' })}
                      {field('phone', 'Mobile number', { type: 'tel', autoComplete: 'tel', placeholder: '98765 43210' })}
                      {adminCheck.loading ? (
                        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking whether admin setup is still open…
                        </p>
                      ) : adminCheck.available ? (
                        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          This creates the first and only self-service admin account. Keep these credentials safe.
                        </p>
                      ) : (
                        <p className="flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-200">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          An admin account already exists on this deployment. Use Sign in instead.
                        </p>
                      )}
                    </>
                  ) : null}

                  <div>
                    <label htmlFor="password" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {role === 'admin' ? 'Master password (min 10 characters)' : 'Password (min 8 characters)'}
                    </label>
                    <div className={inputClass(false)}>
                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(event) => set('password', event.target.value)}
                        placeholder="Letters and numbers"
                        className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="rounded-md p-1 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {role === 'patient' ? (
                    <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-600">
                      <input
                        type="checkbox"
                        checked={notifications}
                        onChange={(event) => setNotifications(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600/30"
                      />
                      Send my dose reminders by SMS and email.
                    </label>
                  ) : null}

                  {role !== 'admin' ? (
                    <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-600">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(event) => setConsent(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600/30"
                      />
                      I accept the Privacy Policy
                      {role === 'patient' ? ' and consent to health-data processing' : ''}.
                    </label>
                  ) : null}
                </>
              ) : null}

              {resetDone ? (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-800 ring-1 ring-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{resetDone}</span>
                </div>
              ) : null}

              {formError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-200"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              ) : null}

              {expired ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200"
                >
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <span className="block font-bold">Session expired</span>
                    {error ?? 'Your session expired. Please sign in again.'}
                  </span>
                </div>
              ) : error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-200"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {offline ? (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
                  <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    The API is not answering. Start the server (<code className="font-mono">npm run dev</code> in{' '}
                    <code className="font-mono">server/</code>), or explore the patient portal with sample data below.
                  </span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={pending || (signingUp && role === 'admin' && (!adminCheck.available || adminCheck.loading))}
                className="btn-primary w-full !py-3 !text-sm"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : signingUp ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {pending ? (signingUp ? 'Creating account…' : 'Signing in…') : signingUp ? active.signUpSubmit : active.signInSubmit}
                {!pending ? <ArrowRight className="ml-auto h-4 w-4" /> : null}
              </button>
            </form>
            )}

            {!signingUp && !forgotOpen && role === 'patient' ? (
              <>
                <div className="mt-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">or</span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>

                <button
                  type="button"
                  onClick={onDemo}
                  className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-ink"
                >
                  Continue with demo data
                </button>
                <p className="mt-2 text-center text-[10px] leading-relaxed text-slate-400">
                  Demo mode needs no account. Reminders, payments and tracking are simulated, and nearby shops fall back
                  to labelled sample data.
                </p>
              </>
            ) : null}
          </div>

          <p className="mt-5 text-center text-[10px] leading-relaxed text-slate-500">
            {signingUp && role === 'admin'
              ? 'Admin sign-up is a one-time bootstrap. Later admins are created by an existing admin or with npm run admin:create.'
              : 'Sign up is open for patients and pharmacies. Stores stay hidden from the patient map until an admin verifies the drug licence.'}
          </p>
        </div>
      </main>
    </div>
  );
}
