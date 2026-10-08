import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Lock, Printer, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field, Spinner } from '../components/ui';
import TokenVerifyModal from '../components/TokenVerifyModal';
import UnlockedBar from '../components/UnlockedBar';
import AccessSessions from '../components/AccessSessions';
import AssignedStaffCard from '../components/AssignedStaffCard';
import useSensitiveLogging from '../hooks/useSensitiveLogging';
import { clearGrant, readGrant, saveGrant, unlockHeaders } from '../lib/grants';
import { formatDate, formatDateTime } from '../lib/format';
import { TRANSITION_TONE } from './Transitions';
import NotFound from './NotFound';

const REC = 'transition_review';
const STATUSES = ['For Review', 'In Progress', 'Completed'];
const FORM_KEYS = ['review_status', 'education_goal', 'vocational_goal', 'housing_goal', 'notes', 'informed_at', 'informed_by'];
const toForm = (r) => Object.fromEntries(FORM_KEYS.map((k) => [k, k === 'informed_at' ? (r[k] ? String(r[k]).slice(0, 10) : '') : (r[k] || '')]));

/**
 * /transition-reviews/:id. Staff: the locked view until the assigned case worker unlocks it (purpose,
 * confidentiality tick, QR, Token ID). Unsaved edits stay in the form if the unlock ends; saving needs
 * a new unlock. Admin: everything, no token. Nothing here discharges or deletes a record.
 */
