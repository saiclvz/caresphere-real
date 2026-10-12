import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import useApi from '../hooks/useApi';
import { download, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Spinner, Table } from '../components/ui';
import { formatMoney } from '../lib/format';
import { inKindTotal } from '../lib/donations';

function Section({ title, rows, money = true, extra }) {
  return (
    <Card>
      <h2 className="px-4 pt-4 font-semibold text-navy-900">{title}</h2>
      {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">No donations in this period.</p> : (
        <Table label={title}>
          <thead className="bg-slate-50"><tr><th className="th">{title.replace(/^(All donations )?[Bb]y /, '').replace(/^./, (c) => c.toUpperCase())}</th><th className="th text-right">Donations</th>{money && <><th className="th text-right">Cash</th><th className="th text-right">In-kind (estimated)</th></>}{extra && <th className="th text-right">{extra.label}</th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => (
            <tr key={r.label}><td className="td">{r.label}</td><td className="td text-right tabular-nums">{r.count}</td>
              {money && <><td className="td text-right tabular-nums">{formatMoney(r.cash)}</td><td className="td text-right tabular-nums">{Number(r.in_kind) > 0 ? formatMoney(r.in_kind) : <span className="text-slate-400">-</span>}</td></>}
              {extra && <td className="td text-right tabular-nums">{extra.render(r)}</td>}</tr>
          ))}</tbody>
        </Table>
      )}
    </Card>
  );
}

/**
 * The Summary view of the Donations page (formerly a separate Reports page). Uses the page's Date filter.
 * Counts verified or accepted donations only, never Voided. The CSV uses no donor names and is logged.
 */
export default function DonationSummary({ query }) {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi(`/donations/reports${qs(query)}`);
  const r = data?.data;
  const [busy, setBusy] = useState(false);
  const csv = async () => {
    setBusy(true);
    try { await download(`/donations/reports${qs({ ...query, format: 'csv' })}`, 'donation-summary.csv'); toast('Summary exported. The export was logged.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!r) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">Totals count verified or accepted donations only and leave out voided ones. In-kind values are estimates and are never added to cash.</p>
        <Button size="sm" variant="secondary" className="ml-auto" loading={busy} onClick={csv}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Export summary</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Cash (verified)', formatMoney(r.cards.cash.total)], ['In-kind (estimated)', inKindTotal(r.cards.in_kind.count, r.cards.in_kind.estimated_value, formatMoney)], ['Donations', r.cards.donations], ['Cash used / items distributed', `${formatMoney(r.utilization.cash_used)} / ${r.utilization.items_distributed}`]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-card"><p className="text-xs font-medium text-slate-500">{l}</p><p className="mt-1 text-xl font-semibold tabular-nums text-navy-900">{v}</p></div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="By month" rows={r.by_month} />
        <Section title="By source" rows={r.by_source} />
        <Section title="By purpose" rows={r.by_purpose} />
        <Section title="By allocation program" rows={r.by_program} money={false} extra={{ label: 'Allocated (cash)', render: (x) => `${formatMoney(x.allocated)}${x.needs_review ? ` · ${x.needs_review} need review` : ''}` }} />
        <Section title="All donations by status" rows={r.by_status} money={false} />
      </div>
    </div>
  );
}
