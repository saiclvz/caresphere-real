import { useState } from 'react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Card, Field } from './ui';

/** Admin: the child's case worker. Only this staff member can unlock the child's Transition Review. */
export default function ChildCaseWorker({ child, onSaved }) {
  const { toast } = useApp();
  const users = useApi('/users?role=Staff');
  // A case worker needs the Health records duty (the server checks it too).
  const staff = (users.data?.data || []).filter((u) => u.is_active && (u.duties || []).includes('health'));
  const [busy, setBusy] = useState(false);
  const save = async (value) => {
    setBusy(true);
    try {
      await api(`/children/${child.child_id}/assign`, { method: 'PUT', body: { staff_user_id: value || null } });
      toast(value ? 'Case worker updated.' : 'Case worker removed.'); onSaved?.();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5">
      <Field label="Case worker" hint="Only this staff member can unlock the child's Transition Review (18+).">
        <select className="input" disabled={busy} value={child.assigned_staff_id || ''} onChange={(e) => save(e.target.value)}>
          <option value="">Not assigned</option>
          {staff.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
        </select>
      </Field>
    </Card>
  );
}
