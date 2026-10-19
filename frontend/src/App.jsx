import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Register from './pages/Register';
import Landing from './pages/Landing';
import { PrivacyPolicy, Terms } from './pages/Legal';
import Logo from './components/Logo';
import Dashboard from './pages/Dashboard';
import DonorDashboard from './pages/DonorDashboard';
import DonorHistory from './pages/DonorHistory';
import Children from './pages/Children';
import ChildDetail from './pages/ChildDetail';
import Intake from './pages/Intake';
import AdmissionPage from './pages/AdmissionPage';
import Inventory from './pages/Inventory';
import Donations from './pages/Donations';
import DonationDetail from './pages/DonationDetail';
import Donors from './pages/Donors';
import DonorProfile from './pages/DonorProfile';
import Visitors from './pages/Visitors';
import Meals from './pages/Meals';
import Schedules from './pages/Schedules';
import MySchedule from './pages/MySchedule';
import Users from './pages/Users';
import SettingsPage from './pages/Settings';
import AuditLog from './pages/AuditLog';
import DataProtection from './pages/DataProtection';
import Adoptions from './pages/Adoptions';
import StaffApplicationDetail from './pages/StaffApplicationDetail';
import Transitions from './pages/Transitions';
import Donate from './pages/Donate';
import AdoptChild from './pages/AdoptChild';
import AdoptionForm, { StartApplication } from './pages/AdoptionForm';
import MyApplicationDetail from './pages/MyApplicationDetail';
import TransitionReviewDetail from './pages/TransitionReviewDetail';
import ChangeTemporaryPassword from './pages/ChangeTemporaryPassword';
import Notifications from './pages/Notifications';
import NotificationSettings from './pages/NotificationSettings';
import ProtectedRecordPage from './pages/ProtectedRecordPage';
import MyApplications from './pages/MyApplications';
import ProtectedArea from './components/ProtectedArea';
import RequireDuty from './components/RequireDuty';
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
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-page px-6">
        <Logo variant="stacked" />
        <Spinner label="Loading information..." />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<ToLogin />} />
      </Routes>
    );
  }

  // A temporary password set by an Admin: choose your own first (the server refuses everything else until then).
  if (user.must_change_password) return <ChangeTemporaryPassword />;

  const ops = ['Admin', 'Staff'];
  const admin = ['Admin'];
  const donor = ['Donor']; // Donor accounts include Adopt a Child and My applications
  const home = user.role === 'Donor' ? <DonorDashboard /> : <Dashboard />;
  return (
    <Routes>
      <Route path="/login" element={<AfterLogin />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<Terms />} />
      <Route element={<Layout />}>
        <Route index element={home} />
        <Route path="donate" element={<RequireRole roles={donor}><ProtectedArea area="Donation"><Donate /></ProtectedArea></RequireRole>} />
        {/* The online-payment return page was removed (CareSphere no longer processes payments); old links land on the history. */}
        <Route path="donate/result" element={<Navigate to="/donations/history" replace />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="notifications/settings" element={<NotificationSettings />} />
        <Route path="donations/history" element={<RequireRole roles={donor}><ProtectedArea area="Your donations"><DonorHistory /></ProtectedArea></RequireRole>} />
        <Route path="adopt" element={<RequireRole roles={donor}><ProtectedArea area="Children available for adoption"><AdoptChild /></ProtectedArea></RequireRole>} />
        <Route path="applications" element={<RequireRole roles={donor}><ProtectedArea area="Your applications"><MyApplications /></ProtectedArea></RequireRole>} />
        <Route path="applications/new" element={<RequireRole roles={donor}><StartApplication /></RequireRole>} />
        <Route path="applications/:id/edit" element={<RequireRole roles={donor}><ProtectedArea area="Your application"><AdoptionForm /></ProtectedArea></RequireRole>} />
        <Route path="applications/:id" element={<RequireRole roles={donor}><ProtectedArea area="Your application"><MyApplicationDetail /></ProtectedArea></RequireRole>} />
        <Route path="transition-reviews/:id" element={<RequireRole roles={ops}><RequireDuty duty="transition"><ProtectedArea area="Transition records"><TransitionReviewDetail /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="adoptions" element={<RequireRole roles={ops}><RequireDuty duty="adoption"><ProtectedArea area="Adoption records"><Adoptions /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="adoptions/:id" element={<RequireRole roles={ops}><RequireDuty duty="adoption"><ProtectedArea area="Adoption records"><StaffApplicationDetail /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="protected/:publicId" element={<RequireRole roles={ops}><RequireDuty duty="adoption"><ProtectedArea area="Protected records"><ProtectedRecordPage /></ProtectedArea></RequireDuty></RequireRole>} />
        {/* Protected access moved into Audit log > Sensitive record access; the old address still works. */}
        <Route path="protected-access" element={<RequireRole roles={admin}><Navigate to="/audit-log?tab=data-protection" replace /></RequireRole>} />
        {/* Data protection now lives in the Audit log page; old links and bookmarks still work. */}
        {/* Staff open Data protection here; for Admin it is also a tab of the Audit log. */}
        <Route path="data-protection" element={<RequireRole roles={ops}><ProtectedArea area="Data protection"><DataProtection /></ProtectedArea></RequireRole>} />
        <Route path="transitions" element={<RequireRole roles={ops}><RequireDuty duty="transition"><ProtectedArea area="Transition records"><Transitions /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="children" element={<RequireRole roles={ops}><RequireDuty duty={['children', 'admission']}><ProtectedArea area="Child records"><Children /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="children/intake" element={<RequireRole roles={ops}><RequireDuty duty="admission"><ProtectedArea area="Child records"><Intake /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="admissions/:id" element={<RequireRole roles={ops}><RequireDuty duty={['children', 'admission']}><ProtectedArea area="Child records"><AdmissionPage /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="children/:id" element={<RequireRole roles={ops}><RequireDuty duty="children"><ProtectedArea area="Child records"><ChildDetail /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="inventory" element={<RequireRole roles={ops}><RequireDuty duty="inventory"><Inventory /></RequireDuty></RequireRole>} />
        <Route path="donations" element={<RequireRole roles={ops}><RequireDuty duty="donations"><ProtectedArea area="Donor records"><Donations /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="donations/reports" element={<Navigate to="/donations?view=summary" replace />} />
        <Route path="donations/:id" element={<RequireRole roles={ops}><RequireDuty duty="donations"><ProtectedArea area="Donor records"><DonationDetail /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="donors" element={<RequireRole roles={ops}><RequireDuty duty="donor_directory"><ProtectedArea area="Donor records"><Donors /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="donors/:id" element={<RequireRole roles={ops}><RequireDuty duty="donor_directory"><ProtectedArea area="Donor records"><DonorProfile /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="visitors" element={<RequireRole roles={ops}><RequireDuty duty="visitors"><ProtectedArea area="Visitor records"><Visitors /></ProtectedArea></RequireDuty></RequireRole>} />
        <Route path="meals" element={<RequireRole roles={ops}><RequireDuty duty="meals"><Meals /></RequireDuty></RequireRole>} />
        <Route path="my-schedule" element={<RequireRole roles={ops}><MySchedule /></RequireRole>} />
        <Route path="schedules" element={<RequireRole roles={admin}><Schedules /></RequireRole>} />
        <Route path="users" element={<RequireRole roles={admin}><ProtectedArea area="Account records"><Users /></ProtectedArea></RequireRole>} />
        <Route path="settings" element={<RequireRole roles={admin}><SettingsPage /></RequireRole>} />
        {/* Admin: every tab. Staff: only the Data protection tab (the tabs check the role, the API enforces it). */}
        <Route path="audit-log" element={<RequireRole roles={admin}><ProtectedArea area="Audit log"><AuditLog /></ProtectedArea></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
