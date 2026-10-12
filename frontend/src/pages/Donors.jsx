import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Users } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { Badge, Card, EmptyState, ErrorNote, Field, PageHeader, Spinner, Table } from '../components/ui';
import Pagination from '../components/Pagination';
import { formatDate, formatMoney } from '../lib/format';

const ORIGIN = { account: 'Donor account', walk_in: 'Walk-in', staff: 'Staff recorded' };

/**
 * Donations > Donors: the donor directory (DNR-NNNN). Admin and Staff with the Donor directory duty only; the
 * server answers ACCESS DENIED to anyone else. Contact details stay masked here (reveal on the profile, logged).
 */
export default function Donors() {
  const [params, setParams] = useSearchParams();
  const f = { q: params.get('q') || '', type: params.get('type') || '', origin: params.get('origin') || '', page: params.get('page') || '1', limit: params.get('limit') || '20' };
  const setF = (patch) => setParams((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!('page' in patch)) n.delete('page'); return n; }, { replace: true });
  const [search, setSearch] = useState(f.q);
  useEffect(() => { const t = setTimeout(() => { if (search.trim() !== f.q) setF({ q: search.trim() }); }, 350); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, loading, error, reload } = useApi(`/donor-records${qs(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`);
  const rows = data?.data || [];
  return (
    <>
      <PageHeader title="Donors" description="Donor records made from donor accounts and walk-in names. Records with the same name are flagged for you to check; nothing is merged automatically." />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter donors">
          <Field label="Search" className="min-w-[12rem] flex-1"><input className="input h-10" type="search" placeholder="Name or donor code" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Type" className="w-40"><select className="input h-10" value={f.type} onChange={(e) => setF({ type: e.target.value })}><option value="">All types</option><option>Individual</option><option>Organization</option></select></Field>
          <Field label="Source" className="w-44"><select className="input h-10" value={f.origin} onChange={(e) => setF({ origin: e.target.value })}><option value="">All sources</option>{Object.entries(ORIGIN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
      </Card>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <EmptyState icon={Users} title={f.q || f.type || f.origin ? 'No donors match' : 'No donor records yet'} description="Donor records are created when a donation is recorded." />
        ) : (
          <Table label="Donors">
            <thead className="bg-slate-50"><tr><th className="th">Donor</th><th className="th">Type</th><th className="th">Source</th><th className="th">Contact</th><th className="th text-right">Donations</th><th className="th text-right">Cash given</th><th className="th">Last donation</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.donor_ref_id}>
                  <td className="td"><Link to={`/donors/${r.donor_ref_id}`} className="font-medium text-brand hover:underline">{r.display_name}</Link><p className="font-mono text-xs text-slate-500">{r.donor_code}</p>
                    {r.possible_duplicate && <Badge tone="amber"><AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />Possible duplicate</Badge>}</td>
                  <td className="td">{r.donor_type}</td>
                  <td className="td">{ORIGIN[r.origin]}</td>
                  <td className="td text-sm">{r.contact || r.email || <span className="text-slate-400">-</span>}</td>
                  <td className="td text-right tabular-nums">{r.donation_count}</td>
                  <td className="td text-right tabular-nums">{formatMoney(r.cash_total)}</td>
                  <td className="td whitespace-nowrap">{r.last_donation_at ? formatDate(r.last_donation_at) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination pagination={data?.pagination} label="donors" onPageChange={(p) => setF({ page: String(p) })} onLimitChange={(l) => setF({ limit: String(l) })} />
      </Card>
    </>
  );
}
