import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Gift, Receipt } from 'lucide-react';
import useApi from '../hooks/useApi';
import { download, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDateTime, formatMoney } from '../lib/format';

const STATUS_TONE = { Pending: 'amber', Received: 'blue', 'Under inspection': 'blue', Accepted: 'blue', Acknowledged: 'green', Allocated: 'green', 'Partially distributed': 'green', 'Fully distributed': 'green', Closed: 'slate', Cancelled: 'slate', Voided: 'red', 'Pending verification': 'amber', Rejected: 'red', Paid: 'green', Confirmed: 'green' };
const ATTEMPT_TONE = { pending: 'amber', failed: 'red', cancelled: 'slate', expired: 'slate' };

export default function DonorHistory() {
  const { query, toast } = useApp();
  const { data, loading, error, reload } = useApi(`/donor/history${qs({ q: query })}`);
  // Payment records: show Paid / Confirmed / Rejected on donations, and list attempts that created no donation.
  const pays = useApi('/donor/payments');
  const payByDonation = Object.fromEntries((pays.data?.data || []).filter((p) => p.donation_id).map((p) => [p.donation_id, p]));
  const attempts = (pays.data?.data || []).filter((p) => !p.donation_id);
  const statusOf = (d) => {
    const p = payByDonation[d.donation_id];
    if (d.status === 'Voided') return 'Voided';
    if (!p) return d.status;
    return { paid: 'Paid', confirmed: 'Confirmed', rejected: 'Rejected', pending_verification: 'Pending verification' }[p.status] || d.status;
  };
  const [busy, setBusy] = useState(null);
  const rows = data?.data || [];

  const getReceipt = async (id) => {
    setBusy(id);
    try { await download(`/donations/${id}/receipt`, `CareSphere-Acknowledgment-${rows.find((r) => r.donation_id === id)?.donation_no || id}.pdf`); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Donation history"
        description="E-wallet donations show as Paid once PayMongo confirms them. Bank transfers show as Pending verification until the staff confirm them. A signed receipt is available after that."
        actions={<Link to="/donate"><Button><Gift className="h-4 w-4" /> Donate</Button></Link>} />
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Receipt} title="No donations yet" description="Your donations and their receipts will appear here." />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Donation</th><th className="th">Amount</th><th className="th">Method</th><th className="th">Status</th>
              <th className="th">Your note</th><th className="th">How it is allocated</th>
              <th className="th"><span className="sr-only">Receipt</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.donation_id}>
                  <td className="td whitespace-nowrap"><span className="font-mono text-sm text-navy-900">{d.donation_no}</span><p className="text-xs text-slate-500">{formatDateTime(d.created_at)}</p></td>
                  <td className="td whitespace-nowrap font-semibold text-navy-900">{d.payment_method === 'In-kind' ? <span className="text-sm font-normal text-slate-600">Items</span> : formatMoney(d.amount)}</td>
                  <td className="td">{d.payment_method}{d.item_description && <p className="text-xs text-slate-500">{d.item_description}</p>}</td>
                  <td className="td"><Badge tone={STATUS_TONE[statusOf(d)]}>{statusOf(d)}</Badge>
                    {payByDonation[d.donation_id]?.rejection_reason && <p className="mt-1 max-w-[14rem] text-xs text-red-700">Reason: {payByDonation[d.donation_id].rejection_reason}</p>}</td>
                  <td className="td max-w-xs text-sm">{d.reason_for_donation || d.reason_category || <span className="text-slate-400">-</span>}</td>
                  <td className="td max-w-xs text-sm">{d.allocation?.length ? d.allocation.map((l) => l.needs_review ? 'Being reviewed by the home' : `${l.program}${l.amount !== null ? ` ${formatMoney(l.amount)}` : ''}`).join('; ') : <span className="text-slate-400">Not recorded yet</span>}</td>
                  <td className="td text-right">
                    {d.has_acknowledgment && d.status !== 'Voided' ? (
                      <Button size="sm" variant="secondary" loading={busy === d.donation_id} onClick={() => getReceipt(d.donation_id)}>
                        <Download className="h-3.5 w-3.5" /> Receipt
                      </Button>
                    ) : <span className="text-xs text-slate-400">{['Pending', 'Pending verification'].includes(d.status) ? 'Awaiting confirmation' : d.status === 'Voided' ? '' : 'Being processed'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {attempts.length > 0 && (
        <Card className="mt-6">
          <h2 className="px-4 pt-4 font-semibold text-navy-900">Online payments that didn't complete</h2>
          <p className="px-4 text-xs text-slate-500">No money was taken for these and no donation was recorded.</p>
          <Table>
            <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Amount</th><th className="th">Method</th><th className="th">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {attempts.map((p) => (
                <tr key={p.payment_id}>
                  <td className="td whitespace-nowrap">{formatDateTime(p.created_at)}</td>
                  <td className="td whitespace-nowrap font-semibold text-navy-900">{formatMoney(p.amount)}</td>
                  <td className="td">{p.method_name}</td>
                  <td className="td"><Badge tone={ATTEMPT_TONE[p.status]}>{p.status_label}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
