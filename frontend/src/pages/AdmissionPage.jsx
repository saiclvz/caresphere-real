import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, CheckCircle2, FileText, ImagePlus, Lock, Plus, Send, Trash2, Upload, UserCheck, UserX, Undo2, XCircle } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field, Modal, Notice, Skeleton, Table } from '../components/ui';
import PhotoCropDialog from '../components/PhotoCropDialog';
import { formatDate, formatDateTime, isoDate } from '../lib/format';
import { MB, ageFromDob, checkFile, readFile } from '../lib/files';
import { openFileInNewTab } from '../lib/openFile';
import NotFound from './NotFound';

export const ADMISSION_TONE = { Draft: 'slate', 'Pending Approval': 'amber', 'Needs Correction': 'red', Admitted: 'green', Declined: 'slate' };
const STEPS = [[1, 'Basic information'], [2, 'Referral details'], [3, 'Parent/guardian and family'], [4, 'Documents / checklist']];
const OVER_AGE = 'Registration denied. The child exceeds the maximum age requirement.';
const blank = (v) => !String(v ?? '').trim();

/** Steps 1-4 as a row of buttons (any step can be opened; there is no approval between steps). */
function Stepper({ current, onSelect, done = [], disabled = false }) {
  return (
    <nav aria-label="Admission steps" className="relative mb-4 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1">
        {STEPS.map(([n, label], i) => {
          const state = n === current ? 'current' : done.includes(n) ? 'completed' : 'pending';
          return (
            <li key={n} className="flex items-center gap-1">
              <button type="button" disabled={disabled} onClick={() => onSelect?.(n)} aria-current={state === 'current' ? 'step' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-default ${
                  state === 'completed' ? 'bg-emerald-50 text-emerald-800' : state === 'current' ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {state === 'completed' ? <Check className="h-3 w-3" aria-hidden /> : <span aria-hidden>{n}</span>} Step {n}: {label}
                <span className="sr-only">({state})</span>
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-3 bg-slate-300" aria-hidden />}
            </li>
          );
        })}
        <li className="flex items-center gap-1"><span className="h-px w-3 bg-slate-300" aria-hidden /><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Submit for Admin Approval</span></li>
      </ol>
    </nav>
  );
}

/** Field errors from a 422 (server-side validation is the real check). */
const fieldErrors = (err) => err?.details?.errors || {};

// ---------------------------------------------------------------- Step 1
function BasicForm({ initial, creating, onSave, error, maxAge }) {
  const [f, setF] = useState({ first_name: '', last_name: '', gender: 'Female', dob: '', admission_date: isoDate(), place_of_birth: '', ...initial });
  const [photo, setPhoto] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const [touched, setTouched] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const age = ageFromDob(f.dob);
  const overAge = creating && age !== null && age > maxAge;
  const local = useMemo(() => {
    const e = {};
    if (blank(f.first_name)) e.first_name = 'First name is required.';
    if (blank(f.last_name)) e.last_name = 'Last name is required.';
    if (!f.dob) e.dob = 'Date of birth is required.'; else if (f.dob > isoDate()) e.dob = 'Date of birth cannot be in the future.'; else if (overAge) e.dob = OVER_AGE;
    if (f.admission_date && f.admission_date > isoDate()) e.admission_date = 'Admission date cannot be in the future.';
    if (f.admission_date && f.dob && f.admission_date < f.dob) e.admission_date = 'Admission date cannot be before the date of birth.';
    return e;
  }, [f, overAge]);
  const server = fieldErrors(error);
  const err = (k) => (touched || (k === 'dob' && overAge) ? local[k] : null) || server[k];
  const pickPhoto = (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const problem = checkFile(file, { types: ['image/jpeg', 'image/png'], maxBytes: 5 * MB });
    if (problem) { setPhoto({ error: `Profile photo: ${problem}` }); return; }
    setCropFile(file);
  };
  const submit = (e, extra = {}) => {
    e?.preventDefault?.();
    setTouched(true);
    if (Object.keys(local).length) return;
    onSave({ ...f, ...(photo?.data ? { photo: { name: photo.name, data: photo.data } } : {}), ...extra });
  };
  return (
    <form id="step-form" onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required error={err('first_name')}><input className="input" maxLength={50} value={f.first_name} onChange={set('first_name')} /></Field>
        <Field label="Last name" required error={err('last_name')}><input className="input" maxLength={50} value={f.last_name} onChange={set('last_name')} /></Field>
        <Field label="Gender" required error={err('gender')}><select className="input" value={f.gender} onChange={set('gender')}><option>Female</option><option>Male</option></select></Field>
        <Field label="Date of birth" required error={err('dob')} hint={age !== null && !local.dob ? `Age: ${age} ${age === 1 ? 'year' : 'years'}` : `Children up to ${maxAge} years old can be admitted.`}>
          <input className={`input ${overAge ? 'border-red-400 ring-2 ring-red-100' : ''}`} type="date" max={isoDate()} value={f.dob || ''} onChange={set('dob')} aria-invalid={Boolean(err('dob'))} />
        </Field>
        <Field label="Admission date" error={err('admission_date')} hint="The day the child came to the home. Required before submitting."><input className="input" type="date" max={isoDate()} value={f.admission_date || ''} onChange={set('admission_date')} /></Field>
        <Field label="Place of birth (optional)"><input className="input" maxLength={150} value={f.place_of_birth || ''} onChange={set('place_of_birth')} /></Field>
      </div>
      {creating && (
        <Field label="Profile photo (optional)" error={photo?.error} hint="JPG or PNG, up to 5 MB. Cropped to a square and stored encrypted.">
          <div className="flex items-center gap-3">
            {photo?.preview && <img src={photo.preview} alt="Cropped preview" className="h-14 w-14 rounded-lg object-cover" />}
            <span className="relative inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-navy-900 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand">
              <ImagePlus className="h-4 w-4" aria-hidden /> {photo?.data ? 'Change photo' : 'Choose photo'}
              <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={pickPhoto} />
            </span>
          </div>
        </Field>
      )}
      {cropFile && <PhotoCropDialog file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(out) => { setPhoto({ name: out.name, data: out.data, preview: out.preview }); setCropFile(null); }} />}
    </form>
  );
}

// ---------------------------------------------------------------- Step 2
function ReferralForm({ initial, options, onSave, error }) {
  const [f, setF] = useState({ referral_source: '', referring_agency: '', referring_person: '', referring_contact: '', referral_date: '', referral_reference: '', reason: '', background_care_info: '', ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ''])) });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const e = fieldErrors(error);
  return (
    <form id="step-form" noValidate className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); onSave({ ...f, referral_date: f.referral_date ? String(f.referral_date).slice(0, 10) : null }); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Referral source" required error={e.referral_source}>
          <select className="input" value={f.referral_source} onChange={set('referral_source')}><option value="">Choose…</option>{options.referral_sources.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
        <Field label="Referral date" required error={e.referral_date}><input className="input" type="date" max={isoDate()} value={String(f.referral_date || '').slice(0, 10)} onChange={set('referral_date')} /></Field>
        <Field label="Referring agency or office"><input className="input" maxLength={150} value={f.referring_agency} onChange={set('referring_agency')} /></Field>
        <Field label="Referring social worker or person"><input className="input" maxLength={150} value={f.referring_person} onChange={set('referring_person')} /></Field>
        <Field label="Their contact number or email" hint="Stored encrypted."><input className="input" maxLength={150} value={f.referring_contact} onChange={set('referring_contact')} /></Field>
        <Field label="Referral reference number"><input className="input" maxLength={80} value={f.referral_reference} onChange={set('referral_reference')} /></Field>
      </div>
      <Field label="Reason for admission" required hint="Stored encrypted. Facts only; no health details here."><textarea className="input" rows={3} maxLength={5000} value={f.reason} onChange={set('reason')} /></Field>
      <Field label="Circumstances and background (optional)" hint="Saved to the child's case files (encrypted)."><textarea className="input" rows={3} maxLength={10000} value={f.background_care_info} onChange={set('background_care_info')} /></Field>
    </form>
  );
}

