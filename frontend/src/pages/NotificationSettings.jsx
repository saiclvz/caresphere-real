import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Field, PageHeader, Spinner } from '../components/ui';

/** Admin: notification retention and the clean-up (asks first; written to the audit log). */
function Retention() {
  const { toast } = useApp();
  const preview = useApi('/notifications/cleanup');
  const settings = useApi('/settings');
  const [days, setDays] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const current = days ?? settings.data?.data?.notification_retention_days ?? '90';
  const saveDays = async () => {
    setBusy(true);
    try { await api('/settings', { method: 'PUT', body: { notification_retention_days: String(current) } }); toast('Retention saved.'); preview.reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try { const r = await api('/notifications/cleanup', { method: 'POST' }); toast(`${r.data.deleted} old read notifications deleted.`); setConfirming(false); preview.reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const count = preview.data?.data?.count ?? 0;
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold text-navy-900">Retention (Admin)</h2>
      <p className="text-xs text-slate-500">Read and dismissed notifications older than this can be cleaned up. Nothing is deleted automatically.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Keep read notifications for (days)"><input className="input w-32" type="number" min="30" max="3650" value={current} onChange={(e) => setDays(e.target.value)} /></Field>
        <Button variant="secondary" loading={busy} onClick={saveDays}>Save</Button>
      </div>
      <p className="text-sm text-slate-600">{count} read notification{count === 1 ? ' is' : 's are'} older than {preview.data?.data?.days ?? current} days.</p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900">
          <span className="flex-1">Delete {count} old read notification{count === 1 ? '' : 's'} for all users? This is written to the audit log.</span>
          <Button size="sm" variant="danger" loading={busy} onClick={run}>Delete</Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      ) : <Button variant="secondary" disabled={!count} onClick={() => setConfirming(true)}>Clean up now</Button>}
    </Card>
  );
}

/** /notifications/settings - each user turns optional categories on or off. Critical events always arrive. */
export default function NotificationSettings() {
  const { user } = useAuth();
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi('/notifications/preferences');
  const [rows, setRows] = useState(null);
  const list = rows || data?.data || [];
  const toggle = async (c) => {
    try { const res = await api('/notifications/preferences', { method: 'PUT', body: { category: c.key, enabled: !c.enabled } }); setRows(res.data); toast(`${c.label}: ${c.enabled ? 'off' : 'on'}.`); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/notifications" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" /> Notifications</Link>
      <PageHeader title="Notification settings" description="Choose which kinds of notifications you get in the app." />
      <Card className="p-5">
        {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
          <ul className="divide-y divide-slate-100">
            {list.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-navy-900">{c.label}</p>
                  {c.always_on && <p className="flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3 w-3" aria-hidden /> {c.always_on}</p>}
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" role="switch" className="h-5 w-5 accent-brand" checked={c.enabled} onChange={() => toggle(c)} aria-label={`${c.label} notifications`} />
                  {c.enabled ? 'On' : 'Off'}
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {user.role === 'Admin' && <Retention />}
    </div>
  );
}
