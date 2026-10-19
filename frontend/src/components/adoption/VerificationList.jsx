import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Flag, Images, MinusCircle, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { unlockHeaders } from '../../lib/grants';
import { formatDate, formatDateTime } from '../../lib/format';
import { Badge, Button, Card, Field, Modal } from '../ui';
import { DocumentPages } from '../DocumentViewer';

const OK = ['Verified'];
const NEUTRAL = ['Manual verification required', 'Pending verification', 'Unable to verify', 'Flagged for review'];
const tone = (s) => (OK.includes(s) ? 'green' : NEUTRAL.includes(s) ? 'amber' : 'red');
const icon = (r) => (r === 'pass' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="Passed" />
  : r === 'fail' ? <XCircle className="h-3.5 w-3.5 text-red-600" aria-label="Failed" />
    : r === 'warn' ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Warning" /> : <MinusCircle className="h-3.5 w-3.5 text-slate-400" aria-label="Not applicable" />);
/** Icon beside a status badge, so the status reads by shape and text as well as colour (no emoji). */
export function StatusIcon({ tone: t }) {
  const I = t === 'green' ? CheckCircle2 : t === 'amber' ? AlertTriangle : XCircle;
  return <I className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}
const isOfficial = (v) => v.status === 'Verified' && String(v.method || '').startsWith('Official verification');

/**
 * The label shown for a status. "Verified – real and valid" only when an authorized official source confirmed
 * it; a person's check shows as "Verified (manual check)". Nothing is ever labelled fake.
 */
export function statusLabel(v) {
  if (v.status === 'Verified') {
    if (isOfficial(v)) return v.official?.mode === 'staff_confirmed' ? 'Verified – real and valid (PhilSys Check, Staff-confirmed)' : 'Verified – real and valid';
    return `Manually verified by ${v.reviewed_by_role || 'staff'}${v.reviewed_at ? ` on ${formatDate(v.reviewed_at)}` : ''}`;
  }
  const id = v.kind === 'government_id';
  const map = {
    'Manual verification required': 'Manual verification required', 'Unable to verify': 'Unable to verify', 'Flagged for review': 'Flagged for review',
    'Pending verification': 'Pending verification', Expired: id ? 'Expired ID' : 'Expired', 'Invalid ID': 'Invalid ID', 'Invalid ID number': 'Invalid ID number',
    'Information mismatch': 'Information mismatch', 'ID type mismatch': 'ID type mismatch', 'Unrecognized ID': 'Unrecognized ID',
    'Requires correction': 'Correction requested', Invalid: 'Invalid', 'Not verified': 'Not verified', 'Verification failed': 'Verification failed',
  };
  return map[v.status] || v.status;
}

/** What the status means, in plain words. Nothing is called genuine without official confirmation. */
const statusText = (v) => (isOfficial(v)
  ? `Confirmed by ${v.official?.source || v.method.replace('Official verification: ', '')}${v.official?.mode === 'staff_confirmed' ? `, recorded by ${v.official.by_name || 'staff'}${v.official.by_role ? ` (${v.official.by_role})` : ''}` : ' (automatic)'}${v.official?.reference || v.method_ref ? `, ref ${v.official?.reference || v.method_ref}` : ''}${v.official?.at || v.reviewed_at ? `, on ${formatDateTime(v.official?.at || v.reviewed_at)}` : ''}.`
  : v.status === 'Verified'
    ? `Checked by ${v.reviewed_by_name || 'staff'}${v.reviewed_by_role ? ` (${v.reviewed_by_role})` : ''}${v.method ? `: ${v.method.toLowerCase()}` : ''}${v.method_ref ? ` (ref ${v.method_ref})` : ''}${v.reviewed_at ? ` on ${formatDateTime(v.reviewed_at)}` : ''}. This is a manual verification; no official source confirmed it.`
    : v.status === 'Manual verification required' ? 'No official verification result yet. Authorized staff must verify the original before it counts.'
      : v.status === 'Flagged for review' ? 'Potential problem found (for example, a possible screenshot, a QR code that differs from the card, or a reused number). Manual verification required. This does not mean the ID is fake.'
        : null);
const CORRECTABLE = ['Requires correction', 'Information mismatch', 'Invalid ID number', 'Expired', 'Invalid', 'Unrecognized ID', 'ID type mismatch', 'Not verified', 'Verification failed', 'Invalid ID'];

/** Reason for manual review, from the failed and warning checks. */
const reasons = (v) => v.checks.filter((c) => c.result === 'fail' || c.result === 'warn').map((c) => `${c.check}: ${c.message}`);

/** What the applicant entered next to what the scan read (printed text, QR code or MRZ), for the reviewer. */
function ExtractedInfo({ v }) {
  const ex = v.scan?.extracted || v.extracted || null;
  const ai = v.applicant_info;
  if (!ai) return null;
  const fd = (d) => (d ? formatDate(d) : null);
  const row = (label, entered, read) => (
    <tr key={label}><td className="py-0.5 pr-3 font-medium text-slate-600">{label}</td><td className="py-0.5 pr-3">{entered || '–'}</td><td className="py-0.5">{read || <span className="text-slate-400">not found</span>}</td></tr>
  );
  const detected = v.scan?.front?.detected_type;
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 p-2 text-xs">
      <table className="w-full text-left">
        <thead><tr className="text-slate-500"><th className="pb-1 pr-3 font-medium">Field</th><th className="pb-1 pr-3 font-medium">Entered by the applicant</th><th className="pb-1 font-medium">Read from the ID (scan)</th></tr></thead>
        <tbody>
          {row('ID type', ai.id_type, detected)}
          {row('ID number', ai.id_number, ex?.id_number)}
          {row('Full name', [ai.full_name, ai.name_on_id && ai.name_on_id !== ai.full_name ? `as on ID: ${ai.name_on_id}` : null].filter(Boolean).join(' · '), ex?.full_name)}
          {row('Date of birth', fd(ai.date_of_birth), fd(ex?.date_of_birth))}
          {row('Address', null, ex?.address)}
          {row('Date issued', null, fd(ex?.date_issued))}
          {row('Expiry date', fd(ai.expiry_on_id || v.expiry_date), fd(ex?.expiry_date))}
        </tbody>
      </table>
      <p className="mt-1 text-slate-500">
        {v.scan?.front?.purged ? 'What was read has been cleared under the retention setting. Compare the original by hand.'
          : ex ? 'Read automatically on this server. Readings can be wrong and never prove an ID is genuine.'
            : 'The ID photos have not been read yet.'}
      </p>
    </div>
  );
}

