import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Baby, ClipboardList, Eye, GraduationCap, UserPlus } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table, FilterChips, IconButton } from '../components/ui';
import { formatDate } from '../lib/format';
import Pagination, { usePageState } from '../components/Pagination';
import { AssignmentModal } from '../components/children/AccessPanels';
import { hasDuty } from '../lib/duties';

export const STATUS_TONE = { Active: 'green', Discharged: 'slate', Adopted: 'blue' };
/** tbl_children.status 'Active' is shown as "Admitted" (the child is in care). */
export const CHILD_STATUS_LABEL = { Active: 'Admitted', Discharged: 'Discharged', Adopted: 'Adopted' };
/** Default: admitted children (in care). Discharged and Adopted stay as history; admissions are on the Intake page;
 * young people turning 18 are on the Transitions page. */
const TABS = [
  { key: 'Active', label: 'Admitted' },
  { key: 'Discharged', label: 'Discharged' },
  { key: 'Adopted', label: 'Adopted' },
  { key: 'all', label: 'All records' },
];

/** Sort options. Default: most recent activity. Age only for Admin, and only when chosen. */
const SORTS = [['recent', 'Most recent activity'], ['registered', 'Date added (newest)'], ['case', 'Record number'], ['name', 'Name (A to Z)']];

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
  const tabs = [...TABS, ...(isAdmin ? [{ key: 'archived', label: 'Archived' }] : [])];
  const tab = tabs.some((t) => t.key === params.get('status')) ? params.get('status') : 'Active';
  const assigned = params.get('assigned') || '';
  const canDirectory = hasDuty(user, 'children');
  const canAdmit = user.role === 'Staff' && hasDuty(user, 'admission'); // Staff submit admissions; Admin reviews them on Intake
  const [monitoring, setMonitoring] = useState(false);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('recent');
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState(false);
  const [page, setPage] = usePageState(JSON.stringify({ tab, query, limit, sort, assigned }));
  const filter = tab === 'archived' ? { archived: 1 } : tab === 'all' ? {} : { status: tab };
  const { data, loading, error, reload } = useApi(canDirectory ? `/children${qs({ ...filter, q: query, assigned, sort, page, limit })}` : null);
  const staff = useApi(isAdmin ? '/assignments/staff?record_type=child' : null);
  const rows = data?.data || [];
  const monitoringOn = data?.meta?.monitoring;
  const changePage = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const sorts = isAdmin ? [...SORTS, ['age', 'Age (youngest first)']] : SORTS;
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.child_id));
  const open = (id) => navigate(`/children/${encodeURIComponent(id)}`);

  return (
    <>
      <PageHeader title="Children"
        description="Directory of admitted children. Admissions not yet approved are on the Intake page."
        actions={!monitoringOn && <>
          {isAdmin && <Button variant="secondary" onClick={() => setMonitoring(true)}><Eye className="h-4 w-4" aria-hidden /> Monitoring visit</Button>}
          {(canAdmit || isAdmin) && <Button variant="secondary" onClick={() => navigate('/children/intake')}><ClipboardList className="h-4 w-4" aria-hidden /> Intake</Button>}
        </>} />

      {/* Security state, not a statistic: shown to Admin only while child record access is not enforced. */}
      {isAdmin && !monitoringOn && data?.meta?.mode === 'log_only' && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Child record access is in <strong>Log only</strong> mode: nothing is blocked yet, and what would be blocked is recorded. <Link to="/settings#child-access" className="font-medium underline">Review and switch to Enforce in Settings</Link>.
        </p>
      )}
      {!canDirectory && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">You can start and complete admissions on the <Link to="/children/intake" className="font-medium text-brand underline">Intake</Link> page. The children directory needs the Child records duty.</p>}
      {canDirectory && <>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <FilterChips label="Filter by status" value={tab} onChange={(k) => setParam('status', k)} options={tabs.map((t) => ({ key: t.key, label: t.label }))} />
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

      {/* Phones: the table header (with its select-all box) is hidden while rows show as cards, so it is offered here. */}
      {isAdmin && !monitoringOn && rows.length > 0 && (
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-700 sm:hidden">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={allSelected}
            onChange={() => setSelected(allSelected ? selected.filter((id) => !rows.some((r) => r.child_id === id)) : [...new Set([...selected, ...rows.map((r) => r.child_id)])])} />
          Select all on this page
        </label>
      )}
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Baby} title="No children in this view" description={assigned === 'me' ? 'No records are assigned to you.' : 'Admitted children appear here once an Admin approves their admission.'} />
        ) : (
          <Table label="Children">
            <thead className="bg-slate-50"><tr>
              {isAdmin && !monitoringOn && <th className="th w-8"><input type="checkbox" className="h-4 w-4 accent-brand" aria-label="Select all on this page" checked={allSelected}
                onChange={() => setSelected(allSelected ? selected.filter((id) => !rows.some((r) => r.child_id === id)) : [...new Set([...selected, ...rows.map((r) => r.child_id)])])} /></th>}
              <th className="th">Case number</th><th className="th">Child</th><th className="th">Status</th>
              <th className="th">Case worker</th><th className="th">Date added</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.child_id} className="cursor-pointer hover:bg-slate-50" onClick={() => open(c.child_id)}>
                  {isAdmin && !monitoringOn && <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="h-4 w-4 accent-brand" aria-label={`Select ${c.child_id}`} checked={selected.includes(c.child_id)}
                    onChange={() => setSelected((s) => (s.includes(c.child_id) ? s.filter((x) => x !== c.child_id) : [...s, c.child_id]))} /></td>}
                  <td className="td whitespace-nowrap font-mono text-sm">{c.child_id}</td>
                  <td className="td">
                    <Link to={`/children/${encodeURIComponent(c.child_id)}`} onClick={(e) => e.stopPropagation()} className="font-medium text-navy-900 hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">{c.display_name}</Link>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[c.status]}>{CHILD_STATUS_LABEL[c.status] || c.status}</Badge>
                      {c.transition_flag && <Badge tone="amber"><GraduationCap className="h-3 w-3" aria-hidden /> 18+</Badge>}
                    </div>
                  </td>
                  {/* Who is assigned is Admin information; Staff only see whether they themselves are assigned. */}
                  <td className="td text-sm">{isAdmin ? (c.case_worker?.name || <span className="text-amber-700">Unassigned</span>) : c.case_worker?.you ? 'You' : <span className="text-slate-400">-</span>}</td>
                  <td className="td whitespace-nowrap text-sm">{c.created_at ? formatDate(c.created_at) : '-'}</td>
                  <td className="td whitespace-nowrap text-right text-sm" onClick={(e) => e.stopPropagation()}>
                    <IconButton icon={Eye} tone="brand" label={`View ${c.child_id}`} to={`/children/${encodeURIComponent(c.child_id)}`} />
                  </td>
                </tr>
              ))}
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
