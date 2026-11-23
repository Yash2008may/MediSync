import { speakLocalizedDose, translateDosageToKannada } from './components/ScheduleList.jsx';
import { syncReminderSchedules } from './notifications.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_PHARMACIES, seedState } from './data.js';
import {
  DEMO_REASON_TEXT,
  fetchDefaultLocation,
  fetchNearbyStores,
  requestLocation,
  reverseGeocode,
  saveDefaultLocation as saveDefaultLocationRequest,
} from './pharmacies.js';
import {
  SESSION_EXPIRED_MESSAGE,
  clearSessionHint,
  fetchProfile,
  apiUrl,
  hasSession,
  loginAs,
  logoutAccount,
  onUnauthorized,
  registerAccount,
  updateMyProfile,
} from './api.js';

const STORAGE_KEY = 'medisync.portal.v1';

export const inr = (value) =>
  `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const refillPrice = (medicine) =>
  Number((medicine.mrp * (1 - (medicine.discountPct ?? 0) / 100)).toFixed(2));

export const stockLevel = (medicine) => {
  const ratio = medicine.capacity ? medicine.pills / medicine.capacity : 0;
  if (medicine.pills <= 0) return 'empty';
  if (ratio <= 0.3) return 'low';
  return 'ok';
};

const uid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const clockTime = () =>
  new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

// Saves written before live shops existed have no source, so treat their shops as demo.
const migrate = (state) => {
  if (!state.pharmacies) return state;
  const pharmacies = {
    source: 'demo',
    demoReason: 'seed',
    mode: null,
    selectedId: null,
    notice: null,
    googleAvailable: null,
    coords: null,
    defaultLocation: null,
    ...state.pharmacies,
  };
  return {
    ...state,
    pharmacies: {
      ...pharmacies,
      items: (pharmacies.items ?? []).map((pharmacy) => ({ ...pharmacy, source: pharmacy.source ?? 'demo' })),
    },
  };
};

const loadState = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.medicines) && Array.isArray(parsed.doses)) return migrate(parsed);
    }
  } catch {
    /* corrupt or unavailable storage — fall back to the demo patient */
  }
  return seedState();
};

const message = (state, { channel, subject, body, status = 'delivered' }) => ({
  id: uid(),
  channel,
  to: channel === 'Email' ? state.user.email : state.user.phone,
  subject,
  body,
  at: nowIso(),
  status,
});

const playBeep = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close();
  } catch {
    /* audio is a nice-to-have; ignore blocked autoplay */
  }
};

export function usePortal() {
  const [state, setState] = useState(loadState);
  // Callbacks read the latest shops state without being rebuilt on every change.
  const pharmaciesRef = useRef(state.pharmacies);
  pharmaciesRef.current = state.pharmacies;
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState(null);
  const [reordering, setReordering] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const firedRef = useRef(0);

  // Sign-in lives outside the persisted portal state; only the display identity is stored.
  const [auth, setAuth] = useState(() => ({
    status: hasSession() ? 'checking' : 'signed-out',
    role: null,
    user: null,
    pending: false,
    error: null,
    offline: false,
    expired: false,
  }));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked — the session still works in memory */
    }
  }, [state]);

  const notify = useCallback((title, text, tone = 'success') => {
    setToast({ id: uid(), title, text, tone });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  // The saved default location lives on the server; localStorage keeps the last copy.
  const loadSavedDefaultLocation = useCallback(async () => {
    const { location } = await fetchDefaultLocation();
    if (!location) return;
    setState((prev) => ({
      ...prev,
      pharmacies: { ...prev.pharmacies, defaultLocation: location },
    }));
  }, []);

    const sendRealAlert = useCallback(
    async (type, title, body, emailSubject = null, emailBody = null) => {
      try {
        const res = await fetch(apiUrl('/api/notifications/alert'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, title, body, emailSubject, emailBody }),
        });
        if (res.status === 401) {
          notify(
            'Sign in required for real SMS/Email',
            'You are in Demo Mode. Sign in with your patient account to send real SMS and Email.',
            'warning'
          );
          return;
        }
        if (!res.ok) {
          notify('Gateway error', `Server returned ${res.status} while sending SMS/Email.`, 'warning');
        }
      } catch {
        notify('Backend offline', 'Start the MediSync server on port 5000 to send real SMS and Email.', 'warning');
      }
    },
    [notify]
  );

  const fireDispatch = useCallback(
    (kind) => {
      const isAuto = kind === 'auto';
      const dose = state.doses.find((d) => !d.taken) ?? state.doses[0];
      const med = state.medicines.find((m) => m.id === dose?.medicineId);
      const prefLang = window.localStorage.getItem('medisync.preferredLang') || 'kn';

      const subject = isAuto
        ? `MediSync Auto-dispatch: ${dose?.name ?? 'Medicine'} (${dose?.time ?? '20:00'})`
        : `MediSync Reminder: ${dose?.name ?? 'Medicine'} (${dose?.time ?? '20:00'})`;
      const body = prefLang === 'kn'
        ? `Samaya ${dose?.time ?? '20:00'}: ${dose?.name ?? 'Medication'} ${dose?.strength ?? ''} matre. Ootada nantara ondu matre tegedukolli.`
        : `${dose?.name ?? 'Medication'} ${dose?.strength ?? ''} - ${dose?.dosage ?? 'take as prescribed'}. ${
            med && med.pills <= 5 ? `Only ${med.pills} pills left, reorder soon.` : 'Tap TAKEN after your dose.'
          }`;

      const emailSubject = prefLang === 'kn'
        ? `MediSync ಜ್ಞಾಪನೆ: ${dose?.name ?? 'Medicine'} (${dose?.time ?? '20:00'})`
        : subject;
      const emailBody = prefLang === 'kn'
        ? `ಸಮಯ ${dose?.time ?? '20:00'}.\n${dose?.name ?? 'Medication'} ${dose?.strength ?? ''} ಮಾತ್ರೆ.\n${translateDosageToKannada(dose?.dosage)}.\n\n(${body})`
        : body;

      sendRealAlert('medication_reminder', subject, body, emailSubject, emailBody);

      setState((prev) => ({
        ...prev,
        pendingTestAt: null,
        nextDispatchAt: isAuto ? Date.now() + 30 * 60000 : prev.nextDispatchAt,
        messages: [
          message(prev, {
            channel: 'SMS + Email',
            subject: emailSubject,
            body: emailBody,
            status: 'delivered',
          }),
          ...prev.messages,
        ],
      }));

      if (dose) speakLocalizedDose(dose, prefLang);
      if (state.settings.sound) playBeep();
      notify(
        isAuto ? 'Auto-dispatch sent' : 'Reminder sent (SMS + Email + Voice)',
        `${dose?.name ?? 'Dose'} sent to ${state.user.phone} and ${state.user.email}.`,
        'teal'
      );
    },
    [state.doses, state.medicines, state.settings.sound, state.user.phone, state.user.email, notify, sendRealAlert]
  );

  useEffect(() => {
    if (!state.pendingTestAt) return;
    if (now >= state.pendingTestAt) {
      fireDispatch('test');
    }
  }, [now, state.pendingTestAt, fireDispatch]);

    // Automatically sync active medication schedules + persist medicines/doses in PostgreSQL.
  useEffect(() => {
    if (auth.status !== 'signed-in' || auth.role !== 'patient') return;
    const schedules = (state.doses ?? []).map((d) => ({
      medName: d.name,
      strength: d.strength,
      dosage: d.dosage,
      doseTime: d.time,
      taken: Boolean(d.taken),
      active: !d.taken,
    }));
    syncReminderSchedules(schedules).catch(() => {});
    fetch(apiUrl('/api/patients/me/portal-state'), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicines: state.medicines, doses: state.doses }),
    }).catch(() => {});
  }, [auth.status, auth.role, state.doses, state.medicines]);

  // Any 401 on a request that carried a token means the session died mid-use
  // (expired, revoked, or the password changed). Drop the token and land on the
  // login screen with an explicit "session expired" reason, not a credentials error.
  useEffect(
    () =>
      onUnauthorized((message) => {
        clearSessionHint();
        setAuth({
          status: 'signed-out',
          role: null,
          user: null,
          pending: false,
          error: message ?? SESSION_EXPIRED_MESSAGE,
          offline: false,
          expired: true,
        });
      }),
    []
  );

  // Restore a saved session on load. A rejected or expired token goes back to sign-in.
  useEffect(() => {
    if (!hasSession()) return undefined;
    let cancelled = false;
    fetchProfile().then((profile) => {
      if (cancelled) return;
      if (!profile || profile.unauthorized) {
        clearSessionHint();
        setAuth({
          status: 'signed-out',
          role: null,
          user: null,
          pending: false,
          error: profile?.unauthorized ? SESSION_EXPIRED_MESSAGE : null,
          offline: false,
          expired: Boolean(profile?.unauthorized),
        });
        return;
      }
      if (profile.offline) {
        setAuth({
          status: 'signed-out',
          role: null,
          user: null,
          pending: false,
          error: 'Cannot reach the MediSync server. Check that it is running.',
          offline: true,
          expired: false,
        });
        return;
      }
      if (profile.role === 'patient') {
        setState((prev) => ({
          ...prev,
          signedOut: false,
          user: {
            name: profile.profile?.name ?? prev.user.name,
            email: profile.email ?? prev.user.email,
            phone: profile.phone ?? prev.user.phone,
          },
        }));
        loadSavedDefaultLocation();
        fetch(apiUrl('/api/patients/me/portal-state'), { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((saved) => {
            if (saved && Array.isArray(saved.medicines) && saved.medicines.length > 0) {
              setState((prev) => ({
                ...prev,
                medicines: saved.medicines,
                doses: Array.isArray(saved.doses) ? saved.doses : prev.doses,
              }));
            }
          })
          .catch(() => {});
      }
      setAuth({
        status: 'signed-in',
        role: profile.role ?? 'patient',
        user: profile,
        pending: false,
        error: null,
        offline: false,
        expired: false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [loadSavedDefaultLocation]);

  const markTaken = useCallback(
    (doseId) => {
      const dose = state.doses.find((d) => d.id === doseId);
      if (!dose || dose.taken) return;
      const med = state.medicines.find((m) => m.id === dose.medicineId);
      const remaining = med ? Math.max(0, med.pills - 1) : 0;

      setState((prev) => ({
        ...prev,
        doses: prev.doses.map((d) =>
          d.id === doseId ? { ...d, taken: true, takenAt: nowIso() } : d
        ),
        medicines: prev.medicines.map((m) =>
          m.id === dose.medicineId ? { ...m, pills: Math.max(0, m.pills - 1) } : m
        ),
        messages: [
          message(prev, {
            channel: 'SMS + Email',
            subject: `Dose confirmed · ${dose.name} ${dose.strength}`,
            body: `${dose.name} marked as taken at ${clockTime()}. ${remaining} pills left.`,
            status: 'delivered',
          }),
          ...prev.messages,
        ],
      }));

      sendRealAlert(
        'dose_taken',
        `Dose confirmed: ${dose.name} ${dose.strength}`,
        `${dose.name} marked as taken at ${clockTime()}. ${remaining} pills left.`
      );

      notify(
        'Dose recorded',
        `${dose.name} ${dose.strength} marked as taken. Stock is now ${remaining} pill${
          remaining === 1 ? '' : 's'
        }; confirmation sent by SMS + email.`
      );
    },
    [state.doses, state.medicines, notify]
  );

  const startReorder = useCallback(
    (medicine) => {
      if (!medicine) return;
      setReordering({ medicineId: medicine.id, packs: 3 });
    },
    []
  );

  const placeOrder = useCallback(
    ({ medicineId, packs, paymentId, note }) => {
      const med = state.medicines.find((m) => m.id === medicineId);
      if (!med) return;
      const payment = (
        { upi: 'UPI · GPay', card: 'Card · RuPay', netbanking: 'Netbanking · HDFC', cod: 'Cash on delivery' }[
          paymentId
        ] ?? 'UPI · GPay'
      );
      const addedPills = packs * med.packSize;
      const subtotal = refillPrice(med) * packs;
      const deliveryFee = subtotal >= 199 ? 0 : 25;
      const total = Number((subtotal + deliveryFee).toFixed(2));
      // Orders go to the shop the patient picked (or the nearest default shop).
      const shop =
        state.pharmacies.items.find((s) => s.id === state.pharmacies.selectedId) ??
        state.pharmacies.items.slice().sort((a, b) => a.distanceKm - b.distanceKm)[0] ??
        null;
      const shopName = shop?.name ?? 'Apollo Pharmacy, Indiranagar';

      setState((prev) => ({
        ...prev,
        medicines: prev.medicines.map((m) =>
          m.id === medicineId ? { ...m, pills: Math.min(m.capacity * 3, m.pills + addedPills) } : m
        ),
        delivery: {
          id: `MS-${Math.floor(24900 + Math.random() * 900)}`,
          pharmacy: shopName,
          items: `${med.name} ${med.strength} · ${addedPills} pills`,
          payment,
          amount: total,
          rider: 'Ravi Kumar',
          riderPhone: '+91 90000 12345',
          startedAt: Date.now(),
          etaMin: 25,
          baseProgress: 8,
          note: note?.trim() || '',
        },
        messages: [
          message(prev, {
            channel: 'SMS + Email',
            subject: `Order confirmed · ${med.name} ${med.strength}`,
            body: `${packs} × ${med.packSize} pills ordered from ${shopName}. ${inr(total)} paid via ${payment}. Live tracking is on in the portal.`,
            status: 'simulated',
          }),
          ...prev.messages,
        ],
      }));

      setReordering(null);
      notify(
        'Reorder placed',
        `${med.name} ${med.strength} · ${addedPills} pills from ${shopName}. ${inr(total)} via ${payment}. Live tracking restarted.`
      );
    },
    [state.medicines, state.pharmacies, notify]
  );

  const addMedicine = useCallback(
    ({ name, strength, dosage, time, pills, mrp, discountPct }) => {
      const id = uid();
      setState((prev) => ({
        ...prev,
        medicines: [
          ...prev.medicines,
          {
            id,
            name,
            strength,
            dosage,
            time,
            pills: Number(pills),
            capacity: Math.max(30, Number(pills)),
            packSize: 10,
            mrp: Number(mrp),
            discountPct: Number(discountPct),
            rx: true,
          },
        ],
        doses: [
          ...prev.doses,
          { id: `dose-${id}`, medicineId: id, name, strength, dosage, time, taken: false },
        ].sort((a, b) => a.time.localeCompare(b.time)),
      }));
      notify('Medicine added', `${name} ${strength} is on today's schedule at ${time}.`);
    },
    [notify]
  );

    const removeScheduledDose = useCallback(
    (doseId) => {
      const target = state.doses.find((d) => d.id === doseId);
      if (!target) return;
      setState((prev) => {
        const remainingDoses = prev.doses.filter((d) => d.id !== doseId);
        const stillUsed = remainingDoses.some((d) => d.medicineId === target.medicineId);
        return {
          ...prev,
          doses: remainingDoses,
          medicines: stillUsed
            ? prev.medicines
            : prev.medicines.filter((m) => m.id !== target.medicineId),
        };
      });
      notify(
        'Schedule canceled',
        `${target.name} ${target.strength} (${target.time}) was removed from your schedule and reminder queue.`,
        'warning'
      );
    },
    [state.doses, notify]
  );
  const testAutoDispatch = useCallback(() => fireDispatch('auto'), [fireDispatch]);

  const testFiveMinuteAlert = useCallback(() => {
    setState((prev) => ({ ...prev, pendingTestAt: Date.now() + 10000 }));
    notify('5-minute alert test started', 'The reminder fires in 10 seconds and lands in the SMS & Email Hub.', 'teal');
  }, [notify]);

  const toggleSetting = useCallback(
    (key) => {
      setState((prev) => ({ ...prev, settings: { ...prev.settings, [key]: !prev.settings[key] } }));
      const label = key === 'sound' ? 'Push & sound alerts' : 'Push alerts';
      notify(`${label} ${state.settings[key] ? 'disabled' : 'enabled'}`, 'Preference saved for this browser.');
    },
    [notify, state.settings]
  );

  // Real path: the chosen origin (a live GPS fix, or the patient's saved default
  // location) -> /api/stores/nearby. A failure swaps in sample shops with an explicit
  // reason instead of inventing distances.
  const refreshPharmacies = useCallback(
    async (options) => {
      const mode = options?.mode === 'default' ? 'default' : 'gps';
      const saved = options?.overrideLocation ?? pharmaciesRef.current.defaultLocation;

      const applyDemo = (reason, label) => {
        setState((prev) => ({
          ...prev,
          pharmacies: {
            ...prev.pharmacies,
            source: 'demo',
            demoReason: reason,
            mode,
            selectedId: null,
            notice: null,
            googleAvailable: null,
            coords: null,
            location: label,
            updatedAt: nowIso(),
            lookups: (prev.pharmacies.lookups ?? 0) + 1,
            items: DEMO_PHARMACIES.map((pharmacy) => ({ ...pharmacy })),
          },
        }));
        notify('Showing sample shops', DEMO_REASON_TEXT[reason] ?? DEMO_REASON_TEXT['server-error'], 'warning');
      };

      if (!hasSession()) {
        applyDemo('auth-missing', 'Sample shops (not signed in)');
        return;
      }
      if (mode === 'default' && !saved) {
        applyDemo('no-default', 'Sample shops (no default saved)');
        return;
      }

      setLookingUp(true);
      try {
        let origin = saved;
        if (mode === 'gps') {
          try {
            origin = await requestLocation();
          } catch (error) {
            applyDemo(error?.code ?? 'unavailable', 'Sample shops (no live location)');
            return;
          }
        }

        const result = await fetchNearbyStores({ lat: origin.lat, lng: origin.lng });
        if (!result.ok) {
          applyDemo(result.error, mode === 'default' ? saved.label : 'Sample shops (lookup failed)');
          return;
        }
        if (!result.stores.length && !result.googleAvailable && mode !== 'default') {
          applyDemo('api-key-missing', mode === 'default' ? saved.label : 'Sample shops (no map key)');
          return;
        }

        const label =
          mode === 'default'
            ? saved.label
            : (await reverseGeocode(origin.lat, origin.lng)) ??
              `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`;
        const nearestNames = result.stores.slice(0, 3).map((store) => store.name);

        setState((prev) => ({
          ...prev,
          pharmacies: {
            ...prev.pharmacies,
            source: 'live',
            demoReason: null,
            mode,
            selectedId: prev.pharmacies.selectedId,
            notice: result.googleAvailable
              ? null
              : 'Google Maps results are off on the server, so only MediSync partner pharmacies are shown.',
            googleAvailable: result.googleAvailable,
            coords: { lat: origin.lat, lng: origin.lng, accuracy: origin.accuracy ?? null },
            location: label,
            updatedAt: nowIso(),
            lookups: (prev.pharmacies.lookups ?? 0) + 1,
            items: result.stores,
          },
        }));

        notify(
          mode === 'default' ? 'Shops near your default location' : 'Default shops updated',
          nearestNames.length
            ? `Nearest stores from ${label}: ${nearestNames.join(', ')}.`
            : 'No pharmacies were found within 5 km of that location.',
          nearestNames.length ? 'teal' : 'warning'
        );
      } finally {
        setLookingUp(false);
      }
    },
    [notify]
  );

  // Saves the patient's own default location (coordinates + the name they give it).
  const setDefaultLocation = useCallback(
    async ({ lat, lng, label }) => {
      try {
        const { location } = await saveDefaultLocationRequest({ lat, lng, label });
        setState((prev) => ({ ...prev, pharmacies: { ...prev.pharmacies, defaultLocation: location } }));
        notify('Default location saved', `${location.label} is now your default location for ordering.`, 'teal');
        await refreshPharmacies({ mode: 'default', overrideLocation: location });
        return { ok: true, location };
      } catch (error) {
        return { ok: false, error: error?.message ?? 'Could not save the default location.' };
      }
    },
    [notify, refreshPharmacies]
  );

  // Which shop the next refill is handed to (patient picks one on the map page).
  const selectPharmacy = useCallback((id) => {
    setState((prev) => ({ ...prev, pharmacies: { ...prev.pharmacies, selectedId: id } }));
  }, []);

  const resetData = useCallback(() => {
    setState(seedState());
    setReordering(null);
    setToast(null);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuth((prev) => (prev.error || prev.offline ? { ...prev, error: null, offline: false } : prev));
  }, []);

  const adoptSession = useCallback(
    (account, fallbackRole, { viaSignup = false } = {}) => {
      const resolvedRole = account?.role ?? fallbackRole ?? 'patient';

      if (resolvedRole === 'patient') {
        setState((prev) => ({
          ...prev,
          signedOut: false,
          user: {
            name: account?.profile?.name ?? prev.user.name,
            email: account?.email ?? prev.user.email,
            phone: account?.phone ?? prev.user.phone,
          },
        }));
        loadSavedDefaultLocation();
        fetch(apiUrl('/api/patients/me/portal-state'), { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((saved) => {
            if (saved && Array.isArray(saved.medicines) && saved.medicines.length > 0) {
              setState((prev) => ({
                ...prev,
                medicines: saved.medicines,
                doses: Array.isArray(saved.doses) ? saved.doses : prev.doses,
              }));
            }
          })
          .catch(() => {});
      } else {
        setState((prev) => ({ ...prev, signedOut: false }));
      }

      setAuth({
        status: 'signed-in',
        role: resolvedRole,
        user: account,
        pending: false,
        error: null,
        offline: false,
        expired: false,
      });

      const who = account?.profile?.name ?? account?.profile?.storeName ?? account?.email ?? 'there';
      if (resolvedRole === 'patient') {
        notify(
          viaSignup ? 'Account created' : 'Signed in',
          viaSignup
            ? `Welcome, ${who}. Your patient account is ready — medicine and stock data is still the sample patient.`
            : `Welcome back, ${who}. Medicine and stock data is still the sample patient until those routes are wired.`,
          'teal'
        );
      } else if (resolvedRole === 'pharmacy') {
        notify(
          viaSignup ? 'Pharmacy registered' : 'Signed in as pharmacy',
          viaSignup
            ? `${who} — your licence is queued for admin review before the store can take orders.`
            : `${who} — session started.`,
          'teal'
        );
      } else {
        notify(viaSignup ? 'Admin created' : 'Signed in as admin', `${who} — session started.`, 'teal');
      }
    },
    [notify]
  );

  const startAuth = useCallback(() => {
    setAuth((prev) => ({ ...prev, pending: true, error: null, offline: false, expired: false }));
  }, []);

  const failAuth = useCallback((error) => {
    setAuth({
      status: 'signed-out',
      role: null,
      user: null,
      pending: false,
      error: error?.message ?? 'Sign-in failed. Please try again.',
      offline: error?.code === 'offline',
      expired: error?.code === 'session-expired',
    });
  }, []);

  const login = useCallback(
    async ({ role = 'patient', identifier, password }) => {
      startAuth();
      try {
        const data = await loginAs(role, { identifier, password });
        adoptSession(data.user ?? {}, role);
      } catch (error) {
        failAuth(error);
      }
    },
    [adoptSession, failAuth, startAuth]
  );

  const register = useCallback(
    async ({ role = 'patient', payload }) => {
      startAuth();
      try {
        const data = await registerAccount(role, payload);
        adoptSession(data.user ?? {}, role, { viaSignup: true });
      } catch (error) {
        failAuth(error);
      }
    },
    [adoptSession, failAuth, startAuth]
  );

  const continueAsDemo = useCallback(() => {
    clearSessionHint();
    setState((prev) => ({ ...prev, signedOut: false }));
    setAuth({ status: 'demo', role: 'patient', user: null, pending: false, error: null, offline: false });
    notify(
      'Demo mode',
      'Sample patient only — reminders, payments and tracking are simulated, and shops fall back to labelled demo data.',
      'warning'
    );
  }, [notify]);

  // Profile edits for the signed-in account. The server returns the refreshed user,
  // which replaces both the auth session object and the patient header identity.
  const updateProfile = useCallback(
    async (payload) => {
      try {
        const { user } = await updateMyProfile(payload);
        if (!user) return { ok: false, error: 'The server did not return the updated profile.' };
        setAuth((prev) => ({ ...prev, user }));
        if (user.role === 'patient') {
          setState((prev) => ({
            ...prev,
            user: {
              ...prev.user,
              name: user.profile?.name ?? prev.user.name,
              email: user.email ?? prev.user.email,
              phone: user.phone ?? prev.user.phone,
            },
          }));
        }
        notify('Profile updated', 'Your profile changes are saved.', 'teal');
        return { ok: true, user };
      } catch (error) {
        return { ok: false, error: error?.message ?? 'Could not save your profile.' };
      }
    },
    [notify]
  );

  const signOut = useCallback(() => {
    // Clears the httpOnly cookie on the server as well as the local session hint.
    logoutAccount().catch(() => {});
    setState((prev) => ({ ...prev, signedOut: true }));
    setAuth({ status: 'signed-out', role: null, user: null, pending: false, error: null, offline: false });
    notify('Signed out', 'Your session cookie was cleared on this device.', 'teal');
  }, [notify]);

  const derived = useMemo(() => {
    const emptyMeds = state.medicines.filter((m) => stockLevel(m) === 'empty');
    const lowMeds = state.medicines.filter((m) => stockLevel(m) === 'low');
    const pendingDoses = state.doses.filter((d) => !d.taken);
    const takenDoses = state.doses.filter((d) => d.taken);
    const upcoming = state.doses
      .filter((d) => !d.taken)
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time));
    const nextDose = upcoming[0] ?? state.doses[0];
    const nextMed = nextDose ? state.medicines.find((m) => m.id === nextDose.medicineId) : null;

    const elapsed = Math.max(0, now - state.delivery.startedAt);
    const progress = Math.min(96, state.delivery.baseProgress + Math.floor(elapsed / 15000));
    const eta = Math.max(1, state.delivery.etaMin - Math.floor(elapsed / 60000));
    const stepIndex = progress >= 92 ? 4 : progress >= 70 ? 3 : progress >= 45 ? 2 : progress >= 20 ? 1 : 0;

    const nearest = state.pharmacies.items
      .slice()
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const defaultShops = nearest.slice(0, 3);
    const orderShop =
      state.pharmacies.items.find((shop) => shop.id === state.pharmacies.selectedId) ??
      defaultShops[0] ??
      null;

    const dispatchLeft = Math.max(0, state.nextDispatchAt - now);
    const totalSeconds = Math.floor(dispatchLeft / 1000);
    const dispatchCountdown = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}m ${String(
      totalSeconds % 60
    ).padStart(2, '0')}s`;

    return {
      emptyMeds,
      lowMeds,
      pendingDoses,
      takenDoses,
      upcoming,
      nextDose,
      nextMed,
      tracking: { progress, eta, stepIndex },
      defaultShops,
      orderShop,
      dispatchCountdown,
    };
  }, [state, now]);

  return {
    state,
    auth,
    now,
    toast,
    dismissToast,
    reordering,
    closeReorder: () => setReordering(null),
    lookingUp,
    derived,
    actions: {
      login,
      register,
      clearAuthError,
      continueAsDemo,
      markTaken,
      startReorder,
      placeOrder,
      addMedicine,
      removeScheduledDose,
      testAutoDispatch,
      testFiveMinuteAlert,
      toggleSetting,
      refreshPharmacies,
      setDefaultLocation,
      selectPharmacy,
      resetData,
      updateProfile,
      signOut,
      dismissToast,
    },
  };
}