export default function TransitionReviewDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [expired, setExpired] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(() => api(`/transition-reviews/${id}`, { headers: unlockHeaders(REC, id) }).then((r) => {
    setReview(r.data);
    // Locked: the form is cleared unless it holds the user's own unsaved edits (kept so no work is lost).
    if (r.data.locked) { clearGrant(REC, id); if (!dirtyRef.current) setForm(null); }
    else if (!dirtyRef.current) setForm(toForm(r.data));
  }).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);
  useSensitiveLogging(REC, id, Boolean(review && !review.locked), unlockHeaders(REC, id));
  // "Update" on the list opens the unlock steps straight away.
  useEffect(() => {
    if (review?.locked && review.sensitive.assigned && params.get('unlock') === '1') { setUnlocking(true); setParams({}, { replace: true }); }
  }, [review, params, setParams]);

  if (error?.status === 404) return <NotFound />;
  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!review) return <Spinner />;

  const onUnlocked = async (result) => {
    saveGrant(REC, review.review_id, result.grant, result.expires_at, { purpose: result.purpose });
    setUnlocking(false); setExpired(false); setSaveError(null);
    await load();
    toast('Review unlocked.');
  };
  const onLocked = (why) => {
    clearGrant(REC, review.review_id);
    if (dirtyRef.current) { setExpired(true); toast('Your unlock ended. Your changes are still in the form: unlock again to save them.'); }
    else toast(why === 'expired' ? 'Time is up. The review is locked again.' : 'Locked.');
    load();
  };
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setDirty(true); };
  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const res = await api(`/transition-reviews/${review.review_id}`, { method: 'PUT', headers: unlockHeaders(REC, review.review_id), body: form });
      setReview(res.data); setForm(toForm(res.data)); setDirty(false); setExpired(false);
      toast('Transition review saved.');
    } catch (err) {
      if (err.details?.locked) { setExpired(true); clearGrant(REC, review.review_id); load(); }
      setSaveError(err);
    } finally { setSaving(false); }
  };

  const modal = <TokenVerifyModal open={unlocking} onClose={() => setUnlocking(false)} recordType={REC} recordId={review.review_id}
    recordLabel={`Transition review ${review.case_number}`} onUnlocked={onUnlocked} />;
  const header = (
    <div className="mb-4">
      <Link to="/transitions" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" /> Transition Review (18+)</Link>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-2xl font-semibold text-navy-900">{review.case_number}</h1>
        <Badge tone={TRANSITION_TONE[review.review_status]}>{review.review_status}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-500">{review.locked ? review.masked_name : review.full_name} · Age {review.age} · Flagged {formatDate(review.flagged_at)} · Case worker: {review.assigned_staff?.name || 'not assigned'}</p>
      <p className="mt-1 text-xs text-slate-500">Records stay active; nothing is discharged or deleted by this review.</p>
    </div>
  );

  // Locked view (Staff before an unlock). If edits were kept from an ended unlock, they stay below.
  if (review.locked && !form) {
    return (
      <>
        {modal}{header}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
              <div>
                <h2 className="font-semibold text-navy-900">This review is locked</h2>
                <ul className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                  {review.sensitive.sections.map((x) => <li key={x.key} className="flex items-center gap-1.5"><Lock className="h-3 w-3 text-slate-400" aria-hidden /> {x.label}</li>)}
                </ul>
              </div>
            </div>
            <div className="mt-5">
              {review.sensitive.assigned
                ? <Button className="h-12 w-full text-base sm:w-auto" onClick={() => setUnlocking(true)}>Unlock review</Button>
                : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700" role="status">You're not assigned to this record. Ask an Admin to assign you.</p>}
            </div>
          </Card>
          <aside><AssignedStaffCard record={review} endpoint={`/transition-reviews/${review.review_id}/assign`} onSaved={() => load()} /></aside>
        </div>
      </>
    );
  }

  const canEdit = !review.locked;
  const ta = (k, label, rows = 2) => (
    <Field label={label}><textarea className="input" rows={rows} maxLength={k === 'notes' ? 10000 : 3000} value={form[k]} disabled={!canEdit} onChange={set(k)} /></Field>
  );
  return (
    <>
      {modal}{header}
      {isAdmin && <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-navy-900 px-3 py-1 text-xs font-medium text-white"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Admin full access · views are recorded</p>}
      {!isAdmin && !review.locked && (
        <div className="mb-4"><UnlockedBar recordType={REC} recordId={review.review_id} expiresAt={review.sensitive.expires_at}
          purpose={review.sensitive.purpose || readGrant(REC, review.review_id)?.purpose} headers={unlockHeaders(REC, review.review_id)} onLocked={onLocked} /></div>
      )}
      {review.locked && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{expired ? 'Your unlock ended. Your unsaved changes are kept below. Unlock again to save them.' : 'This review is locked.'}</p>
          {review.sensitive.assigned && <Button size="sm" onClick={() => setUnlocking(true)}>Unlock again</Button>}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <ErrorNote error={saveError} />
          {!review.locked && (
            <Card className="p-4">
              <h2 className="mb-2 font-semibold text-navy-900">Child information</h2>
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Name</dt><dd className="text-navy-900">{review.full_name}</dd></div>
                <div><dt className="text-slate-500">Gender</dt><dd className="text-navy-900">{review.gender}</dd></div>
                <div><dt className="text-slate-500">Date of birth</dt><dd className="text-navy-900">{formatDate(review.dob)} (age {review.age})</dd></div>
                <div><dt className="text-slate-500">Record status</dt><dd className="text-navy-900">{review.child_status}</dd></div>
              </dl>
              <Link to={`/children/${review.child_id}`} className="mt-2 inline-block text-sm text-brand hover:underline">Open the child's record</Link>
            </Card>
          )}
          <Card className="space-y-4 p-4">
            <h2 className="font-semibold text-navy-900">Transition plan</h2>
            <Field label="Status">
              <select className="input" value={form.review_status} disabled={!canEdit} onChange={set('review_status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <fieldset className="space-y-3"><legend className="text-sm font-medium text-navy-800">Educational skills</legend>
              {ta('education_goal', 'Education goal')}{ta('vocational_goal', 'Vocational and skills goal')}
            </fieldset>
            <fieldset className="space-y-3"><legend className="text-sm font-medium text-navy-800">Exit plan from the welfare home</legend>
              {ta('housing_goal', 'Housing and exit plan')}
            </fieldset>
            <fieldset className="space-y-3"><legend className="text-sm font-medium text-navy-800">Goals, case notes and staff remarks</legend>
              {ta('notes', 'Review notes', 4)}
              {!review.locked && review.updated_by_name && <p className="text-xs text-slate-500">Last updated by {review.updated_by_name}, {formatDateTime(review.updated_at)}</p>}
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium text-navy-800">Young person informed of this review and their data rights</legend>
              <p className="text-xs text-slate-500">They are an adult data subject (RA 10173). Optional; it doesn't block saving.</p>
              {!form.informed_at && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Reminder: record when the young person was informed.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Date informed"><input className="input" type="date" value={form.informed_at} disabled={!canEdit} onChange={set('informed_at')} /></Field>
                <Field label="Informed by"><input className="input" maxLength={150} value={form.informed_by} disabled={!canEdit} onChange={set('informed_by')} /></Field>
              </div>
            </fieldset>
            <Card className="bg-slate-50 p-3 shadow-none"><h3 className="text-sm font-medium text-navy-800">Documents</h3><p className="text-xs text-slate-500">No documents are attached to transition reviews.</p></Card>
            <div className="flex flex-wrap items-center gap-2">
              <Button loading={saving} disabled={!canEdit || !dirty} onClick={save}>Save review</Button>
              {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
            </div>
            <p className="text-xs text-slate-500">Completing the review does not discharge the young person. Use the child's record to change status with full discharge documentation.</p>
          </Card>
        </div>
        <aside className="space-y-4">
          <AssignedStaffCard record={review} endpoint={`/transition-reviews/${review.review_id}/assign`} onSaved={() => load()} />
          {isAdmin && <AccessSessions recordType={REC} recordId={review.review_id} />}
        </aside>
      </div>
    </>
  );
}
