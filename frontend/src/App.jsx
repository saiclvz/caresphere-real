import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import DonorDashboard from './pages/DonorDashboard';
import DonorHistory from './pages/DonorHistory';
import Children from './pages/Children';
import ChildDetail from './pages/ChildDetail';
import Inventory from './pages/Inventory';
import Donations from './pages/Donations';
import Visitors from './pages/Visitors';
import Meals from './pages/Meals';
import Schedules from './pages/Schedules';
import MySchedule from './pages/MySchedule';
import Users from './pages/Users';
import SettingsPage from './pages/Settings';
import AuditLog from './pages/AuditLog';
import DataProtection from './pages/DataProtection';
import UndertakingGate from './components/UndertakingGate';
import Adoptions from './pages/Adoptions';
import StaffApplicationDetail from './pages/StaffApplicationDetail';
import Transitions from './pages/Transitions';
import Donate from './pages/Donate';
import AdoptChild from './pages/AdoptChild';
import AdoptionForm, { StartApplication } from './pages/AdoptionForm';
import MyApplicationDetail from './pages/MyApplicationDetail';
import TransitionReviewDetail from './pages/TransitionReviewDetail';
import DonateResult from './pages/DonateResult';
import Notifications from './pages/Notifications';
import NotificationSettings from './pages/NotificationSettings';
import ProtectedRecordPage from './pages/ProtectedRecordPage';
import MyApplications from './pages/MyApplications';
import NotFound from './pages/NotFound';

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

/** Not signed in: go to sign in, remembering where to come back to (e.g. a scanned QR link). */
function ToLogin() {
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;
  return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />;
}

/** Signed in: return to the page from ?next= (same-site paths only), otherwise the dashboard. */
function AfterLogin() {
  const location = useLocation();
  const next = new URLSearchParams(location.search).get('next') || '/';
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return <Navigate to={safe} replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-page"><Spinner label="Restoring your session" /></div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<ToLogin />} />
      </Routes>
    );
  }

  const ops = ['Admin', 'Staff'];
  const admin = ['Admin'];
  const donor = ['Donor']; // Donor accounts include Adopt a Child and My applications
  const home = user.role === 'Donor' ? <DonorDashboard /> : <Dashboard />;
  return (
    <Routes>
      <Route path="/login" element={<AfterLogin />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={home} />
        <Route path="donate" element={<RequireRole roles={donor}><Donate /></RequireRole>} />
        <Route path="donate/result" element={<RequireRole roles={donor}><DonateResult /></RequireRole>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="notifications/settings" element={<NotificationSettings />} />
        <Route path="donations/history" element={<RequireRole roles={donor}><DonorHistory /></RequireRole>} />
        <Route path="adopt" element={<RequireRole roles={donor}><AdoptChild /></RequireRole>} />
        <Route path="applications" element={<RequireRole roles={donor}><MyApplications /></RequireRole>} />
        <Route path="applications/new" element={<RequireRole roles={donor}><StartApplication /></RequireRole>} />
        <Route path="applications/:id/edit" element={<RequireRole roles={donor}><AdoptionForm /></RequireRole>} />
        <Route path="applications/:id" element={<RequireRole roles={donor}><MyApplicationDetail /></RequireRole>} />
        <Route path="transition-reviews/:id" element={<RequireRole roles={ops}><UndertakingGate area="transition"><TransitionReviewDetail /></UndertakingGate></RequireRole>} />
        <Route path="adoptions" element={<RequireRole roles={ops}><UndertakingGate area="adoption"><Adoptions /></UndertakingGate></RequireRole>} />
        <Route path="adoptions/:id" element={<RequireRole roles={ops}><UndertakingGate area="adoption"><StaffApplicationDetail /></UndertakingGate></RequireRole>} />
        <Route path="protected/:publicId" element={<RequireRole roles={ops}><ProtectedRecordPage /></RequireRole>} />
        {/* Protected access moved into Audit log > Sensitive record access; the old address still works. */}
        <Route path="protected-access" element={<RequireRole roles={admin}><Navigate to="/audit-log?tab=data-protection" replace /></RequireRole>} />
        {/* Data protection now lives in the Audit log page; old links and bookmarks still work. */}
        {/* Staff open Data protection here; for Admin it is also a tab of the Audit log. */}
        <Route path="data-protection" element={<RequireRole roles={ops}><DataProtection /></RequireRole>} />
        <Route path="transitions" element={<RequireRole roles={ops}><UndertakingGate area="transition"><Transitions /></UndertakingGate></RequireRole>} />
        <Route path="children" element={<RequireRole roles={ops}><Children /></RequireRole>} />
        <Route path="children/:id" element={<RequireRole roles={ops}><ChildDetail /></RequireRole>} />
        <Route path="inventory" element={<RequireRole roles={ops}><Inventory /></RequireRole>} />
        <Route path="donations" element={<RequireRole roles={ops}><Donations /></RequireRole>} />
        <Route path="visitors" element={<RequireRole roles={ops}><Visitors /></RequireRole>} />
        <Route path="meals" element={<RequireRole roles={ops}><Meals /></RequireRole>} />
        <Route path="my-schedule" element={<RequireRole roles={ops}><MySchedule /></RequireRole>} />
        <Route path="schedules" element={<RequireRole roles={admin}><Schedules /></RequireRole>} />
        <Route path="users" element={<RequireRole roles={admin}><Users /></RequireRole>} />
        <Route path="settings" element={<RequireRole roles={admin}><SettingsPage /></RequireRole>} />
        {/* Admin: every tab. Staff: only the Data protection tab (the tabs check the role, the API enforces it). */}
        <Route path="audit-log" element={<RequireRole roles={admin}><AuditLog /></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
