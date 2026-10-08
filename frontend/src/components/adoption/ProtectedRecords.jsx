import { useState } from 'react';
import '../../pages/adoption/adoption.css'; // QR print slips
import { Link } from 'react-router-dom';
import { Copy, KeyRound, Lock, Printer } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Button, Card, ErrorNote, Field, Modal } from '../ui';
import QrCode from '../QrCode';
import { publicBaseUrl } from '../../lib/publicUrl';
import { formatDateTime } from '../../lib/format';
import usePrintSlip from './usePrintSlip';

export const protectedUrl = (publicId) => `${publicBaseUrl()}/protected/${publicId}`;

/** Admin: issue a token for one record and one staff user. The token is shown once. */
export function IssueTokenModal({ record, onClose }) {
  const { toast } = useApp();
  const users = useApi('/users?role=Staff');
  const staff = (users.data?.data || []).filter((u) => u.is_active);
  const [form, setForm] = useState({ staff_user_id: '', expires_hours: '24', max_uses: '3', purpose: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!form.staff_user_id) found.staff_user_id = 'Choose the staff member.';
    const h = Number(form.expires_hours);
    if (!Number.isInteger(h) || h < 1 || h > 168) found.expires_hours = 'Enter 1 to 168 hours (7 days).';
    const m = Number(form.max_uses);
    if (!Number.isInteger(m) || m < 1 || m > 20) found.max_uses = 'Enter 1 to 20.';
    if (form.purpose.trim().length < 5) found.purpose = 'State the purpose (at least 5 characters).';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true); setError(null);
    try {
      const res = await api(`/protected-records/${record.record_id}/tokens`, { method: 'POST', body: { staff_user_id: Number(form.staff_user_id), expires_hours: h, max_uses: m, purpose: form.purpose.trim() } });
      setIssued(res.data);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(issued.token); toast('Token copied.'); } catch { toast('Select the token and copy it.', 'error'); }
  };

  if (issued) {
    return (
      <Modal open onClose={onClose} title="Token issued" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-amber-50 p-2 text-amber-900">This token is shown <strong>only once</strong>. Give it to {issued.staff_name} privately. It is not stored and can't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-slate-100 p-3 text-center font-mono text-xl tracking-widest text-navy-900">{issued.token}</code>
            <Button variant="secondary" onClick={copy} aria-label="Copy token"><Copy className="h-4 w-4" /> Copy</Button>
          </div>
          <p className="text-slate-600">Record: {issued.record_label}<br />Expires {formatDateTime(issued.expires_at)} · up to {issued.max_uses} use{issued.max_uses === 1 ? '' : 's'}</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title="Issue access token"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="token-form" loading={busy}>Issue token</Button></>}>
      <form id="token-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error || users.error} />
        <p className="text-sm text-slate-600">For: <strong>{record.label}</strong>. The token works only for this record and this staff member.</p>
        <Field label="Staff member" required error={errors.staff_user_id}>
          <select className="input" value={form.staff_user_id} onChange={set('staff_user_id')}>
            <option value="">Select...</option>
            {staff.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} ({u.email})</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expires after (hours)" required error={errors.expires_hours} hint="Default 24, maximum 168 (7 days)">
            <input className="input" type="number" min="1" max="168" value={form.expires_hours} onChange={set('expires_hours')} />
          </Field>
          <Field label="Maximum uses" required error={errors.max_uses} hint="Default 3">
            <input className="input" type="number" min="1" max="20" value={form.max_uses} onChange={set('max_uses')} />
          </Field>
        </div>
        <Field label="Purpose" required error={errors.purpose} hint="Recorded in the audit log.">
          <textarea className="input" rows={2} maxLength={500} value={form.purpose} onChange={set('purpose')} />
        </Field>
      </form>
    </Modal>
  );
}

/**
 * Admin: "Protected record QR" cards. The QR encodes only {BASE_URL}/protected/{random id}.
 * The label has no personal data. Print shows only the QR and the label.
 */
export default function ProtectedRecords({ records, onChanged, title = 'Protected record QR' }) {
  const { toast } = useApp();
  const [issuing, setIssuing] = useState(null);
  const [printing, print] = usePrintSlip();
  // Whole-record tokens (application / child) are issued from the record's page, not as file QR cards.
  records = (records || []).filter((r) => !['adoption_application', 'child_record'].includes(r.record_type));
  if (!records.length) return null;
  const toggleDownload = async (r) => {
    try {
      await api(`/protected-records/${r.record_id}`, { method: 'PUT', body: { allow_download: !r.allow_download } });
      toast(!r.allow_download ? 'Staff with a token can now download a watermarked copy.' : 'Downloads blocked for staff.');
      onChanged?.();
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-navy-900"><Lock className="h-4 w-4 text-red-600" aria-hidden /> {title}</h2>
        <Link to="/audit-log?tab=data-protection" className="text-xs font-medium text-brand hover:underline">Manage staff tokens</Link>
      </div>
      <ul className="space-y-3">
        {records.map((r) => (
          <li key={r.record_id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex gap-3">
              <QrCode value={protectedUrl(r.public_id)} size={72} label={`QR code for protected record: ${r.label}`} />
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="font-medium text-navy-900">{r.label}</p>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setIssuing(r)}><KeyRound className="h-3.5 w-3.5" /> Issue token</Button>
                  <Button size="sm" variant="ghost" onClick={() => { print(r.record_id); api('/qr-prints', { method: 'POST', body: { kind: 'protected', id: r.record_id } }).catch(() => {}); }}><Printer className="h-3.5 w-3.5" /> Print</Button>
                  <Link to={`/protected/${r.public_id}`} className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-slate-100">Open</Link>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={!!r.allow_download} onChange={() => toggleDownload(r)} />
                  Allow staff with a token to download (watermarked)
                </label>
              </div>
            </div>
            <div className={`cs-print-slip ${printing === r.record_id ? 'is-active' : ''}`} aria-hidden="true">
              <div style={{ display: 'inline-block', marginBottom: 16 }}><QrCode value={protectedUrl(r.public_id)} size={240} label="" /></div>
              <p style={{ fontSize: 16, fontWeight: 700 }}>{r.label}</p>
              <p style={{ fontSize: 11, marginTop: 8 }}>Protected record. Opening it requires authorization.</p>
            </div>
          </li>
        ))}
      </ul>
      {issuing && <IssueTokenModal record={issuing} onClose={() => { setIssuing(null); onChanged?.(); }} />}
    </Card>
  );
}
