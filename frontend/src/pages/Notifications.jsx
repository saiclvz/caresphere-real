import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, Settings2, SlidersHorizontal, X } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, PageHeader, Spinner } from '../components/ui';
import Pagination from '../components/Pagination';
import { iconFor, PRIORITY_LABEL, relativeTime } from '../lib/notifications';
import { formatDateTime } from '../lib/format';

const KEYS = ['status', 'category', 'priority', 'date', 'from', 'to', 'q', 'sort'];
const DEFAULTS = { status: 'all', category: '', priority: '', date: 'all', from: '', to: '', q: '', sort: 'newest' };
const STORE = 'cs.notifications.filters'; // filter values only (no names or content), this tab only
const DATE_LABEL = { all: 'Any time', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', custom: 'Custom range' };

/**
 * /notifications - the full list. Filters live in the URL (and the session), are applied on the
 * server with AND, and reset the page to 1 when they change. Bulk actions apply to the selection.
 */
export default function Notifications() {
  const { user } = useAuth();
  const { toast, refreshRequests } = useApp();
  const navigate = useNavigate();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  // First visit without filters in the URL: restore the session's last filters.
  useEffect(() => {
    if ([...params.keys()].some((k) => KEYS.includes(k))) return;
    try { const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null'); if (saved) setParams(saved, { replace: true }); } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const f = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? DEFAULTS[k]])), [params]);
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const setFilter = (patch) => {
    const next = { ...f, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([k, v]) => v && v !== DEFAULTS[k]));
    try { sessionStorage.setItem(STORE, JSON.stringify(clean)); } catch { /* ignore */ }
    setParams({ ...clean, limit: String(limit) }); // page back to 1
    setSelected(new Set());
  };
  const apiQuery = Object.fromEntries(Object.entries({ ...f, page, limit }).filter(([k, v]) => v !== '' && v !== DEFAULTS[k] || k === 'page' || k === 'limit'));
  const { data, loading, error, reload } = useApi(`/notifications${qs(apiQuery)}`);
  const rows = data?.data || [];
  const categories = (data?.categories || []).filter((c) => !c.priority || isAdmin);
  const cats = f.category ? f.category.split(',') : [];
  const prios = f.priority ? f.priority.split(',') : [];
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(',');

  const chips = [
    f.status !== 'all' && { k: 'status', label: f.status === 'unread' ? 'Unread' : 'Read' },
    ...cats.map((c) => ({ k: 'category', v: c, label: categories.find((x) => x.key === c)?.label || c })),
    ...prios.map((p) => ({ k: 'priority', v: p, label: PRIORITY_LABEL[p] })),
    f.date !== 'all' && { k: 'date', label: f.date === 'custom' ? `${f.from || '…'} to ${f.to || '…'}` : DATE_LABEL[f.date] },
    f.q && { k: 'q', label: `"${f.q}"` },
  ].filter(Boolean);
  const removeChip = (c) => {
    if (c.k === 'category') setFilter({ category: cats.filter((x) => x !== c.v).join(',') });
    else if (c.k === 'priority') setFilter({ priority: prios.filter((x) => x !== c.v).join(',') });
    else if (c.k === 'date') setFilter({ date: 'all', from: '', to: '' });
    else setFilter({ [c.k]: DEFAULTS[c.k] });
  };

  const openItem = async (n) => {
    try {
      const res = await api(`/notifications/${n.notification_id}/open`, { method: 'POST' });
      refreshRequests?.();
      if (res.data.link) navigate(res.data.link); else { toast(res.data.message); reload(); }
    } catch (err) { toast(err.message, 'error'); }
  };
  const act = async (action, ids) => {
    setBusy(true);
    try {
      await api('/notifications/bulk', { method: 'POST', body: { action, ids } });
      setSelected(new Set()); refreshRequests?.(); reload();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.notification_id));
  const toggleAll = () => setSelected(allShown ? new Set() : new Set(rows.map((r) => r.notification_id)));

  const filterBar = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Status">
        <select className="input h-10" value={f.status} onChange={(e) => setFilter({ status: e.target.value })}>
          <option value="all">All</option><option value="unread">Unread</option><option value="read">Read</option>
        </select>
      </Field>
      <Field label="Date">
        <select className="input h-10" value={f.date} onChange={(e) => setFilter({ date: e.target.value, ...(e.target.value !== 'custom' ? { from: '', to: '' } : {}) })}>
          {Object.entries(DATE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Search" hint="Text or a reference, e.g. ADP-2026-0004">
        <input className="input h-10" defaultValue={f.q} key={f.q} onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q: e.currentTarget.value.trim() }); }}
          onBlur={(e) => { if (e.currentTarget.value.trim() !== f.q) setFilter({ q: e.currentTarget.value.trim() }); }} maxLength={100} />
      </Field>
      <Field label="Sort">
        <select className="input h-10" value={f.sort} onChange={(e) => setFilter({ sort: e.target.value })}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          {isAdmin && <option value="priority">Action required first</option>}
        </select>
      </Field>
      {f.date === 'custom' && (
        <>
          <Field label="From"><input className="input h-10" type="date" value={f.from} onChange={(e) => setFilter({ from: e.target.value })} /></Field>
          <Field label="To"><input className="input h-10" type="date" value={f.to} onChange={(e) => setFilter({ to: e.target.value })} /></Field>
        </>
      )}
      <fieldset className="sm:col-span-2 lg:col-span-4">
        <legend className="mb-1 text-sm font-medium text-navy-800">Category</legend>
        <div className="flex flex-wrap gap-1.5">
          {categories.filter((c) => !c.priority).map((c) => (
            <button key={c.key} type="button" aria-pressed={cats.includes(c.key)} onClick={() => setFilter({ category: toggle(cats, c.key) })}
              className={`rounded-full px-3 py-1 text-xs font-medium ${cats.includes(c.key) ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{c.label}</button>
          ))}
        </div>
      </fieldset>
      {isAdmin && (
        <fieldset className="sm:col-span-2 lg:col-span-4">
          <legend className="mb-1 text-sm font-medium text-navy-800">Priority</legend>
          <div className="flex flex-wrap gap-1.5">
            {['action', 'warning', 'info'].map((p) => (
              <button key={p} type="button" aria-pressed={prios.includes(p)} onClick={() => setFilter({ priority: toggle(prios, p) })}
                className={`rounded-full px-3 py-1 text-xs font-medium ${prios.includes(p) ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{PRIORITY_LABEL[p]}</button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Notifications" description="Updates about records you work with or things you did. Dismissed items are hidden."
        actions={<Link to="/notifications/settings"><Button variant="secondary"><Settings2 className="h-4 w-4" /> Settings</Button></Link>} />
      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center justify-between sm:hidden">
          <Button variant="secondary" size="sm" onClick={() => setPanel((p) => !p)} aria-expanded={panel}><SlidersHorizontal className="h-4 w-4" /> Filters{chips.length ? ` (${chips.length})` : ''}</Button>
        </div>
        <div className={`${panel ? 'block' : 'hidden'} sm:block`}>{filterBar}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm" aria-live="polite">
          <span className="text-slate-500">{data ? `${data.pagination.total} notification${data.pagination.total === 1 ? '' : 's'}` : ''}</span>
          {chips.map((c) => (
            <button key={`${c.k}-${c.v || ''}`} type="button" onClick={() => removeChip(c)} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100" aria-label={`Remove filter ${c.label}`}>
              {c.label} <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          {chips.length > 0 && <button type="button" className="ml-auto font-medium text-brand hover:underline" onClick={() => setFilter(DEFAULTS)}>Clear filters</button>}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand" checked={allShown} onChange={toggleAll} aria-label="Select all shown" /> Select shown</label>
          {selected.size > 0 && (
            <>
              <span className="text-slate-500">{selected.size} selected</span>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => act('read', [...selected])}>Mark as read</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => act('unread', [...selected])}>Mark as unread</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => act('dismiss', [...selected])}>Dismiss</Button>
            </>
          )}
        </div>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <EmptyState icon={Bell} title={chips.length ? 'No notifications match these filters' : 'Nothing here yet'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => {
              const Icon = iconFor(n);
              return (
                <li key={n.notification_id} className={`flex items-start gap-3 px-4 py-3 ${n.is_read ? '' : 'bg-blue-50/50'}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={selected.has(n.notification_id)} aria-label={`Select ${n.title}`}
                    onChange={() => setSelected((s) => { const x = new Set(s); if (x.has(n.notification_id)) x.delete(n.notification_id); else x.add(n.notification_id); return x; })} />
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${n.priority === 'action' ? 'text-red-600' : n.priority === 'warning' ? 'text-amber-600' : 'text-slate-500'}`} aria-hidden />
                  <button type="button" onClick={() => openItem(n)} className="min-w-0 flex-1 text-left">
                    <span className={`block text-sm ${n.is_read ? 'text-slate-700' : 'font-semibold text-navy-900'}`}>{n.title}</span>
                    <span className="block text-xs text-slate-500">{n.body}</span>
                    <span className="block text-[11px] text-slate-400" title={formatDateTime(n.created_at)}>{relativeTime(n.created_at)}
                      {isAdmin && n.priority !== 'info' && <> · <Badge tone={n.priority === 'action' ? 'red' : 'amber'}>{PRIORITY_LABEL[n.priority]}</Badge></>}</span>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row">
                    <button type="button" className="text-xs text-brand hover:underline" onClick={() => act(n.is_read ? 'unread' : 'read', [n.notification_id])}>{n.is_read ? 'Mark as unread' : 'Mark as read'}</button>
                    <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => act('dismiss', [n.notification_id])}>Dismiss</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination pagination={data?.pagination} label="notifications"
          onPageChange={(p) => setParams((x) => { const n = new URLSearchParams(x); n.set('page', String(p)); return n; })}
          onLimitChange={(l) => setParams((x) => { const n = new URLSearchParams(x); n.set('limit', String(l)); n.delete('page'); return n; })} />
      </Card>
    </>
  );
}