// ---------------------------------------------------------------- Step 3
const blankGuardian = () => ({ name: '', relationship: '', status: '', contact: '', address: '' });
function FamilyForm({ initial, options, onSave, error }) {
  const [f, setF] = useState({ parents_unknown: Boolean(initial.parents_unknown), guardians: initial.guardians?.length ? initial.guardians.map((g) => ({ ...blankGuardian(), ...g, name: g.name || '', contact: g.contact || '', address: g.address || '' })) : [],
    siblings: initial.siblings || '', family_notes: initial.family_notes || '' });
  const e = fieldErrors(error);
  const setG = (i, patch) => setF((x) => ({ ...x, guardians: x.guardians.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));
  return (
    <form id="step-form" noValidate className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); onSave(f); }}>
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={f.parents_unknown} onChange={(ev) => setF({ ...f, parents_unknown: ev.target.checked })} />
        <span><span className="font-medium text-navy-900">Parents/guardians unknown</span><span className="block text-slate-500">For example a foundling. Otherwise add at least one parent or guardian.</span></span>
      </label>
      {e.guardians && <p className="text-sm text-red-600">{e.guardians}</p>}
      {f.guardians.map((g, i) => (
        <fieldset key={i} className="space-y-3 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-navy-900">Parent or guardian {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" error={e[`guardian_${i}_name`]} className="sm:col-span-1"><input className="input" maxLength={150} value={g.name} onChange={(ev) => setG(i, { name: ev.target.value })} /></Field>
            <Field label="Relationship" required error={e[`guardian_${i}_relationship`]}><select className="input" value={g.relationship || ''} onChange={(ev) => setG(i, { relationship: ev.target.value })}><option value="">Choose…</option>{options.relationships.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Status" required error={e[`guardian_${i}_status`]}><select className="input" value={g.status || ''} onChange={(ev) => setG(i, { status: ev.target.value })}><option value="">Choose…</option>{options.guardian_status.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Contact (optional)"><input className="input" maxLength={100} value={g.contact} onChange={(ev) => setG(i, { contact: ev.target.value })} /></Field>
            <Field label="Address (optional)" className="sm:col-span-2"><input className="input" maxLength={300} value={g.address} onChange={(ev) => setG(i, { address: ev.target.value })} /></Field>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, guardians: x.guardians.filter((_, j) => j !== i) }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove<span className="sr-only"> parent or guardian {i + 1}</span></Button>
        </fieldset>
      ))}
      {f.guardians.length < options.max_guardians && <Button variant="secondary" onClick={() => setF((x) => ({ ...x, guardians: [...x.guardians, blankGuardian()] }))}><Plus className="h-4 w-4" aria-hidden /> Add parent or guardian</Button>}
      <Field label="Siblings (optional)" hint="Stored encrypted."><textarea className="input" rows={2} maxLength={3000} value={f.siblings} onChange={(ev) => setF({ ...f, siblings: ev.target.value })} /></Field>
      <Field label="Family background notes (optional)" hint="Saved to the child's case files (encrypted)."><textarea className="input" rows={3} maxLength={10000} value={f.family_notes} onChange={(ev) => setF({ ...f, family_notes: ev.target.value })} /></Field>
    </form>
  );
}

