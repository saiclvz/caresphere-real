import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import useApi from '../hooks/useApi';
import { formatDate } from '../lib/format';
import { Badge, Card, ErrorNote, Skeleton } from './ui';

const TONE = { 'For Review': 'amber', 'In Progress': 'blue', Completed: 'green', 'On Hold': 'slate' };

/**
 * Child profile: the Transition Review (18+) card for a young person who is 18 or older. Status, stage, target
 * date and social worker for anyone with the Transition duty; pathway and aftercare for Admin and the review's
 * assigned staff (the server decides).
 */
export default function TransitionSummaryCard({ childId, firstName }) {
  const { data, loading, error, reload } = useApi(`/children/${encodeURIComponent(childId)}/transition-summary`);
  if (loading && !data) return <Card><Skeleton rows={3} /></Card>;
  if (error) return <Card className="p-5"><ErrorNote error={error} onRetry={reload} /></Card>;
  const r = data?.data?.review;
  if (!data?.data?.eligible) return null;
  return (
    <Card className="border-amber-200 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-navy-900"><GraduationCap className="h-4 w-4 text-amber-600" aria-hidden /> Transition Review</h2>
      {!r ? <p className="mt-1 text-sm text-slate-600">{firstName} is 18 or older. The review is added automatically within a few hours.</p> : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">Transition status</dt><dd><Badge tone={TONE[r.display_status]}>{r.display_status}</Badge>{r.next_review_date && <span className="block text-xs text-slate-500">Next review {formatDate(r.next_review_date)}</span>}</dd></div>
            <div><dt className="text-xs text-slate-500">Current stage</dt><dd className="text-navy-900">{r.current_stage || '-'}</dd></div>
            <div><dt className="text-xs text-slate-500">Target transition date</dt><dd className="text-navy-900">{r.target_transition_date ? formatDate(r.target_transition_date) : 'Not set'}</dd></div>
            {r.assigned_staff_name && <div><dt className="text-xs text-slate-500">Assigned social worker</dt><dd className="text-navy-900">{r.assigned_staff_name}</dd></div>}
            {'pathway' in r && <div><dt className="text-xs text-slate-500">Transition pathway</dt><dd className="text-navy-900">{r.pathway || 'Not set'}</dd></div>}
            {'aftercare_status' in r && <div><dt className="text-xs text-slate-500">Aftercare status</dt><dd className="text-navy-900">{r.aftercare_status}</dd></div>}
          </dl>
          <Link to={`/transition-reviews/${r.review_id}`} className="mt-4 inline-block text-sm font-medium text-brand hover:underline">Open Transition Review</Link>
        </>
      )}
    </Card>
  );
}
