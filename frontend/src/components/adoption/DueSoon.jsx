import { Link } from 'react-router-dom';
import { AlarmClock } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { Badge, Card, Spinner } from '../ui';
import { formatDate } from '../../lib/format';

/** Staff dashboard: trial custody end dates, NACC 60-day deadlines and monthly monitoring reports due soon. */
export default function DueSoon() {
  const { data, loading, error } = useApi('/dashboard/due-soon');
  const items = data?.data || [];
  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-navy-900"><AlarmClock className="h-4 w-4 text-brand" aria-hidden /> Due soon (adoption)</h2>
      {loading && !data ? <Spinner /> : error ? (
        <p className="text-sm text-slate-500">{error.message}</p>
      ) : items.length === 0 ? <p className="text-sm text-slate-500">Nothing due in the next 14 days.</p> : (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={`${it.kind}-${it.application_id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <Link to={`/adoptions/${it.application_id}`} className="font-mono font-medium text-navy-900 hover:text-brand">{it.reference_no}</Link>
                <p className="text-xs text-slate-500">{it.label}{it.kind !== 'monitoring_report' && it.due ? `: ${formatDate(it.due)}` : it.kind === 'monitoring_report' && it.due ? `, last on ${formatDate(it.due)}` : ''}</p>
              </div>
              <Badge tone={it.days_left < 0 ? 'red' : it.days_left <= 7 ? 'amber' : 'slate'}>{it.days_left < 0 ? `${-it.days_left} day(s) overdue` : it.days_left === 0 ? 'Today' : `${it.days_left} day(s)`}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
