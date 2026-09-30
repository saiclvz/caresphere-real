import { useState } from 'react';
import { BadgeCheck, Download, HandCoins, Pencil, Plus, ScanLine, Trash2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import QrScanner from '../components/QrScanner';
import { formatDateTime, formatMoney } from '../lib/format';

const METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Check', 'In-kind'];

function DonationForm({ onClose, onSave }) {
  const donors = useApi('/donations/donors');
  const [form, setForm] = useState({ donor_id: '', amount: '', payment_method: 'Cash', allocation_notes: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try { await onSave({ ...form, donor_id: Number(form.donor_id), amount: Number(form.amount) }); }
    catch (err) { setError(err); } finally { setSaving(false); }
  };
  const list = donors.data?.data || [];
  return (
    <Modal open onClose={onClose} title="Record a donation"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="donation-form" loading={saving}>Record donation</Button></>}>
      <form id="donation-form" onSubmit={submit} className="space-y-4">
        <ErrorNote error={error || donors.error} />
        <Field label="Donor" hint={list.length === 0 && !donors.loading ? 'No donor accounts yet. Donors can register from the sign-in page, or an admin can create one.' : 'The receipt and history appear in this donor\'s portal.'}>
          <select className="input" required value={form.donor_id} onChange={set('donor_id')}>
            <option value="">Select a donor</option>
            {list.map((d) => <option key={d.user_id} value={d.user_id}>{d.full_name} ({d.email})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (₱)" hint="For in-kind, enter the estimated value"><input className="input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={set('amount')} /></Field>
          <Field label="Payment method"><select className="input" value={form.payment_method} onChange={set('payment_method')}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        </div>
        <Field label="How it will be used" hint="Visible to the donor. You can fill this in later."><textarea className="input" rows={3} value={form.allocation_notes} onChange={set('allocation_notes')} placeholder="e.g. 20 cans of infant formula for the nursery" /></Field>
      </form>
    </Modal>
  );
}

function AllocationForm({ donation, onClose, onSave }) {
  const [notes, setNotes] = useState(donation.allocation_notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setSaving(true); setError(null);
    try { await onSave(notes); } catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Allocation for ${donation.donor_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={saving}>Save allocation</Button></>}>
      <ErrorNote error={error} />
      <p className="mb-3 text-sm text-slate-500">{formatMoney(donation.amount)} via {donation.payment_method} on {formatDateTime(donation.created_at)}</p>
      <Field label="How this donation was used"><textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Modal>
  );
}

export default function Donations() {
  const { user } = useAuth();
  const { query, toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [range, setRange] = useState({ from: '', to: '' });
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi(`/donations${qs({ ...range, status, q: query })}`);
  const [confirmingStatus, setConfirmingStatus] = useState(null); // { donation, status }
  const [adding, setAdding] = useState(false);
  const [allocating, setAllocating] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(null);
  const [busy, setBusy] = useState(null);

  const rows = data?.data || [];
  const total = rows.filter((d) => d.status === 'Received').reduce((s, d) => s + Number(d.amount), 0);
  const pending = rows.filter((d) => d.status === 'Pending').length;
  const setDonationStatus = async () => {
    setBusy('status');
    try {
      await api(`/donations/${confirmingStatus.donation.donation_id}/status`, { method: 'PUT', body: { status: confirmingStatus.status } });
      await reload();
      toast(confirmingStatus.status === 'Received' ? 'Marked as received. The donor can now download the receipt.' : 'Donation cancelled.');
      setConfirmingStatus(null);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  const create = async (payload) => { await api('/donations', { method: 'POST', body: payload }); setAdding(false); toast('Donation recorded. The donor can download the receipt from their portal.'); reload(); };
  const saveAllocation = async (notes) => { await api(`/donations/${allocating.donation_id}/allocation`, { method: 'PUT', body: { allocation_notes: notes } }); setAllocating(null); toast('Allocation saved.'); reload(); };
  const receipt = async (id) => { setBusy(id); try { await download(`/donations/${id}/receipt`, `receipt-${id}.pdf`); } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); } };
  const remove = async () => {
    setBusy('delete');
    try { await api(`/donations/${deleting.donation_id}`, { method: 'DELETE' }); setDeleting(null); toast('Donation deleted.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const onVerify = async (code) => {
    const res = await api(`/donations/verify/${encodeURIComponent(code)}`);
    setVerifying(false);
    setVerified(res.data);
  };

  return (
    <>
      <PageHeader title="Donations" description="Record gifts, note how each one is used, and issue signed receipts."
        actions={<>
          <Button variant="secondary" onClick={() => setVerifying(true)}><ScanLine className="h-4 w-4" /> Verify receipt</Button>
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Record donation</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><input className="input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        <Field label="Status"><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option>Pending</option><option>Received</option><option>Cancelled</option>
        </select></Field>
        {(range.from || range.to) && <Button variant="ghost" onClick={() => setRange({ from: '', to: '' })}>Clear dates</Button>}
        <p className="ml-auto text-sm text-slate-500">{rows.length} donation{rows.length === 1 ? '' : 's'}{pending ? ` · ${pending} pending` : ''} · received <span className="font-semibold text-navy-900">{formatMoney(total)}</span></p>
      </div>

      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={HandCoins} title="No donations in this view" action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Record donation</Button>} />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Date</th><th className="th">Donor</th><th className="th text-right">Amount</th>
              <th className="th">Method</th><th className="th">Status</th><th className="th">Children / reason</th><th className="th">Allocation</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.donation_id}>
                  <td className="td whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                  <td className="td font-medium text-navy-900">{d.donor_name}</td>
                  <td className="td text-right font-semibold tabular-nums">{formatMoney(d.amount)}</td>
                  <td className="td">{d.payment_method}{d.item_description && <p className="text-xs text-slate-500">{d.item_description}</p>}</td>
                  <td className="td"><Badge tone={{ Pending: 'amber', Received: 'green', Cancelled: 'slate' }[d.status]}>{d.status}</Badge>
                    {d.submitted_by_donor ? <p className="mt-0.5 text-xs text-slate-500">Submitted by donor</p> : null}</td>
                  <td className="td max-w-xs text-xs">
                    {d.supported_children && <p className="text-navy-900">{d.supported_children}</p>}
                    {d.reason_for_donation && <p className="text-slate-500">{d.reason_for_donation}</p>}
                    {!d.supported_children && !d.reason_for_donation && <span className="text-slate-400">-</span>}
                  </td>
                  <td className="td max-w-xs">{d.allocation_notes || <span className="text-amber-700">Not recorded</span>}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      {d.status === 'Pending' && <>
                        <Button size="sm" onClick={() => setConfirmingStatus({ donation: d, status: 'Received' })}>Mark received</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmingStatus({ donation: d, status: 'Cancelled' })}>Cancel</Button>
                      </>}
                      <Button size="sm" variant="ghost" aria-label="Edit allocation" title="Edit allocation" onClick={() => setAllocating(d)}><Pencil className="h-4 w-4" /></Button>
                      {d.status === 'Received' && <Button size="sm" variant="ghost" aria-label="Download receipt" title="Download receipt" loading={busy === d.donation_id} onClick={() => receipt(d.donation_id)}><Download className="h-4 w-4" /></Button>}
                      {isAdmin && <Button size="sm" variant="ghost" aria-label="Delete" className="text-red-600" onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {adding && <DonationForm onClose={() => setAdding(false)} onSave={create} />}
      {allocating && <AllocationForm donation={allocating} onClose={() => setAllocating(null)} onSave={saveAllocation} />}
      <QrScanner open={verifying} onClose={() => setVerifying(false)} onScan={onVerify} title="Verify a donation receipt" hint="Scan the QR code printed on the receipt." />
      <Modal open={Boolean(verified)} onClose={() => setVerified(null)} title="Receipt is authentic" size="sm" footer={<Button onClick={() => setVerified(null)}>Done</Button>}>
        {verified && (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-medium text-emerald-700"><BadgeCheck className="h-5 w-5" /> Signature matches receipt #{String(verified.donation_id).padStart(6, '0')}</p>
            <p><span className="text-slate-500">Donor:</span> {verified.donor_name}</p>
            <p><span className="text-slate-500">Amount:</span> {formatMoney(verified.amount)} via {verified.payment_method}</p>
            <p><span className="text-slate-500">Date:</span> {formatDateTime(verified.created_at)}</p>
          </div>
        )}
      </Modal>
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy === 'delete'}
        title="Delete this donation?" message="The donor will lose this record and its receipt from their portal. This cannot be undone." />
      <ConfirmModal open={!!confirmingStatus} onClose={() => setConfirmingStatus(null)} loading={busy === 'status'} onConfirm={setDonationStatus}
        title={confirmingStatus?.status === 'Received' ? 'Mark donation as received?' : 'Cancel this donation?'}
        confirmLabel={confirmingStatus?.status === 'Received' ? 'Mark received' : 'Cancel donation'}
        message={confirmingStatus ? (confirmingStatus.status === 'Received'
          ? `Confirm that ${formatMoney(confirmingStatus.donation.amount)} from ${confirmingStatus.donation.donor_name} has actually been received. A receipt will be issued.`
          : `Are you sure you want to cancel the pending donation from ${confirmingStatus.donation.donor_name}?`) : ''} />
    </>
  );
}
