import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, FileSpreadsheet, FileText, ShieldAlert } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, PageHeader, Spinner, Table } from '../components/ui';
import Pagination from '../components/Pagination';
import { formatDateTime } from '../lib/format';
import DataProtection from './DataProtection';
import AccessControlPanels from '../components/AccessControlPanels';

const KEYS = ['category', 'type', 'ended', 'from', 'to', 'user_id', 'event', 'q'];

/** "2 active access sessions" above the filters; refreshed every 10 s, paused while the tab is hidden. */
function ActiveSessionsNotice() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let id = null;
    const load = () => api('/unlock/sessions/active', { headers: { 'X-Background': '1' } }).then((r) => setCount(r.data.length)).catch(() => {});
    const start = () => { if (!id) id = setInterval(load, 10000); };
    const stop = () => { clearInterval(id); id = null; };
    const onVis = () => { if (document.hidden) stop(); else { load(); start(); } };
    load(); if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!count) return null;
  return (
    <p className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{count} active access session{count === 1 ? '' : 's'}</span>
      <Link to="/audit-log?tab=data-protection" className="font-medium text-brand hover:underline">Manage</Link>
    </p>
  );
}

/**
 * Activity log: one log over general activity, health access and the unlock flow. Filters are in the
 * URL (values only), combined with AND and applied on the server; changing one resets to page 1.
 */
