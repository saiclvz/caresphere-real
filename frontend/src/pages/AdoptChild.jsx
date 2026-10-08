import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileHeart, FolderHeart, Info, UserRound } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner } from '../components/ui';
import Pagination, { usePageState } from '../components/Pagination';
import { applicationPath, isActiveStatus } from './adoption/formLogic';

export const DISCLAIMER = 'Submitting an application does not guarantee approval or finalize an adoption.';

/** Adopt a Child (Donor accounts): public-safe child profiles only (privacy name, age, photo, basic bio). */
export default function AdoptChild() {
  const { query } = useApp();
  const navigate = useNavigate();
  // Decision 4: one active application per donor. If there is one, Apply opens it.
  const mine = useApi('/adoptions/mine');
  const active = (mine.data?.data || []).find((a) => isActiveStatus(a.status));
  // New applications start by choosing Regular or Relative/Stepchild (on /applications/new).
  const apply = () => navigate(active ? applicationPath(active) : '/applications/new');
  const [limit, setLimit] = useState(10);
  // Back to page 1 whenever the search or page size changes.
  const [page, setPage] = usePageState(JSON.stringify({ query, limit }));
  const { data, loading, error, reload } = useApi(`/public-children${qs({ purpose: 'adoption', q: query, page, limit })}`);
  const rows = data?.data || [];
  const changePage = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return (
    <>
      <PageHeader title="Adopt a Child"
        description="Children whose profiles the home has made available. Medical, background and legal details are never shown here."
        actions={<Link to="/applications"><Button variant="secondary">My applications</Button></Link>} />
      {active && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-navy-900" role="status">
          <FileHeart className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <p className="min-w-0 flex-1">
            You have an active application{active.reference_no ? <> (<strong>{active.reference_no}</strong>)</> : ''}: <strong>{active.status_label}</strong>.
            {active.status === 'Draft' ? ' Continue it to finish and submit.' : ' The home will contact you about the next steps.'}
          </p>
          <Link to={applicationPath(active)}><Button size="sm">{active.status === 'Draft' ? 'Continue application' : 'View application'}</Button></Link>
        </div>
      )}
      <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <Info className="h-5 w-5 shrink-0" aria-hidden />
        <p><strong>{DISCLAIMER}</strong> Every application is reviewed by the home and follows the formal legal adoption process.</p>
      </div>
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : rows.length === 0 ? (
        <Card>{query ? <NoMatches /> : <EmptyState icon={FolderHeart} title="No profiles are available right now" description="Please check back later." />}</Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <li key={c.child_id}>
              <Card className="flex h-full flex-col overflow-hidden">
                {/* RA 7610 / RA 11930: no child photos or identifying details for donors. */}
                <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 text-slate-300" aria-hidden="true"><UserRound className="h-16 w-16" /></div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-lg font-semibold text-navy-900">{c.display_name}</p>
                  <p className="text-sm text-slate-500">{c.age_label} · {c.gender}</p>
                  <div className="mt-auto pt-4">
                    <Button className="w-full" onClick={apply}>{active ? (active.status === 'Draft' ? 'Continue application' : 'View my application') : 'Apply to adopt'}</Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <Card className="mt-6">
          <Pagination pagination={data?.pagination} label="profiles" bordered={false} onPageChange={changePage} onLimitChange={setLimit} />
        </Card>
      )}
    </>
  );
}
