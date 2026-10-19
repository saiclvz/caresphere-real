import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Lock } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table, FilterChips } from '../components/ui';
import { formatDate } from '../lib/format';
import AssignedFilter from '../components/AssignedFilter';

const STATUSES = ['For Review', 'In Progress', 'Completed'];
export const TRANSITION_TONE = { 'For Review': 'amber', 'In Progress': 'blue', Completed: 'green' };

/**
 * Transition Review (18+). Admin: full list. Staff: case number, age, flagged date, stage, status and a masked
 * name only (the server sends nothing more); search by case number. Open goes to the review, where the
 * assigned case worker unlocks it with a purpose, the QR and a Token ID. Search is the page search at the top.
 */
export default function Transitions() {
  const { user } = useAuth();
  const { query } = useApp();
  const navigate = useNavigate();
  const isAdmin = user.role === 'Admin';
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const [sort, setSort] = useState('recent');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [activity, setActivity] = useState('');
  const { data, loading, error, reload } = useApi(`/transition-reviews${qs({ status, assigned: assigned || undefined, sort, from: from || undefined, to: to || undefined, activity: activity || undefined, q: query })}`);
  const rows = data?.data || [];
  const counts = data?.meta?.counts;
  const filtered = Boolean(from || to || activity || assigned);
  const open = (r) => navigate(`/transition-reviews/${r.review_id}${isAdmin ? '' : '?unlock=1'}`);

  return (
    <>
      <PageHeader title="Transition Review (18+)"
        description="Young people are added here automatically when they turn 18. Nothing is discharged or deleted by the review; each case moves through assessment, conference, decision, planning, transition and aftercare." />
      <FilterChips className="mb-4" label="Filter by status" value={status} onChange={setStatus}
        options={['', ...STATUSES].map((s) => ({ key: s, label: s || 'All', count: counts ? counts[s || 'all'] : undefined }))} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <AssignedFilter value={assigned} onChange={setAssigned} />
        <label className="text-xs text-slate-500">Flagged from<input type="date" className="input mt-1 h-10 w-40" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">to<input type="date" className="input mt-1 h-10 w-40" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-xs text-slate-500">Activity
          <select className="input mt-1 h-10 w-44" value={activity} onChange={(e) => setActivity(e.target.value)}>
            <option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">Sort
          <select className="input mt-1 h-10 w-52" value={sort} onChange={(e) => setSort(e.target.value)}>
            {[['recent', 'Most recent activity'], ['flagged', 'Date flagged (newest)'], ['status', 'Status'], ['case', 'Case number'], ['age', 'Age (youngest first)']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {filtered && <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo(''); setActivity(''); setAssigned(''); }}>Clear filters</Button>}
      </div>
      {!isAdmin && <p className="mb-3 text-xs text-slate-500">Names and plans are hidden until you unlock a review assigned to you. Search works by case number.</p>}
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query || filtered || status ? <NoMatches /> : <EmptyState icon={GraduationCap} title="No one is due for transition review" description="Young people appear here automatically on their 18th birthday." />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Case number</th><th className="th">Young person</th><th className="th">Age</th><th className="th">Date flagged</th><th className="th">Assigned staff</th>
              <th className="th">Transition goals</th><th className="th">Status</th><th className="th"><span className="sr-only">Action</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.review_id} className="cursor-pointer hover:bg-slate-50" onClick={() => open(r)}>
                  <td className="td whitespace-nowrap font-mono text-sm text-navy-900">{r.case_number}</td>
                  <td className="td">
                    {r.masked ? <span className="inline-flex items-center gap-1 text-navy-900"><Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {r.masked_name}</span>
                      : <span className="font-medium text-navy-900">{r.full_name}</span>}
                  </td>
                  <td className="td">{r.age}</td>
                  <td className="td whitespace-nowrap">{formatDate(r.flagged_at)}</td>
                  <td className="td text-sm">{r.assigned_to_me ? <Badge tone="blue">You</Badge> : r.assigned_staff_name || <span className="text-slate-400">Unassigned</span>}
                    {r.assignment_flag && <p className="text-xs text-amber-700">Account deactivated</p>}</td>
                  <td className="td text-sm text-slate-600">{r.masked ? <span className="text-xs text-slate-400">Locked</span> : r.goals?.length ? r.goals.join(', ') : <span className="text-slate-400">None set</span>}</td>
                  <td className="td"><Badge tone={TRANSITION_TONE[r.review_status]}>{r.review_status}</Badge>
                    {r.current_stage && <p className="mt-1 text-xs text-slate-500">{r.legacy_completed ? 'Before the 9-stage workflow' : r.current_stage}</p>}</td>
                  <td className="td text-right">
                    <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={(e) => { e.stopPropagation(); open(r); }}>Open<span className="sr-only"> {r.case_number}</span></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