function ActivityLog() {
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const f = useMemo(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) || ''])), [params]);
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const rangeError = f.from && f.to && f.from > f.to ? 'From must be on or before To.' : null;
  const options = useApi(`/audit-logs/options${qs({ from: rangeError ? undefined : f.from || undefined, to: rangeError ? undefined : f.to || undefined })}`);
  const o = options.data?.data;
  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const { data, loading, error, reload } = useApi(rangeError ? null : `/audit-logs${qs({ ...query, page, limit })}`);
  const rows = data?.data || [];
  const active = Object.keys(query).length > 0;
  const [busy, setBusy] = useState(null);

  const set = (patch) => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    n.delete('page');
    return n;
  });
  const clear = () => setParams((p) => { const n = new URLSearchParams(); if (p.get('tab')) n.set('tab', p.get('tab')); return n; });
  const events = (o?.events || []).filter((e) => !f.category || e.category === f.category);

  const exportXlsx = async () => {
    setBusy('xlsx');
    try { await download(`/audit-logs/export${qs(query)}`, 'CareSphere-Audit-Log.xlsx'); toast('Audit log exported.'); } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const report = async () => {
    setBusy('pdf');
    try { await download(`/reports/compliance${qs(query)}`, 'CareSphere-Compliance-Report.pdf'); toast('Compliance report generated.'); } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Activity log" description="Who did what, when, and to which record. Sensitive record access is marked. Entries can't be edited or deleted."
        actions={<>
          <Button variant="secondary" loading={busy === 'pdf'} onClick={report}><FileText className="h-4 w-4" /> Compliance report</Button>
          <Button variant="secondary" loading={busy === 'xlsx'} onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4" /> Export to Excel</Button>
        </>} />
      <ActiveSessionsNotice />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Category">
            <select className="input h-10 w-60" value={f.category} onChange={(e) => set({ category: e.target.value, ended: '', event: '' })}>
              <option value="">All categories{o ? ` (${o.total})` : ''}</option>
              {(o?.categories || []).map((c) => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
            </select>
          </Field>
          <Field label="Record type">
            <select className="input h-10 w-48" value={f.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">All</option>{(o?.record_types || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          {f.category === 'sensitive' && (
            <Field label="How it ended">
              <select className="input h-10 w-52" value={f.ended} onChange={(e) => set({ ended: e.target.value })}>
                <option value="">All</option>{(o?.ended || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="From" error={rangeError}><input className="input h-10 w-40" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To"><input className="input h-10 w-40" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          <Field label="User">
            <select className="input h-10 w-52" value={f.user_id} onChange={(e) => set({ user_id: e.target.value })}>
              <option value="">Everyone</option>{(o?.users || []).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} ({u.role})</option>)}
            </select>
          </Field>
          <Field label="Event">
            <select className="input h-10 w-60" value={f.event} onChange={(e) => set({ event: e.target.value })}>
              <option value="">All events</option>{events.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </Field>
          <Field label="Search" hint="Reference number or user name">
            <input className="input h-10 w-56" defaultValue={f.q} key={f.q} maxLength={100}
              onKeyDown={(e) => { if (e.key === 'Enter') set({ q: e.currentTarget.value.trim() }); }}
              onBlur={(e) => { if (e.currentTarget.value.trim() !== f.q) set({ q: e.currentTarget.value.trim() }); }} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm text-slate-500" aria-live="polite">
          <span>{data ? `${data.pagination.total} entr${data.pagination.total === 1 ? 'y' : 'ies'} shown` : ''}</span>
          {active && <button type="button" className="ml-auto font-medium text-brand hover:underline" onClick={clear}>Clear filters</button>}
        </div>
      </Card>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title={active ? 'No entries match these filters' : 'No entries yet'}
            action={active ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined} />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Record</th><th className="th">Device</th><th className="th">Detail</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="td whitespace-nowrap text-xs">{formatDateTime(r.at)}</td>
                  <td className="td">{r.user_name || 'System'}{r.user_role && <span className="text-xs text-slate-500"> ({r.user_role})</span>}</td>
                  <td className="td">
                    {r.sensitive && <Badge tone="red">Sensitive</Badge>}{' '}
                    <span title={r.code} className="text-sm text-navy-900">{r.label}</span>
                  </td>
                  <td className="td whitespace-nowrap font-mono text-xs">
                    {r.record ? (r.record.link ? <Link to={r.record.link} className="text-brand hover:underline">{r.record.label}</Link> : r.record.label) : <span className="font-sans text-slate-400">-</span>}
                  </td>
                  <td className="td text-xs capitalize">{r.device || '-'}</td>
                  <td className="td max-w-xs text-xs text-slate-500">{r.detail || ''}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination pagination={data?.pagination} label="entries"
          onPageChange={(p) => setParams((x) => { const n = new URLSearchParams(x); n.set('page', String(p)); return n; })}
          onLimitChange={(l) => setParams((x) => { const n = new URLSearchParams(x); n.set('limit', String(l)); n.delete('page'); return n; })} />
      </Card>
    </>
  );
}

/** Data protection (Admin tab): privacy requests, incidents and security events, then active access. */
function DataProtectionTab() {
  return (<><DataProtection /><AccessControlPanels /></>);
}

const TABS = [{ key: 'activity', label: 'Activity log' }, { key: 'data-protection', label: 'Data protection' }];
/** Old tab names land on the Activity log filtered to Sensitive record access. */
const OLD_SENSITIVE_TABS = ['adoption', 'health', 'protected-access', 'sensitive-record-access', 'health-data-access'];

/** Audit log (Admin only): Activity log and Data protection. The tab and filters live in the URL. */
export default function AuditLog() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab = TABS.some((t) => t.key === rawTab) ? rawTab : 'activity';
  const refs = useRef({});

  useEffect(() => {
    if (OLD_SENSITIVE_TABS.includes(rawTab)) { setParams({ tab: 'activity', category: 'sensitive' }, { replace: true }); return; }
    if (rawTab !== tab) setParams((p) => { const n = new URLSearchParams(p); n.set('tab', tab); return n; }, { replace: true });
  }, [rawTab, tab, setParams]);

  const select = (key) => setParams({ tab: key });
  const onKeyDown = (e) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    select(t.key);
    refs.current[t.key]?.focus();
  };

  return (
    <>
      <div className="mb-4 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200" role="tablist" aria-label="Audit log sections" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} type="button" role="tab" id={`tab-${t.key}`} aria-controls={`panel-${t.key}`}
            aria-selected={tab === t.key} tabIndex={tab === t.key ? 0 : -1} onClick={() => select(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${tab === t.key ? 'bg-navy-900 text-white' : 'text-slate-600 hover:text-navy-900'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'activity' ? <ActivityLog /> : <DataProtectionTab />}
      </div>
    </>
  );
}
