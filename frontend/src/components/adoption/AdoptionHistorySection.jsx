import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileHeart, Lock } from 'lucide-react';
import { api } from '../../api/client';
import { unlockHeaders } from '../../lib/grants';
import { formatDate, formatDateTime } from '../../lib/format';
import { Badge, Card, ErrorNote, Spinner } from '../ui';

/**
 * Child page: adoption status history. Fetched separately; for Staff the server only returns it while
 * the child record is unlocked (purpose, QR token, 3-minute access).
 */
const TYPE = { Regular: 'Regular', Stepparent: 'Stepparent', Relative: 'Relative', Relative_own_child: 'Own non-marital child', Adult: 'Adult' };

export default function AdoptionHistorySection({ childId }) {
  const [state, setState] = useState({ loading: true });
  const load = useCallback(() => api(`/children/${encodeURIComponent(childId)}/adoption-history`, { headers: unlockHeaders('health', childId) })
    .then((r) => setState({ rows: r.data })).catch((error) => setState({ error })), [childId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onChange = (e) => { if (e.detail.kind === 'health' && e.detail.id === String(childId)) load(); };
    window.addEventListener('caresphere-unlock', onChange);
    return () => window.removeEventListener('caresphere-unlock', onChange);
  }, [childId, load]);

  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-navy-900"><FileHeart className="h-4 w-4" /> Adoption</h2>
      {state.loading ? <Spinner /> : state.error?.details?.locked ? (
        <p className="flex items-center gap-1.5 text-sm text-slate-600"><Lock className="h-4 w-4 text-amber-700" aria-hidden /> Locked. Unlock the child record (health section) to see it.</p>
      ) : state.error ? <ErrorNote error={state.error} onRetry={load} /> : state.rows.length === 0 ? <p className="text-sm text-slate-500">No adoption case for this child.</p> : (
        <ul className="space-y-3">
          {state.rows.map((a) => (
            <li key={a.application_id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/adoptions/${a.application_id}`} className="font-medium text-brand hover:underline">{a.reference_no}</Link>
                <Badge>{a.status}</Badge>
              </div>
              <p className="text-xs text-slate-500">{a.applicant} · {TYPE[a.application_type] || a.application_type} · submitted {formatDate(a.submitted_at)}</p>
              {a.summary && (
                <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                  {[['Current stage', a.summary.current_stage], ['Matching', a.summary.matching_status], ['Placement', a.summary.placement_status],
                    ['Petition', a.summary.petition_status], ['NACC decision', a.summary.nacc_decision], ['Order of Adoption', a.summary.order_of_adoption],
                    ['Certificate of Finality', a.summary.certificate_of_finality], ['Civil registration', a.summary.civil_registration],
                    ['Post-adoption monitoring', a.summary.post_adoption_monitoring]].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-right text-navy-900">{v}</dd></div>
                  ))}
                </dl>
              )}
              {a.changes.length > 0 && (
                <ol className="mt-2 space-y-0.5 text-xs text-slate-600">
                  {a.changes.map((ch, i) => <li key={i}>{formatDateTime(ch.at)}: {ch.from} → {ch.to}{ch.by ? ` (${ch.by})` : ''}</li>)}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
