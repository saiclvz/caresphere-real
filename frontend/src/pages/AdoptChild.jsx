import { Link } from 'react-router-dom';
import { FolderHeart, Info } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useApp } from '../context/AppContext';
import AuthImage from '../components/AuthImage';
import { Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner } from '../components/ui';

export const DISCLAIMER = 'Submitting an application does not guarantee approval or finalize an adoption.';

/** Adopt a Child (Donor accounts): public-safe child profiles only (privacy name, age, photo, basic bio). */
export default function AdoptChild() {
  const { query } = useApp();
  const { data, loading, error, reload } = useApi(`/public-children${qs({ purpose: 'adoption', q: query })}`);
  const rows = data?.data || [];
  return (
    <>
      <PageHeader title="Adopt a Child"
        description="Children whose profiles the home has made available. Medical, background and legal details are never shown here."
        actions={<Link to="/applications"><Button variant="secondary">My applications</Button></Link>} />
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
                <AuthImage src={c.photo_url} alt={c.display_name} className="aspect-[4/3] w-full" />
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-lg font-semibold text-navy-900">{c.display_name}</p>
                  <p className="text-sm text-slate-500">{c.age_label} · {c.gender}</p>
                  {c.public_bio && <p className="mt-2 text-sm text-slate-700">{c.public_bio}</p>}
                  <div className="mt-auto pt-4">
                    <Link to={`/applications/new?child=${encodeURIComponent(c.child_id)}`}><Button className="w-full">Apply to adopt</Button></Link>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
