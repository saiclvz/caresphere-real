import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Gift, Receipt } from 'lucide-react';
import useApi from '../hooks/useApi';
import { download, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDateTime, formatMoney } from '../lib/format';

const STATUS_TONE = { Pending: 'amber', Received: 'green', Cancelled: 'slate' };

export default function DonorHistory() {
  const { query, toast } = useApp();
  const { data, loading, error, reload } = useApi(`/donor/history${qs({ q: query })}`);
  const [busy, setBusy] = useState(null);
  const rows = data?.data || [];

  const getReceipt = async (id) => {
    setBusy(id);
    try { await download(`/donations/${id}/receipt`, `CareSphere-Receipt-${id}.pdf`); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Donation history"
        description="Donations you submit show as Pending until the home confirms they were received. A signed receipt is available after that."
        actions={<Link to="/donate"><Button><Gift className="h-4 w-4" /> Donate</Button></Link>} />
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Receipt} title="No donations yet" description="Your donations and their receipts will appear here." />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Date</th><th className="th">Amount</th><th className="th">Method</th><th className="th">Status</th>
              <th className="th">Children supported</th><th className="th">Your reason</th><th className="th">How it was used</th>
              <th className="th"><span className="sr-only">Receipt</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.donation_id}>
                  <td className="td whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                  <td className="td whitespace-nowrap font-semibold text-navy-900">{formatMoney(d.amount)}</td>
                  <td className="td">{d.payment_method}{d.item_description && <p className="text-xs text-slate-500">{d.item_description}</p>}</td>
                  <td className="td"><Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge></td>
                  <td className="td">{d.supported_children || <span className="text-slate-400">General support</span>}</td>
                  <td className="td max-w-xs text-sm">{d.reason_for_donation || <span className="text-slate-400">-</span>}</td>
                  <td className="td max-w-xs text-sm">{d.allocation_notes || <span className="text-slate-400">Not recorded yet</span>}</td>
                  <td className="td text-right">
                    {d.status === 'Received' ? (
                      <Button size="sm" variant="secondary" loading={busy === d.donation_id} onClick={() => getReceipt(d.donation_id)}>
                        <Download className="h-3.5 w-3.5" /> Receipt
                      </Button>
                    ) : <span className="text-xs text-slate-400">{d.status === 'Pending' ? 'Awaiting confirmation' : ''}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
