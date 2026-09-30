import { useEffect, useState } from 'react';
import { ClipboardList, FileSpreadsheet, FileText } from 'lucide-react';
import useApi from '../hooks/useApi';
import { download, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDateTime } from '../lib/format';

const ENTITIES = ['', 'Child', 'Inventory', 'Donation', 'Visitor', 'Meal', 'Schedule', 'User', 'Settings', 'Reports'];

function ActivityLog() {
  const { query, toast } = useApp();
  const [filters, setFilters] = useState({ entity: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const listQuery = qs({ ...filters, search: query, page, page_size: 50 });
  const { data, loading, error, reload } = useApi(`/audit-logs${listQuery}`);
  const [busy, setBusy] = useState(null);

  useEffect(() => { setPage(1); }, [filters, query]);

  const exportFile = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'xlsx') await download(`/audit-logs/export${qs({ ...filters, search: query })}`, 'audit-log.xlsx');
      else await download(`/reports/compliance${qs({ from: filters.from, to: filters.to })}`, 'compliance-report.pdf');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  const rows = data?.rows || [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const tone = (a) => (a.startsWith('PHI') ? 'red' : a.startsWith('QR') ? 'blue' : a.startsWith('DELETE') ? 'amber' : 'slate');

  return (
    <>
      <PageHeader title="Audit log" description="Every sign-in, change, and health-record access, with who did it and from which device."
        actions={<>
          <Button variant="secondary" loading={busy === 'pdf'} onClick={() => exportFile('pdf')}><FileText className="h-4 w-4" /> Compliance report</Button>
          <Button loading={busy === 'xlsx'} onClick={() => exportFile('xlsx')}><FileSpreadsheet className="h-4 w-4" /> Export to Excel</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Record type">
          <select className="input" value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
            {ENTITIES.map((e) => <option key={e} value={e}>{e || 'All'}</option>)}
          </select>
        </Field>
        <Field label="From"><input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
      </div>

      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={ClipboardList} title="No activity matches these filters" />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50"><tr>
                <th className="th">When</th><th className="th">User</th><th className="th">Action</th><th className="th">Record</th><th className="th">IP address</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((l) => (
                  <tr key={l.log_id}>
                    <td className="td whitespace-nowrap">{formatDateTime(l.timestamp)}</td>
                    <td className="td"><span className="font-medium text-navy-900">{l.full_name}</span><span className="block text-xs text-slate-400">{l.role}</span></td>
                    <td className="td"><Badge tone={tone(l.action_performed)}>{l.action_performed}</Badge></td>
                    <td className="td">{l.target_entity}</td>
                    <td className="td font-mono text-xs">{l.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
              <span>{data.total.toLocaleString()} entries</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span>Page {page} of {pages}</span>
                <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

const EVENT_TONE = { TOKEN_ISSUED: 'blue', VIEW: 'green', UPDATE: 'navy', TOKEN_DENIED: 'red', TOKEN_EXPIRED: 'amber', TOKEN_INVALID: 'red', TOKEN_REVOKED: 'slate' };

/** Every health-record access grant, denial, view, update and expiry. */
function HealthAccessLog() {
  const { query } = useApp();
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, loading, error, reload } = useApi(`/audit-logs/health-access${qs({ ...range, q: query })}`);
  const rows = data?.data || [];
  return (
    <>
      <PageHeader title="Health data access log" description="Each 3-minute access grant, denied attempt, view, update and expiry for health records and case files." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><input className="input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      </div>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={ClipboardList} title="No health data access recorded in this period" />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">When</th><th className="th">User</th><th className="th">Child</th><th className="th">Event</th><th className="th">Detail</th><th className="th">IP address</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((l) => (
                <tr key={l.log_id}>
                  <td className="td whitespace-nowrap text-xs">{formatDateTime(l.created_at)}</td>
                  <td className="td">{l.user_name || '-'}{l.user_role && <span className="text-xs text-slate-500"> ({l.user_role})</span>}</td>
                  <td className="td">{l.child_id || '-'}</td>
                  <td className="td"><Badge tone={EVENT_TONE[l.event] || 'slate'}>{l.event.replace(/_/g, ' ')}</Badge></td>
                  <td className="td max-w-xs text-xs text-slate-600">{l.detail || ''}</td>
                  <td className="td text-xs text-slate-500">{l.ip_address || ''}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export default function AuditLog() {
  const [tab, setTab] = useState('activity');
  return (
    <>
      <div className="mb-4 inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200" role="tablist">
        {[['activity', 'Activity log'], ['health', 'Health data access']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-navy-900 text-white' : 'text-slate-600 hover:text-navy-900'}`}>{label}</button>
        ))}
      </div>
      {tab === 'activity' ? <ActivityLog /> : <HealthAccessLog />}
    </>
  );
}
