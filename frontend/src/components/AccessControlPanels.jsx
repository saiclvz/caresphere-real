import { useState } from 'react';
import { Link } from 'react-router-dom';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Spinner, Table } from './ui';
import { formatDateTime } from '../lib/format';
import { KeyRound } from 'lucide-react';

const EVENT_TONE = { issued: 'blue', used: 'green', view: 'slate', download: 'amber', failed: 'red', locked: 'red', expired: 'slate', revoked: 'slate' };

/** Admin: every active unlock session (adoption applications and child records), with Revoke. */
function ActiveUnlockSessions() {
  const { toast } = useApp();
  const { data, reload } = useApi('/unlock/sessions/active');
  const rows = data?.data || [];
  const revoke = async (s) => {
    try { await api(`/unlock/sessions/${s.session_id}/revoke`, { method: 'POST' }); toast('Session ended.'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Card>
      <h2 className="px-4 pt-4 font-semibold text-navy-900">Active unlock sessions</h2>
      <p className="px-4 text-xs text-slate-500">Staff who unlocked a record with the QR and Token ID. Revoking locks it for them immediately.</p>
      {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">No one has a record unlocked right now.</p> : (
        <Table>
          <thead className="bg-slate-50"><tr><th className="th">Record</th><th className="th">Staff</th><th className="th">Purpose</th><th className="th">Started</th><th className="th">Ends</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.session_id}>
                <td className="td font-mono text-sm">{s.reference_no || `Child ${s.record_id}`}</td>
                <td className="td">{s.user_name}</td>
                <td className="td text-sm">{s.purpose}</td>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(s.started_at)}</td>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(s.expires_at)}</td>
                <td className="td text-right"><Button size="sm" variant="danger" onClick={() => revoke(s)}>Revoke</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Inner() {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi('/protected-access');
  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);
  const tokens = data?.data?.tokens || [];
  const recent = data?.data?.recent || [];

  const revoke = async () => {
    setBusy(true);
    try { await api(`/protected-tokens/${revoking.token_id}/revoke`, { method: 'POST' }); toast('Token revoked.'); setRevoking(null); reload(); }
    catch (err) { toast(err.message, 'error'); setRevoking(null); } finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="mb-3 mt-8 text-lg font-semibold text-navy-900">Active access</h2>
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <div className="space-y-6">
          <ActiveUnlockSessions />
          <Card>
            <h2 className="px-4 pt-4 font-semibold text-navy-900">Active tokens (protected files)</h2>
            {tokens.length === 0 ? <EmptyState icon={KeyRound} title="No active tokens" description="Issue tokens from a record's Protected record QR card." /> : (
              <Table>
                <thead className="bg-slate-50"><tr><th className="th">Record</th><th className="th">Staff</th><th className="th">Purpose</th><th className="th">Uses</th><th className="th">Expires</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {tokens.map((t) => (
                    <tr key={t.token_id}>
                      <td className="td"><Link to={`/protected/${t.public_id}`} className="font-medium text-navy-900 hover:text-brand">{t.label}</Link><p className="text-xs text-slate-500">Issued by {t.issued_by_name}</p></td>
                      <td className="td">{t.staff_name}</td>
                      <td className="td max-w-xs text-sm">{t.purpose}</td>
                      <td className="td tabular-nums">{t.uses} / {t.max_uses}{t.failed_attempts > 0 && <p className="text-xs text-red-600">{t.failed_attempts} wrong tr{t.failed_attempts === 1 ? 'y' : 'ies'}</p>}</td>
                      <td className="td whitespace-nowrap">{formatDateTime(t.expires_at)}</td>
                      <td className="td text-right"><Button size="sm" variant="danger" onClick={() => setRevoking(t)}>Revoke</Button></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <h2 className="px-4 pt-4 font-semibold text-navy-900">Recent protected file access</h2>
            {recent.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing yet.</p> : (
              <Table>
                <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Event</th><th className="th">Record</th><th className="th">User</th><th className="th">Detail</th><th className="th">IP</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.map((r) => (
                    <tr key={r.log_id}>
                      <td className="td whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                      <td className="td"><Badge tone={EVENT_TONE[r.event]}>{r.event}</Badge></td>
                      <td className="td">{r.label || '-'}</td>
                      <td className="td">{r.user_name}</td>
                      <td className="td max-w-xs text-xs text-slate-600">{r.detail || '-'}</td>
                      <td className="td text-xs">{r.ip_address}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
      <ConfirmModal open={!!revoking} onClose={() => setRevoking(null)} onConfirm={revoke} loading={busy} confirmLabel="Revoke token" title="Revoke this token?"
        message={revoking ? `${revoking.staff_name} will lose access to "${revoking.label}" immediately, including any record they have open.` : ''} />
    </>
  );
}

/**
 * Admin: every active Staff unlock session and every active protected-file token, each with Revoke,
 * plus recent protected-file access. Shown in Audit log > Sensitive record access.
 */
export default function AccessControlPanels() {
  return <Inner />;
}
