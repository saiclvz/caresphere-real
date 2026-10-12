import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArrowLeft, CalendarDays, ClipboardCheck, Eye, Lock, ShieldCheck } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import DocumentViewer from '../components/DocumentViewer';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field, Modal, Skeleton } from '../components/ui';
import TokenVerifyModal from '../components/TokenVerifyModal';
import UnlockedBar from '../components/UnlockedBar';
import AssignedStaffCard from '../components/AssignedStaffCard';
import useSensitiveLogging from '../hooks/useSensitiveLogging';
import { clearGrant, readGrant, saveGrant } from '../lib/grants';
import { formatDate, formatDateTime } from '../lib/format';
import { DeadlineChip, statusTone } from './Adoptions';
import NotFound from './NotFound';
import StatusDialog from './adoption/staff/StatusDialog';
import OverviewTab from './adoption/staff/OverviewTab';
import ApplicantTab from './adoption/staff/ApplicantTab';
import DocumentsTab from './adoption/staff/DocumentsTab';
import IdCheckTab from './adoption/staff/IdCheckTab';
import AssessmentTab from './adoption/staff/AssessmentTab';
import MatchingTab from './adoption/staff/MatchingTab';
import NotesTab from './adoption/staff/NotesTab';
import TimelineTab from './adoption/staff/TimelineTab';
import AccessTab from './adoption/staff/AccessTab';
import { headersFor, REC } from './adoption/staff/common';
import WorkflowTab, { CaseStepper } from './adoption/staff/WorkflowTab';

const TABS = [
  ['workflow', 'Case workflow'], ['overview', 'Overview'], ['applicant', 'Applicant'], ['documents', 'Documents'], ['idcheck', 'ID check'], ['assessment', 'Assessment'],
  ['matching', 'Matching and placement'], ['notes', 'Notes'], ['timeline', 'Timeline'], ['access', 'Access'],
];

/** One neutral line instead of the old red banner and pill. */
function RecordNotice({ isAdmin }) {
  return (
    <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500" role="note">
      <Eye className="h-3.5 w-3.5" aria-hidden /> Restricted record. Every view is recorded.
      {isAdmin && <Badge tone="slate"><ShieldCheck className="h-3 w-3" aria-hidden /> Admin full access</Badge>}
    </p>
  );
}

function Header({ app, isAdmin }) {
  return (
    <div className="mb-3">
      <Link to="/adoptions" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Adoption applications</Link>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-2xl font-semibold text-navy-900">{app.reference_no}</h1>
        <Badge tone={statusTone(app.status)}>{app.status}</Badge>
        {app.category && <Badge tone="slate">{app.category}</Badge>}
        {app.key_dates?.finalized_at && <Badge tone="green"><ShieldCheck className="h-3 w-3" aria-hidden /> Finalized {formatDate(app.key_dates.finalized_at)}</Badge>}
        {app.is_legacy && <Badge tone="slate">Earlier form</Badge>}
        {app.archived_at && <Badge tone="slate"><Archive className="h-3 w-3" aria-hidden /> Archived</Badge>}
        <DeadlineChip label="Trial custody ends" d={app.deadlines?.trial_end} />
        <DeadlineChip label="NACC deadline" d={app.deadlines?.nacc_deadline} />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {isAdmin && app.applicant_name ? app.applicant_name : `Applicant ${app.applicant_initials || app.applicant_masked || ''}`}
        {' · '}Submitted {formatDate(app.submitted_at)}{' · '}Assigned staff: {app.assigned_staff?.name || 'not assigned'}
      </p>
    </div>
  );
}



