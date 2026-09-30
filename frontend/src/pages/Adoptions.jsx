import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileHeart } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDate } from '../lib/format';

export const ADOPTION_STATUSES = ['Submitted', 'Under Review', 'Additional Documents Required', 'Approved', 'Rejected', 'Completed'];
export const ADOPTION_TONE = {
  Submitted: 'blue', 'Under Review': 'navy', 'Additional Documents Required': 'amber', Approved: 'green', Rejected: 'red', Completed: 'green',
};

export default function Adoptions() {
  const { query } = useApp();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi(`/adoptions${qs({ status, q: query })}`);
  const summary = useApi('/adoptions/summary');
  const counts = summary.data?.data || {};
  const rows = data?.data || [];

  return (
    <>
      <PageHeader title="Adoption" description="Incoming adoption applications. Approving an application does not change the child's status; the child becomes Adopted only when the legal process is marked Completed." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {['', ...ADOPTION_STATUSES].map((s) => (
          <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {s || 'All'}{s && counts[s] ? ` (${counts[s]})` : ''}
          </button>
        ))}
      </div>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={FileHeart} title="No applications in this view" />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Reference</th><th className="th">Applicant</th><th className="th">Child</th>
              <th className="th">Submitted</th><th className="th">Required documents</th><th className="th">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.application_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/adoptions/${a.application_id}`)}>
                  <td className="td font-medium text-brand">{a.reference_no}</td>
                  <td className="td"><p className="font-medium text-navy-900">{a.legal_name}</p><p className="text-xs text-slate-500">{a.email}</p></td>
                  <td className="td">{a.child_first_name} {a.child_last_initial}. <span className="text-xs text-slate-500">({a.child_id})</span></td>
                  <td className="td whitespace-nowrap">{formatDate(a.submitted_at)}</td>
                  <td className="td">{Number(a.required_docs_submitted) >= 2 ? <Badge tone="green">Complete</Badge> : <Badge tone="amber">{a.required_docs_submitted}/2 submitted</Badge>}</td>
                  <td className="td"><Badge tone={ADOPTION_TONE[a.status]}>{a.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
