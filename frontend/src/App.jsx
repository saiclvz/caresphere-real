import { Navigate, Route, Routes } from 'react-router-dom';
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
import Adoptions from './pages/Adoptions';
import ApplicationDetail from './pages/ApplicationDetail';
import Transitions from './pages/Transitions';
import Donate from './pages/Donate';
import AdoptChild from './pages/AdoptChild';
import AdoptionForm from './pages/AdoptionForm';
import MyApplications from './pages/MyApplications';
import NotFound from './pages/NotFound';

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-page"><Spinner label="Restoring your session" /></div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const ops = ['Admin', 'Staff'];
  const admin = ['Admin'];
  const donor = ['Donor']; // Donor accounts include Adopt a Child and My applications
  const home = user.role === 'Donor' ? <DonorDashboard /> : <Dashboard />;
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route index element={home} />
        <Route path="donate" element={<RequireRole roles={donor}><Donate /></RequireRole>} />
        <Route path="donations/history" element={<RequireRole roles={donor}><DonorHistory /></RequireRole>} />
        <Route path="adopt" element={<RequireRole roles={donor}><AdoptChild /></RequireRole>} />
        <Route path="applications" element={<RequireRole roles={donor}><MyApplications /></RequireRole>} />
        <Route path="applications/new" element={<RequireRole roles={donor}><AdoptionForm /></RequireRole>} />
        <Route path="applications/:id" element={<RequireRole roles={donor}><ApplicationDetail /></RequireRole>} />
        <Route path="adoptions" element={<RequireRole roles={ops}><Adoptions /></RequireRole>} />
        <Route path="adoptions/:id" element={<RequireRole roles={ops}><ApplicationDetail /></RequireRole>} />
        <Route path="transitions" element={<RequireRole roles={ops}><Transitions /></RequireRole>} />
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
        <Route path="audit-log" element={<RequireRole roles={admin}><AuditLog /></RequireRole>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
