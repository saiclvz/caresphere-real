import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Baby, Eye, GraduationCap, KeyRound, Plus, ShieldAlert, Siren, UserPlus, Users } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/format';
import Pagination, { usePageState } from '../components/Pagination';
import { AssignmentModal, ReviewEmergency } from '../components/children/AccessPanels';
import { chipOf } from '../lib/childAccess';
import { hasDuty } from '../lib/duties';
import { ADMISSION_TONE } from './AdmissionPage';

export const STATUS_TONE = { Active: 'green', Discharged: 'slate', Adopted: 'blue' };
const TABS = [
  { key: '', label: 'All' },
  { key: 'Active', label: 'Active' },
  { key: 'Discharged', label: 'Discharged' },
  { key: 'Adopted', label: 'Adopted' },
  { key: 'flagged', label: 'Transition Review (18+)' },
];

/** Sort options. Default: most recent activity. Age only for Admin, and only when chosen. */
const SORTS = [['recent', 'Most recent activity'], ['registered', 'Date added (newest)'], ['case', 'Record number'], ['name', 'Name (A to Z)']];

/** Admin: what needs attention (counts only). */
function AccessAlerts({ onPanel }) {
  const { data } = useApi('/child-access/overview');
  const o = data?.data;
  if (!o) return null;
  const items = [
    { n: o.unassigned, label: 'without a case worker', to: '/children?assigned=unassigned', Icon: Users },
    { n: o.needs_reassignment, label: 'need reassignment', to: '/children?assigned=attention', Icon: AlertTriangle },
    { n: o.access_requests, label: 'access requests', panel: 'requests', Icon: KeyRound },
    { n: o.emergency_to_review, label: 'emergency access to review', panel: 'emergency', Icon: Siren },
    { n: o.covers_ending, label: 'temporary covers ending within 3 days', Icon: UserPlus },
    { n: o.privacy_concerns, label: 'privacy concerns', to: '/data-protection?tab=concerns', Icon: ShieldAlert },
  ].filter((x) => x.n > 0);
  return (
    <div className="mb-4 space-y-2">
      {o.mode === 'log_only' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Child record access is in <strong>Log only</strong> mode: nothing is blocked yet, and what would be blocked is recorded. <Link to="/settings#child-access" className="font-medium underline">Review and switch to Enforce in Settings</Link>.
        </p>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Needs attention">
          {items.map((x) => {
            const body = <><x.Icon className="h-4 w-4" aria-hidden /> <strong className="tabular-nums">{x.n}</strong> {x.label}</>;
            const cls = 'inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm text-navy-900 ring-1 ring-slate-200 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';
            return x.to ? <Link key={x.label} to={x.to} className={cls}>{body}</Link>
              : x.panel ? <button key={x.label} type="button" className={cls} onClick={() => onPanel(x.panel)}>{body}</button>
                : <span key={x.label} className={cls}>{body}</span>;
          })}
        </div>
      )}
    </div>
  );
}

const ADMIN_FILTERS = [['Pending Approval', 'Waiting for review'], ['Needs Correction', 'Returned for correction'], ['Draft', 'Drafts'], ['Declined', 'Declined'], ['all', 'All']];

/**
 * Admin: "Admissions for Review". Staff with the Admission duty: "My admissions" (the ones they started).
 * Creating a child record does not mean owning it: the list only shows admissions, never the case record.
 */
