import { useState } from 'react';
import useApi from '../../../hooks/useApi';
import { api } from '../../../api/client';
import { Badge, Button, ErrorNote, Field, Modal, Spinner } from '../../../components/ui';
import { statusTone } from '../../Adoptions';
import { headersFor } from './common';
import { adoptionLabel } from '../../../lib/adoptionStatus';

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const today = () => nowLocal().slice(0, 10);
const iso = (v) => (v ? String(v).slice(0, 10) : null);
function addMonthsIso(d, m) { const [y, mo, da] = d.split('-').map(Number); const dt = new Date(Date.UTC(y, mo - 1 + m, da)); if (dt.getUTCDate() !== da) dt.setUTCDate(0); return dt.toISOString().slice(0, 10); }
const addDaysIso = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);


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
      return <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">Upload the proof of publication in the Documents tab first.</p>;
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

/** Update status dialog: the next stage, its required details, message to the applicant, internal note. */
export default function StatusDialog({ app, config, onClose, onSaved, preset = null }) {
  const notesLocked = !app.sensitive?.unlocked;
  // Only allowed next statuses; blocked ones are listed with what blocks them (the server checks again).
  const transitions = app.transitions || (app.allowed_statuses || []).map((to) => ({ to, blocked: false, reasons: [] }));
  const firstOpen = transitions.find((t) => !t.blocked)?.to || '';
  const [status, setStatus] = useState(preset?.status && transitions.some((t) => t.to === preset.status && !t.blocked) ? preset.status : firstOpen);
  const [v, setV] = useState(preset?.docs ? { docs: preset.docs } : {});
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
    if (status === 'Declined' && !remark.trim()) e.remark = 'Give the applicant a reason when rejecting.';
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
      const res = await api(`/adoptions/${app.application_id}/status`, { method: 'PUT', body, headers: headersFor(app.application_id) });
      onSaved(res.data);
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Update status" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="status-form" loading={saving} disabled={!status}>{status === 'Order of Adoption issued' ? 'Finalize adoption' : 'Save status'}</Button></>}>
      <form id="status-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-600">Current stage: <Badge tone={statusTone(app.status)}>{adoptionLabel(app.status)}</Badge></p>
        {firstOpen ? (
          <Field label="Next stage" required>
            <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setErrors({}); }}>
              {transitions.filter((t) => !t.blocked).map((t) => <option key={t.to} value={t.to}>{t.to === 'Order of Adoption issued' ? 'Order of Adoption issued (Finalize adoption)' : adoptionLabel(t.to)}</option>)}
            </select>
          </Field>
        ) : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">No next stage can be recorded yet. See what blocks each one below.</p>}
        {transitions.some((t) => t.blocked) && (
          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-medium text-navy-900">Not available yet</p>
            <ul className="mt-1 space-y-1.5">
              {transitions.filter((t) => t.blocked).map((t) => (
                <li key={t.to}><span className="font-medium text-slate-700">{adoptionLabel(t.to)}</span>
                  <ul className="list-disc pl-5 text-xs text-slate-600">{t.reasons.map((r) => <li key={r}>{r}</li>)}{t.more > 0 && <li>and {t.more} more</li>}</ul>
                </li>
              ))}
            </ul>
          </div>
        )}
        {status && <StageFields target={status} v={v} set={set} errors={errors} app={app} config={config} />}
        <Field label="Message to the applicant" required={status === 'Declined'} error={errors.remark} hint="The applicant sees this on their timeline.">
          <textarea className="input" rows={3} maxLength={3000} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </Field>
        <Field label="Internal note" hint={notesLocked ? 'Internal notes are a locked section. Unlock the sensitive sections to read or add them.' : 'Staff only. Never shown to the applicant.'}>
          <textarea className="input" rows={3} maxLength={5000} value={note} disabled={notesLocked} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

