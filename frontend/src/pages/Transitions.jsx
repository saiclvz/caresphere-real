import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Lock, Pencil } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/format';
import AssignedFilter from '../components/AssignedFilter';

const STATUSES = ['For Review', 'In Progress', 'Completed'];
export const TRANSITION_TONE = { 'For Review': 'amber', 'In Progress': 'blue', Completed: 'green' };

/**
 * Transition Review (18+). Admin: full list. Staff: case number, age, flagged date, status and a masked
 * name only (the server sends nothing more); search by case number. "Update" opens the review, where
 * the assigned case worker unlocks it with a purpose, the QR and a Token ID.
 */
export default function Transitions() {
  const { user } = useAuth();
  const { query } = useApp();
  const navigate = useNavigate();
  const isAdmin = user.role === 'Admin';
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const [sort, setSort] = useState('recent');
  const { data, loading, error, reload } = useApi(`/transition-reviews${qs({ status, assigned: assigned || undefined, sort, q: query })}`);
  const rows = data?.data || [];

  return (
    <>
      <PageHeader title="Transition Review (18+)"
        description="Children are added here automatically when they turn 18. Records stay active; nothing is discharged or deleted by this review." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {['', ...STATUSES].map((s) => (
          <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3"><AssignedFilter value={assigned} onChange={setAssigned} />
        <label className="sr-only" htmlFor="tr-sort">Sort</label>
        <select id="tr-sort" className="input h-10 w-56" value={sort} onChange={(e) => setSort(e.target.value)}>
          {[['recent', 'Most recent activity'], ['flagged', 'Date flagged (newest)'], ['status', 'Status'], ['case', 'Case number'], ['age', 'Age (youngest first)']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {!isAdmin && <p className="mb-3 text-xs text-slate-500">Names and plans are hidden until you unlock a review assigned to you. Search works by case number.</p>}
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={GraduationCap} title="No one is due for transition review" description="Children appear here automatically on their 18th birthday." />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Case number</th><th className="th">Young person</th><th className="th">Age</th><th className="th">Flagged</th><th className="th">Assigned staff</th>
              {isAdmin && <th className="th">Goals</th>}
              <th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.review_id}>
                  <td className="td whitespace-nowrap font-mono text-sm text-navy-900">{r.case_number}</td>
                  <td className="td">
                    {r.masked ? <span className="inline-flex items-center gap-1 text-navy-900"><Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {r.masked_name}</span>
                      : <span className="font-medium text-navy-900">{r.full_name}</span>}
                  </td>
                  <td className="td">{r.age}</td>
                  <td className="td whitespace-nowrap">{formatDate(r.flagged_at)}</td>
                  <td className="td text-sm">{r.assigned_to_me ? <Badge tone="blue">You</Badge> : r.assigned_staff_name || <span className="text-slate-400">Unassigned</span>}
                    {r.assignment_flag && <p className="text-xs text-amber-700">Account deactivated</p>}</td>
                  {isAdmin && (
                    <td className="td text-xs text-slate-600">
                      {[['Housing', r.housing_goal], ['Vocational', r.vocational_goal], ['Education', r.education_goal]].filter(([, v]) => v).map(([l]) => l).join(', ')
                        || <span className="text-slate-400">None set</span>}
                    </td>
                  )}
                  <td className="td"><Badge tone={TRANSITION_TONE[r.review_status]}>{r.review_status}</Badge>
                    {isAdmin && r.updated_by_name && <p className="mt-1 text-xs text-slate-500">{r.updated_by_name}, {formatDateTime(r.updated_at)}</p>}</td>
                  <td className="td text-right">
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/transition-reviews/${r.review_id}${isAdmin ? '' : '?unlock=1'}`)}><Pencil className="h-3.5 w-3.5" /> Update</Button>
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