function AdmissionsPanel({ isAdmin }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState(isAdmin ? 'Pending Approval' : 'all');
  const { data, loading, error, reload } = useApi(`/admissions${qs({ status })}`);
  const all = data?.data || [];
  const rows = isAdmin ? all : all.filter((r) => r.admission_status !== 'Admitted');
  const counts = data?.meta?.counts || {};
  const title = isAdmin ? 'Admissions for Review' : 'My admissions';
  return (
    <Card className="mb-4" id="admissions">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <h2 className="mr-auto font-semibold text-navy-900">{title}{isAdmin && counts['Pending Approval'] ? <Badge tone="amber" className="ml-2">{counts['Pending Approval']} waiting</Badge> : null}</h2>
        {isAdmin && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Admission status">
            {ADMIN_FILTERS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => setStatus(k)}
                className={`rounded-full px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${status === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">{isAdmin ? (status === 'Pending Approval' ? 'No admissions are waiting for review.' : 'No admissions in this view.') : 'No admissions in progress. Use New Admission to start one.'}</p>
      ) : (
        <Table label={title}>
          <thead className="bg-slate-50"><tr>
            <th className="th">Case number</th><th className="th">Child name</th>{isAdmin && <th className="th">Created by</th>}<th className="th">Date submitted</th><th className="th">Status</th><th className="th"><span className="sr-only">Action</span></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const canOpen = isAdmin || ['Draft', 'Pending Approval', 'Needs Correction'].includes(r.admission_status);
              const action = isAdmin ? (r.admission_status === 'Pending Approval' ? 'Review' : 'Open') : ['Draft', 'Needs Correction'].includes(r.admission_status) ? 'Continue' : 'View';
              return (
                <tr key={r.child_id}>
                  <td className="td whitespace-nowrap font-mono text-sm">{r.child_id}</td>
                  <td className="td">{r.name}{r.decision_note && <p className="max-w-sm text-xs text-slate-500">{r.admission_status === 'Declined' ? 'Reason' : 'To correct'}: {r.decision_note}</p>}</td>
                  {isAdmin && <td className="td text-sm">{r.created_by_name}</td>}
                  <td className="td whitespace-nowrap text-sm">{r.submitted_at ? formatDateTime(r.submitted_at) : <span className="text-slate-400">Not submitted</span>}</td>
                  <td className="td"><Badge tone={ADMISSION_TONE[r.admission_status]}>{r.admission_status}</Badge></td>
                  <td className="td text-right">{canOpen && <Button size="sm" variant={action === 'Review' ? 'primary' : 'secondary'} onClick={() => navigate(`/admissions/${encodeURIComponent(r.child_id)}`)}>{action}<span className="sr-only"> admission {r.child_id}</span></Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/** Admin queues: access requests and "Emergency access to review". */
function AdminQueue({ panel, onClose }) {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi(panel === 'emergency' ? '/emergency-access?status=pending' : '/access-requests?status=pending');
  const [reviewing, setReviewing] = useState(null);
  const rows = data?.data || [];
  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="font-semibold text-navy-900">{panel === 'emergency' ? 'Emergency access to review' : 'Access requests'}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing waiting.</p> : (
        <Table label={panel === 'emergency' ? 'Emergency access to review' : 'Access requests'}>
          <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Child</th><th className="th">Staff</th><th className="th">Reason</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.emergency_id || r.request_id}>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(r.started_at || r.created_at)}</td>
                <td className="td"><Link className="font-mono text-brand hover:underline" to={`/children/${encodeURIComponent(r.child_id)}?tab=access`}>{r.child_id}</Link></td>
                <td className="td">{r.user_name || r.requested_by_name}</td>
                <td className="td max-w-xs text-sm">{r.reason}{r.note ? `: ${r.note}` : ''}</td>
                <td className="td text-right">{panel === 'emergency'
                  ? <Button size="sm" onClick={() => setReviewing(r)}>Review<span className="sr-only"> emergency access on {r.child_id}</span></Button>
                  : <Link to={`/children/${encodeURIComponent(r.child_id)}?tab=access`} className="text-sm font-medium text-brand hover:underline">Decide<span className="sr-only"> request on {r.child_id}</span></Link>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {reviewing && <ReviewEmergency item={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); toast('Review saved.'); reload(); }} />}
    </Card>
  );
}

/** Admin: start a read-only monitoring visit (NACC, DSWD, other reviewers) for chosen records. */
function MonitoringModal({ onClose }) {
  const { toast } = useApp();
  const list = useApi('/children?limit=100&sort=case');
  const [f, setF] = useState({ reviewer_name: '', reviewer_org: 'DSWD', minutes: 60, child_ids: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const errs = error?.details?.errors || {};
  const toggle = (id) => setF((x) => ({ ...x, child_ids: x.child_ids.includes(id) ? x.child_ids.filter((y) => y !== id) : [...x.child_ids, id] }));
  const start = async () => {
    setBusy(true); setError(null);
    try { await api('/monitoring', { method: 'POST', body: { ...f, minutes: Number(f.minutes) } }); toast('Monitoring visit started. Everything is read-only until it ends.'); window.location.assign('/children'); }
    catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Start a monitoring visit" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={start}>Start visit</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Read-only and time-limited: edits and downloads are off, a watermark shows the visit and your name, and every record opened is logged. It ends on the timer or when you sign out.</p>
        <ErrorNote error={error && !Object.keys(errs).length ? error : null} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Reviewer name" required error={errs.reviewer_name} className="sm:col-span-2"><input className="input" maxLength={150} value={f.reviewer_name} onChange={(e) => setF({ ...f, reviewer_name: e.target.value })} /></Field>
          <Field label="Agency" required error={errs.reviewer_org}><select className="input" value={f.reviewer_org} onChange={(e) => setF({ ...f, reviewer_org: e.target.value })}><option>NACC</option><option>DSWD</option><option>Other</option></select></Field>
        </div>
        <Field label="Length" error={errs.minutes}><select className="input w-40" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })}>{[30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}</select></Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-navy-800">Records to show <span className="text-red-600" aria-hidden>*</span></legend>
          {errs.child_ids && <p className="mb-1 text-xs text-red-600">{errs.child_ids}</p>}
          <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
            {(list.data?.data || []).map((c) => (
              <label key={c.child_id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={f.child_ids.includes(c.child_id)} onChange={() => toggle(c.child_id)} /> <span className="font-mono text-xs">{c.child_id}</span> {c.display_name}</label>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

export default function Children() {
  const { user } = useAuth();
  const { query, toast } = useApp();
  const navigate = useNavigate();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const tab = params.get('status') || '';
  const assigned = params.get('assigned') || '';
  const panel = params.get('panel') || '';
  const canDirectory = hasDuty(user, 'children');
  const canAdmit = hasDuty(user, 'admission');
  const [monitoring, setMonitoring] = useState(false);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState(false);
  const [page, setPage] = usePageState(JSON.stringify({ tab, query, limit, sort, assigned }));
  const filter = tab === 'flagged' ? { flagged: 1 } : { status: tab };
  const { data, loading, error, reload } = useApi(canDirectory ? `/children${qs({ ...filter, q: query, assigned, sort, page, limit })}` : null);
  const staff = useApi(isAdmin ? '/assignments/staff?record_type=child' : null);
  const rows = data?.data || [];
  const monitoringOn = data?.meta?.monitoring;
  const changePage = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const sorts = isAdmin ? [...SORTS, ['age', 'Age (youngest first)']] : SORTS;
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.child_id));

  return (
    <>
      <PageHeader title="Children"
        description="Every child in care, most recent activity first. You see each record at your access level: the directory for everyone with the duty, the core record when you are assigned."
        actions={!monitoringOn && <>
          {isAdmin && <Button variant="secondary" onClick={() => setMonitoring(true)}><Eye className="h-4 w-4" aria-hidden /> Monitoring visit</Button>}
          {canAdmit && <Button onClick={() => navigate('/admissions/new')}><Plus className="h-4 w-4" aria-hidden /> New Admission</Button>}
        </>} />

      {isAdmin && !monitoringOn && <AccessAlerts onPanel={(p) => setParam('panel', p)} />}
      {isAdmin && panel && panel !== 'admissions' && !monitoringOn && <AdminQueue panel={panel} onClose={() => setParam('panel', '')} />}
      {(isAdmin || canAdmit) && !monitoringOn && <AdmissionsPanel isAdmin={isAdmin} />}
      {!canDirectory && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">You can start and complete admissions. The children directory needs the Child records duty.</p>}
      {canDirectory && <>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setParam('status', t.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === t.key ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label="Assigned" className="w-56">
            <select className="input h-9" value={assigned} onChange={(e) => setParam('assigned', e.target.value)}>
              <option value="">Everyone</option>
              <option value="me">Assigned to me</option>
              {isAdmin && <><option value="unassigned">Unassigned</option><option value="attention">Needs reassignment</option>
                {(staff.data?.data || []).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}</>}
            </select>
          </Field>
          <Field label="Sort" className="w-56">
            <select className="input h-9" value={sort} onChange={(e) => setSort(e.target.value)}>
              {sorts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {isAdmin && selected.length > 0 && !monitoringOn && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-navy-900" role="status">
          {selected.length} selected
          <Button size="sm" onClick={() => setBulk(true)}><UserPlus className="h-3.5 w-3.5" aria-hidden /> Assign selected</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Baby} title="No children in this view" description={assigned === 'me' ? 'No records are assigned to you.' : 'Admitted children appear here once an Admin approves their admission.'} />
        ) : (
          <Table label="Children">
            <thead className="bg-slate-50"><tr>
              {isAdmin && !monitoringOn && <th className="th w-8"><input type="checkbox" className="h-4 w-4 accent-brand" aria-label="Select all on this page" checked={allSelected}
                onChange={() => setSelected(allSelected ? selected.filter((id) => !rows.some((r) => r.child_id === id)) : [...new Set([...selected, ...rows.map((r) => r.child_id)])])} /></th>}
              <th className="th">Case number</th><th className="th">Name</th><th className="th">Status</th>
              {isAdmin && <th className="th">Case worker</th>}<th className="th">Access</th><th className="th">Last activity</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const chip = chipOf(c.access);
                return (
                  <tr key={c.child_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/children/${c.child_id}`)}>
                    {isAdmin && !monitoringOn && <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="h-4 w-4 accent-brand" aria-label={`Select ${c.child_id}`} checked={selected.includes(c.child_id)}
                      onChange={() => setSelected((s) => (s.includes(c.child_id) ? s.filter((x) => x !== c.child_id) : [...s, c.child_id]))} /></td>}
                    <td className="td whitespace-nowrap font-mono text-sm">{c.child_id}</td>
                    <td className="td">
                      <Link to={`/children/${c.child_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-navy-900 hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">{c.display_name}</Link>
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                        {c.transition_flag && <Badge tone="amber"><GraduationCap className="h-3 w-3" aria-hidden /> 18+</Badge>}
                      </div>
                    </td>
                    {isAdmin && <td className="td text-sm">{c.case_worker?.name || <span className="text-amber-700">Unassigned</span>}</td>}
                    <td className="td"><Badge tone={chip.tone}><chip.Icon className="h-3 w-3" aria-hidden /> {chip.label}</Badge></td>
                    <td className="td whitespace-nowrap text-sm">{c.updated_at ? formatDate(c.updated_at) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {rows.length > 0 && (
          <Pagination pagination={data?.pagination} label="children" onPageChange={changePage} onLimitChange={setLimit} />
        )}
      </Card>

      </>}
      {bulk && <AssignmentModal title={`Assign ${selected.length} record${selected.length === 1 ? '' : 's'}`} onClose={() => setBulk(false)} onSave={async (body) => {
        const res = await api('/assignments/bulk', { method: 'POST', body: { ...body, record_type: 'child', ids: selected } });
        setBulk(false); setSelected([]); toast(res.message); reload();
      }} />}
      {monitoring && <MonitoringModal onClose={() => setMonitoring(false)} />}
    </>
  );
}
