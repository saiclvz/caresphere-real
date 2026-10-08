import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Archive, CalendarClock, Download, FileText, Lock, MessageSquarePlus, ShieldCheck, Upload } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download } from '../api/client';
import { downloadFile, openFileInNewTab } from '../lib/openFile';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field, Modal, Spinner } from '../components/ui';
import QrCode from '../components/QrCode';
import ConfidentialityBanner from '../components/adoption/ConfidentialityBanner';
import ProtectedRecords from '../components/adoption/ProtectedRecords';
import TokenVerifyModal from '../components/TokenVerifyModal';
import UnlockedBar from '../components/UnlockedBar';
import AccessSessions from '../components/AccessSessions';
import AssignedStaffCard from '../components/AssignedStaffCard';
import useSensitiveLogging from '../hooks/useSensitiveLogging';
import { clearGrant, readGrant, saveGrant, unlockHeaders } from '../lib/grants';
import { publicBaseUrl } from '../lib/publicUrl';
import { readFile } from '../lib/files';
import { formatDate, formatDateTime } from '../lib/format';
import { displayValue, fieldStatus, pageFields } from './adoption/formLogic';
import { DeadlineChip, statusTone } from './Adoptions';
import NotFound from './NotFound';
import './adoption/adoption.css'; // print rules for QR slips

const CHIP_TONE = { Done: 'green', Missing: 'red', Optional: 'slate' };
const LEGACY_LABELS = {
  address: 'Address', occupation: 'Occupation', employment_details: 'Employment details', spouse_details: 'Spouse / co-applicant details',
  household_members: 'Household members', living_conditions: 'Living conditions', caregiving_experience: 'Caregiving experience',
};
const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const today = () => nowLocal().slice(0, 10);
const iso = (v) => (v ? String(v).slice(0, 10) : null);
function addMonthsIso(d, m) { const [y, mo, da] = d.split('-').map(Number); const dt = new Date(Date.UTC(y, mo - 1 + m, da)); if (dt.getUTCDate() !== da) dt.setUTCDate(0); return dt.toISOString().slice(0, 10); }
const addDaysIso = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

const REC = 'adoption_application';
const openDocument = (applicationId, doc) => openFileInNewTab(`/adoptions/${applicationId}/documents/${doc.document_id}`, unlockHeaders(REC, applicationId));
const downloadDocument = (applicationId, doc) => downloadFile(`/adoptions/${applicationId}/documents/${doc.document_id}?download=1`, doc.original_name, unlockHeaders(REC, applicationId));

