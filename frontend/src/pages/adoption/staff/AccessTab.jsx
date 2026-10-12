import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { formatDateTime } from '../../../lib/format';
import { Badge, Button, Card, ErrorNote, Skeleton } from '../../../components/ui';
import { REC } from './common';

function SessionRow({ s, onRevoke }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-navy-900">{s.user_name} <span className="font-normal text-slate-500">· {s.purpose}</span></p>
        {s.purpose_note && <p className="text-xs text-slate-500">"{s.purpose_note}"</p>}
        <p className="text-xs text-slate-500">Started {formatDateTime(s.started_at)}{s.active ? ` · until ${formatDateTime(s.expires_at)}` : ` · ${s.end_reason || 'expired'}${s.revoked_by_name ? ` by ${s.revoked_by_name}` : ''}`}</p>
      </div>
      {s.active ? <Button size="sm" variant="danger" onClick={() => onRevoke(s)}>Revoke</Button> : <Badge tone="slate">Ended</Badge>}
    </li>
  );
}

/** Access (Admin): active unlock sessions with Revoke, then the history, collapsed, 10 a page, filtered by user and state. */
export default function AccessTab({ app }) {
  const { toast } = useApp();
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState('');
  const [state, setState] = useState('all');
  const [openHistory, setOpenHistory] = useState(false);
  const [res, setRes] = useState({ data: null, error: null });
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ record_type: REC, record_id: String(app.application_id), page: String(page), state, ...(userId ? { user_id: userId } : {}) });
      const r = await api(`/unlock/sessions?${q}`);
      setRes({ data: r.data, error: null });
    } catch (error) { setRes((x) => ({ ...x, error })); }
  }, [app.application_id, page, state, userId]);
  useEffect(() => { load(); }, [load]);
  const revoke = async (s) => {
    try { await api(`/unlock/sessions/${s.session_id}/revoke`, { method: 'POST' }); toast('Session ended.'); load(); }
    catch (err) { toast(err.message, 'error'); }
  };
  if (res.error && !res.data) return <ErrorNote error={res.error} onRetry={load} />;
  if (!res.data) return <Skeleton rows={6} />;
  const d = res.data;
  const pages = Math.max(1, Math.ceil(d.total / d.per_page));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-600">User</span>
          <select className="input h-9" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }}>
            <option value="">Everyone</option>{d.users.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
          </select></label>
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-slate-600">Sessions</span>
          <select className="input h-9" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
            <option value="all">Active and ended</option><option value="active">Active only</option><option value="ended">Ended only</option>
          </select></label>
      </div>
      {state !== 'ended' && (
        <Card className="p-4">
          <h3 className="font-semibold text-navy-900">Active now</h3>
          {d.active.length === 0 ? <p className="mt-1 text-sm text-slate-500">No one has this record unlocked.</p>
            : <ul className="divide-y divide-slate-100">{d.active.map((s) => <SessionRow key={s.session_id} s={s} onRevoke={revoke} />)}</ul>}
        </Card>
      )}
      {state !== 'active' && (
        <Card className="p-4">
          <button type="button" className="flex w-full items-center justify-between text-left font-semibold text-navy-900" aria-expanded={openHistory} onClick={() => setOpenHistory((o) => !o)}>
            History <span className="text-sm font-normal text-slate-500">{d.total} ended session{d.total === 1 ? '' : 's'} · {openHistory ? 'Hide' : 'Show'}</span>
          </button>
          {openHistory && (d.history.length === 0 ? <p className="mt-2 text-sm text-slate-500">No ended sessions.</p> : (
            <>
              <ul className="mt-2 divide-y divide-slate-100">{d.history.map((s) => <SessionRow key={s.session_id} s={s} onRevoke={revoke} />)}</ul>
              {pages > 1 && (
                <nav className="mt-2 flex items-center justify-between text-sm" aria-label="History pages">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  <span className="text-slate-500" aria-live="polite">Page {page} of {pages} · 10 a page</span>
                  <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
                </nav>
              )}
            </>
          ))}
        </Card>
      )}
    </div>
  );
}
