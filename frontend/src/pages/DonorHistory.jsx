import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Gift, MessageSquare, Receipt, Undo2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, downloadSigned, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, Notice, PageHeader, Spinner, Table } from '../components/ui';
import ClaimSteps from '../components/donations/ClaimSteps';
import { checkFile, MB, readFile } from '../lib/files';
import { formatDateTime, formatMoney } from '../lib/format';

const STATUS_TONE = {
  'Waiting for the home to confirm': 'amber', 'The home needs more details': 'amber', 'Being checked by the home': 'blue', 'Confirmed by the home': 'green',
  'Not matched yet': 'red', Withdrawn: 'slate', 'Cancelled (legacy)': 'slate',
  Pending: 'amber', Received: 'blue', 'Under inspection': 'blue', Accepted: 'blue', Acknowledged: 'green', Allocated: 'green', 'Partially distributed': 'green', 'Fully distributed': 'green', Closed: 'slate', Cancelled: 'slate', Voided: 'red', Rejected: 'red',
};

/** Reply to the home and/or add proof later. The amount and the reference can't be changed here (withdraw and report again). */
function AddInfo({ d, onClose, onSaved }) {
  const [note, setNote] = useState('');
  const [proof, setProof] = useState(null);
  const [error, setError] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const problem = checkFile(file, { types: ['image/jpeg', 'image/png', 'application/pdf'], maxBytes: 5 * MB });
    setFileError(problem); setProof(problem ? null : await readFile(file));
  };
  const save = async () => {
    setBusy(true); setError(null);
    try { const r = await api(`/donor/donation-reports/${d.donation_id}/info`, { method: 'POST', body: { note: note.trim() || undefined, proof: proof || undefined } }); onSaved(r.data); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Add details to ${d.donation_no}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!note.trim() && !proof} onClick={save}>Send to the home</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        {d.message && <Notice tone="warning" title="Message from the home">{d.message}</Notice>}
        <p className="text-sm text-slate-600">The amount and the reference can't be changed. If they are wrong, withdraw this report and report the donation again.</p>
        <Field label="Your reply" hint="Optional (up to 500 characters)"><textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Proof" error={fileError} hint="Optional: PDF, JPG or PNG up to 5 MB">
          <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={pick} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy-900" />
        </Field>
        {proof && <p className="text-xs text-slate-600">Attached: {proof.name}</p>}
      </div>
    </Modal>
  );
}

export default function DonorHistory() {
  const { query, toast } = useApp();
  const { data, loading, error, reload } = useApi(`/donor/history${qs({ q: query })}`);
  const [busy, setBusy] = useState(null);
  const [adding, setAdding] = useState(null);
  const [withdrawing, setWithdrawing] = useState(null);
  const rows = data?.data || [];

  const getReceipt = async (d) => {
    setBusy(d.donation_id);
    try { await downloadSigned(`/donations/${d.donation_id}/receipt/link`, `CareSphere-Acknowledgment-${d.donation_no || d.donation_id}.pdf`); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const withdraw = async () => {
    try { await api(`/donor/donation-reports/${withdrawing.donation_id}/withdraw`, { method: 'POST' }); toast('Report withdrawn.', 'success'); setWithdrawing(null); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Donation history"
        description='A donation you reported shows as "Waiting for the home to confirm" until the home finds it in its own account. Your acknowledgment receipt is available after that.'
        actions={<Link to="/donate"><Button><Gift className="h-4 w-4" aria-hidden /> Donate</Button></Link>} />
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Receipt} title="No donations yet" description="Your donations and their receipts will appear here." />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Donation</th><th className="th">Amount</th><th className="th">Method</th><th className="th">Status</th>
              <th className="th">How it is allocated</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.donation_id} className="align-top">
                  <td className="td whitespace-nowrap">
                    <span className="font-mono text-sm text-navy-900">{d.donation_no}</span>
                    <p className="text-xs text-slate-500">{formatDateTime(d.sent_at || d.reported_at || d.created_at)}</p>
                    {d.reference && <p className="text-xs text-slate-500">Ref. <span className="font-mono">{d.reference}</span></p>}
                  </td>
                  <td className="td whitespace-nowrap">
                    {d.method === 'In-kind' ? <span className="text-sm text-slate-600">Items</span> : d.claim_status ? (
                      <>
                        <span className="font-semibold text-navy-900">{formatMoney(d.confirmed_amount ?? d.reported_amount)}</span>
                        {d.confirmed_amount !== null && d.reported_amount !== null && d.confirmed_amount !== d.reported_amount && <p className="text-xs text-slate-500">You reported {formatMoney(d.reported_amount)}</p>}
                        {d.confirmed_amount === null && <p className="text-xs text-slate-500">Reported</p>}
                      </>
                    ) : <span className="font-semibold text-navy-900">{formatMoney(d.amount)}</span>}
                  </td>
                  <td className="td">{d.method}{d.item_description && <p className="text-xs text-slate-500">{d.item_description}</p>}{d.your_note && <p className="mt-0.5 max-w-[14rem] text-xs text-slate-500">Your note: {d.your_note}</p>}</td>
                  <td className="td">
                    <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                    {d.steps && <div className="mt-2"><ClaimSteps steps={d.steps} /></div>}
                    {d.message && <p className="mt-1 max-w-[16rem] text-xs text-red-700">From the home: {d.message}</p>}
                    {d.notes?.length > 0 && <p className="mt-1 text-xs text-slate-500">{d.notes.length} message{d.notes.length === 1 ? '' : 's'} · last {formatDateTime(d.notes[d.notes.length - 1].at)}</p>}
                  </td>
                  <td className="td max-w-xs text-sm">{d.allocation?.length ? d.allocation.map((l) => l.needs_review ? 'Being reviewed by the home' : `${l.program}${l.amount !== null ? ` ${formatMoney(l.amount)}` : ''}`).join('; ') : <span className="text-slate-400">Not recorded yet</span>}</td>
                  <td className="td text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      {d.receipt_available && (
                        <Button size="sm" variant="secondary" loading={busy === d.donation_id} onClick={() => getReceipt(d)}><Download className="h-3.5 w-3.5" aria-hidden /> Receipt</Button>
                      )}
                      {d.can_add_info && <Button size="sm" variant="secondary" onClick={() => setAdding(d)}><MessageSquare className="h-3.5 w-3.5" aria-hidden /> {d.claim_status === 'Details requested' ? 'Reply' : 'Add proof or note'}</Button>}
                      {d.can_withdraw && <Button size="sm" variant="ghost" onClick={() => setWithdrawing(d)}><Undo2 className="h-3.5 w-3.5" aria-hidden /> Withdraw</Button>}
                      {!d.receipt_available && !d.can_add_info && !d.can_withdraw && d.status !== 'Voided' && <span className="text-xs text-slate-400">{d.claim_status === 'Verified' ? 'Receipt being prepared' : ''}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <AddInfo d={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); toast('Sent to the home.', 'success'); reload(); }} />}
      <ConfirmModal open={!!withdrawing} onClose={() => setWithdrawing(null)} onConfirm={withdraw} title="Withdraw this report?"
        confirmLabel="Withdraw"
        message={withdrawing ? `Report ${withdrawing.donation_no} will be withdrawn. This doesn't return any money: if you already sent it, contact the home. You can report the donation again with the right details.` : ''} />
    </>
  );
}