// ---------------------------------------------------------------- Step 4
function DocumentsForm({ a, options, onSave, onUploaded, error }) {
  const { toast } = useApp();
  const [marks, setMarks] = useState(() => Object.fromEntries(a.checklist.map((c) => [c.key, { status: c.status || '', note: c.note || '' }])));
  const [busy, setBusy] = useState(null);
  const [upErr, setUpErr] = useState(null);
  const e = fieldErrors(error);
  const upload = async (key, file) => {
    setUpErr(null);
    const problem = checkFile(file, { types: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: options.file_max_mb * MB });
    if (problem) { setUpErr(problem); return; }
    setBusy(key);
    try {
      const res = await api(`/admissions/${a.child_id}/documents/${key}`, { method: 'POST', body: { file: await readFile(file) } });
      setMarks((m) => ({ ...m, [key]: { ...m[key], status: 'Received' } }));
      onUploaded(res.data); toast('Document uploaded.');
    } catch (err) { setUpErr(err.message); } finally { setBusy(null); }
  };
  return (
    <form id="step-form" noValidate className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); onSave({ checklist: Object.fromEntries(Object.entries(marks).filter(([, v]) => v.status)) }); }}>
      <p className="text-sm text-slate-600">Mark every item before submitting. Copies are optional (PDF, JPG or PNG, up to {options.file_max_mb} MB) and stored encrypted.</p>
      {upErr && <Notice tone="error">{upErr}</Notice>}
      <Table label="Admission checklist">
        <thead className="bg-slate-50"><tr><th className="th">Document</th><th className="th w-44">Status</th><th className="th">Note</th><th className="th">Copy</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {a.checklist.map((c) => (
            <tr key={c.key}>
              <td className="td text-sm">{c.label}{c.sensitive && <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3 w-3" aria-hidden /> Medical: opens only for Admin and the assigned case worker</span>}</td>
              <td className="td">
                <select className={`input h-9 ${e[`check_${c.key}`] ? 'border-red-400' : ''}`} aria-label={`Status of ${c.label}`} value={marks[c.key].status} onChange={(ev) => setMarks((m) => ({ ...m, [c.key]: { ...m[c.key], status: ev.target.value } }))}>
                  <option value="">Not marked</option>{options.check_statuses.map((s) => <option key={s}>{s}</option>)}
                </select>
              </td>
              <td className="td"><input className="input h-9" maxLength={500} aria-label={`Note for ${c.label}`} value={marks[c.key].note} onChange={(ev) => setMarks((m) => ({ ...m, [c.key]: { ...m[c.key], note: ev.target.value } }))} /></td>
              <td className="td text-sm">
                <FileLinks a={a} item={c} />
                <span className="relative mt-1 inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-navy-900 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-brand">
                  <Upload className="h-3 w-3" aria-hidden /> {busy === c.key ? 'Uploading…' : c.files.some((x) => !x.superseded) ? 'Replace' : 'Upload'}<span className="sr-only"> a copy of {c.label}</span>
                  <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={Boolean(busy)} onChange={(ev) => { const file = ev.target.files?.[0]; ev.target.value = ''; if (file) upload(c.key, file); }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </form>
  );
}

function FileLinks({ a, item }) {
  const { toast } = useApp();
  const current = item.files.filter((f) => !f.superseded);
  if (!current.length) return item.files.length ? null : <span className="block text-xs text-slate-400">No copy</span>;
  return current.map((f) => (item.can_open
    ? <button key={f.file_id} type="button" className="block max-w-[14rem] truncate text-left text-xs font-medium text-brand hover:underline" onClick={() => openFileInNewTab(`/admissions/${a.child_id}/files/${f.file_id}`).catch((e) => toast(e.message, 'error'))}><FileText className="mr-1 inline h-3 w-3" aria-hidden />{f.original_name}</button>
    : <span key={f.file_id} className="block text-xs text-slate-500"><Lock className="mr-1 inline h-3 w-3" aria-hidden />Copy on file ({formatDate(f.uploaded_at)})</span>));
}

// ---------------------------------------------------------------- read-only summary (Admin review, submitted, decided)
const Row = ({ label, children }) => <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-sm text-navy-900">{children || <span className="text-slate-400">Not recorded</span>}</dd></div>;
function Summary({ a }) {
  const b = a.basic; const r = a.referral; const f = a.family;
  return (
    <div className="space-y-4">
      <Card className="p-4"><h2 className="mb-3 font-semibold text-navy-900">Step 1: Basic information</h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Row label="Name">{b.full_name}</Row><Row label="Gender">{b.gender}</Row><Row label="Date of birth">{b.dob ? `${formatDate(b.dob)} (age ${ageFromDob(String(b.dob).slice(0, 10))})` : null}</Row>
          <Row label="Admission date">{b.admission_date ? formatDate(b.admission_date) : null}</Row><Row label="Place of birth">{b.place_of_birth}</Row><Row label="Photo">{b.has_photo ? 'On file' : 'None'}</Row>
        </dl></Card>
      <Card className="p-4"><h2 className="mb-3 font-semibold text-navy-900">Step 2: Referral details</h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Row label="Referral source">{r.referral_source}</Row><Row label="Referral date">{r.referral_date ? formatDate(r.referral_date) : null}</Row><Row label="Reference number">{r.referral_reference}</Row>
          <Row label="Referring agency">{r.referring_agency}</Row><Row label="Referring person">{r.referring_person}</Row><Row label="Their contact">{r.referring_contact}</Row>
          <div className="sm:col-span-3"><Row label="Reason for admission">{r.reason}</Row></div>
          <div className="sm:col-span-3"><Row label="Circumstances and background">{r.background_care_info}</Row></div>
        </dl></Card>
      <Card className="p-4"><h2 className="mb-3 font-semibold text-navy-900">Step 3: Parent/guardian and family</h2>
        {f.parents_unknown && <p className="mb-2 text-sm text-navy-900">Parents/guardians unknown.</p>}
        {f.guardians.length > 0 && (
          <Table label="Parents and guardians"><thead className="bg-slate-50"><tr><th className="th">Name</th><th className="th">Relationship</th><th className="th">Status</th><th className="th">Contact</th><th className="th">Address</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{f.guardians.map((g, i) => <tr key={i}><td className="td">{g.name || '-'}</td><td className="td">{g.relationship}</td><td className="td">{g.status}</td><td className="td">{g.contact || '-'}</td><td className="td">{g.address || '-'}</td></tr>)}</tbody></Table>)}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2"><Row label="Siblings">{f.siblings}</Row><Row label="Family background notes">{f.family_notes}</Row></dl></Card>
      <Card className="p-4"><h2 className="mb-3 font-semibold text-navy-900">Step 4: Documents / admission checklist</h2>
        <Table label="Admission checklist"><thead className="bg-slate-50"><tr><th className="th">Document</th><th className="th">Status</th><th className="th">Note</th><th className="th">Copy</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{a.checklist.map((c) => (
            <tr key={c.key}><td className="td text-sm">{c.label}</td><td className="td">{c.status ? <Badge tone={c.status === 'Received' ? 'green' : c.status === 'To follow' ? 'amber' : 'slate'}>{c.status}</Badge> : <span className="text-xs text-red-700">Not marked</span>}</td>
              <td className="td text-sm">{c.note || '-'}</td><td className="td"><FileLinks a={a} item={c} /></td></tr>))}</tbody></Table></Card>
    </div>
  );
}

// ---------------------------------------------------------------- Admin decisions
function ApproveDialog({ a, onClose, onDone }) {
  const opts = useApi('/admissions/assign-options');
  const [cw, setCw] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const o = opts.data?.data;
  useEffect(() => { if (o && cw === null) setCw(o.default_case_worker_id ? String(o.default_case_worker_id) : ''); }, [o]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setBusy(true); setError(null);
    try { const res = await api(`/admissions/${a.child_id}/approve`, { method: 'POST', body: { case_worker_id: cw ? Number(cw) : undefined, note: note || undefined } }); onDone(res); }
    catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Approve admission ${a.child_id}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={go}><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve Admission</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">The child becomes <strong>Admitted</strong> and appears in the Children list. Creating a record does not make the staff member its case worker: only the person assigned here (or later) keeps working on the child.</p>
        <ErrorNote error={error && !fieldErrors(error).user_id ? error : null} />
        <Field label="Case worker" error={fieldErrors(error).user_id} hint={o?.default_case_worker_id ? 'The default case worker from Settings is suggested.' : 'You can also assign later on the child\'s page.'}>
          <select className="input" value={cw ?? ''} onChange={(e) => setCw(e.target.value)} disabled={!o}>
            <option value="">Leave unassigned for now</option>
            {(o?.staff || []).map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}{s.user_id === a.created_by.user_id ? ' (created this admission)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Note (optional)"><textarea className="input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ReasonDialog({ a, kind, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ret = kind === 'return';
  const go = async () => {
    setBusy(true); setError(null);
    try { const res = await api(`/admissions/${a.child_id}/${ret ? 'return' : 'decline'}`, { method: 'POST', body: ret ? { note: text } : { reason: text } }); onDone(res); }
    catch (err) { setError(err); setBusy(false); }
  };
  const e = fieldErrors(error);
  return (
    <Modal open onClose={onClose} title={ret ? 'Return for Correction' : 'Decline Admission'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={ret ? 'primary' : 'danger'} loading={busy} onClick={go}>{ret ? 'Return for Correction' : 'Decline Admission'}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{ret ? 'The staff member who created the admission is notified and can edit and resubmit it.' : 'The child is not admitted. The record is kept (never deleted) and the staff member is notified.'}</p>
        <ErrorNote error={error && !Object.keys(e).length ? error : null} />
        <Field label={ret ? 'What needs correcting' : 'Reason for declining'} required error={e.note || e.reason}><textarea className="input" rows={3} maxLength={2000} value={text} onChange={(ev) => setText(ev.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- pages
function Header({ a, title }) {
  return (
    <>
      <Link to="/children" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Children</Link>
      <div className="mb-4 mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
          {a && <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600"><span className="font-mono">{a.child_id}</span><Badge tone={ADMISSION_TONE[a.admission_status]}>{a.admission_status}</Badge>
            <span>Created by {a.created_by.name} · {formatDate(a.created_at)}</span>{a.submitted_at && <span>· Submitted {formatDateTime(a.submitted_at)}</span>}</p>}
        </div>
      </div>
    </>
  );
}

function NewAdmission() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const rules = useApi('/children/rules');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState(null);
  const [last, setLast] = useState(null);
  const save = async (body) => {
    setSaving(true); setError(null); setLast(body);
    try {
      const res = await api('/admissions', { method: 'POST', body });
      toast(res.message);
      navigate(`/admissions/${encodeURIComponent(res.data.child_id)}?step=2`, { replace: true });
    } catch (err) {
      if (err.status === 409 && err.details?.possible_match) setDup({ message: err.message, matches: err.details.matches || null });
      else setError(err);
    } finally { setSaving(false); }
  };
  return (
    <>
      <Header title="New Admission" />
      <Stepper current={1} />
      <Card className="p-5">
        <h2 className="mb-1 font-semibold text-navy-900">Step 1: Basic information</h2>
        <p className="mb-4 text-sm text-slate-500">Saving this step creates the child's record, marked as in admission. It is not admitted until an Admin approves it.</p>
        <ErrorNote error={error && !Object.keys(fieldErrors(error)).length ? error : null} />
        {dup && (
          <Notice tone="warning" title="Possible duplicate" className="mb-4">
            <p>{dup.message}</p>
            {dup.matches && <ul className="mt-1 list-disc pl-5 text-sm">{dup.matches.map((m) => <li key={m.child_id}><span className="font-mono">{m.child_id}</span> · {m.full_name} · {m.status}</li>)}</ul>}
            <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setDup(null)}>Change the details</Button><Button size="sm" loading={saving} onClick={() => { setDup(null); save({ ...last, confirm_duplicate: true }); }}>Continue anyway</Button></div>
          </Notice>
        )}
        <BasicForm creating initial={{}} onSave={save} error={error} maxAge={rules.data?.data?.max_admission_age ?? 17} />
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={() => navigate('/children')}>Cancel</Button>
          <Button type="submit" form="step-form" loading={saving}>Save and continue</Button>
        </div>
      </Card>
    </>
  );
}

function ExistingAdmission({ id }) {
  const { toast } = useApp();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload, setData } = useApi(`/admissions/${encodeURIComponent(id)}`);
  const rules = useApi('/children/rules');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [result, setResult] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const nextStep = useRef(null); // which button submitted the step form: "Save progress" or "Save and continue"
  if (error?.status === 404) return <NotFound />;
  if (error && !data) return <><Header title="Admission" /><ErrorNote error={error} onRetry={reload} /></>;
  if (loading && !data) return <Skeleton rows={8} />;
  const a = data.data;
  const editing = a.can.edit;
  const step = editing ? Math.min(4, Math.max(1, Number(params.get('step')) || a.current_step || 1)) : null;
  const goStep = (n) => { setSaveError(null); setParams({ step: String(n) }, { replace: true }); window.scrollTo({ top: 0 }); };
  const done = [1, 2, 3, 4].filter((n) => !a.problems.some((p) => p.step === n));

  const save = async (body, next) => {
    setSaving(true); setSaveError(null);
    try {
      const res = await api(`/admissions/${encodeURIComponent(a.child_id)}/steps/${step}`, { method: 'PUT', body });
      setData(res); setFormKey((k) => k + 1); toast(res.message);
      if (next) goStep(next);
    } catch (err) { setSaveError(err); } finally { setSaving(false); }
  };
  const submit = async () => {
    setSaving(true); setSubmitError(null);
    try { const res = await api(`/admissions/${encodeURIComponent(a.child_id)}/submit`, { method: 'POST' }); setData(res); setResult({ tone: 'success', text: res.message }); window.scrollTo({ top: 0 }); }
    catch (err) { setSubmitError(err); } finally { setSaving(false); }
  };
  const options = a.options;
  const nextOf = step && step < 4 ? step + 1 : null;
  // Step 4 saves the checklist first, then the button below submits.
  const footer = editing && (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
      {step > 1 && <Button variant="ghost" onClick={() => goStep(step - 1)}>Back</Button>}
      <Button variant="secondary" type="submit" form="step-form" loading={saving} onClick={() => { nextStep.current = null; }}>Save progress</Button>
      {nextOf && <Button type="submit" form="step-form" loading={saving} onClick={() => { nextStep.current = nextOf; }}>Save and continue</Button>}
    </div>
  );
  const onSave = (body) => { const n = nextStep.current; nextStep.current = null; save(body, n); };

  return (
    <>
      <Header a={a} title={`Admission: ${a.basic.full_name}`} />
      {result && <Notice tone={result.tone} className="mb-4">{result.text}</Notice>}
      {a.admission_status === 'Pending Approval' && !a.can.review && !result && <Notice tone="success" className="mb-4">Admission submitted successfully. Waiting for Admin approval.</Notice>}
      {a.admission_status === 'Needs Correction' && a.decision && <Notice tone="warning" title="Returned for correction" className="mb-4"><p className="whitespace-pre-line">{a.decision.note}</p><p className="mt-1 text-xs">{a.decision.by} · {formatDateTime(a.decision.at)}. Make the corrections, then submit it again.</p></Notice>}
      {a.admission_status === 'Declined' && a.decision && <Notice tone="error" title="Admission declined" className="mb-4"><p className="whitespace-pre-line">{a.decision.note}</p><p className="mt-1 text-xs">{a.decision.by} · {formatDateTime(a.decision.at)}. The record is kept.</p></Notice>}
      {a.admission_status === 'Admitted' && (
        <Notice tone="success" title="Admission approved. Child is now Admitted." className="mb-4">
          <p className="flex items-center gap-1.5">{a.assignment?.assigned ? <UserCheck className="h-4 w-4" aria-hidden /> : <UserX className="h-4 w-4" aria-hidden />}{a.assignment?.label}</p>
          <p className="mt-1 text-xs">Approved by {a.approved_by_name} · {formatDateTime(a.approved_at)}. <Link className="font-medium underline" to={`/children/${encodeURIComponent(a.child_id)}`}>Open the child's page</Link></p>
        </Notice>
      )}

      {editing ? (
        <>
          <Stepper current={step} onSelect={goStep} done={done} />
          <Card className="p-5">
            <h2 className="mb-4 font-semibold text-navy-900">Step {step}: {STEPS[step - 1][1]}</h2>
            <ErrorNote error={saveError && !Object.keys(fieldErrors(saveError)).length ? saveError : null} />
            {step === 1 && <BasicForm key={formKey} initial={{ ...a.basic, dob: a.basic.dob ? String(a.basic.dob).slice(0, 10) : '', admission_date: a.basic.admission_date ? String(a.basic.admission_date).slice(0, 10) : '' }} onSave={onSave} error={saveError} maxAge={rules.data?.data?.max_admission_age ?? 17} />}
            {step === 2 && <ReferralForm key={formKey} initial={a.referral} options={options} onSave={onSave} error={saveError} />}
            {step === 3 && <FamilyForm key={formKey} initial={a.family} options={options} onSave={onSave} error={saveError} />}
            {step === 4 && <DocumentsForm key={formKey} a={a} options={options} onSave={onSave} onUploaded={(d) => setData({ data: d })} error={saveError} />}
            {footer}
          </Card>
          {step === 4 && (
            <Card className="mt-4 p-5">
              <h2 className="font-semibold text-navy-900">Submit for Admin Approval</h2>
              <p className="mt-1 text-sm text-slate-600">Save the checklist first. After you submit, the admission is locked until an Admin approves it or returns it for correction. You can't approve your own admission.</p>
              {a.problems.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm" aria-label="Still missing">
                  {a.problems.map((p) => <li key={p.field} className="flex flex-wrap items-center gap-2 text-amber-900"><XCircle className="h-4 w-4" aria-hidden /> {p.message} <button type="button" className="font-medium text-brand underline" onClick={() => goStep(p.step)}>Go to step {p.step}</button></li>)}
                </ul>
              )}
              <ErrorNote error={submitError && !submitError.details?.problems ? submitError : null} />
              <div className="mt-4 flex justify-end"><Button loading={saving} disabled={a.problems.length > 0} onClick={submit}><Send className="h-4 w-4" aria-hidden /> Submit for Admin Approval</Button></div>
            </Card>
          )}
        </>
      ) : (
        <>
          {a.can.review && (
            <Card className="mb-4 flex flex-wrap items-center gap-2 p-4">
              <p className="mr-auto text-sm text-navy-900">Review the four steps below, then decide.</p>
              <Button onClick={() => setDialog('approve')}><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve Admission</Button>
              <Button variant="secondary" onClick={() => setDialog('return')}><Undo2 className="h-4 w-4" aria-hidden /> Return for Correction</Button>
              <Button variant="danger" onClick={() => setDialog('decline')}><XCircle className="h-4 w-4" aria-hidden /> Decline Admission</Button>
            </Card>
          )}
          {!a.can.review && a.can.decline && <div className="mb-4 flex justify-end"><Button variant="danger" onClick={() => setDialog('decline')}><XCircle className="h-4 w-4" aria-hidden /> Decline Admission</Button></div>}
          <Summary a={a} />
        </>
      )}

      <Card className="mt-4 p-4">
        <h2 className="mb-2 font-semibold text-navy-900">History</h2>
        <ol className="space-y-1.5 text-sm">{a.history.map((h, i) => <li key={i}><span className="text-slate-500">{formatDateTime(h.created_at)}</span> · {h.from_status ? `${h.from_status} → ` : ''}<strong>{h.to_status}</strong>{h.actor_name ? ` · ${h.actor_name}` : ''}{h.note ? <span className="block whitespace-pre-line pl-4 text-slate-600">{h.note}</span> : null}</li>)}</ol>
      </Card>

      {dialog === 'approve' && <ApproveDialog a={a} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); setResult({ tone: 'success', text: `${res.message} ${res.data.assignment.label}.` }); toast(res.message); reload(); }} />}
      {(dialog === 'return' || dialog === 'decline') && <ReasonDialog a={a} kind={dialog} onClose={() => setDialog(null)} onDone={(res) => { setDialog(null); toast(res.message); reload(); if (user.role === 'Admin') navigate('/children?panel=admissions'); }} />}
    </>
  );
}

/** /admissions/new and /admissions/:id - the one admission form (Steps 1-4), the review and the decision. */
export default function AdmissionPage() {
  const { id } = useParams();
  return id === 'new' ? <NewAdmission /> : <ExistingAdmission id={id} />;
}
