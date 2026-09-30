import { Link, useNavigate } from 'react-router-dom';
import { FileHeart } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { ADOPTION_TONE } from './Adoptions';
import { DISCLAIMER } from './AdoptChild';
import { Badge, Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDate } from '../lib/format';

export default function MyApplications() {
  const { query } = useApp();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(`/adoptions/mine${qs({ q: query })}`);
  const rows = data?.data || [];
  return (
    <>
      <PageHeader title="My applications" description={DISCLAIMER}
        actions={<Link to="/adopt"><Button>Browse children</Button></Link>} />
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={FileHeart} title="You haven't applied yet" description="Choose a child on the Adopt a Child page to start an application." />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Reference</th><th className="th">Child</th><th className="th">Submitted</th>
              <th className="th">Required documents</th><th className="th">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.application_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/applications/${a.application_id}`)}>
                  <td className="td font-medium text-brand">{a.reference_no}</td>
                  <td className="td">{a.child_first_name} {a.child_last_initial}.</td>
                  <td className="td">{formatDate(a.submitted_at)}</td>
                  <td className="td">{Number(a.required_docs_submitted) >= 2 ? <Badge tone="green">Submitted</Badge> : <Badge tone="amber">Missing</Badge>}</td>
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
