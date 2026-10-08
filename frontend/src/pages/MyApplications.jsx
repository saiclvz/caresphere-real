import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, FilePlus2, Heart } from 'lucide-react';
import useApi from '../hooks/useApi';
import { Spinner } from '../components/ui';
import { formatDate } from '../lib/format';
import { AFTER_ORDER, applicationPath, isActiveStatus } from './adoption/formLogic';
import { StatusBadge, THANK_YOU } from './MyApplicationDetail';
import './adoption/adoption.css';

/** My applications (donor): reference, matched child, submitted date, status. */
/**
 * Summary progress: Submitted, Under review, Documents requested, Interview or home visit, Decision,
 * with the date each step was reached. The current step is the last one reached.
 */
function ProgressSteps({ steps }) {
  const current = steps.reduce((last, st, i) => (st.reached_at ? i : last), -1);
  return (
    <ol className="flex gap-1 overflow-x-auto px-4 pb-4" aria-label="Application progress">
      {steps.map((st, i) => {
        const reached = Boolean(st.reached_at);
        return (
          <li key={st.key} className="min-w-[6.5rem] flex-1" aria-current={i === current ? 'step' : undefined}>
            <div className={`h-1.5 rounded-full ${reached ? 'bg-brand' : 'bg-slate-200'}`} />
            <p className={`mt-1 text-[11px] ${i === current ? 'font-semibold text-navy-900' : reached ? 'text-slate-700' : 'text-slate-400'}`}>{st.label}</p>
            <p className="text-[10px] text-slate-400">{reached ? formatDate(st.reached_at) : 'Not yet'}</p>
          </li>
        );
      })}
    </ol>
  );
}

export default function MyApplications() {
  const { data, loading, error, reload } = useApi('/adoptions/mine');
  const rows = data?.data || [];
  const active = rows.find((r) => isActiveStatus(r.status));
  const withRequests = rows.filter((r) => r.open_requests > 0);
  const approved = rows.filter((r) => AFTER_ORDER.includes(r.status));

  return (
    <div className="cs-theme cs-page space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="cs-title text-2xl">My applications</h1>
          <p className="cs-muted text-sm">Your adoption applications and their status. Every application is reviewed by the home.</p>
        </div>
        {!active && !loading && <Link to="/applications/new" className="cs-btn cs-btn-primary"><FilePlus2 className="h-4 w-4" aria-hidden /> Start an application</Link>}
      </div>

      {withRequests.map((r) => (
        <div key={r.application_id} className="cs-notice cs-notice-warn flex flex-wrap items-center gap-3" role="status">
          <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: 'var(--cs-warning)' }} aria-hidden />
          <p className="min-w-0 flex-1 text-sm">The home requested {r.open_requests === 1 ? 'a document' : `${r.open_requests} documents`} for <strong>{r.reference_no}</strong>.</p>
          <Link to={`/applications/${r.application_id}`} className="cs-btn cs-btn-sm cs-btn-primary">Upload documents</Link>
        </div>
      ))}
      {approved.length > 0 && (
        <div className="cs-notice cs-notice-success flex gap-3"><Heart className="h-5 w-5 shrink-0" style={{ color: 'var(--cs-success)' }} aria-hidden /><p className="text-sm">{THANK_YOU}</p></div>
      )}

      <section className="cs-card overflow-hidden">
        {loading && !data ? <Spinner /> : error ? (
          <div className="p-4"><div className="cs-notice cs-notice-error" role="alert">{error.message} <button type="button" className="cs-link" onClick={reload}>Try again</button></div></div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <p className="cs-title">No applications yet</p>
            <p className="cs-muted mt-1 text-sm">When you're ready, start an application. You can save it and continue later.</p>
            <Link to="/adopt" className="cs-link mt-3 inline-block text-sm">Go to Adopt a Child</Link>
          </div>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.application_id} className="border-t first:border-t-0 cs-divider" style={r.unread_notifications > 0 ? { background: 'var(--cs-primary-soft)' } : undefined}>
                <Link to={applicationPath(r)} className="flex items-center gap-3 p-4 hover:opacity-90" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="min-w-0 flex-1">
                    <p className="cs-title font-mono">{r.reference_no || 'Draft'}</p>
                    <p className="cs-muted text-xs">
                      {r.submitted_at ? `Submitted ${formatDate(r.submitted_at)}` : `Started ${formatDate(r.created_at)}, not submitted yet`}
                      {r.matched_child && <> · Matched child: {r.matched_child.display_name}</>}
                    </p>
                    {r.stage?.description && <p className="mt-0.5 text-xs">{r.stage.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                    {r.unread_notifications > 0 && <span className="cs-chip cs-chip-info" style={{ fontWeight: 700 }}>{r.unread_notifications} new update{r.unread_notifications === 1 ? '' : 's'}</span>}
                    {r.open_requests > 0 && <span className="cs-chip cs-chip-warn">{r.open_requests} requested</span>}
                    <StatusBadge status={r.status} label={r.status_label} />
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 cs-muted" aria-hidden />
                </Link>
                {r.progress && <ProgressSteps steps={r.progress} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
