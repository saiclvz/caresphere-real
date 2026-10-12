import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock, FileQuestion, MinusCircle, XCircle } from 'lucide-react';
import { api } from '../../../api/client';
import { unlockHeaders } from '../../../lib/grants';
import { Badge, ErrorNote, Skeleton } from '../../../components/ui';

export const REC = 'adoption_application';
export const headersFor = (id) => unlockHeaders(REC, id);

/** Status chip: an icon and a word (never color alone). */
const CHIPS = {
  Verified: ['green', CheckCircle2], Done: ['green', CheckCircle2], Uploaded: ['blue', Clock], Submitted: ['blue', Clock], 'Under validation': ['blue', Clock],
  'Manual verification required': ['amber', AlertTriangle], 'Requires correction': ['amber', AlertTriangle], 'Flagged for review': ['amber', AlertTriangle],
  'Pending submission': ['red', FileQuestion], Missing: ['red', FileQuestion], Rejected: ['red', XCircle], Expired: ['red', XCircle],
  'Not applicable': ['slate', MinusCircle], Optional: ['slate', Circle], Open: ['amber', Clock], Fulfilled: ['green', CheckCircle2], Closed: ['slate', MinusCircle],
};
export function StatusChip({ status, className = '' }) {
  const [tone, Icon] = CHIPS[status] || (/mismatch|Invalid|Unrecognized|failed|Not verified/i.test(status || '') ? ['red', XCircle] : ['amber', AlertTriangle]);
  return <Badge tone={tone} className={className}><Icon className="h-3 w-3" aria-hidden />{status}</Badge>;
}
export const REQ_TONE = { Required: 'red', Conditional: 'amber', Optional: 'slate', 'Not applicable': 'slate' };

/**
 * Loads one tab's data (GET /adoptions/:id/tab/:tab) when the tab is first shown, again when `version`
 * changes (after a save), and on retry. Requests from a tab the user has left are ignored.
 */
export function useTab(appId, tab, version) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api(`/adoptions/${appId}/tab/${tab}`, { headers: headersFor(appId) });
      if (n === seq.current) setState({ data: res.data, loading: false, error: null });
    } catch (error) {
      if (n === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
  }, [appId, tab]);
  useEffect(() => { load(); }, [load, version]);
  return { ...state, reload: load };
}

/** Skeleton while a tab loads for the first time; a clear error with Try again. */
export function TabState({ state, rows = 5, children }) {
  if (state.error && !state.data) return <ErrorNote error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Skeleton rows={rows} />;
  return children(state.data);
}

export const iso = (v) => (v ? String(v).slice(0, 10) : null);
