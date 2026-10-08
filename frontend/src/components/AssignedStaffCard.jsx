import { useEffect, useState } from 'react';
import { AlertTriangle, UserCheck } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { formatDateTime } from '../lib/format';
import { Button, Card, Field } from './ui';

/**
 * "Assigned staff" for adoption applications and Transition Review (shared). Admin: a dropdown of
 * active Staff accounts plus Unassigned, and Save. Staff: read-only. The server rejects changes
 * from anyone but Admin.
 */
export default function AssignedStaffCard({ record, endpoint, onSaved, label = 'Assigned staff', duty }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const users = useApi(isAdmin ? '/users?role=Staff' : null);
  // Only active Staff with the duty for this kind of record (the server checks it too).
  const staff = (users.data?.data || []).filter((u) => u.is_active && (!duty || (u.duties || []).includes(duty)));
  const current = record.assigned_staff?.user_id ? String(record.assigned_staff.user_id) : '';
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(current), [current]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api(endpoint, { method: 'PUT', body: { staff_user_id: value || null } });
      onSaved(res.data);
      toast(value ? 'Assigned staff saved. They have been notified.' : 'Assignment removed.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold text-navy-900"><UserCheck className="h-4 w-4 text-brand" aria-hidden /> {label}</h2>
      {record.assignment_flag && isAdmin && (
        <p className="flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{record.assignment_flag}. Treated as unassigned; choose someone else.</p>
      )}
      {isAdmin ? (
        <>
          <Field label="Staff member" hint="Only this staff member can unlock the sensitive sections.">
            <select className="input" value={value} disabled={busy} onChange={(e) => setValue(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Button size="sm" loading={busy} disabled={value === current} onClick={save}>Save</Button>
        </>
      ) : (
        <p className="text-sm text-navy-900">{record.assigned_staff?.name || 'Not assigned'}</p>
      )}
      {record.assigned_at && <p className="text-xs text-slate-500">Assigned by {record.assigned_by_name || 'an administrator'} on {formatDateTime(record.assigned_at)}</p>}
    </Card>
  );
}