/** Extra fields each stage needs (validated again on the server). */
function StageFields({ target, v, set, errors, app, config }) {
  const matchable = useApi(target === 'Child matched' ? '/adoption-matchable-children' : null);
  switch (target) {
    case 'Documents requested':
      return (
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-navy-800">Documents to request<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></legend>
          {errors.docs && <p className="text-xs text-red-600">{errors.docs}</p>}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {[...Object.entries(config.documents), ['forum_certificate', config.stage_documents.forum_certificate]].map(([t, def]) => (
              <div key={t} className="rounded-md px-2 py-1 hover:bg-slate-50">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={t in (v.docs || {})}
                    onChange={() => set({ docs: (() => { const n = { ...(v.docs || {}) }; if (t in n) delete n[t]; else n[t] = ''; return n; })() })} />
                  <span>{def.label}{def.page ? <span className="text-xs text-slate-400"> (page {def.page})</span> : null}</span>
                </label>
                {t in (v.docs || {}) && <input className="input mt-1" maxLength={500} placeholder="Optional note to the applicant" value={v.docs[t]}
                  onChange={(e) => set({ docs: { ...v.docs, [t]: e.target.value } })} aria-label={`Note about ${def.label}`} />}
              </div>
            ))}
          </div>
        </fieldset>
      );
    case 'Home study scheduled':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Home study visit" required error={errors.when}><input className="input" type="datetime-local" min={nowLocal()} value={v.when || ''} onChange={(e) => set({ when: e.target.value })} /></Field>
          <Field label="Details for the applicant" hint="Place or instructions"><input className="input" maxLength={500} value={v.details || ''} onChange={(e) => set({ details: e.target.value })} /></Field>
        </div>
      );
    case 'Child matched': {
      const kids = matchable.data?.data || [];
      return (
        <Field label="Child to match" required error={errors.child} hint="Only Active children under 18, marked Available, with a verified CDCLAA and not already placed.">
          {matchable.loading && !matchable.data ? <Spinner /> : (
            <select className="input" value={v.child_id || ''} onChange={(e) => set({ child_id: e.target.value })}>
              <option value="">{kids.length ? 'Select...' : 'No eligible children'}</option>
              {kids.map((c) => <option key={c.child_id} value={c.child_id}>{c.full_name} ({c.child_id}, {c.age} yrs, CDCLAA {c.cdclaa_number})</option>)}
            </select>
          )}
        </Field>
      );
    }
    case 'Trial custody':
      return (
        <Field label="Trial custody start date" required error={errors.trial_start}
          hint={v.trial_start ? `Ends ${addMonthsIso(v.trial_start, 6)} (6 months). Monthly monitoring reports are due during this time.` : 'The end date is set 6 months after the start.'}>
          <input className="input" type="date" value={v.trial_start || ''} onChange={(e) => set({ trial_start: e.target.value })} />
        </Field>
      );
    case 'Placement ended':
      return (
        <Field label="Why the placement ended" required error={errors.reason} hint="Saved as an internal note. The child becomes available for matching again.">
          <textarea className="input" rows={3} maxLength={2000} value={v.reason || ''} onChange={(e) => set({ reason: e.target.value })} />
        </Field>
      );
    case 'Petition filed':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date filed" required error={errors.petition_date}><input className="input" type="date" max={today()} value={v.petition_date || ''} onChange={(e) => set({ petition_date: e.target.value })} /></Field>
          <Field label="RACCO office" required error={errors.racco_office}><input className="input" maxLength={150} value={v.racco_office || ''} onChange={(e) => set({ racco_office: e.target.value })} /></Field>
        </div>
      );
    case 'Published':
      return <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">Upload the proof of publication under Workflow documents first.</p>;
    case 'Mandatory appearance done':
      return <Field label="Appearance date" required error={errors.appearance_date}><input className="input" type="date" max={today()} value={v.appearance_date || ''} onChange={(e) => set({ appearance_date: e.target.value })} /></Field>;
    case 'Endorsed to NACC':
      return (
        <Field label="Endorsement date" required error={errors.endorsed_date} hint={v.endorsed_date ? `NACC 60-day deadline: ${addDaysIso(v.endorsed_date, 60)}` : 'The NACC deadline is 60 days after endorsement.'}>
          <input className="input" type="date" max={today()} value={v.endorsed_date || ''} onChange={(e) => set({ endorsed_date: e.target.value })} />
        </Field>
      );
    case 'Order of Adoption issued':
      return (
        <div className="space-y-3">
          <p className="rounded-lg bg-red-50 p-2 text-sm text-red-900">Finalize adoption: {app.matched_child ? `${app.matched_child.full_name} (${app.matched_child.child_id}) becomes Adopted and ` : ''}other open applications for this child are closed. Upload the Certificate of Finality first.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Order of Adoption number" required error={errors.order_number}><input className="input font-mono" maxLength={80} value={v.order_number || ''} onChange={(e) => set({ order_number: e.target.value })} /></Field>
            <Field label="Order date" required error={errors.order_date}><input className="input" type="date" max={today()} value={v.order_date || ''} onChange={(e) => set({ order_date: e.target.value })} /></Field>
          </div>
        </div>
      );
    case 'Civil registry updated':
      return <Field label="LCR / PSA reference" required error={errors.civil_registry_ref}><input className="input" maxLength={120} value={v.civil_registry_ref || ''} onChange={(e) => set({ civil_registry_ref: e.target.value })} /></Field>;
    default:
      return null;
  }
}

