import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import useCountdown from '../../hooks/useCountdown';
import { api } from '../../api/client';
import { Button } from '../ui';
import { formatDate } from '../../lib/format';

/**
 * Monitoring visit (Admin, for NACC, DSWD or other reviewers): a banner with the timer and "End visit", and a
 * watermark over every page with the visit, the date, the reviewer and the Admin's name. The server keeps the visit
 * read-only (no edits, no downloads) and limited to the selected records, and ends it on its timer or at sign-out.
 */
export default function MonitoringBar({ monitoring, adminName }) {
  const [ending, setEnding] = useState(false);
  const seconds = Math.max(0, Math.round((new Date(monitoring.expires_at).getTime() - Date.now()) / 1000));
  const remaining = useCountdown(seconds, monitoring.monitoring_id, () => window.location.assign('/children'));
  const end = async () => {
    setEnding(true);
    try { await api('/monitoring/end', { method: 'POST' }); } finally { window.location.assign('/children'); }
  };
  const mark = `Monitoring visit, ${formatDate(monitoring.started_at)}, ${monitoring.reviewer_name} · Admin: ${adminName}`;
  const tiles = useMemo(() => Array.from({ length: 40 }, (_, i) => i), []);
  const h = Math.floor(remaining / 3600); const m = Math.floor((remaining % 3600) / 60); const s = String(remaining % 60).padStart(2, '0');
  return (
    <>
      <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 sm:px-6" role="status" aria-live="polite">
        <Eye className="h-4 w-4" aria-hidden />
        <strong>Monitoring visit</strong>
        <span>{monitoring.reviewer_org} · {monitoring.reviewer_name} · read-only, downloads off · {monitoring.child_ids.length} record{monitoring.child_ids.length === 1 ? '' : 's'}</span>
        <span className="ml-auto font-mono tabular-nums">Ends in {h ? `${h}:${String(m).padStart(2, '0')}` : m}:{s}</span>
        <Button size="sm" variant="dark" loading={ending} onClick={end}>End visit</Button>
      </div>
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden>
        <div className="absolute -inset-1/4 flex rotate-[-24deg] flex-wrap content-start gap-x-24 gap-y-20 opacity-[0.10]">
          {tiles.map((i) => <span key={i} className="whitespace-nowrap text-lg font-semibold text-navy-900">{mark}</span>)}
        </div>
      </div>
    </>
  );
}