const RESULT_WORD = { passed: 'Passed', failed: 'Failed', unreadable: 'Unable to read' };

/** One side of the ID: scan result, measurements, and each check. */
function ScanSide({ title, s }) {
  if (!s) return <div className="rounded-lg border border-dashed border-slate-300 p-2 text-xs text-slate-500">{title}: not uploaded.</div>;
  const q = s.quality || {};
  return (
    <div className="rounded-lg border border-slate-200 p-2 text-xs">
      <p className="font-medium text-navy-900">{title} · attempt {s.attempt_no} · {s.state === 'done' ? RESULT_WORD[s.result] || s.result : 'Scanning...'}</p>
      {s.state === 'done' && (
        <p className="mt-0.5 text-slate-500">
          {s.detected_type ? `Looks like: ${s.detected_type}${s.detected_side ? ` (${s.detected_side})` : ''}` : 'Type not recognized'}
          {q.width ? ` · ${q.width}×${q.height}px, brightness ${q.brightness}, sharpness ${q.sharpness}, glare ${q.glare}%, camera data ${q.camera_data ? 'yes' : 'no'}` : ''}
          {s.machine?.kind && s.machine.kind !== 'none' ? ` · ${s.machine.kind.toUpperCase()}: ${s.machine.status || 'not found'}` : ''}
        </p>
      )}
      <ul className="mt-1 space-y-0.5">
        {(s.checks || []).map((c) => <li key={c.check} className="flex items-start gap-1.5">{icon(c.result)}<span><span className="font-medium">{c.check}:</span> {c.message}</span></li>)}
      </ul>
    </div>
  );
}

