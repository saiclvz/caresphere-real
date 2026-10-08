import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Baby, GraduationCap, Lock, Plus } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import AuthImage from '../components/AuthImage';
import ChildForm from './ChildForm';
import { Badge, Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDate } from '../lib/format';
import Pagination, { usePageState } from '../components/Pagination';

export const STATUS_TONE = { Active: 'green', Discharged: 'slate', Adopted: 'blue' };
const TABS = [
  { key: '', label: 'All' },
  { key: 'Active', label: 'Active' },
  { key: 'Discharged', label: 'Discharged' },
  { key: 'Adopted', label: 'Adopted' },
  { key: 'flagged', label: 'Transition Review (18+)' },
];

/** Sort options. Default: most recent activity; age only when chosen. */
const SORTS = [['recent', 'Most recent activity'], ['registered', 'Date registered (newest)'], ['case', 'Case number'], ['name', 'Name (A to Z)'], ['age', 'Age (youngest first)']];

export default function Children() {
  const { user } = useAuth();
  const { query, toast } = useApp();
  const navigate = useNavigate();
  const canRegister = ['Admin', 'Staff'].includes(user.role);
  const [tab, setTab] = useState('');
  const [adding, setAdding] = useState(false);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('recent');
  // Back to page 1 whenever the tab, search, sort or page size changes.
  const [page, setPage] = usePageState(JSON.stringify({ tab, query, limit, sort }));
  const params = tab === 'flagged' ? { flagged: 1, q: query } : { status: tab, q: query };
  const { data, loading, error, reload } = useApi(`/children${qs({ ...params, sort, page, limit })}`);
  const rows = data?.data || [];
  const changePage = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <>
      <PageHeader title="Children"
        description="Every child in care, most recent activity first. Health records and case files stay locked until you verify your access."
        actions={canRegister && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Register child</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <label className="sr-only" htmlFor="sort">Sort</label>
          <select id="sort" className="input h-9 w-56" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Baby} title="No children in this view" description={canRegister ? 'Register a child to get started.' : undefined} />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Child</th><th className="th">Age</th><th className="th">Gender</th>
              <th className="th">Admitted</th><th className="th">Status</th><th className="th">Health</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.child_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/children/${c.child_id}`)}>
                  <td className="td">
                    <div className="flex items-center gap-3">
                      <AuthImage src={c.profile_photo_url} alt="" className="h-10 w-10 shrink-0 rounded-full" />
                      <div>
                        <button type="button" className="font-medium text-navy-900 hover:text-brand"
                          onClick={(e) => { e.stopPropagation(); navigate(`/children/${c.child_id}`); }}>
                          {c.full_name}
                        </button>
                        <p className="text-xs text-slate-500">{c.child_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="td whitespace-nowrap">{c.age} {c.age === 1 ? 'yr' : 'yrs'}</td>
                  <td className="td">{c.gender}</td>
                  <td className="td whitespace-nowrap">{c.admission_date ? formatDate(c.admission_date) : <span className="text-slate-400">-</span>}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                      {c.transition_flag && <Badge tone="amber"><GraduationCap className="h-3 w-3" /> Transition Review (18+)</Badge>}
                    </div>
                  </td>
                  <td className="td"><span className="inline-flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" /> Protected</span></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {rows.length > 0 && (
          <Pagination pagination={data?.pagination} label="children" onPageChange={changePage} onLimitChange={setLimit} />
        )}
      </Card>

      {adding && (
        <ChildForm onClose={() => setAdding(false)}
          onSaved={(child) => { setAdding(false); toast(`${child.full_name} registered.`); navigate(`/children/${child.child_id}`); }} />
      )}
    </>
  );
}
