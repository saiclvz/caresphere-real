import { useState } from 'react';
import { Building2, Eye } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { openFileInNewTab } from '../lib/openFile';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { Badge, Button, Card, ErrorNote, Field, Modal, Table } from './ui';

/**
 * Admin and Staff: bank transfers waiting for verification. Confirm needs the Allocation (the receipt
 * is issued then); Reject needs a reason (the donor is notified). Viewing a proof is logged.
 */
export default function BankTransferQueue({ onChanged }) {
  const { toast } = useApp();
  const { data, error, reload } = useApi('/payments?status=pending_verification');
  const rows = data?.data || [];
  const [acting, setActing] = useState(null); // { payment, action }
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!rows.length && !error) return null;
  const viewProof = (p) => openFileInNewTab(`/payments/${p.payment_id}/proof`).catch((e) => toast(e.message, 'error'));
  const open = (payment, action) => { setActing({ payment, action }); setText(''); setFieldError(null); };
  const submit = async () => {
    if (!text.trim()) { setFieldError(acting.action === 'confirm' ? 'Allocation is required before the receipt can be issued.' : 'A reason is required when rejecting.'); return; }
    setBusy(true);
    try {
      await api(`/payments/${acting.payment.payment_id}/verify`, { method: 'POST', body: acting.action === 'confirm'
        ? { action: 'confirm', allocation_notes: text.trim() } : { action: 'reject', reason: text.trim() } });
      toast(acting.action === 'confirm' ? 'Transfer confirmed. The receipt was issued and the donor notified.' : 'Transfer rejected. The donor was notified.');
      setActing(null); reload(); onChanged?.();
    } catch (err) { setFieldError(err.message); } finally { setBusy(false); }
  };

  return (
    <Card className="mb-4 border border-amber-200">
      <h2 className="flex items-center gap-2 px-4 pt-4 font-semibold text-navy-900"><Building2 className="h-4 w-4 text-amber-700" aria-hidden /> Bank transfers to verify <Badge tone="amber">{rows.length}</Badge></h2>
      <p className="px-4 text-xs text-slate-500">Match the reference number, amount and date against the home's bank statement before confirming. An attachment is optional.</p>
      {error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : (
        <Table>
          <thead className="bg-slate-50"><tr>
            <th className="th">Submitted</th><th className="th">Donor</th><th className="th">Amount</th><th className="th">Reference</th><th className="th">Transfer date</th><th className="th">Attachment</th><th className="th"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.payment_id}>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(p.created_at)}</td>
                <td className="td">{p.donor_name}</td>
                <td className="td whitespace-nowrap font-semibold text-navy-900">{formatMoney(p.amount)}</td>
                <td className="td font-mono text-sm">{p.transfer_reference}{p.account_last4 && <p className="font-sans text-xs text-slate-500">Account ending {p.account_last4}</p>}</td>
                <td className="td whitespace-nowrap">{formatDate(p.transfer_date)}</td>
                <td className="td">{p.has_proof ? <Button size="sm" variant="ghost" onClick={() => viewProof(p)}><Eye className="h-3.5 w-3.5" /> View</Button> : <span className="text-xs text-slate-400">None</span>}</td>
                <td className="td whitespace-nowrap text-right">
                  <Button size="sm" onClick={() => open(p, 'confirm')}>Confirm</Button>{' '}
                  <Button size="sm" variant="ghost" onClick={() => open(p, 'reject')}>Reject</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={Boolean(acting)} onClose={() => setActing(null)} size="sm"
        title={acting?.action === 'confirm' ? 'Confirm bank transfer' : 'Reject bank transfer'}
        footer={<><Button variant="secondary" onClick={() => setActing(null)}>Cancel</Button>
          <Button variant={acting?.action === 'reject' ? 'danger' : 'primary'} loading={busy} onClick={submit}>{acting?.action === 'confirm' ? 'Confirm and issue receipt' : 'Reject'}</Button></>}>
        {acting && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{formatMoney(acting.payment.amount)} from {acting.payment.donor_name}, reference <span className="font-mono">{acting.payment.transfer_reference}</span>.</p>
            <Field label={acting.action === 'confirm' ? 'Allocation' : 'Reason (sent to the donor)'} required error={fieldError}
              hint={acting.action === 'confirm' ? 'How the donation will be used. Shown to the donor.' : undefined}>
              <textarea className="input" rows={3} maxLength={acting.action === 'confirm' ? 2000 : 1000} value={text} onChange={(e) => { setText(e.target.value); setFieldError(null); }} />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