/** Both photos side by side in the protected viewer (drawn on canvases, no download). */
function IdImages({ app, scan, onClose }) {
  const headers = unlockHeaders('adoption_application', app.application_id);
  const sides = [['Front', scan.front], ['Back', scan.back]].filter(([, s]) => s?.document_id);
  return (
    <Modal open onClose={onClose} title="ID photos (front and back)" size="xl">
      <div className="grid gap-4 md:grid-cols-2">
        {sides.map(([label, s]) => (
          <div key={label}>
            <p className="mb-1 text-sm font-medium text-navy-900">{label}</p>
            <DocumentPages path={`/adoptions/${app.application_id}/documents/${s.document_id}`} headers={headers} title={`ID ${label.toLowerCase()}`} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** PhilSys Check, done by authorized staff on the ORIGINAL card, then recorded here (Staff-confirmed). */
function PhilSysCheck({ app, v, onUpdated }) {
  const { toast } = useApp();
  const empty = { result: '', details_match: null, reference: '', note: '' };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const valid = f.result && (f.result !== 'verified' || (f.details_match === true || (f.details_match === false && f.note.trim().length >= 5)));
  const save = async () => {
    setBusy(true);
    try {
      const res = await api(`/adoptions/${app.application_id}/verifications/${v.verification_id}/philsys-check`, { method: 'POST', body: f, headers: unlockHeaders('adoption_application', app.application_id) });
      onUpdated(res.data); setF(empty); setOpen(false); toast('PhilSys Check result recorded.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" className="cs-btn cs-btn-sm mt-2" onClick={() => setOpen(true)}><ShieldCheck className="h-4 w-4" aria-hidden /> Verify with PhilSys Check</button>;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
      <p className="font-medium text-navy-900">Verify with PhilSys Check</p>
      <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
        <li>Ask the applicant for the original card (or the original ePhilID printout).</li>
        <li>Open <a className="text-brand underline" href="https://verify.philsys.gov.ph" target="_blank" rel="noreferrer noopener">verify.philsys.gov.ph <ExternalLink className="inline h-3 w-3" aria-hidden /></a> and scan the QR code on the original, not the uploaded photo.</li>
        <li>Compare the name, date of birth and photo PhilSys Check displays with the printed card, then record the result below.</li>
      </ol>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-slate-600">What PhilSys Check showed</legend>
        {[['verified', 'Verified (the card checked out)'], ['deactivated', 'Deactivated card'], ['unreadable', 'QR code could not be read']].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2"><input type="radio" name={`philsys-${v.verification_id}`} checked={f.result === k} onChange={() => setF({ ...f, result: k, details_match: null })} /> {label}</label>
        ))}
      </fieldset>
      {f.result === 'verified' && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-slate-600">Do the details shown match the printed card?</legend>
          <label className="flex items-center gap-2"><input type="radio" name={`match-${v.verification_id}`} checked={f.details_match === true} onChange={() => setF({ ...f, details_match: true })} /> Yes, they match</label>
          <label className="flex items-center gap-2"><input type="radio" name={`match-${v.verification_id}`} checked={f.details_match === false} onChange={() => setF({ ...f, details_match: false })} /> No, something differs</label>
        </fieldset>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Reference shown (optional)"><input className="input h-9" maxLength={120} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label={f.details_match === false ? 'What differs (required)' : 'Note (optional)'}><input className="input h-9" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-slate-500">This is recorded as Staff-confirmed (not automatic), with your name and the time. Only "Verified" with matching details gives "Verified – real and valid".</p>
      <div className="flex gap-2"><Button size="sm" loading={busy} disabled={!valid} onClick={save}>Record result</Button>
        <button type="button" className="cs-btn cs-btn-sm" onClick={() => { setF(empty); setOpen(false); }}>Cancel</button></div>
    </div>
  );
}

/** Staff and Admin: the automatic scan of the front and back, the flags, and the official verification. */
function IdScanPanel({ app, v, onUpdated }) {
  const [images, setImages] = useState(false);
  const scan = v.scan;
  if (!scan) return null;
  const official = isOfficial(v);
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-navy-900">Automated checks:</span>
        <Badge tone={scan.auto_result === 'Passed' ? 'green' : scan.auto_result ? 'red' : 'slate'}>{scan.auto_result || 'Not complete'}</Badge>
        <span className="font-medium text-navy-900">Authenticity:</span>
        <Badge tone={official ? 'green' : 'amber'}>{official ? 'VERIFIED – REAL AND VALID' : v.status === 'Verified' ? 'MANUALLY VERIFIED (no official result)' : 'MANUAL VERIFICATION REQUIRED'}</Badge>
        {(scan.front?.document_id || scan.back?.document_id) && (
          <button type="button" className="cs-btn cs-btn-sm ml-auto" onClick={() => setImages(true)}><Images className="h-4 w-4" aria-hidden /> View front and back</button>
        )}
      </div>
      {scan.flags?.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
          <p className="flex items-center gap-1 font-medium"><Flag className="h-3.5 w-3.5" aria-hidden /> Flagged for review (not proof of fraud)</p>
          <ul className="mt-0.5 list-disc pl-5">{scan.flags.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        <ScanSide title="Front" s={scan.front} />
        <ScanSide title={scan.rule && !scan.rule.needs_back ? 'Back (optional)' : 'Back'} s={scan.back} />
      </div>
      <p className="text-slate-500">Retakes used: front {Math.max(0, (scan.attempts?.front || 0) - 1)}, back {Math.max(0, (scan.attempts?.back || 0) - 1)} (5 allowed per side).</p>
      <div className="rounded-md border border-slate-200 bg-white p-2">
        <p className="font-medium text-navy-900">Official verification</p>
        {v.official ? (
          <p className="mt-0.5">Source: {v.official.source} · result: {v.official.result}{v.official.reference ? ` · ref ${v.official.reference}` : ''} · {formatDateTime(v.official.at)} · {v.official.mode === 'staff_confirmed' ? `Staff-confirmed by ${v.official.by_name || 'staff'}${v.official.by_role ? ` (${v.official.by_role})` : ''}` : 'automatic'}{!official ? ' · not the current result' : ''}</p>
        ) : (
          <p className="mt-0.5 text-slate-600">{v.adapter === 'philsys_check' ? 'No server verification exists for PhilSys yet: use PhilSys Check below.'
            : v.adapter === 'mrz_consistency' ? 'Passport: the MRZ check digits are checked for consistency only. No official passport verification is connected, so authorized staff verify the original.'
              : 'No official verification is available for this ID type. Authorized staff verify the original.'}</p>
        )}
        {v.adapter === 'philsys_check' && onUpdated && v.status !== 'Verified' && <PhilSysCheck app={app} v={v} onUpdated={onUpdated} />}
      </div>
      {images && <IdImages app={app} scan={scan} onClose={() => setImages(false)} />}
    </div>
  );
}

const ACTIONS = [
  { key: 'verify', label: 'Verify', cls: 'cs-btn-primary' },
  { key: 'reject', label: 'Reject', cls: '' },
  { key: 'correction', label: 'Request correction', cls: '' },
  { key: 'flag', label: 'Flag for review', cls: '' },
];

function StaffReview({ app, v, config, onUpdated }) {
  const { toast } = useApp();
  const empty = { action: '', status: '', method: '', method_ref: '', note: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const rejects = (config.verification.reject_reasons || {})[v.kind] || [];
  const needsNote = (config.verification.needs_resolution_note || []).includes(v.status);
  const pick = (action) => setF({ ...empty, action, status: action === 'verify' ? 'Verified' : action === 'correction' ? 'Requires correction' : action === 'flag' ? 'Flagged for review' : '' });
  const save = async () => {
    setBusy(true);
    try {
      const { action, ...body } = f;
      const res = await api(`/adoptions/${app.application_id}/verifications/${v.verification_id}/review`, { method: 'POST', body, headers: unlockHeaders('adoption_application', app.application_id) });
      onUpdated(res.data); setF(empty); toast('Verification recorded.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const noteOk = f.note.trim().length >= 5;
  const valid = f.status && (f.action !== 'verify' || (f.method && (!needsNote || noteOk))) && (!['reject', 'correction'].includes(f.action) || noteOk);
  const expired = v.expiry_date && v.expiry_date <= new Date().toISOString().slice(0, 10);
  const noteLabel = f.action === 'reject' ? 'Reason for rejecting (required)' : f.action === 'correction' ? 'What to correct (sent to the applicant)'
    : f.action === 'verify' && needsNote ? `How the "${v.status}" was resolved (required)` : 'Note (optional)';
  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Review action">
        {ACTIONS.map((a) => (
          <button key={a.key} type="button" disabled={a.key === 'verify' && expired} aria-pressed={f.action === a.key}
            className={`cs-btn cs-btn-sm ${f.action === a.key ? 'cs-btn-primary' : ''}`} onClick={() => pick(a.key)}
            title={a.key === 'verify' && expired ? 'An expired ID cannot be verified.' : undefined}>{a.label}</button>
        ))}
      </div>
      {f.action && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {f.action === 'reject' && (
            <Field label="Rejection result"><select className="input h-9" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">Choose...</option>{rejects.map((r) => <option key={r}>{r}</option>)}</select></Field>
          )}
          {f.action === 'verify' && (
            <Field label="How you verified it"><select className="input h-9" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option value="">Choose...</option>{config.verification.methods.map((m) => <option key={m}>{m}</option>)}</select></Field>
          )}
          {f.action === 'verify' && <Field label="Reference from the check (optional)"><input className="input h-9" maxLength={120} value={f.method_ref} onChange={(e) => setF({ ...f, method_ref: e.target.value })} /></Field>}
          <Field label={noteLabel}><input className="input h-9" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          {f.action === 'verify' && <p className="text-xs text-slate-500 sm:col-span-2">This is recorded as "Manually verified by [your role] on [date]", not "Verified – real and valid", because no official source confirmed it.</p>}
          <div className="flex gap-2 sm:col-span-2"><Button size="sm" loading={busy} disabled={!valid} onClick={save}>Save</Button>
            <button type="button" className="cs-btn cs-btn-sm" onClick={() => setF(empty)}>Cancel</button></div>
        </div>
      )}
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
      <p className="text-xs text-slate-500">CareSphere scans the ID photos on its own server (photo quality, ID type and side, number format, expiry, matching details, QR code or MRZ). These automated checks never prove an ID is genuine. Only an official verification result gives "Verified – real and valid"; without one, authorized staff verify the original and it shows as "Manually verified".</p>
      <ul className="divide-y divide-slate-100">
        {list.map((v) => (
          <li key={v.verification_id} className="py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-navy-900">{v.kind === 'government_id' ? `Government ID: ${v.item_type}` : `${v.item_type}: ${v.holder}`}</p>
                <p className="text-xs text-slate-500">No. <span className="font-mono">{v.reference}</span>{v.issue_date ? ` · issued ${formatDate(v.issue_date)}` : ''}{v.expiry_date ? ` · valid to ${formatDate(v.expiry_date)}` : ''} · last checked {formatDateTime(v.last_checked)}</p>
              </div>
              <Badge tone={tone(v.status)}><StatusIcon tone={tone(v.status)} />{statusLabel(v)}</Badge>
            </div>
            {statusText(v) && <p className="mt-1 text-xs text-slate-600">{statusText(v)}</p>}
            {v.note && <p className="mt-1 text-xs text-amber-800">Note from the home: {v.note}</p>}
            {staff && v.status !== 'Verified' && reasons(v).length > 0 && (
              <div className="mt-1 text-xs text-amber-800"><span className="font-medium">Reason for manual review: </span>{reasons(v).map((r) => r.split(':')[0]).join(', ')}</div>
            )}
            {staff && v.kind === 'government_id' && <IdScanPanel app={app} v={v} onUpdated={onUpdated} />}
            {staff && v.kind === 'government_id' && <ExtractedInfo v={v} />}
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
