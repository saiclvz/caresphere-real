import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Clock, Lock, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ErrorNote, Skeleton } from '../components/ui';
import TokenVerifyModal from '../components/TokenVerifyModal';
import UnlockedBar from '../components/UnlockedBar';
import AccessSessions from '../components/AccessSessions';
import AssignedStaffCard from '../components/AssignedStaffCard';
import DocumentViewer from '../components/DocumentViewer';
import useSensitiveLogging from '../hooks/useSensitiveLogging';
import { clearGrant, readGrant, saveGrant, unlockHeaders } from '../lib/grants';
import { formatDate, formatDateTime } from '../lib/format';
import { REC, StageDocuments, StatusBadge } from './transition/common';
import { ClosedNote, STAGE_PANELS } from './transition/Stages';
import NotFound from './NotFound';

/** The 9-stage stepper. Completed and current stages open; later stages open only for an administrator. */
function Stepper({ stages, selected, onSelect, isAdmin }) {
  return (
    <nav aria-label="Transition review stages" className="relative mb-4 overflow-x-auto">
      <ol className="grid min-w-[46rem] grid-cols-9 gap-1">
        {stages.map((s, i) => {
          const open = isAdmin || s.state !== 'pending';
          const sel = selected === s.key;
          return (
            <li key={s.key} className="relative">
              {i > 0 && <span className={`absolute left-0 top-4 h-0.5 w-1/2 ${s.state === 'pending' ? 'bg-slate-200' : 'bg-emerald-300'}`} aria-hidden />}
              {i < stages.length - 1 && <span className={`absolute right-0 top-4 h-0.5 w-1/2 ${stages[i + 1].state === 'pending' ? 'bg-slate-200' : 'bg-emerald-300'}`} aria-hidden />}
              <button type="button" disabled={!open} onClick={() => onSelect(s.key)} aria-current={s.state === 'current' ? 'step' : undefined} aria-pressed={sel}
                title={open ? s.label : 'Complete the earlier stages first'}
                className={`relative z-10 flex w-full flex-col items-center gap-1.5 rounded-lg px-1 pb-1 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${open ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-page ${
                  s.state === 'completed' ? 'bg-emerald-500 text-white' : s.state === 'current' ? 'bg-navy-900 text-white' : 'border border-slate-300 bg-white text-slate-500'} ${sel ? 'outline outline-2 outline-offset-2 outline-brand' : ''}`}>
                  {s.state === 'completed' ? <Check className="h-4 w-4" aria-hidden /> : s.state === 'pending' && !isAdmin ? <Lock className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                </span>
                <span className={`text-xs leading-tight ${sel ? 'font-semibold text-navy-900' : s.state === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}>{s.label}</span>
                <span className="sr-only">({s.state === 'completed' ? 'completed' : s.state === 'current' ? 'current stage' : 'pending'})</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Summary({ review }) {
  const dec = review.workflow.decisions[0];
  const onHold = !review.closed_at && dec && !['Approved', 'Approved with Conditions'].includes(dec.decision);
  const rows = [
    ['Current placement', review.current_placement], ['Pathway', review.proposed_pathway], ['Target transition date', review.target_transition_date && formatDate(review.target_transition_date)],
    ['Next review', onHold && review.next_review_date && formatDate(review.next_review_date)], ['Goals', review.goals.join(', ')],
    ['Aftercare', review.workflow.aftercare ? `${review.workflow.aftercare.status} · ${review.workflow.visits.filter((v) => v.visit_date).length} of ${review.workflow.visits.length} follow-ups` : null],
  ].filter(([, v]) => v);
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold text-navy-900">Summary</h2>
      {onHold && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">On hold: {dec.decision}. The review stays active.</p>}
      <dl className="space-y-1.5 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right text-navy-900">{v}</dd></div>)}</dl>
      {!rows.length && <p className="text-sm text-slate-500">Nothing recorded yet.</p>}
    </Card>
  );
}

function Timeline({ events }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 8);
  return (
    <Card className="p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-navy-900"><Clock className="h-4 w-4 text-slate-400" aria-hidden /> Activity</h2>
      {events.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : (
        <ol className="space-y-2 border-l border-slate-200 pl-3">
          {shown.map((e) => (
            <li key={e.event_id} className="text-sm">
              <p className="text-navy-900">{e.summary}</p>
              <p className="text-xs text-slate-500">{e.actor_name || 'System'} · {formatDateTime(e.created_at)}</p>
            </li>
          ))}
        </ol>
      )}
      {events.length > 8 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${events.length}`}</Button>}
    </Card>
  );
}

/**
 * /transition-reviews/:id?stage=. Staff: the locked view until the assigned case worker unlocks it (purpose,
 * confidentiality tick, QR, Token ID). Admin: everything. Turning 18 created this review; nothing here deletes
 * a child or a record. Unsaved edits stay on screen if the unlock ends; saving needs a new unlock.
 */
export default function TransitionReviewDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [expired, setExpired] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [viewing, setViewing] = useState(null);
  const dirty = useRef(false);

  const load = useCallback(() => api(`/transition-reviews/${id}`, { headers: unlockHeaders(REC, id) }).then((r) => {
    if (r.data.locked) clearGrant(REC, id);
    // Locked while editing: keep the stage on screen (the edits are kept) until the user unlocks again.
    setReview((cur) => (r.data.locked && dirty.current && cur && !cur.locked ? cur : r.data));
    setError(null);
  }).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);
  useSensitiveLogging(REC, id, Boolean(review && !review.locked), unlockHeaders(REC, id));
  useEffect(() => {
    if (review?.locked && review.sensitive.assigned && params.get('unlock') === '1') { setUnlocking(true); setParams({}, { replace: true }); }
  }, [review, params, setParams]);

  if (error?.status === 404) return <NotFound />;
  if (error && !review) return <ErrorNote error={error} onRetry={load} />;
  if (!review) return <Skeleton rows={8} />;

  const stageKey = params.get('stage');
  const current = review.stages?.find((s) => s.state === 'current')?.key || (review.closed ? 'closure' : 'identify');
  const selected = review.stages?.some((s) => s.key === stageKey && (isAdmin || s.state !== 'pending')) ? stageKey : current;
  const goTo = (key) => setParams((p) => { const n = new URLSearchParams(p); n.set('stage', key); return n; }, { replace: true });

  const onUnlocked = async (result) => {
    saveGrant(REC, review.review_id, result.grant, result.expires_at, { purpose: result.purpose });
    setUnlocking(false); setExpired(false);
    dirty.current = false;
    await load();
    toast('Review unlocked.');
  };
  const onLocked = (why) => {
    clearGrant(REC, review.review_id);
    if (dirty.current) { setExpired(true); toast('Your unlock ended. Your changes are still on screen: unlock again to save them.'); return; }
    toast(why === 'expired' ? 'Time is up. The review is locked again.' : 'Locked.');
    load();
  };
  const onSaved = (data, err) => {
    if (data) { setReview(data); dirty.current = false; setExpired(false); return; }
    if (err?.details?.locked) { clearGrant(REC, review.review_id); setExpired(true); }
  };

  const modal = <TokenVerifyModal open={unlocking} onClose={() => setUnlocking(false)} recordType={REC} recordId={review.review_id}
    recordLabel={`Transition review ${review.case_number}`} onUnlocked={onUnlocked} />;
  const dec = review.workflow?.decisions?.[0];
  const onHold = review.workflow && !review.closed_at && dec && !['Approved', 'Approved with Conditions'].includes(dec.decision);
  const header = (
    <div className="mb-4">
      <Link to="/transitions" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" /> Transition Review (18+)</Link>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-2xl font-semibold text-navy-900">{review.case_number}</h1>
        <StatusBadge status={review.review_status} />
        {onHold && <Badge tone="slate">On hold until {formatDate(review.next_review_date)}</Badge>}
        {review.legacy_completed && <Badge tone="slate">Completed before the 9-stage workflow</Badge>}
      </div>
      <p className="mt-1 text-sm text-slate-500">{review.locked ? review.masked_name : review.full_name} · Age {review.age} · Flagged {formatDate(review.flagged_at)} · Social worker: {review.assigned_staff?.name || 'not assigned'}</p>
      <p className="mt-1 text-xs text-slate-500">Turning 18 does not discharge anyone. The child's record and case history are kept.</p>
    </div>
  );

  if (review.locked) {
    return (
      <>
        {modal}{header}
        <Stepper stages={review.stages} selected={null} onSelect={() => {}} isAdmin={false} />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
          <aside><AssignedStaffCard duty="transition" record={review} endpoint={`/transition-reviews/${review.review_id}/assign`} onSaved={() => load()} /></aside>
        </div>
      </>
    );
  }

  const Panel = STAGE_PANELS[selected];
  const def = review.config.stages.find((s) => s.key === selected);
  const st = review.stages.find((s) => s.key === selected);
  const generalDocs = !['conference', 'aftercare'].includes(selected);
  return (
    <>
      {modal}{header}
      <DocumentViewer open={Boolean(viewing)} title={viewing?.label} path={viewing ? `/transition-reviews/${review.review_id}/documents/${viewing.document_id}` : null}
        headers={unlockHeaders(REC, review.review_id)} onClose={() => setViewing(null)} />
      {isAdmin && <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-navy-900 px-3 py-1 text-xs font-medium text-white"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Admin full access · views are recorded</p>}
      {!isAdmin && !expired && (
        <div className="mb-4"><UnlockedBar recordType={REC} recordId={review.review_id} expiresAt={review.sensitive.expires_at}
          purpose={review.sensitive.purpose || readGrant(REC, review.review_id)?.purpose} headers={unlockHeaders(REC, review.review_id)} onLocked={onLocked} /></div>
      )}
      {expired && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">Your unlock ended. Your unsaved changes are still on screen. Unlock again to save them.</p>
          <Button size="sm" onClick={() => setUnlocking(true)}>Unlock again</Button>
        </div>
      )}
      <Stepper stages={review.stages} selected={selected} onSelect={goTo} isAdmin={isAdmin} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="min-w-0 space-y-4 p-5" onInputCapture={() => { dirty.current = true; }}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Stage {review.config.stages.findIndex((s) => s.key === selected) + 1} of 9</p>
              <h2 className="text-lg font-semibold text-navy-900">{def.label}</h2>
              <p className="text-sm text-slate-600">{def.help}</p>
            </div>
            <Badge tone={st.state === 'completed' ? 'green' : st.state === 'current' ? 'blue' : 'slate'}>{st.state === 'completed' ? 'Completed' : st.state === 'current' ? 'Current' : 'Pending'}</Badge>
          </div>
          <ClosedNote review={review} />
          {st.state !== 'completed' && st.outstanding.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">Still to do</p>
              <ul className="mt-1 list-disc pl-5">{st.outstanding.map((o) => <li key={o}>{o}</li>)}</ul>
            </div>
          )}
          <Panel key={`${selected}-${review.timeline[0]?.event_id || 0}`} review={review} onSaved={onSaved} goTo={goTo} onView={setViewing} />
          {generalDocs && (
            <div className="border-t border-slate-100 pt-4">
              <StageDocuments review={review} stage={selected} canUpload={review.permissions.can_edit && (!def.admin || isAdmin)} onSaved={onSaved} onView={setViewing} />
            </div>
          )}
        </Card>
        <aside className="space-y-4">
          <AssignedStaffCard duty="transition" record={review} endpoint={`/transition-reviews/${review.review_id}/assign`} onSaved={() => load()} />
          <Summary review={review} />
          <Timeline events={review.timeline} />
          {isAdmin && <AccessSessions recordType={REC} recordId={review.review_id} />}
        </aside>
      </div>
    </>
  );
}
