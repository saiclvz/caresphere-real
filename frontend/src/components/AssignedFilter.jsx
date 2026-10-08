import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';

/** List filter for assigned staff. Admin: All, Unassigned, or a staff member. Staff: "Assigned to me". */
export default function AssignedFilter({ value, onChange }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const users = useApi(isAdmin ? '/users?role=Staff' : null);
  const staff = (users.data?.data || []).filter((u) => u.is_active);
  if (!isAdmin) {
    return (
      <label className="flex h-10 items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" className="h-4 w-4 accent-brand" checked={value === 'me'} onChange={(e) => onChange(e.target.checked ? 'me' : '')} /> Assigned to me
      </label>
    );
  }
  return (
    <div className="max-w-xs">
      <label className="sr-only" htmlFor="assigned-filter">Assigned staff</label>
      <select id="assigned-filter" className="input h-10" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All assigned staff</option>
        <option value="none">Unassigned</option>
        {staff.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
      </select>
    </div>
  );
}
