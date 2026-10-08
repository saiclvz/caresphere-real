import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Eye, HandCoins, Pencil, Plus, ScanLine, Trash2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, PageHeader, Spinner, Table } from '../components/ui';
import VerifyReceiptModal from '../components/VerifyReceiptModal';
import DonationForm, { RECORD_METHODS } from '../components/DonationForm';
import BankTransferQueue from '../components/BankTransferQueue';
import { formatDateTime, formatMoney } from '../lib/format';

const badInput = 'border-red-400 focus:border-red-500 focus:ring-red-200';

/** The one place to edit a donation: amount, method, allocation and receipt status. */
function EditDonation({ donation: d, onClose, onSaved }) {
  // In-kind gifts with items keep In-kind; others can't switch to In-kind (it needs items).
  const lockedInKind = d.payment_method === 'In-kind' && Boolean(d.items_summary);
  // Cash, or the method it already has (e.g. a donor-portal GCash donation). In-kind needs items.
  const methods = lockedInKind ? ['In-kind'] : [...new Set([...RECORD_METHODS.filter((m) => m !== 'In-kind' || d.payment_method === 'In-kind'), d.payment_method])];
  const [form, setForm] = useState({
    amount: String(d.amount ?? ''), payment_method: d.payment_method, allocation_notes: d.allocation_notes || '', receipt_issued: !!d.receipt_issued,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const inKind = form.payment_method === 'In-kind';

  const check = (f) => {
    const e = {};
    if (!inKind || String(f.amount).trim()) {
      if (!String(f.amount).trim()) e.amount = 'Amount is required.';
      else if (!(Number(f.amount) >= 0) || (!inKind && !(Number(f.amount) > 0))) e.amount = 'Enter an amount greater than 0.';
    }
    if (!f.allocation_notes.trim()) e.allocation_notes = 'Allocation is required.';
    return e;
  };
  const update = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (Object.keys(errors).length) { const fresh = check(next); setErrors(Object.fromEntries(Object.keys(errors).filter((k) => fresh[k]).map((k) => [k, fresh[k]]))); }
  };
  const submit = async (e) => {
    e.preventDefault();
    const found = check(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setError(null);
    try {
      const res = await api(`/donations/${d.donation_id}`, { method: 'PUT', body: {
        amount: inKind && !String(form.amount).trim() ? 0 : Number(form.amount), payment_method: form.payment_method,
        allocation_notes: form.allocation_notes.trim(), receipt_issued: form.receipt_issued,
      } });
      onSaved(res.data);
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Edit donation from ${d.donor_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-donation" loading={saving}>Save changes</Button></>}>
      <form id="edit-donation" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-500">{formatDateTime(d.created_at)} · <SourceBadge d={d} /></p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={inKind ? 'Estimated value (₱)' : 'Amount (₱)'} required={!inKind} error={errors.amount} hint={inKind ? 'Optional for in-kind gifts.' : undefined}>
            <input className={`input ${errors.amount ? badInput : ''}`} type="number" min="0" step="0.01" value={form.amount} onChange={(e) => update({ amount: e.target.value })} />
          </Field>
          <Field label="Method" required hint={lockedInKind ? 'Stays In-kind: its items were added to Inventory.' : undefined}>
            <select className="input" value={form.payment_method} disabled={lockedInKind} onChange={(e) => update({ payment_method: e.target.value })}>
              {methods.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        {d.items_summary && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><span className="font-medium text-navy-900">Items:</span> {d.items_summary}</p>}
        {!d.allocation_notes && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">This donation has no allocation yet. Add it to save changes or issue a receipt.</p>}
        <Field label="Allocation" required error={errors.allocation_notes} hint="How the donation will be used. Visible to the donor.">
          <textarea className={`input ${errors.allocation_notes ? badInput : ''}`} rows={3} maxLength={3000} value={form.allocation_notes} onChange={(e) => update({ allocation_notes: e.target.value })} />
        </Field>
        <label className={`flex items-center gap-2 text-sm ${d.status === 'Received' ? 'text-slate-700' : 'text-slate-400'}`}>
          <input type="checkbox" className="h-4 w-4 accent-brand" disabled={d.status !== 'Received'} checked={form.receipt_issued} onChange={(e) => update({ receipt_issued: e.target.checked })} />
          Receipt issued to the donor{d.status !== 'Received' && ' (available once received)'}
        </label>
      </form>
    </Modal>
  );
}

/** Portal = donor's own Donate page; Walk-in = any walk-in donor; Staff recorded = registered donor's gift entered by staff. */
const SOURCE_LABEL = { portal: 'Portal', walk_in: 'Walk-in', staff: 'Staff recorded' };
const SOURCE_TONE = { portal: 'blue', walk_in: 'green', staff: 'slate' };
const sourceGroup = (d) => (d.source === 'portal' ? 'portal' : d.donor_type === 'walk_in' ? 'walk_in' : 'staff');
function SourceBadge({ d }) {
  const g = sourceGroup(d);
  return <Badge tone={SOURCE_TONE[g]}>{SOURCE_LABEL[g]}</Badge>;
}

function ChildrenCell({ d }) {
  if (d.supported_children) return <span className="text-navy-900">{d.supported_children}</span>;
  if (d.is_general) return <Badge tone="slate">General</Badge>;
  return <span className="text-slate-400">-</span>;
}

function DonationDetail({ donation: d, onClose }) {
  const row = (label, value) => (
    <div className="grid grid-cols-3 gap-3 py-2">
      <dt className="text-slate-500">{label}</dt><dd className="col-span-2 text-navy-900">{value || <span className="text-slate-400">-</span>}</dd>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`Donation #${String(d.donation_id).padStart(6, '0')}`} footer={<Button onClick={onClose}>Close</Button>}>
      <dl className="divide-y divide-slate-100 text-sm">
        {row('Date', formatDateTime(d.created_at))}
        {row('Donor', d.donor_name)}
        {row('Amount', formatMoney(d.amount))}
        {row('Payment method', d.payment_method)}
        {row('Status', <Badge tone={DONATION_TONE[d.status]}>{d.status}</Badge>)}
        {d.reason_category && row('Reason (earlier form)', d.reason_category)}
        {d.reason_for_donation && row('Donor\'s note', d.reason_for_donation)}
        {row('Description', d.item_description)}
        {/* Only older donations were linked to specific children. */}
        {d.supported_children && row('Children supported', d.supported_children)}
        {row('Allocation', d.allocation_notes || <span className="font-medium text-amber-700">Allocation needed</span>)}
        {row('Source', <><SourceBadge d={d} /> <span className="text-xs text-slate-500">{d.source === 'visitors_page' ? 'recorded from a visit' : d.source === 'donations_page' ? 'recorded on the Donations page' : 'submitted by the donor'}</span></>)}
        {d.donor_type === 'walk_in' && row('Walk-in contact', d.walk_in_contact)}
        {d.linked_visit_time && row('Linked visit', formatDateTime(d.linked_visit_time))}
        {d.items_summary && row('Items', d.items_summary)}
        {row('Receipt', d.receipt_issued ? 'Receipt issued' : 'No receipt yet')}
        {d.submitted_by_donor ? row('Submitted', 'Submitted by donor') : null}
      </dl>
    </Modal>
  );
}

const DATE_OPTIONS = [
  { key: 'all', label: 'All dates' }, { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' }, { key: 'custom', label: 'Custom range' },
];
const SOURCE_OPTIONS = [{ key: '', label: 'All sources' }, { key: 'portal', label: 'Portal' }, { key: 'walk_in', label: 'Walk-in' }, { key: 'staff', label: 'Staff recorded' }];
const RECEIPT_OPTIONS = [{ key: '', label: 'Any' }, { key: 'issued', label: 'Issued' }, { key: 'not_issued', label: 'Not issued' }];
const DEFAULTS = { date: 'all', from: '', to: '', source: '', method: '', status: '', receipt: '' };
const STATUS_OPTIONS = ['Pending', 'Pending verification', 'Received', 'Rejected', 'Cancelled'];
const DONATION_TONE = { Pending: 'amber', 'Pending verification': 'amber', Received: 'green', Rejected: 'red', Cancelled: 'slate' };
const isDefault = (f) => Object.keys(DEFAULTS).every((k) => f[k] === DEFAULTS[k]);

export default function Donations() {
  const { user } = useAuth();
  const { query, toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  // ?source=walk_in&donation=ID (from the Visitors page) opens with that filter and that donation.
  const [f, setF] = useState(() => ({ ...DEFAULTS, source: SOURCE_LABEL[params.get('source')] ? params.get('source') : '' }));
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const rangeError = f.date === 'custom' && f.from && f.to && f.from > f.to ? 'From must be on or before To.' : null;
  const apiParams = {
    date: f.date,
    date_from: f.date === 'custom' ? f.from || undefined : undefined,
    date_to: f.date === 'custom' ? f.to || undefined : undefined,
    source: f.source || undefined, method: f.method || undefined, status: f.status || undefined, receipt: f.receipt || undefined, q: query,
  };
  const { data, loading, error, reload } = useApi(rangeError ? null : `/donations${qs(apiParams)}`);
  const methodList = useApi('/donations/methods').data?.data || [];
  const [confirmingStatus, setConfirmingStatus] = useState(null); // { donation, status }
  // Donor-portal donations arrive without an allocation: it is added when confirming receipt.
  const [confirmAllocation, setConfirmAllocation] = useState('');
  const [confirmAllocationError, setConfirmAllocationError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(null);

  const rows = data?.data || [];
  const summary = data?.summary || { count: 0, received_total: 0 };

  const linkedId = Number(params.get('donation')) || null;
  useEffect(() => {
    if (!linkedId || !data) return;
    const found = rows.find((d) => d.donation_id === linkedId);
    if (found) setViewing(found);
    setParams({}, { replace: true });
  }, [linkedId, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDonationStatus = async () => {
    setBusy('status');
    try {
      const needsAllocation = confirmingStatus.status === 'Received' && !confirmingStatus.donation.allocation_notes;
      if (needsAllocation && !confirmAllocation.trim()) { setConfirmAllocationError('Allocation is required.'); setBusy(null); return; }
      await api(`/donations/${confirmingStatus.donation.donation_id}/status`, { method: 'PUT', body: {
        status: confirmingStatus.status, allocation_notes: needsAllocation ? confirmAllocation.trim() : undefined,
      } });
      toast(confirmingStatus.status === 'Received' ? 'Donation marked as received. A receipt can now be issued.' : 'Donation cancelled.');
      setConfirmingStatus(null); reload();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const onCreated = (d) => {
    setAdding(false);
    toast(d.donor_type === 'walk_in' ? 'Walk-in donation recorded.' : 'Donation recorded. The donor can download the receipt from their portal.');
    reload();
  };
  const remove = async () => {
    setBusy('delete');
    try { const res = await api(`/donations/${deleting.donation_id}`, { method: 'DELETE' }); setDeleting(null); toast(res.message); reload(); }
    catch (err) { toast(err.message, 'error'); setDeleting(null); } finally { setBusy(null); }
  };
  const receipt = async (id) => {
    setBusy(id);
    try { await download(`/donations/${id}/receipt`, `CareSphere-Receipt-${String(id).padStart(6, '0')}.pdf`); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  const filtered = !isDefault(f);
  return (
    <>
      <PageHeader title="Donations" description="Every donation in one place: walk-in visitors, online gifts from donor accounts, and gifts recorded by staff."
        actions={<>
          <Button variant="secondary" onClick={() => setVerifying(true)}><ScanLine className="h-4 w-4" /> Verify receipt</Button>
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Record donation</Button>
        </>} />

      <BankTransferQueue onChanged={reload} />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Date">
            <select className="input h-10" value={f.date} onChange={(e) => set({ date: e.target.value })}>{DATE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
          </Field>
          <Field label="Source">
            <select className="input h-10" value={f.source} onChange={(e) => set({ source: e.target.value })}>{SOURCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
          </Field>
          <Field label="Method">
            <select className="input h-10" value={f.method} onChange={(e) => set({ method: e.target.value })}>
              <option value="">All methods</option>{methodList.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input h-10" value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All statuses</option>{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Receipt">
            <select className="input h-10" value={f.receipt} onChange={(e) => set({ receipt: e.target.value })}>{RECEIPT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
          </Field>
        </div>
        {f.date === 'custom' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="From" error={rangeError}><input className={`input h-10 ${rangeError ? badInput : ''}`} type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></Field>
            <Field label="To"><input className="input h-10" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm text-slate-500" aria-live="polite">
          <span>{summary.count} donation{summary.count === 1 ? '' : 's'} · received <span className="font-semibold text-navy-900">{formatMoney(summary.received_total)}</span></span>
          {filtered && <button type="button" className="ml-auto font-medium text-brand hover:underline" onClick={() => setF(DEFAULTS)}>Reset filters</button>}
        </div>
      </Card>

      <Card>
        {rangeError ? <div className="p-5 text-sm text-red-600">{rangeError}</div>
          : loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
            filtered || query
              ? <EmptyState icon={HandCoins} title="No donations match these filters" description="Try a wider date range or another source, or reset the filters." action={filtered ? <Button variant="secondary" onClick={() => setF(DEFAULTS)}>Reset filters</Button> : null} />
              : <EmptyState icon={HandCoins} title="No donations yet" action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Record donation</Button>} />
          ) : (
            <Table>
              <thead className="bg-slate-50"><tr>
                <th className="th">Date</th><th className="th">Donor</th><th className="th text-right">Amount</th>
                <th className="th">Method</th><th className="th">Status</th><th className="th">Source</th><th className="th">Children</th><th className="th">Allocation</th><th className="th"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <tr key={d.donation_id}>
                    <td className="td whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                    <td className="td"><p className="font-medium text-navy-900">{d.donor_name}</p>
                      {d.linked_visit_time && <p className="text-xs text-slate-500">Linked visit: {formatDateTime(d.linked_visit_time)}</p>}</td>
                    <td className="td text-right font-semibold tabular-nums">{formatMoney(d.amount)}</td>
                    <td className="td">{d.payment_method}{(d.items_summary || d.item_description) && <p className="text-xs text-slate-500">{d.items_summary || d.item_description}</p>}</td>
                    <td className="td"><Badge tone={DONATION_TONE[d.status]}>{d.status}</Badge>
                      {d.submitted_by_donor ? <p className="mt-0.5 text-xs text-slate-500">Submitted by donor</p> : null}</td>
                    <td className="td whitespace-nowrap"><SourceBadge d={d} />
                      <p className={`mt-0.5 text-xs ${d.receipt_issued ? 'text-emerald-700' : 'text-slate-500'}`}>{d.receipt_issued ? 'Receipt issued' : 'No receipt yet'}</p></td>
                    <td className="td max-w-xs text-xs"><ChildrenCell d={d} /></td>
                    <td className="td max-w-xs">{d.allocation_notes || (['Pending verification', 'Rejected'].includes(d.status) ? <span className="text-xs text-slate-400">Set when confirmed</span> : <Badge tone="amber">Allocation needed</Badge>)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        {d.status === 'Pending' && <>
                          <Button size="sm" onClick={() => { setConfirmAllocation(''); setConfirmAllocationError(null); setConfirmingStatus({ donation: d, status: 'Received' }); }}>Mark received</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmingStatus({ donation: d, status: 'Cancelled' })}>Cancel</Button>
                        </>}
                        <Button size="sm" variant="ghost" aria-label="View details" title="View details" onClick={() => setViewing(d)}><Eye className="h-4 w-4" /></Button>
                        {d.status !== 'Pending verification' && <Button size="sm" variant="ghost" aria-label="Edit donation" title="Edit donation" onClick={() => setEditing(d)}><Pencil className="h-4 w-4" /></Button>}
                        {d.status === 'Received' && (d.allocation_notes
                          ? <Button size="sm" variant="ghost" aria-label="Download receipt" title="Download receipt" loading={busy === d.donation_id} onClick={() => receipt(d.donation_id)}><Download className="h-4 w-4" /></Button>
                          : <Button size="sm" variant="ghost" aria-label="Add allocation to issue a receipt" title="Add the allocation to issue a receipt" onClick={() => setEditing(d)}><Download className="h-4 w-4 text-slate-300" /></Button>)}
                        {isAdmin && <Button size="sm" variant="ghost" aria-label="Delete" className="text-red-600" onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      {adding && <DonationForm onClose={() => setAdding(false)} onSaved={onCreated} />}
      {viewing && <DonationDetail donation={viewing} onClose={() => setViewing(null)} />}
      {editing && <EditDonation donation={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Donation updated.'); reload(); }} />}
      <VerifyReceiptModal open={verifying} onClose={() => setVerifying(false)} />
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy === 'delete'}
        title="Delete this donation?"
        message={deleting ? `${deleting.visit_id ? 'The linked visit stays as "Just visited". ' : ''}${deleting.items_summary ? 'Its items will be taken back out of Inventory. ' : ''}The donor loses this record and its receipt. This cannot be undone.` : ''} />
      {confirmingStatus?.status === 'Received' && !confirmingStatus.donation.allocation_notes ? (
        <Modal open onClose={() => setConfirmingStatus(null)} title="Mark donation as received?"
          footer={<><Button variant="secondary" onClick={() => setConfirmingStatus(null)}>Back</Button><Button loading={busy === 'status'} onClick={setDonationStatus}>Mark received</Button></>}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Confirm that {formatMoney(confirmingStatus.donation.amount)} from {confirmingStatus.donation.donor_name} has actually been received, and record how it will be used.</p>
            <Field label="Allocation" required error={confirmAllocationError} hint="How the donation will be used. Visible to the donor.">
              <textarea className={`input ${confirmAllocationError ? badInput : ''}`} rows={3} maxLength={3000} value={confirmAllocation}
                onChange={(e) => { setConfirmAllocation(e.target.value); setConfirmAllocationError(null); }} />
            </Field>
          </div>
        </Modal>
      ) : (
      <ConfirmModal open={!!confirmingStatus} onClose={() => setConfirmingStatus(null)} loading={busy === 'status'} onConfirm={setDonationStatus}
        title={confirmingStatus?.status === 'Received' ? 'Mark donation as received?' : 'Cancel this donation?'}
        confirmLabel={confirmingStatus?.status === 'Received' ? 'Mark received' : 'Cancel donation'}
        message={confirmingStatus ? (confirmingStatus.status === 'Received'
          ? `Confirm that ${formatMoney(confirmingStatus.donation.amount)} from ${confirmingStatus.donation.donor_name} has actually been received. A receipt can then be issued.`
          : `Are you sure you want to cancel the pending donation from ${confirmingStatus.donation.donor_name}?`) : ''} />
      )}
    </>
  );
}
