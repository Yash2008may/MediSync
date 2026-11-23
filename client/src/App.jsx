import { useState } from 'react';
import { Pill } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import CheckoutModal from './components/CheckoutModal.jsx';
import AddMedicineModal from './components/AddMedicineModal.jsx';
import GatewaysModal from './components/GatewaysModal.jsx';
import ProfileModal from './components/ProfileModal.jsx';
import Overview from './pages/Overview.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import StockPage from './pages/StockPage.jsx';
import PharmaciesPage from './pages/PharmaciesPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import PharmacyPage from './pages/PharmacyPage.jsx';
import { ToastHost } from './ui.jsx';
import { usePortal } from './usePortal.js';

const TITLES = {
  overview: 'Overview Dashboard',
  schedule: 'Medication Schedule',
  stock: 'Stock, Pricing & Reorder',
  pharmacies: 'Google Maps Pharmacies',
  inbox: 'Live SMS & Email Hub',
};

export default function App() {
  const { state, auth, now, toast, dismissToast, reordering, closeReorder, lookingUp, derived, actions } =
    usePortal();
  const [tab, setTab] = useState('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [gatewaysOpen, setGatewaysOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const openInbox = () => setTab('inbox');
  const reorderMedicine = state.medicines.find((m) => m.id === reordering?.medicineId) ?? null;

  if (auth.status === 'checking') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-ink">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
          <Pill className="h-6 w-6" />
        </span>
        <p className="text-xs font-medium text-slate-400">Restoring your session…</p>
      </div>
    );
  }

  if (auth.status !== 'signed-in' && auth.status !== 'demo') {
    return (
      <LoginPage
        auth={auth}
        onLogin={actions.login}
        onRegister={actions.register}
        onDemo={actions.continueAsDemo}
        onClearError={actions.clearAuthError}
      />
    );
  }

  // Non-patient roles get their own console; the patient dashboard is not shown to them.
  if (auth.status === 'signed-in' && auth.role === 'admin') {
    return <AdminPage auth={auth} onSignOut={actions.signOut} onUpdateProfile={actions.updateProfile} />;
  }

  if (auth.status === 'signed-in' && auth.role === 'pharmacy') {
    return <PharmacyPage auth={auth} onSignOut={actions.signOut} onUpdateProfile={actions.updateProfile} />;
  }

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar
        active={tab}
        onNavigate={setTab}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        counts={{
          doses: state.doses.length,
          empty: derived.emptyMeds.length,
          messages: state.messages.length,
          activeDeliveries: 1,
        }}
        user={state.user}
        onOpenInbox={openInbox}
        onReset={actions.resetData}
        onSignOut={actions.signOut}
        onEditProfile={auth.user ? () => setProfileOpen(true) : undefined}
      />

      <div className="lg:pl-[250px]">
        <TopBar
          title={TITLES[tab]}
          now={now}
          inboxCount={state.messages.length}
          user={state.user}
          onOpenInbox={openInbox}
          onTestFiveMin={actions.testFiveMinuteAlert}
          onMenu={() => setMenuOpen(true)}
        />

        <main className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-6 sm:py-5">
          {tab === 'overview' ? (
            <Overview
              state={state}
              derived={derived}
              actions={actions}
              onNavigate={setTab}
              onOpenGateways={() => setGatewaysOpen(true)}
              onAddMedicine={() => setAddOpen(true)}
              onOpenInbox={openInbox}
            />
          ) : null}

          {tab === 'schedule' ? (
            <SchedulePage
              state={state}
              derived={derived}
              actions={actions}
              onAddMedicine={() => setAddOpen(true)}
              onOpenInbox={openInbox}
            />
          ) : null}

          {tab === 'stock' ? <StockPage state={state} derived={derived} actions={actions} /> : null}

          {tab === 'pharmacies' ? (
            <PharmaciesPage
              state={state}
              derived={derived}
              actions={actions}
              lookingUp={lookingUp}
              patientAddress={auth.user?.profile?.address ?? ''}
              onOrder={(shop) => {
                actions.selectPharmacy(shop.id);
                setTab('stock');
              }}
            />
          ) : null}

          {tab === 'inbox' ? <InboxPage state={state} actions={actions} /> : null}

          <p className="mt-6 pb-2 text-center text-[10px] leading-relaxed text-slate-400">
            MediSync demo build · reminders, payments and rider tracking are simulated until the server gateways are
            connected.
          </p>
        </main>
      </div>

      <CheckoutModal
        medicine={reorderMedicine}
        pharmacy={derived.orderShop}
        onClose={closeReorder}
        onPlace={actions.placeOrder}
      />
      <AddMedicineModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={actions.addMedicine} />
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={auth.user}
        onSave={actions.updateProfile}
      />
      <GatewaysModal
        open={gatewaysOpen}
        onClose={() => setGatewaysOpen(false)}
        settings={state.settings}
        onToggleSetting={actions.toggleSetting}
      />
      <ToastHost toast={toast} onClose={dismissToast} />
    </div>
  );
}
