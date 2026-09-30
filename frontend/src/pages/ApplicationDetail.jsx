import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CircleAlert, ExternalLink, Upload } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { ADOPTION_TONE } from './Adoptions';
import { Badge, Button, Card, ConfirmModal, ErrorNote, Field, Spinner } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/format';
import { MB, checkFile, readFile } from '../lib/files';

export const DOC_TYPES_ALLOWED = ['application/pdf', 'image/png', 'image/jpeg'];
const UPLOADABLE = ['Submitted', 'Under Review', 'Additional Documents Required'];
const STAFF_TARGETS = ['Under Review', 'Additional Documents Required'];
const ADMIN_TARGETS = ['Under Review', 'Additional Documents Required', 'Approved', 'Rejected', 'Completed'];

export async function openDocument(applicationId, doc, toast) {
  const win = window.open('', '_blank');
  try {
    const res = await api(`/adoptions/${applicationId}/documents/${doc.document_id}`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    win?.close();
    toast(err.message, 'error');
  }
}

function Section({ title, children }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold text-navy-900">{title}</h2>
      <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
    </Card>
  );
}
function Item({ label, value, wide }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-navy-900">{value || <span className="text-slate-400">-</span>}</dd>
    </div>
  );
}

/** One adoption application. Reviewers (Admin/Staff) see review tools; applicants see their own status and uploads. */
export default function ApplicationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useApp();
  const isApplicant = user.role === 'Donor'; // Donor accounts hold the applicant features
  const { data, loading, error, reload, setData } = useApi(`/adoptions/${id}`);
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const a = data.data;
  const targets = (user.role === 'Admin' ? ADMIN_TARGETS : STAFF_TARGETS).filter((t) => t !== a.status);
  const closed = ['Rejected', 'Completed'].includes(a.status);

  const upload = async (docType, file) => {
    const problem = checkFile(file, { types: DOC_TYPES_ALLOWED, maxBytes: 10 * MB });
    if (problem) { toast(problem, 'error'); return; }
    setBusy(`doc:${docType}`);
    try {
      const f = await readFile(file);
      const res = await api(`/adoptions/${a.application_id}/documents`, { method: 'POST', body: { doc_type: docType, file: { name: f.name, data: f.data } } });
      setData({ ...data, data: res.data });
      toast('Document uploaded.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  const addNote = async () => {
    if (!note.trim()) { setActionError(new Error('Write a review note.')); return; }
    setBusy('note'); setActionError(null);
    try {
      const res = await api(`/adoptions/${a.application_id}/notes`, { method: 'POST', body: { note } });
      setData({ ...data, data: res.data }); setNote(''); toast('Note added.');
    } catch (err) { setActionError(err); } finally { setBusy(null); }
  };

  const changeStatus = async () => {
    setBusy('status'); setActionError(null);
    try {
      const res = await api(`/adoptions/${a.application_id}/status`, { method: 'PUT', body: { status: target, note } });
      setData({ ...data, data: res.data }); setNote(''); setTarget('');
      toast(target === 'Completed' ? 'Adoption completed. The child is now marked Adopted.' : `Status changed to ${target}.`);
    } catch (err) { setActionError(err); } finally { setBusy(null); setConfirming(false); }
  };

  const requestStatus = () => {
    if (!target) { setActionError(new Error('Choose a new status.')); return; }
    if (['Additional Documents Required', 'Rejected'].includes(target) && !note.trim()) {
      setActionError(new Error(target === 'Rejected' ? 'Give a reason for rejecting the application.' : 'Say which documents are needed.'));
      return;
    }
    if (['Approved', 'Rejected', 'Completed'].includes(target)) setConfirming(true); else changeStatus();
  };

  return (
    <>
      <Link to={isApplicant ? '/applications' : '/adoptions'} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900">
        <ArrowLeft className="h-4 w-4" /> {isApplicant ? 'My applications' : 'Adoption'}
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-navy-900">{a.reference_no}</h1>
        <Badge tone={ADOPTION_TONE[a.status]}>{a.status}</Badge>
        <span className="text-sm text-slate-500">Submitted {formatDateTime(a.submitted_at)}</span>
      </div>
      {isApplicant && (
        <p className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Submitting an application does not guarantee approval or finalize an adoption.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="1. Applicant information">
            <Item label="Legal name" value={a.legal_name} /><Item label="Date of birth" value={formatDate(a.date_of_birth)} />
            <Item label="Contact number" value={a.contact_number} /><Item label="Email" value={a.email} />
            <Item label="Address" value={a.address} wide /><Item label="Civil status" value={a.civil_status} />
            <Item label="Occupation" value={a.occupation} /><Item label="Employment details" value={a.employment_details} wide />
          </Section>
          <Section title="2. Family and household">
            <Item label="Spouse / co-applicant" value={a.spouse_details} wide /><Item label="Household members" value={a.household_members} wide />
            <Item label="Living conditions" value={a.living_conditions} wide /><Item label="Caregiving experience" value={a.caregiving_experience} wide />
          </Section>
          <Section title="3. Child">
            <Item label="Child" value={isApplicant ? `${a.child_first_name} ${a.child_last_initial}.` : `${a.child_full_name} (${a.child_id})`} />
            <Item label="Age" value={`${a.child_age} years`} />
            {!isApplicant && <Item label="Child's current status" value={a.child_status} />}
          </Section>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-navy-900">4. Supporting documents</h2>
            <ul className="divide-y divide-slate-100">
              {a.document_checklist.map((d) => (
                <li key={d.doc_type} className="flex flex-wrap items-center gap-3 py-3">
                  {d.status === 'Submitted'
                    ? <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
                    : <CircleAlert className={`h-5 w-5 ${d.required ? 'text-amber-500' : 'text-slate-300'}`} aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-900">{d.label}{d.required ? '' : ' (optional)'}</p>
                    <p className={`text-xs ${d.status === 'Submitted' ? 'text-emerald-600' : 'text-slate-500'}`}>{d.status}</p>
                  </div>
                  {(isApplicant || user.role === 'Admin') && UPLOADABLE.includes(a.status) && (
                    <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:bg-slate-50 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                      <Upload className="h-3.5 w-3.5" /> {busy === `doc:${d.doc_type}` ? 'Uploading…' : d.status === 'Submitted' ? 'Add another' : 'Upload'}
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="sr-only"
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(d.doc_type, f); }} />
                    </label>
                  )}
                </li>
              ))}
            </ul>
            {a.documents.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold text-navy-900">Uploaded files</h3>
                <ul className="space-y-1.5 text-sm">
                  {a.documents.map((doc) => (
                    <li key={doc.document_id} className="flex flex-wrap items-center gap-2">
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-brand hover:underline" onClick={() => openDocument(a.application_id, doc, toast)}>
                        {doc.original_name} <ExternalLink className="h-3 w-3" />
                      </button>
                      <span className="text-xs text-slate-500">{(doc.size_bytes / MB).toFixed(1)} MB · {formatDateTime(doc.uploaded_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-xs text-slate-500">PDF, PNG or JPG, up to 10 MB each. Files are stored encrypted.</p>
          </Card>

          <Section title="5–6. Reason and declaration">
            <Item label="Reason for adoption" value={a.reason_for_adoption} wide />
            <Item label="Declaration and privacy consent" value={a.declaration_accepted ? `Confirmed on ${formatDateTime(a.consented_at)}` : 'Not confirmed'} wide />
          </Section>
        </div>

        <div className="space-y-6">
          {!isApplicant && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold text-navy-900">Review</h2>
              <ErrorNote error={actionError} />
              <Field label="Review note" hint="Visible to the applicant in their timeline.">
                <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button className="mt-2 w-full" variant="secondary" loading={busy === 'note'} onClick={addNote}>Add note</Button>
              {!closed && targets.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <Field label="Change status">
                    <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                      <option value="">Choose…</option>
                      {targets.map((t) => <option key={t} value={t} disabled={t === 'Completed' && a.status !== 'Approved'}>{t}{t === 'Completed' && a.status !== 'Approved' ? ' (after Approved)' : ''}</option>)}
                    </select>
                  </Field>
                  <Button className="mt-2 w-full" loading={busy === 'status'} onClick={requestStatus}>Update status</Button>
                  {user.role === 'Staff' && <p className="mt-2 text-xs text-slate-500">Staff can set Under Review or Additional Documents Required. An administrator decides approval.</p>}
                </div>
              )}
              {closed && <p className="mt-4 text-sm text-slate-500">This application is {a.status.toLowerCase()} and can no longer change.</p>}
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-navy-900">Timeline</h2>
            {a.reviews.length === 0 ? <p className="text-sm text-slate-500">No review activity yet.</p> : (
              <ol className="space-y-3">
                {a.reviews.map((r, i) => (
                  <li key={r.review_id || i} className="border-l-2 border-slate-200 pl-3 text-sm">
                    <p className="text-xs text-slate-500">{formatDateTime(r.created_at)}{r.reviewer_name ? ` · ${r.reviewer_name} (${r.reviewer_role})` : ''}</p>
                    {r.status_to && <p className="font-medium text-navy-900">{r.status_from} → {r.status_to}</p>}
                    {r.note && <p className="whitespace-pre-wrap text-slate-700">{r.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <ConfirmModal open={confirming} onClose={() => setConfirming(false)} loading={busy === 'status'} onConfirm={changeStatus}
        title={`Set application to ${target}?`} confirmLabel={`Set ${target}`}
        message={target === 'Completed'
          ? `Confirm that the formal legal adoption process is complete. ${a.child_full_name} will be marked Adopted and any other open applications for this child will be closed.`
          : target === 'Approved'
            ? "Approving does not change the child's status. The child becomes Adopted only when you mark the legal process Completed."
            : 'The applicant will see this decision and your note. This cannot be undone.'} />
    </>
  );
}