/** Tabs with arrow-key, Home and End support; the selected tab is kept in the URL (?tab=). */
function TabList({ tabs, current, onSelect }) {
  const refs = useRef({});
  const keys = tabs.map(([k]) => k);
  const onKey = (e) => {
    const i = keys.indexOf(current);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: keys.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const k = keys[(next + keys.length) % keys.length];
    onSelect(k); refs.current[k]?.focus();
  };
  return (
    <div role="tablist" aria-label="Application sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" onKeyDown={onKey}>
      {tabs.map(([k, label]) => (
        <button key={k} ref={(el) => { refs.current[k] = el; }} type="button" role="tab" id={`tab-${k}`} aria-selected={current === k} aria-controls={`panel-${k}`}
          tabIndex={current === k ? 0 : -1} onClick={() => onSelect(k)}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${current === k ? 'border-brand text-navy-900' : 'border-transparent text-slate-500 hover:text-navy-900'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Right rail: assigned staff, next action (with Update status), key dates. */
function RightRail({ app, isAdmin, onUpdate, onGo, onChanged, onArchive }) {
  const na = app.next_action;
  const kd = app.key_dates || {};
  const dates = [
    ['Submitted', kd.submitted_at && formatDate(kd.submitted_at)],
    ['Next visit', kd.next_interview && `${kd.next_interview.kind}, ${formatDateTime(kd.next_interview.at)}`],
    ['Trial custody', kd.trial_start && `${formatDate(kd.trial_start)} to ${formatDate(kd.trial_end)}`],
    ['NACC deadline', kd.nacc_deadline && formatDate(kd.nacc_deadline)],
    ['Days in this stage', app.days_in_stage != null ? String(app.days_in_stage) : null],
  ].filter(([, v]) => v);
  const allowed = (app.allowed_statuses || []).length > 0;
  return (
    <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Case summary">
      <AssignedStaffCard duty="adoption" record={app} endpoint={`/adoptions/${app.application_id}/assign`} onSaved={onChanged} />
      <Card className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold text-navy-900"><ClipboardCheck className="h-4 w-4 text-brand" aria-hidden /> Next action</h2>
        {na ? <p className="text-sm text-slate-700">{na.text}</p> : <p className="text-sm text-slate-700">{allowed ? 'Record the next stage.' : 'The next stage is recorded by an administrator.'}</p>}
        {na?.tab && <Button size="sm" variant="secondary" className="w-full" onClick={() => onGo(na.tab, na.filter)}>Go to {TABS.find(([k]) => k === na.tab)?.[1]}</Button>}
        {allowed && <Button className="w-full" onClick={onUpdate}>Update status</Button>}
        {isAdmin && ['Closed', 'Declined', 'Withdrawn'].includes(app.status) && !app.archived_at && (
          <Button size="sm" variant="ghost" onClick={onArchive}><Archive className="h-4 w-4" aria-hidden /> Archive application</Button>
        )}
        {isAdmin && app.archived_at && <p className="text-xs text-slate-500">Archived {formatDate(app.archived_at)}{app.archive_reason ? `: ${app.archive_reason}` : ''}</p>}
      </Card>
      {dates.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-navy-900"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> Key dates</h2>
          <dl className="space-y-1 text-sm">{dates.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right text-navy-900">{v}</dd></div>)}</dl>
        </Card>
      )}
    </aside>
  );
}

/** Locked Staff: header, progress and what is locked. Nothing sensitive is loaded. */
function LockedBody({ app, onUnlock }) {
  return (
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
  );
}

/** /adoptions/:id (Admin, Staff): the application in tabs, with the RA 11642 workflow. */
export default function StaffApplicationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  const configReq = useApi('/adoptions/form-config');
  const config = configReq.data?.data;
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null); // null | { preset }
  const [docFilter, setDocFilter] = useState('all');
  const [viewing, setViewing] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Notes become available after a status update is saved in this session (attached to that update).
  const [sessionUpdate, setSessionUpdate] = useState(null);

  // Non-Regular adoptions have no matching: the child is linked and verified instead.
  const tabs = TABS.filter(([k]) => k !== 'access' || isAdmin)
    .map(([k, l]) => (k === 'matching' && app && app.category && app.application_type !== 'Regular' ? [k, 'Child and placement'] : [k, l]));
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'workflow';
  const stageKey = params.get('stage') || null;
  const select = (k, filter) => {
    if (k === 'documents') setDocFilter(filter || 'all');
    setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); if (k !== 'workflow') n.delete('stage'); return n; }, { replace: true });
  };
  // The stepper: opens the stage's workspace in the Case workflow tab (?tab=workflow&stage=...).
  const openStage = (key) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', 'workflow'); n.set('stage', key); return n; }, { replace: true });

  // The unlock secret is sent as a header; the server decides what is returned.
  const load = useCallback(() => api(`/adoptions/${id}?view=shell`, { headers: headersFor(id) }).then((r) => {
    if (r.data.locked) clearGrant(REC, id);
    setApp(r.data); setError(null);
  }).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);
  const refresh = useCallback(() => { load(); setVersion((v) => v + 1); }, [load]);
  useSensitiveLogging(REC, id, Boolean(app && !app.locked), headersFor(id));

  if (error?.status === 404) return <NotFound />;
  if (error && !app) return <ErrorNote error={error} onRetry={load} />;
  if (!app || !config) return <Skeleton rows={8} />;

  const onUnlocked = async (result) => {
    saveGrant(REC, app.application_id, result.grant, result.expires_at, { purpose: result.purpose });
    setUnlocking(false);
    await load(); setVersion((v) => v + 1);
    toast('Sensitive sections unlocked for this application.');
  };
  const onLocked = (why) => {
    clearGrant(REC, app.application_id);
    toast(why === 'expired' ? 'Time is up. The sensitive sections are locked again.' : 'Locked.');
    load();
  };
  const openDoc = (f) => setViewing({ title: f.display_name, path: `/adoptions/${app.application_id}/documents/${f.document_id}`, headers: headersFor(app.application_id) });
  const archive = async () => {
    if (archiveReason.trim().length < 5) { toast('Give a reason for archiving.', 'error'); return; }
    setBusy(true);
    try { await api(`/adoptions/${app.application_id}/archive`, { method: 'POST', body: { reason: archiveReason.trim() } }); setArchiving(false); refresh(); toast('Application archived. It is kept, not deleted.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const statusDialog = dialog && (
    <StatusDialog app={app} config={config} preset={dialog.preset} onClose={() => setDialog(null)}
      onSaved={(data) => {
        setDialog(null);
        setSessionUpdate({ history_id: data.last_history_id, status: data.status, at: new Date().toISOString() });
        toast(`Recorded: ${data.status}.`);
        refresh();
      }} />
  );
  const rail = <RightRail app={app} isAdmin={isAdmin} onUpdate={() => setDialog({})} onGo={select} onChanged={refresh} onArchive={() => setArchiving(true)} />;

  if (app.locked) {
    return (
      <>
        <TokenVerifyModal open={unlocking} onClose={() => setUnlocking(false)} recordType={REC} recordId={app.application_id} recordLabel={app.reference_no} onUnlocked={onUnlocked} />
        <RecordNotice isAdmin={false} />
        <Header app={app} isAdmin={false} />
        <CaseStepper stages={app.stages} selected={null} onSelect={null} />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <LockedBody app={app} onUnlock={() => setUnlocking(true)} />
          {rail}
        </div>
        {statusDialog}
      </>
    );
  }

  const props = { app, config, version, onChanged: refresh };
  const panel = {
    workflow: <WorkflowTab {...props} stageKey={stageKey} onSelectStage={openStage} onGo={select} />,
    overview: <OverviewTab app={app} onGo={select} />,
    applicant: <ApplicantTab {...props} />,
    documents: <DocumentsTab key={docFilter} {...props} initialFilter={docFilter} onOpenDoc={openDoc}
      onRequest={(row) => setDialog({ preset: { status: 'Documents requested', docs: { [row.doc_type]: '' } } })} />,
    idcheck: <IdCheckTab {...props} />,
    assessment: <AssessmentTab {...props} onGo={select} />,
    matching: <MatchingTab {...props} />,
    notes: <NotesTab {...props} sessionUpdate={sessionUpdate} />,
    timeline: <TimelineTab {...props} />,
    access: isAdmin ? <AccessTab app={app} /> : null,
  }[tab];

  return (
    <>
      <DocumentViewer open={Boolean(viewing)} title={viewing?.title} path={viewing?.path} headers={viewing?.headers} onClose={() => setViewing(null)} />
      <RecordNotice isAdmin={isAdmin} />
      <Header app={app} isAdmin={isAdmin} />
      {!isAdmin && (
        <div className="mb-3"><UnlockedBar recordType={REC} recordId={app.application_id} expiresAt={app.sensitive.expires_at}
          purpose={app.sensitive.purpose || readGrant(REC, app.application_id)?.purpose} headers={headersFor(app.application_id)} onLocked={onLocked} /></div>
      )}
      <CaseStepper stages={app.stages} selected={tab === 'workflow' ? (stageKey || app.stages?.find((s) => s.state === 'current')?.key) : null} onSelect={openStage} />
      {error && <div className="mb-3"><ErrorNote error={error} onRetry={load} /></div>}
      <TabList tabs={tabs} current={tab} onSelect={select} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-lg">
            {panel}
          </div>
        </div>
        {rail}
      </div>
      {statusDialog}
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