/** Update status dialog: the next stage, its required details, remark to applicant, internal note. */
function StatusDialog({ app, config, onClose, onSaved }) {
  const notesLocked = !app.sensitive.unlocked;
  const [status, setStatus] = useState(app.allowed_statuses[0] || '');
  const [v, setV] = useState({});
  const [remark, setRemark] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setV((x) => ({ ...x, ...patch }));

  const check = () => {
    const e = {};
    const need = (k, msg) => { if (!String(v[k] || '').trim()) e[k] = msg; };
    if (status === 'Documents requested' && !Object.keys(v.docs || {}).length) e.docs = 'Choose at least one document.';
    if (status === 'Home study scheduled') { if (!v.when) e.when = 'Choose the date and time.'; else if (v.when < nowLocal()) e.when = 'Choose a time in the future.'; }
    if (status === 'Child matched') need('child_id', 'Choose the child.');
    if (status === 'Trial custody') need('trial_start', 'Start date is required.');
    if (status === 'Placement ended') need('reason', 'The reason is required.');
    if (status === 'Petition filed') { need('petition_date', 'Date filed is required.'); need('racco_office', 'RACCO office is required.'); }
    if (status === 'Mandatory appearance done') need('appearance_date', 'Appearance date is required.');
    if (status === 'Endorsed to NACC') need('endorsed_date', 'Endorsement date is required.');
    if (status === 'Order of Adoption issued') { need('order_number', 'Order number is required.'); need('order_date', 'Order date is required.'); }
    if (status === 'Civil registry updated') need('civil_registry_ref', 'Reference is required.');
    if (status === 'Declined' && !remark.trim()) e.remark = 'Give the applicant a reason when declining.';
    return e;
  };
  const submit = async (ev) => {
    ev.preventDefault();
    const e = check();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setError(null);
    try {
      const body = { status, remark: remark.trim() || undefined, internal_note: note.trim() || undefined };
      if (status === 'Documents requested') body.documents = Object.entries(v.docs).map(([doc_type, message]) => ({ doc_type, message: message.trim() || undefined }));
      if (status === 'Home study scheduled') body.interview = { scheduled_at: v.when, details: (v.details || '').trim() || undefined };
      for (const k of ['child_id', 'trial_start', 'reason', 'petition_date', 'racco_office', 'appearance_date', 'endorsed_date', 'order_number', 'order_date', 'civil_registry_ref']) {
        if (v[k]) body[k] = String(v[k]).trim();
      }
      const res = await api(`/adoptions/${app.application_id}/status`, { method: 'PUT', body, headers: unlockHeaders(REC, app.application_id) });
      onSaved(res.data);
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Update status" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="status-form" loading={saving}>{status === 'Order of Adoption issued' ? 'Finalize adoption' : 'Save status'}</Button></>}>
      <form id="status-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-600">Current stage: <Badge tone={statusTone(app.status)}>{app.status}</Badge></p>
        <Field label="Next stage" required>
          <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setErrors({}); }}>
            {app.allowed_statuses.map((s) => <option key={s} value={s}>{s === 'Order of Adoption issued' ? 'Order of Adoption issued (Finalize adoption)' : s}</option>)}
          </select>
        </Field>
        <StageFields target={status} v={v} set={set} errors={errors} app={app} config={config} />
        <Field label="Remark to applicant" required={status === 'Declined'} error={errors.remark} hint="Shown to the applicant on their timeline.">
          <textarea className="input" rows={3} maxLength={3000} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </Field>
        <Field label="Internal note" hint={notesLocked ? 'Internal notes are a locked section. Unlock the sensitive sections to read or add them.' : 'Staff only. Never shown to the applicant.'}>
          <textarea className="input" rows={3} maxLength={5000} value={note} disabled={notesLocked} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/** Workflow documents (forum certificate, case study, monitoring reports, publication, order, finality). */
function StageDocuments({ app, onChanged, onOpenDoc, onDownload, isAdmin }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(null);
  const upload = (docType) => async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { toast('Only PDF, PNG or JPG files are accepted.', 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('The file is larger than 10 MB.', 'error'); return; }
    setBusy(docType);
    try {
      const f = await readFile(file);
      const res = await api(`/adoptions/${app.application_id}/documents`, { method: 'POST', body: { doc_type: docType, file: { name: f.name, data: f.data } } });
      onChanged(res.data); toast('Document uploaded.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold text-navy-900">Workflow documents</h2>
      <ul className="divide-y divide-slate-100">
        {app.stage_documents.map((d) => (
          <li key={d.doc_type} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-navy-900">{d.label} {d.protected && <Lock className="inline h-3.5 w-3.5 text-red-600" aria-label="Protected record" />}</p>
              {d.files.length ? (
                <ul className="mt-0.5 space-y-0.5">
                  {d.files.map((f) => (
                    <li key={f.document_id} className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      {f.is_protected && !isAdmin
                        ? <span className="text-slate-600">{f.original_name} <span className="text-xs text-slate-400">(protected: needs a token)</span></span>
                        : <><button type="button" className="truncate text-brand hover:underline" onClick={() => onOpenDoc(f)}>{f.original_name}</button>
                          {!f.is_protected && <button type="button" className="text-xs text-slate-500 hover:text-navy-900" onClick={() => onDownload(f)} aria-label={`Download ${f.original_name}`}><Download className="h-3.5 w-3.5" /></button>}</>}
                      <span className="text-xs text-slate-400">{formatDate(f.uploaded_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-slate-400">No file</p>}
            </div>
            {d.can_upload && (
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5" aria-hidden /> {busy === d.doc_type ? 'Uploading...' : d.files.length && !d.multiple ? 'Replace' : 'Upload'}
                <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={upload(d.doc_type)} disabled={!!busy} />
              </label>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const MILESTONES = [
  ['forum_verified_at', 'Forum certificate verified'], ['case_study_completed_at', 'Case study completed'], ['cleared_at', 'Cleared for matching'],
  ['matched_at', 'Child matched'], ['trial_start', 'Trial custody started'], ['trial_end', 'Trial custody ends'], ['trial_completed_at', 'Trial custody completed'],
  ['placement_ended_at', 'Placement ended'], ['petition_date', 'Petition filed'], ['racco_office', 'RACCO office'], ['published_at', 'Published'],
  ['appearance_date', 'Mandatory appearance'], ['endorsed_date', 'Endorsed to NACC'], ['nacc_deadline', 'NACC 60-day deadline'],
  ['order_number', 'Order of Adoption number'], ['order_date', 'Order date'], ['civil_registry_ref', 'LCR / PSA reference'], ['closed_at', 'Closed'],
];

/** Admin: release of information to a third party (NACC authorization required). */
function ReleaseOfInformation({ app }) {
  const { toast } = useApp();
  const list = useApi(`/releases?application_id=${app.application_id}`);
  const [open, setOpen] = useState(false);
  const blank = { requester_name: '', requester_org: '', purpose: '', nacc_authorization: '', released_items: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const e = {};
    if (!form.requester_name.trim()) e.requester_name = 'Requester is required.';
    if (form.purpose.trim().length < 5) e.purpose = 'State the purpose.';
    if (!form.nacc_authorization.trim()) e.nacc_authorization = 'The NACC authorization reference is required.';
    if (form.released_items.trim().length < 3) e.released_items = 'List what was released.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try { await api(`/adoptions/${app.application_id}/releases`, { method: 'POST', body: form }); toast('Release recorded.'); setOpen(false); setForm(blank); list.reload(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const rows = list.data?.data || [];
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-medium text-navy-800">Release of information</h3><Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record release</Button></div>
      {rows.length === 0 ? <p className="text-xs text-slate-500">Nothing released.</p> : (
        <ul className="space-y-1 text-xs text-slate-600">{rows.map((r) => <li key={r.release_id}>{formatDate(r.released_at)}: {r.released_items} to {r.requester_name} (NACC ref {r.nacc_authorization})</li>)}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Record a release of information"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={save}>Record release</Button></>}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-600">Adoption information may be released only with NACC authorization, and only for the stated purpose. This is recorded in the audit log.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Requester" required error={errors.requester_name}><input className="input" maxLength={150} value={form.requester_name} onChange={set('requester_name')} /></Field>
            <Field label="Organization"><input className="input" maxLength={150} value={form.requester_org} onChange={set('requester_org')} /></Field>
          </div>
          <Field label="Purpose" required error={errors.purpose}><textarea className="input" rows={2} maxLength={1000} value={form.purpose} onChange={set('purpose')} /></Field>
          <Field label="NACC authorization reference" required error={errors.nacc_authorization}><input className="input font-mono" maxLength={120} value={form.nacc_authorization} onChange={set('nacc_authorization')} /></Field>
          <Field label="What was released" required error={errors.released_items}><textarea className="input" rows={2} maxLength={2000} value={form.released_items} onChange={set('released_items')} /></Field>
        </div>
      </Modal>
    </div>
  );
}

/** One of the 8 answer pages, with documents, in the staff layout. */
function PageSection({ page, app, config, onOpenDoc, onDownload, onProtect }) {
  const fields = pageFields(config, page.n, app.form);
  const docs = app.checklist.filter((c) => c.page === page.n);
  const legacyKeys = app.legacy ? {
    1: ['address', 'occupation', 'employment_details'], 2: ['spouse_details', 'household_members', 'living_conditions', 'caregiving_experience'],
  }[page.n] || [] : [];
  const legacy = legacyKeys.filter((k) => app.legacy[k]);
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold text-navy-900">{page.n}. {page.title}</h2>
      {legacy.length > 0 && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500"><Lock className="h-3.5 w-3.5" aria-hidden /> From the earlier application form (read-only)</p>
          <dl className="space-y-1 text-sm">
            {legacy.map((k) => <div key={k}><dt className="text-slate-500">{LEGACY_LABELS[k]}</dt><dd className="whitespace-pre-line text-navy-900">{app.legacy[k]}</dd></div>)}
          </dl>
        </div>
      )}
      <dl className="divide-y divide-slate-100">
        {fields.map(([key, def]) => {
          const value = displayValue(config, key, def, app.form);
          const status = app.is_legacy && !value ? 'Optional' : fieldStatus(config, key, def, app.form);
          return (
            <div key={key} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <dt className="min-w-0 flex-1 text-sm"><span className="text-slate-500">{def.label}</span>
                <span className="block whitespace-pre-line break-words text-navy-900">{value || <span className="text-slate-400">Not answered</span>}</span></dt>
              <dd><Badge tone={CHIP_TONE[status]}>{status}</Badge></dd>
            </div>
          );
        })}
        {docs.map((d) => (
          <div key={d.doc_type} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <dt className="min-w-0 flex-1 text-sm"><span className="text-slate-500">{d.label}</span>
              {d.files.length ? (
                <ul className="mt-0.5 space-y-0.5">
                  {d.files.map((f) => (
                    <li key={f.document_id} className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      <button type="button" className="truncate text-brand hover:underline" onClick={() => onOpenDoc(f)}>{f.original_name}</button>
                      {f.is_protected && <Lock className="h-3.5 w-3.5 text-red-600" aria-label="Protected record" />}
                      {!f.is_protected && <button type="button" className="text-xs text-slate-500 hover:text-navy-900" onClick={() => onDownload(f)} aria-label={`Download ${f.original_name}`}><Download className="h-3.5 w-3.5" /></button>}
                      {onProtect && !f.is_protected && <button type="button" className="text-xs text-slate-500 hover:text-navy-900" onClick={() => onProtect(f)}>Mark protected</button>}
                      <span className="text-xs text-slate-400">{formatDate(f.uploaded_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <span className="block text-slate-400">No file</span>}
            </dt>
            <dd><Badge tone={CHIP_TONE[d.status]}>{d.status}</Badge></dd>
          </div>
        ))}
        {page.n === 7 && <p className="py-2 text-sm text-slate-500">Home study report: written by a licensed social worker after the home visit. Nothing to upload.</p>}
      </dl>
    </Card>
  );
}

/**
 * What Staff see before an unlock: reference, status, submission date, assigned staff, a masked
 * name and the QR card. Assigned Staff can unlock (purpose + QR + Token ID) or record a stage.
 */
function LockedApplication({ app, config, onUnlock, onSaved }) {
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <ConfidentialityBanner />
      <div className="mb-4">
        <Link to="/adoptions" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" /> Adoption applications</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold text-navy-900">{app.reference_no}</h1>
          <Badge tone={statusTone(app.status)}>{app.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">Applicant {app.applicant_masked} · Submitted {formatDate(app.submitted_at)} · Assigned staff: {app.assigned_staff?.name || 'not assigned'}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
            <div className="min-w-0">
              <h2 className="font-semibold text-navy-900">Sensitive sections are locked</h2>
              <ul className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                {app.sensitive.sections.map((x) => <li key={x.key} className="flex items-center gap-1.5"><Lock className="h-3 w-3 text-slate-400" aria-hidden /> {x.label}</li>)}
              </ul>
            </div>
          </div>
          <div className="mt-5">
            {app.sensitive.assigned
              ? <Button className="h-12 w-full text-base sm:w-auto" onClick={onUnlock}>Unlock sensitive sections</Button>
              : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" role="status">You're not assigned to this record. Ask an Admin to assign you.</p>}
          </div>
        </Card>
        <aside className="space-y-4">
          {app.allowed_statuses.length > 0 && (
            <Card className="space-y-2 p-4">
              <h2 className="font-semibold text-navy-900">Review</h2>
              <p className="text-xs text-slate-500">You can record a stage while the record is locked. Internal notes need an unlock.</p>
              <Button className="w-full" onClick={() => setDialog(true)}>Update status</Button>
            </Card>
          )}
        </aside>
      </div>
      {dialog && <StatusDialog app={app} config={config} onClose={() => setDialog(false)} onSaved={(data) => { setDialog(false); onSaved(data); }} />}
    </>
  );
}

/** /adoptions/:id (Admin, Staff): the application in the staff layout, with the RA 11642 workflow. */
function Inner() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useApp();
  const configReq = useApi('/adoptions/form-config');
  const config = configReq.data?.data;
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(false);
  // Decision 1: Add note becomes active only after a status update is saved in this session.
  const [sessionUpdate, setSessionUpdate] = useState(null);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [unlocking, setUnlocking] = useState(false);
  // The unlock secret is sent as a header; the server decides what is returned.
  const load = useCallback(() => api(`/adoptions/${id}`, { headers: unlockHeaders(REC, id) }).then((r) => {
    if (r.data.locked) clearGrant(REC, id);
    setApp(r.data);
  }).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);
  const unlockedAsStaff = Boolean(app && !app.locked && user.role === 'Staff');
  useSensitiveLogging(REC, id, Boolean(app && !app.locked), unlockHeaders(REC, id));

  if (error?.status === 404) return <NotFound />;
  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!app || !config) return <Spinner />;

  const isAdmin = user.role === 'Admin';
  const onUnlocked = async (result) => {
    saveGrant(REC, app.application_id, result.grant, result.expires_at, { purpose: result.purpose });
    setUnlocking(false);
    await load();
    toast('Sensitive sections unlocked for this application.');
  };
  const onLocked = (why) => {
    clearGrant(REC, app.application_id);
    toast(why === 'expired' ? 'Time is up. The sensitive sections are locked again.' : 'Locked.');
    load();
  };
  const unlockModal = (
    <TokenVerifyModal open={unlocking} onClose={() => setUnlocking(false)} recordType={REC} recordId={app.application_id}
      recordLabel={app.reference_no} onUnlocked={onUnlocked} />
  );
  if (app.locked) {
    return <>{unlockModal}<LockedApplication app={app} config={config} onUnlock={() => setUnlocking(true)} onSaved={setApp} /></>;
  }
  const openDoc = (d) => openDocument(app.application_id, d).catch((e) => toast(e.message, 'error'));
  const downloadDoc = (d) => downloadDocument(app.application_id, d).catch((e) => toast(e.message, 'error'));
  const protect = async (d) => {
    try { const res = await api(`/adoptions/${app.application_id}/documents/${d.document_id}/protect`, { method: 'POST' }); setApp(res.data); toast('Document is now a protected record.'); }
    catch (err) { toast(err.message, 'error'); }
  };
  const notesFor = (hid) => app.notes.filter((n) => n.history_id === hid);
  const looseNotes = app.notes.filter((n) => !n.history_id || !app.history.some((h) => h.history_id === n.history_id));
  const addNote = async () => {
    if (!note.trim()) return;
    setNoteBusy(true);
    try {
      const res = await api(`/adoptions/${app.application_id}/notes`, { method: 'POST', body: { history_id: sessionUpdate.history_id, note: note.trim() }, headers: unlockHeaders(REC, app.application_id) });
      setApp(res.data); setNote(''); toast('Internal note added.');
    } catch (err) { toast(err.message, 'error'); } finally { setNoteBusy(false); }
  };
  const closeRequest = async (requestId) => {
    try { const res = await api(`/adoptions/${app.application_id}/requests/${requestId}/close`, { method: 'PUT', headers: unlockHeaders(REC, app.application_id) }); setApp(res.data); toast('Request closed.'); }
    catch (err) { toast(err.message, 'error'); }
  };
  const archive = async () => {
    if (archiveReason.trim().length < 5) { toast('Give a reason for archiving.', 'error'); return; }
    setBusy(true);
    try { const res = await api(`/adoptions/${app.application_id}/archive`, { method: 'POST', body: { reason: archiveReason.trim() } }); setApp(res.data); setArchiving(false); toast('Application archived. It is kept, not deleted.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const m = app.milestones;

  return (
    <>
      <ConfidentialityBanner />
      <div className="mb-4">
        <Link to="/adoptions" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" /> Adoption applications</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold text-navy-900">{app.reference_no}</h1>
          <Badge tone={statusTone(app.status)}>{app.status}</Badge>
          <Badge tone="slate">{app.application_type_label}</Badge>
          {m.finalized_at && <Badge tone="green"><ShieldCheck className="h-3 w-3" /> Finalized {formatDate(m.finalized_at)}</Badge>}
          {app.is_legacy && <Badge tone="slate">Earlier form</Badge>}
          {app.archived_at && <Badge tone="slate">Archived</Badge>}
          <DeadlineChip label="Trial custody ends" d={app.deadlines?.trial_end} />
          <DeadlineChip label="NACC deadline" d={app.deadlines?.nacc_deadline} />
        </div>
        <p className="mt-1 text-sm text-slate-500">{app.form.legal_name} · Submitted {formatDateTime(app.submitted_at)} · Assigned staff: {app.assigned_staff?.name || 'not assigned'}
          {app.consented_at && ` · Consent ${app.consent_version || ''} / notice ${app.privacy_notice_version || ''} recorded ${formatDateTime(app.consented_at)}`}</p>
      </div>

      {isAdmin && <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-navy-900 px-3 py-1 text-xs font-medium text-white"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Admin full access · views are recorded</p>}
      {unlockedAsStaff && (
        <div className="mb-4"><UnlockedBar recordType={REC} recordId={app.application_id} expiresAt={app.sensitive.expires_at}
          purpose={app.sensitive.purpose || readGrant(REC, app.application_id)?.purpose} headers={unlockHeaders(REC, app.application_id)} onLocked={onLocked} /></div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-2 font-semibold text-navy-900">Milestones</h2>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {MILESTONES.filter(([k]) => m[k]).map(([k, label]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-slate-50 py-1"><dt className="text-slate-500">{label}</dt>
                  <dd className="text-right text-navy-900">{/_at$/.test(k) ? formatDate(m[k]) : /date|trial_|deadline/.test(k) ? iso(m[k]) : m[k]}</dd></div>
              ))}
              {!MILESTONES.some(([k]) => m[k]) && <p className="text-slate-500">No milestones recorded yet.</p>}
            </dl>
          </Card>

          <StageDocuments app={app} onChanged={setApp} onOpenDoc={openDoc} onDownload={downloadDoc} isAdmin={isAdmin} />
          {config.pages.filter((p) => p.n <= 8).map((p) => <PageSection key={p.n} page={p} app={app} config={config} onOpenDoc={openDoc} onDownload={downloadDoc} onProtect={isAdmin ? protect : null} />)}

          <Card className="p-4">
            <h2 className="mb-2 font-semibold text-navy-900">Document requests</h2>
            {app.requests.length === 0 ? <p className="text-sm text-slate-500">No documents requested.</p> : (
              <ul className="divide-y divide-slate-100">
                {app.requests.map((r) => (
                  <li key={r.request_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-navy-900">{config.documents[r.doc_type]?.label || config.stage_documents[r.doc_type]?.label || r.doc_type}</p>
                      <p className="text-xs text-slate-500">Requested {formatDateTime(r.requested_at)} by {r.requested_by_name}{r.message && ` · "${r.message}"`}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={{ Open: 'amber', Fulfilled: 'green', Closed: 'slate' }[r.status]}>{r.status}</Badge>
                      {r.status === 'Open' && <Button size="sm" variant="ghost" onClick={() => closeRequest(r.request_id)}>Close</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 font-semibold text-navy-900">Interviews and home study</h2>
            {app.interviews.length === 0 ? <p className="text-sm text-slate-500">None scheduled.</p> : (
              <ul className="space-y-2">
                {app.interviews.map((i) => (
                  <li key={i.interview_id} className="flex gap-2 text-sm"><CalendarClock className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                    <span><span className="font-medium text-navy-900">{i.kind}</span>, {formatDateTime(i.scheduled_at)}{i.details && <span className="block text-slate-500">{i.details}</span>}<span className="block text-xs text-slate-400">Scheduled by {i.created_by_name}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-semibold text-navy-900">Status history</h2>
            <ol className="space-y-3">
              {app.history.map((h) => (
                <li key={h.history_id} className="rounded-lg border border-slate-100 p-3 text-sm">
                  <p><span className="font-medium text-navy-900">{h.to_status ? `${h.from_status ? `${h.from_status} to ` : ''}${h.to_status}` : 'Message to applicant (earlier form)'}</span>
                    <span className="text-slate-500"> · {formatDateTime(h.created_at)}{h.changed_by_name && ` · ${h.changed_by_name}`}</span></p>
                  {h.remark_to_applicant && <p className="mt-1 whitespace-pre-line text-slate-700"><span className="text-xs font-medium text-slate-500">Remark to applicant: </span>{h.remark_to_applicant}</p>}
                  {notesFor(h.history_id).map((n) => (
                    <p key={n.note_id} className="mt-2 whitespace-pre-line rounded-md bg-amber-50 p-2 text-amber-900"><span className="text-xs font-medium">Internal note, {n.author_name}, {formatDateTime(n.created_at)}: </span>{n.note}</p>
                  ))}
                </li>
              ))}
            </ol>
            {looseNotes.length > 0 && (
              <div className="mt-3 space-y-2">
                {looseNotes.map((n) => <p key={n.note_id} className="whitespace-pre-line rounded-md bg-amber-50 p-2 text-sm text-amber-900"><span className="text-xs font-medium">Internal note, {n.author_name}, {formatDateTime(n.created_at)}: </span>{n.note}</p>)}
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <AssignedStaffCard record={app} endpoint={`/adoptions/${app.application_id}/assign`} onSaved={setApp} />

          <Card className="space-y-4 p-4">
            <div>
              <h2 className="font-semibold text-navy-900">Review</h2>
              <p className="text-xs text-slate-500">{isAdmin
                ? 'You can record every stage, including clearing, matching, trial custody decisions, declining and finalizing.'
                : 'You can record forum, home study, case study, petition, publication, appearance and endorsement stages.'}</p>
            </div>
            {app.allowed_statuses.length > 0
              ? <Button className="w-full" onClick={() => setDialog(true)}>Update status</Button>
              : <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">{app.archived_at || ['Closed', 'Declined', 'Withdrawn'].includes(app.status) ? 'This application is read-only.' : 'The next stage is recorded by an administrator.'}</p>}

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <Field label="Add internal note" hint={sessionUpdate
                ? `Attached to your update "${sessionUpdate.status}" at ${formatDateTime(sessionUpdate.at)}. Staff only.`
                : 'Save a status update first. Notes are attached to the status update you just saved.'}>
                <textarea className="input" rows={3} maxLength={5000} disabled={!sessionUpdate} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button size="sm" variant="secondary" disabled={!sessionUpdate || !note.trim()} loading={noteBusy} onClick={addNote}><MessageSquarePlus className="h-4 w-4" /> Add note</Button>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <h3 className="text-sm font-medium text-navy-800">Matched child</h3>
              {app.matched_child ? (
                <div className="flex items-center gap-3">
                  <Link to={`/children/${app.matched_child.child_id}`} aria-label={`Open ${app.matched_child.full_name}'s profile`}>
                    <QrCode value={`${publicBaseUrl()}/children/${encodeURIComponent(app.matched_child.child_id)}`} size={56} label={`QR code for child ${app.matched_child.child_id}`} />
                  </Link>
                  <div className="min-w-0 text-sm">
                    <Link to={`/children/${app.matched_child.child_id}`} className="font-medium text-navy-900 hover:text-brand">{app.matched_child.full_name}</Link>
                    <p className="font-mono text-xs text-slate-500">{app.matched_child.child_id}{app.matched_child.age != null && ` · ${app.matched_child.age} yrs`}</p>
                    <p className="text-xs text-slate-500">{app.matched_child.status}{app.matched_child.placement_status !== 'None' && ` · ${app.matched_child.placement_status === 'Trial custody' ? 'Matched / Trial custody' : 'Matched'}`}
                      {app.matched_child.cdclaa_verified ? ' · CDCLAA verified' : ' · CDCLAA not verified'}</p>
                  </div>
                </div>
              ) : <p className="text-sm text-slate-500">{app.application_type === 'Relative' ? 'Relative or stepchild adoption: no registry child is needed.' : 'No child matched. An administrator matches through Update status.'}</p>}
            </div>

            {isAdmin && ['Closed', 'Declined', 'Withdrawn'].includes(app.status) && !app.archived_at && (
              <div className="border-t border-slate-100 pt-3">
                <Button size="sm" variant="ghost" onClick={() => setArchiving(true)}><Archive className="h-4 w-4" /> Archive application</Button>
              </div>
            )}
            {isAdmin && app.archived_at && <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">Archived {formatDate(app.archived_at)}: {app.archive_reason}</p>}
            {isAdmin && <ReleaseOfInformation app={app} />}
          </Card>

          {isAdmin && <AccessSessions recordType={REC} recordId={app.application_id} />}
          {isAdmin && <ProtectedRecords records={app.protected_records} onChanged={load} />}
        </aside>
      </div>

      {dialog && <StatusDialog app={app} config={config} onClose={() => setDialog(false)}
        onSaved={(data) => {
          setDialog(false); setApp(data);
          setSessionUpdate({ history_id: data.last_history_id, status: data.status, at: new Date().toISOString() });
          toast(`Recorded: ${data.status}.`);
        }} />}
      <Modal open={archiving} onClose={() => setArchiving(false)} title="Archive this application?" size="sm"
        footer={<><Button variant="secondary" onClick={() => setArchiving(false)}>Cancel</Button><Button loading={busy} onClick={archive}>Archive</Button></>}>
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Archived applications are hidden from the list but kept permanently. Nothing is deleted.</p>
          <Field label="Reason" required><textarea className="input" rows={2} maxLength={500} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

export default function StaffApplicationDetail() {
  return <Inner />;
}
