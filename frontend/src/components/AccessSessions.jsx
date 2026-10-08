import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card } from './ui';
import { formatDateTime } from '../lib/format';

/** Admin: access requests and unlock sessions for this record, with Revoke. */
export default function AccessSessions({ recordType, recordId }) {
  const { toast } = useApp();
  const { data, reload } = useApi(`/unlock/sessions?record_type=${recordType}&record_id=${encodeURIComponent(recordId)}`);
  const rows = data?.data || [];
  const revoke = async (s) => {
    try { await api(`/unlock/sessions/${s.session_id}/revoke`, { method: 'POST' }); toast('Session ended.'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold text-navy-900">Access requests and sessions</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-500">No one has unlocked this record yet.</p> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((s) => (
            <li key={s.session_id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-navy-900">{s.user_name} <span className="font-normal text-slate-500">· {s.purpose}</span></p>
                {s.purpose_note && <p className="text-xs text-slate-500">"{s.purpose_note}"</p>}
                <p className="text-xs text-slate-500">Acknowledged {formatDateTime(s.acknowledged_at)} · started {formatDateTime(s.started_at)}
                  {s.active ? ` · until ${formatDateTime(s.expires_at)}` : ` · ${s.end_reason || 'expired'}${s.revoked_by_name ? ` by ${s.revoked_by_name}` : ''}`}</p>
              </div>
              {s.active ? <Button size="sm" variant="danger" onClick={() => revoke(s)}>Revoke</Button> : <Badge tone="slate">Ended</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

