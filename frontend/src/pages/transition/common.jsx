import { useState } from 'react';
import { CheckCircle2, Circle, FileText, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { unlockHeaders } from '../../lib/grants';
import { checkFile, readFile, MB } from '../../lib/files';
import { formatDate, formatDateTime } from '../../lib/format';
import { Badge, Button, Field } from '../../components/ui';

export const REC = 'transition_review';
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * Saving a stage: one place for busy state, field errors (422 from the server, shown beside each field), the
 * success message and the refreshed review. `run(path, method, body)` resolves true when it saved.
 */
export function useStageSave(review, onSaved) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const run = async (key, path, method, body, success) => {
    setBusy(key); setErrors({}); setError(null);
    try {
      const res = await api(`/transition-reviews/${review.review_id}${path}`, { method, headers: unlockHeaders(REC, review.review_id), body });
      onSaved(res.data);
      if (success) toast(success);
      return true;
    } catch (err) {
      if (err.details?.errors) {
        setErrors(err.details.errors);
        const first = Object.keys(err.details.errors)[0];
        setTimeout(() => document.querySelector(`[data-field="${first}"] :is(input,select,textarea,button)`)?.focus(), 0);
      }
      if (err.details?.locked) onSaved(null, err);
      setError(err);
      return false;
    } finally { setBusy(null); }
  };
  return { busy, errors, error, run, setErrors };
}

/** A labelled control with its server error; `name` ties the error and the focus to it. */
export function F({ name, label, errors, required, hint, className = '', children }) {
  return <div data-field={name} className={className}><Field label={label} required={required} hint={hint} error={errors?.[name]}>{children}</Field></div>;
}

export function Select({ value, onChange, options, placeholder = 'Choose...', disabled, ...rest }) {
  return (
    <select className="input" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export const TASK_TONE = { Pending: 'slate', 'In Progress': 'blue', Completed: 'green', 'Not Applicable': 'slate' };
export const PRIORITY_TONE = { Low: 'slate', Medium: 'amber', High: 'red' };

export function Check({ done, label, children }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
      <span className={done ? 'text-navy-900' : 'text-slate-600'}>{label}<span className="sr-only">{done ? ' (done)' : ' (not done)'}</span>{children}</span>
    </li>
  );
}

export function Progress({ value, label }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-600"><span>{label}</span><span className="font-medium text-navy-900">{pct}%</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** "Last saved by X on date" lines. */
export const SavedBy = ({ name, at, prefix = 'Last saved' }) => (name && at ? <p className="text-xs text-slate-500">{prefix} by {name} on {formatDateTime(at)}.</p> : null);

/**
 * Documents for a stage (optionally one conference or follow-up): list, view (watermarked for Staff), upload.
 * PDF, JPG or PNG up to 10 MB, encrypted on the server.
 */
export function StageDocuments({ review, stage, conferenceId = null, visitId = null, canUpload, onSaved, onView, title = 'Documents' }) {
  const { toast } = useApp();
  const docs = review.workflow.documents.filter((d) => d.stage_key === stage && (conferenceId ? d.conference_id === conferenceId : true) && (visitId ? d.visit_id === visitId : true));
  const [label, setLabel] = useState('');
  const [file, setFile] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    const p = !label.trim() ? 'Describe the document.' : checkFile(file, { types: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: 10 * MB });
    setProblem(p);
    if (p) return;
    setBusy(true);
    try {
      const f = await readFile(file);
      const res = await api(`/transition-reviews/${review.review_id}/documents`, { method: 'POST', headers: unlockHeaders(REC, review.review_id),
        body: { stage_key: stage, label: label.trim(), conference_id: conferenceId, visit_id: visitId, file: { name: f.name, data: f.data } } });
      onSaved(res.data); setLabel(''); setFile(null); toast('Document uploaded.');
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-navy-900">{title} ({docs.length})</h4>
      {docs.length === 0 ? <p className="text-xs text-slate-500">No documents uploaded.</p> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {docs.map((d) => (
            <li key={d.document_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0"><span className="block truncate font-medium text-navy-900">{d.label}</span>
                  <span className="text-xs text-slate-500">{d.uploaded_by_name}, {formatDate(d.uploaded_at)}</span></span></span>
              <Button size="sm" variant="secondary" onClick={() => onView(d)}>View</Button>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Document" className="min-w-[12rem] flex-1"><input className="input" maxLength={150} placeholder="e.g. Conference minutes" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 hover:bg-brand-50">
            <Upload className="h-4 w-4" aria-hidden /> {file ? file.name.slice(0, 24) : 'Choose file'}
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <Button size="sm" variant="secondary" loading={busy} onClick={upload}>Upload</Button>
          {problem && <p className="w-full text-xs text-red-700" role="alert">{problem}</p>}
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }) {
  return <Badge tone={{ 'For Review': 'amber', 'In Progress': 'blue', Completed: 'green', 'On Hold': 'slate' }[status] || 'slate'}>{status}</Badge>;
}
