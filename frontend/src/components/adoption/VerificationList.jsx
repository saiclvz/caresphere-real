import { useState } from 'react';
import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { unlockHeaders } from '../../lib/grants';
import { formatDate, formatDateTime } from '../../lib/format';
import { Badge, Button, Card, Field } from '../ui';

const OK = ['Verified'];
const NEUTRAL = ['Manual verification required', 'Pending verification'];
const tone = (s) => (OK.includes(s) ? 'green' : NEUTRAL.includes(s) ? 'amber' : s === 'Flagged for review' ? 'amber' : 'red');
const icon = (r) => (r === 'pass' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="Passed" />
  : r === 'fail' ? <XCircle className="h-3.5 w-3.5 text-red-600" aria-label="Failed" />
    : r === 'warn' ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Warning" /> : <MinusCircle className="h-3.5 w-3.5 text-slate-400" aria-label="Not applicable" />);
/** What the status means, in plain words. Nothing is called genuine without a person's verification. */
const statusText = (v) => (v.status === 'Verified' && String(v.method || '').startsWith('Official verification')
  ? `Verified – real and valid. Confirmed by ${v.method.replace('Official verification: ', '')}${v.method_ref ? ` (ref ${v.method_ref})` : ''}.`
  : v.status === 'Verified'
  ? `Verified by ${v.reviewed_by_name || 'staff'}${v.method ? `: ${v.method.toLowerCase()}` : ''}${v.method_ref ? ` (ref ${v.method_ref})` : ''}`
  : v.status === 'Manual verification required' ? 'Automatic checks passed. A person must verify the original before it counts.' : null);
const CORRECTABLE = ['Requires correction', 'Information mismatch', 'Invalid ID number', 'Expired', 'Invalid', 'Unrecognized ID', 'ID type mismatch', 'Not verified', 'Verification failed', 'Invalid ID'];

function StaffReview({ app, v, config, onUpdated }) {
  const { toast } = useApp();
  const [f, setF] = useState({ status: '', method: '', method_ref: '', note: '' });
  const [busy, setBusy] = useState(false);
  const results = config.verification.review_results[v.kind] || [];
  const save = async () => {
    setBusy(true);
    try {
      const res = await api(`/adoptions/${app.application_id}/verifications/${v.verification_id}/review`, { method: 'POST', body: f, headers: unlockHeaders('adoption_application', app.application_id) });
      onUpdated(res.data); setF({ status: '', method: '', method_ref: '', note: '' }); toast('Verification recorded.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const valid = f.status && (f.status !== 'Verified' || f.method) && (f.status !== 'Requires correction' || f.note.trim().length >= 5);
  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-2">
      <Field label="Result"><select className="input h-9" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
        <option value="">Choose...</option>{results.map((r) => <option key={r}>{r}</option>)}</select></Field>
      {f.status === 'Verified' && (
        <Field label="How you verified it"><select className="input h-9" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
          <option value="">Choose...</option>{config.verification.methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
      )}
      {f.status === 'Verified' && <Field label="Reference from the check (optional)"><input className="input h-9" maxLength={120} value={f.method_ref} onChange={(e) => setF({ ...f, method_ref: e.target.value })} /></Field>}
      <Field label={f.status === 'Requires correction' ? 'What to correct (sent to the applicant)' : 'Note (optional)'}>
        <input className="input h-9" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Button size="sm" loading={busy} disabled={!valid} onClick={save}>Save result</Button></div>
    </div>
  );
}

function DonorCorrection({ app, v, config, onUpdated }) {
  const { toast } = useApp();
  const form = app.form || {};
  const idx = v.kind === 'clearance' ? Number(v.slot.split('-')[1]) - 1 : -1;
  const [f, setF] = useState(v.kind === 'government_id'
    ? { id_type: form.id_type || '', id_number: form.id_number || '', id_expiry: form.id_expiry || '', id_name: form.id_name || '', id_dob: form.id_dob || '' }
    : { ...(form.clearances?.[idx] || {}) });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: k === 'id_number' || k === 'number' ? e.target.value.toUpperCase() : e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = v.kind === 'government_id' ? f : { clearance: f };
      const res = await api(`/adoptions/${app.application_id}/verifications/${v.verification_id}`, { method: 'PUT', body });
      onUpdated(res.data); setOpen(false); toast('Sent to the home for checking.');
    } catch (err) { toast(err.details?.errors ? Object.values(err.details.errors)[0] : err.message, 'error'); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" className="cs-btn cs-btn-sm mt-2" onClick={() => setOpen(true)}>Correct the details</button>;
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {v.kind === 'government_id' ? (
        <>
          <label className="text-sm">ID type<select className="cs-input" value={f.id_type} onChange={set('id_type')}>{[...config.verification.id_types, 'Other'].map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="text-sm">ID number<input className="cs-input" value={f.id_number} onChange={set('id_number')} /></label>
          <label className="text-sm">Expiry date (if the ID has one)<input type="date" className="cs-input" value={f.id_expiry} onChange={set('id_expiry')} /></label>
          <label className="text-sm">Name as printed<input className="cs-input" value={f.id_name} onChange={set('id_name')} /></label>
          <label className="text-sm">Date of birth as printed<input type="date" className="cs-input" value={f.id_dob} onChange={set('id_dob')} /></label>
        </>
      ) : (
        <>
          <label className="text-sm">Whose clearance<input className="cs-input" value={f.holder || ''} onChange={set('holder')} /></label>
          <label className="text-sm">Kind<select className="cs-input" value={f.kind || ''} onChange={set('kind')}>{['NBI clearance', 'Police clearance', 'Court clearance'].map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="text-sm">Reference number<input className="cs-input" value={f.number || ''} onChange={set('number')} /></label>
          <label className="text-sm">Date issued<input type="date" className="cs-input" value={f.issue_date || ''} onChange={set('issue_date')} /></label>
        </>
      )}
      <div className="flex gap-2 sm:col-span-2"><button type="button" className="cs-btn cs-btn-sm cs-btn-primary" disabled={busy} onClick={save}>{busy ? 'Sending...' : 'Send correction'}</button>
        <button type="button" className="cs-btn cs-btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

/**
 * Government ID and clearance checks. Staff: automatic check results, the history and the review. Applicant:
 * the status, the home's note, and a correction form when something needs fixing. No screenshots involved.
 */
export default function VerificationList({ app, config, mode, onUpdated }) {
  const list = app.verifications || [];
  if (!list.length) return null;
  const staff = mode === 'staff';
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold text-navy-900">ID and clearance checks</h2>
      <p className="text-xs text-slate-500">No official verification service is connected. CareSphere runs automatic checks, and a person verifies the original before anything counts as verified.</p>
      <ul className="divide-y divide-slate-100">
        {list.map((v) => (
          <li key={v.verification_id} className="py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-navy-900">{v.kind === 'government_id' ? `Government ID: ${v.item_type}` : `${v.item_type}: ${v.holder}`}</p>
                <p className="text-xs text-slate-500">No. <span className="font-mono">{v.reference}</span>{v.issue_date ? ` · issued ${formatDate(v.issue_date)}` : ''}{v.expiry_date ? ` · valid to ${formatDate(v.expiry_date)}` : ''} · last checked {formatDateTime(v.last_checked)}</p>
              </div>
              <Badge tone={tone(v.status)}>{v.status}</Badge>
            </div>
            {statusText(v) && <p className="mt-1 text-xs text-slate-600">{statusText(v)}</p>}
            {v.note && <p className="mt-1 text-xs text-amber-800">Note from the home: {v.note}</p>}
            {staff && (
              <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {v.checks.map((c) => <li key={c.check} className="flex items-start gap-1.5">{icon(c.result)}<span><span className="font-medium">{c.check}:</span> {c.message}</span></li>)}
              </ul>
            )}
            {!staff && v.checks.filter((c) => c.result === 'fail').map((c) => <p key={c.check} className="mt-1 text-xs text-red-700">{c.check}: {c.message}</p>)}
            {staff && v.history?.length > 0 && (
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-brand">History ({v.history.length})</summary>
                <ul className="mt-1 space-y-0.5 text-slate-600">{v.history.map((h, i) => <li key={i}>{formatDateTime(h.created_at)}: {h.from_status ? `${h.from_status} → ` : ''}{h.to_status} ({h.actor}){h.detail ? ` · ${h.detail}` : ''}</li>)}</ul>
              </details>
            )}
            {staff && onUpdated && <StaffReview app={app} v={v} config={config} onUpdated={onUpdated} />}
            {!staff && CORRECTABLE.includes(v.status) && <DonorCorrection app={app} v={v} config={config} onUpdated={onUpdated} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}
