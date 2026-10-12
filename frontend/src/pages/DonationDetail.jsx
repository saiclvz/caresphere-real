import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Download, FileText, Pencil, Upload } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Skeleton, Table } from '../components/ui';
import DocumentViewer from '../components/DocumentViewer';
import AllocationEditor, { allocationBody } from '../components/donations/AllocationEditor';
import { checkFile, readFile, MB } from '../lib/files';
import { typeMethod } from '../lib/donations';
import { formatDate, formatDateTime, formatMoney, isoDate } from '../lib/format';
import { AllocationCell, AmountCell, SourceChip, StatusBadge, VoidDialog } from './Donations';
import NotFound from './NotFound';

const TABS = [['overview', 'Overview'], ['donor', 'Donor'], ['items', 'Items'], ['inventory', 'Inventory'], ['utilization', 'Utilization'], ['documents', 'Documents'], ['timeline', 'Timeline'], ['audit', 'Audit']];
const Row = ({ label, children }) => <div className="grid grid-cols-3 gap-3 py-2 text-sm"><dt className="text-slate-500">{label}</dt><dd className="col-span-2 text-navy-900">{children ?? <span className="text-slate-400">-</span>}</dd></div>;

function Stepper({ steps }) {
  return (
    <nav aria-label="Donation status" className="relative mb-4 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1">
            <span aria-current={s.state === 'current' ? 'step' : undefined} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              s.state === 'completed' ? 'bg-emerald-50 text-emerald-800' : s.state === 'current' ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {s.state === 'completed' ? <Check className="h-3 w-3" aria-hidden /> : <span aria-hidden>{i + 1}</span>} {s.label}
              <span className="sr-only">({s.state})</span>
            </span>
            {i < steps.length - 1 && <span className="h-px w-3 bg-slate-300" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A small form runner: busy state, field errors from the server, success message, reload. */
function useAction(d, reload) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const run = async (key, path, method, body, msg) => {
    setBusy(key); setErrors({}); setError(null);
    try { const r = await api(`/donations/${d.donation_id}${path}`, { method, body }); toast(r.message || msg || 'Saved.'); reload(); return true; }
    catch (err) { if (err.details?.errors) setErrors(err.details.errors); setError(err); return false; } finally { setBusy(null); }
  };
  return { busy, errors, error, run, setError };
}

function AllocationModal({ d, programs, onClose, reload }) {
  const acked = d.can_correct;
  const [lines, setLines] = useState(() => (d.allocation.length ? d.allocation.map((l) => ({ program: l.needs_review ? '' : l.program, amount: l.amount ?? '', intended_use: l.needs_review ? String(l.intended_use || '').replace(/^Other: /, '') : (l.intended_use || '') })) : [{ program: d.purpose || '', amount: d.in_kind ? '' : d.amount, intended_use: '' }]));
  const [purpose, setPurpose] = useState(d.purpose || '');
  const [reason, setReason] = useState('');
  const a = useAction(d, reload);
  const save = async () => { if (await a.run('save', '/allocation', 'PUT', { lines: allocationBody(lines, d.in_kind), purpose: purpose || undefined, reason: reason || undefined }, 'Allocation saved.')) onClose(); };
  return (
    <Modal open onClose={onClose} size="lg" title={`Allocation for ${d.donation_no}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={a.busy === 'save'} onClick={save}>Save allocation</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={a.error && !Object.keys(a.errors).length ? a.error : null} />
        {d.allocation.some((l) => l.needs_review) && (
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />The earlier text could not be matched to a program: {d.allocation.filter((l) => l.original_text).map((l) => `"${l.original_text}"`).join(', ')}. Choose the program(s) below. The original text is kept.</p>
        )}
        <Field label="Purpose"><select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}><option value="">Keep as it is</option>{programs.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <AllocationEditor lines={lines} onChange={setLines} inKind={d.in_kind} amount={d.amount} programs={programs} errors={a.errors} idPrefix="detail-alloc" />
        {acked && <Field label="Reason for the correction" required error={a.errors.reason} hint="The donation is acknowledged, so this change is recorded as a correction."><input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

function CorrectionModal({ d, programs, onClose, reload }) {
  const [v, setV] = useState({ field: d.in_kind ? 'purpose' : 'amount', value: '', reason: '' });
  const a = useAction(d, reload);
  const save = async () => { if (await a.run('save', '/corrections', 'POST', v)) onClose(); };
  return (
    <Modal open onClose={onClose} size="sm" title="Make a correction"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={a.busy === 'save'} onClick={save}>Record correction</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={a.error && !Object.keys(a.errors).length ? a.error : null} />
        <p className="text-xs text-slate-500">The donation is acknowledged, so it isn't edited: each change is a correction entry with the old value, the new value and the reason.</p>
        <Field label="What to correct"><select className="input" value={v.field} onChange={(e) => setV({ ...v, field: e.target.value, value: '' })}>
          {!d.in_kind && <option value="amount">Amount</option>}<option value="purpose">Purpose</option>{!d.in_kind && <option value="payment_method">Method</option>}
        </select></Field>
        <Field label="New value" required error={a.errors.value}>
          {v.field === 'purpose' ? <select className="input" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })}><option value="">Choose...</option>{programs.map((p) => <option key={p}>{p}</option>)}</select>
            : <input className="input" type={v.field === 'amount' ? 'number' : 'text'} min="0.01" step="0.01" maxLength={60} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />}
        </Field>
        <Field label="Reason" required error={a.errors.reason}><input className="input" maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ItemValueModal({ d, line, onClose, reload }) {
  const [v, setV] = useState({ estimated_value: line.estimated_value ?? '', expiry_date: line.expiry_date ? String(line.expiry_date).slice(0, 10) : '', item_condition: line.item_condition || '', reason: '' });
  const a = useAction(d, reload);
  const needsReason = d.can_correct && line.estimated_value !== null;
  const save = async () => { if (await a.run('save', `/items/${line.line_id}`, 'PUT', { ...v, estimated_value: v.estimated_value === '' ? null : Number(v.estimated_value) }, 'Item saved.')) onClose(); };
  return (
    <Modal open onClose={onClose} size="sm" title={`${line.item_name} x${line.quantity}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={a.busy === 'save'} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={a.error && !Object.keys(a.errors).length ? a.error : null} />
        <Field label="Estimated value of the line (₱)" error={a.errors.estimated_value} hint="An estimate: shown as estimated and never added to cash."><input className="input" type="number" min="0.01" step="0.01" value={v.estimated_value} onChange={(e) => setV({ ...v, estimated_value: e.target.value })} /></Field>
        <Field label="Expiry date"><input className="input" type="date" value={v.expiry_date} onChange={(e) => setV({ ...v, expiry_date: e.target.value })} /></Field>
        <Field label="Condition"><select className="input" value={v.item_condition} onChange={(e) => setV({ ...v, item_condition: e.target.value })}><option value="">Not recorded</option>{['New', 'Good', 'Fair', 'Damaged'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        {needsReason && <Field label="Reason for the correction" required error={a.errors.reason}><input className="input" maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

function Overview({ d, isAdmin, reload, onAllocation, onCorrection, onVoid }) {
  const a = useAction(d, reload);
  const pendingVoid = d.void_requests.find((r) => r.status === 'Pending');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h3 className="mb-1 font-semibold text-navy-900">Details</h3>
        <dl className="divide-y divide-slate-100">
          <Row label="Type and method">{typeMethod(d)}</Row>
          <Row label="Amount or value"><AmountCell d={d} linkToItems={false} /></Row>
          <Row label="Purpose">{d.purpose}</Row>
          <Row label="Description">{d.item_description}</Row>
          {d.reason_for_donation && <Row label="Donor's note">{d.reason_for_donation}</Row>}
          <Row label="Recorded">{formatDateTime(d.created_at)}</Row>
          <Row label="Received">{d.received_at ? formatDateTime(d.received_at) : null}</Row>
          {d.visit && <Row label="Linked visit">{formatDateTime(d.visit.check_in_time)}</Row>}
          {d.payment && <Row label="Payment">{d.payment.method_name}{d.payment.transfer_reference ? ` · reference ${d.payment.transfer_reference}` : ''}{d.payment.transfer_date ? ` · ${formatDate(d.payment.transfer_date)}` : ''}</Row>}
          <Row label="Receipt code"><span className="break-all font-mono text-xs">{d.qr_receipt_code}</span></Row>
          {d.status === 'Voided' && <Row label="Voided"><span className="text-red-700">{d.void_reason}{d.void_note ? `: ${d.void_note}` : ''}</span> · {formatDateTime(d.voided_at)}</Row>}
        </dl>
      </Card>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-semibold text-navy-900">Allocation</h3>
            {d.status !== 'Voided' && !['Rejected', 'Closed'].includes(d.status) && <Button size="sm" variant="secondary" onClick={onAllocation}><Pencil className="h-3.5 w-3.5" aria-hidden /> {d.allocation.length ? 'Change allocation' : 'Add allocation'}</Button>}</div>
          <AllocationCell d={d} />
          {d.allocation_problems.length > 0 && d.status !== 'Voided' && <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{d.allocation_problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {d.legacy_allocation && <p className="mt-2 text-xs text-slate-500">Original text (kept): "{d.legacy_allocation}"</p>}
        </Card>
        {pendingVoid && (
          <Card className="border-amber-200 p-4">
            <h3 className="font-semibold text-navy-900">Void requested</h3>
            <p className="text-sm text-slate-600">{pendingVoid.requested_by_name}, {formatDateTime(pendingVoid.requested_at)}: {pendingVoid.reason}{pendingVoid.note ? ` (${pendingVoid.note})` : ''}</p>
            {isAdmin && <div className="mt-2 flex gap-2"><Button size="sm" variant="danger" onClick={onVoid}>Approve and void</Button>
              <Button size="sm" variant="secondary" loading={a.busy === 'decline'} onClick={() => a.run('decline', '/void-request/decline', 'POST', { note: 'Declined' })}>Decline</Button></div>}
          </Card>
        )}
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-semibold text-navy-900">Corrections</h3>
            {d.can_correct && <Button size="sm" variant="secondary" onClick={onCorrection}>Make a correction</Button>}</div>
          {d.corrections.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
            <ul className="space-y-1 text-sm">{d.corrections.map((c) => <li key={c.correction_id}><span className="font-medium text-navy-900">{c.field}</span>: {c.old_value ?? '-'} → {c.new_value ?? '-'} · {c.reason} <span className="text-xs text-slate-500">({c.made_by_name}, {formatDateTime(c.made_at)})</span></li>)}</ul>
          )}
        </Card>
      </div>
      <ErrorNote error={a.error} />
    </div>
  );
}

function DonorTab({ d }) {
  const x = d.donor;
  return (
    <Card className="p-4">
      <dl className="divide-y divide-slate-100">
        <Row label="Donor">{x.display}</Row>
        <Row label="Donor code">{x.anonymous ? 'Hidden (anonymous)' : <span className="font-mono">{x.code}</span>}</Row>
        <Row label="Type">{x.anonymous ? 'Anonymous' : x.kind}</Row>
        <Row label="Source"><SourceChip group={x.source} /> {x.registered ? <span className="text-xs text-slate-500">donor account</span> : null}</Row>
        {x.contact_masked && <Row label="Contact">{x.contact_masked} <span className="text-xs text-slate-500">(reveal it on the donor profile)</span></Row>}
        {x.recorded_name && <Row label="Recorded name (Admin only)">{x.recorded_name}</Row>}
      </dl>
      {x.masked && <p className="mt-2 text-xs text-slate-500">Donor names and contact details need the Donor directory duty.</p>}
      {!x.masked && !x.anonymous && x.ref_id && <Link to={`/donors/${x.ref_id}`} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Open donor profile</Link>}
    </Card>
  );
}

function ItemsTab({ d, onEdit }) {
  if (!d.in_kind) return <EmptyState title="Cash donation" description="Items are recorded for in-kind donations only." />;
  if (!d.items.length) return <EmptyState title="No items recorded" description="This in-kind donation has no item lines yet." />;
  return (
    <Card>
      <Table label="Donated items">
        <thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Quantity</th><th className="th text-right">Left</th><th className="th">Expiry</th><th className="th">Condition</th><th className="th text-right">Estimated value</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {d.items.map((l) => (
            <tr key={l.line_id}>
              <td className="td">{l.item_name}{l.inventory_name && l.inventory_name !== l.item_name && <p className="text-xs text-slate-500">Stock: {l.inventory_name}</p>}{!l.inventory_item_id && <p className="text-xs text-slate-500">Not linked to stock</p>}</td>
              <td className="td text-right tabular-nums">{l.quantity}</td>
              <td className="td text-right tabular-nums">{l.inventory_item_id ? l.remaining : '-'}</td>
              <td className="td">{l.expiry_date ? formatDate(l.expiry_date) : '-'}</td>
              <td className="td">{l.item_condition || '-'}</td>
              <td className="td text-right">{l.estimated_value !== null ? <span className="tabular-nums">{formatMoney(l.estimated_value)} <span className="text-xs text-slate-500">estimated</span></span> : <span className="text-xs text-amber-800">Value not set</span>}</td>
              <td className="td text-right">{d.status !== 'Voided' && <Button size="sm" variant="secondary" onClick={() => onEdit(l)}>{l.estimated_value === null ? 'Add value' : 'Edit'}<span className="sr-only"> for {l.item_name}</span></Button>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function InventoryTab({ d, programs, reload }) {
  const lines = d.items.filter((l) => l.inventory_item_id && l.remaining > 0);
  const [v, setV] = useState({ line_id: lines[0]?.line_id ? String(lines[0].line_id) : '', quantity: '', program: d.purpose || '', used_on: isoDate(), note: '' });
  const a = useAction(d, reload);
  const line = d.items.find((l) => String(l.line_id) === v.line_id);
  const can = ['Allocated', 'Partially distributed'].includes(d.status);
  if (!d.in_kind) return <EmptyState title="Cash donation" description="Cash donations have no inventory. Record how the money was used under Utilization." />;
  return (
    <div className="space-y-4">
      <Card>
        <h3 className="px-4 pt-4 font-semibold text-navy-900">Lots from this donation</h3>
        {d.lots.length === 0 ? <p className="p-4 text-sm text-slate-500">No lots: this donation's items aren't linked to stock.</p> : (
          <Table label="Lots"><thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Received</th><th className="th text-right">Left</th><th className="th">Expiry</th><th className="th">Received on</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.lots.map((l) => <tr key={l.lot_id}><td className="td">{l.item_name}</td><td className="td text-right">{l.received_qty}</td><td className="td text-right">{l.remaining_qty}</td><td className="td">{l.expiry_date ? formatDate(l.expiry_date) : '-'}</td><td className="td">{formatDate(l.received_at)}</td></tr>)}</tbody>
          </Table>
        )}
      </Card>
      <Card>
        <h3 className="px-4 pt-4 font-semibold text-navy-900">Stock in and out</h3>
        {d.movements.length === 0 ? <p className="p-4 text-sm text-slate-500">No stock movements.</p> : (
          <Table label="Stock movements"><thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Item</th><th className="th">Kind</th><th className="th text-right">Change</th><th className="th">By</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.movements.map((m) => (
              <tr key={m.movement_id}><td className="td whitespace-nowrap text-xs">{formatDateTime(m.created_at)}</td><td className="td">{m.item_name}</td>
                <td className="td"><Badge tone={m.change_qty > 0 ? 'green' : 'slate'}>{m.change_qty > 0 ? 'IN' : 'OUT'}</Badge> <span className="text-xs text-slate-500">{({ donation_in: 'donation received', distribution_out: 'distributed', void_reversal: 'void reversal', donation_reversal: 'reversal', correction: 'correction', manual_edit: 'manual edit' })[m.movement_type] || m.movement_type}</span></td>
                <td className="td text-right tabular-nums">{m.change_qty > 0 ? `+${m.change_qty}` : m.change_qty}</td><td className="td text-xs">{m.by_name || '-'}</td></tr>))}</tbody>
          </Table>
        )}
      </Card>
      <Card className="space-y-3 p-4">
        <h3 className="font-semibold text-navy-900">Record distribution</h3>
        {!can ? <p className="text-sm text-slate-500">{d.status === 'Voided' ? 'Voided donations are not distributed.' : 'Available once the allocation is confirmed (status Allocated).'}</p> : lines.length === 0 ? <p className="text-sm text-slate-500">Nothing left to distribute.</p> : (
          <>
            <ErrorNote error={a.error && !Object.keys(a.errors).length ? a.error : null} />
            <p className="text-xs text-slate-500">Taken from this donation's lots with the earliest expiry first. The quantity can't be more than what is left.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Item" required error={a.errors.line_id}><select className="input" value={v.line_id} onChange={(e) => setV({ ...v, line_id: e.target.value })}>{lines.map((l) => <option key={l.line_id} value={l.line_id}>{l.item_name} ({l.remaining} left)</option>)}</select></Field>
              <Field label="Quantity" required error={a.errors.quantity}><input className="input" type="number" min="1" max={line?.remaining} step="1" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} /></Field>
              <Field label="Program" required error={a.errors.program}><select className="input" value={v.program} onChange={(e) => setV({ ...v, program: e.target.value })}><option value="">Choose...</option>{programs.map((p) => <option key={p}>{p}</option>)}</select></Field>
              <Field label="Date" required error={a.errors.used_on}><input className="input" type="date" max={isoDate()} value={v.used_on} onChange={(e) => setV({ ...v, used_on: e.target.value })} /></Field>
            </div>
            <Field label="What it was used for" hint="Never a child's name."><input className="input" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
            <Button loading={a.busy === 'dist'} onClick={async () => { if (await a.run('dist', '/distributions', 'POST', { ...v, line_id: Number(v.line_id), quantity: Number(v.quantity) }, 'Distribution recorded.')) setV({ ...v, quantity: '', note: '' }); }}>Record distribution</Button>
          </>
        )}
      </Card>
    </div>
  );
}

function UtilizationTab({ d, programs, reload }) {
  const t = d.distribution_totals;
  const [v, setV] = useState({ amount: '', program: d.purpose || '', used_on: isoDate(), note: '' });
  const a = useAction(d, reload);
  const can = !d.in_kind && ['Allocated', 'Partially distributed'].includes(d.status);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm text-slate-600">{d.in_kind ? `${t.used} of ${t.total} items distributed.` : `${formatMoney(t.used)} of ${formatMoney(t.total)} used · ${formatMoney(Math.max(0, t.total - t.used))} left.`}</p>
        {d.distributions.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing recorded yet.</p> : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">{d.distributions.map((x) => (
            <li key={x.distribution_id} className="py-2"><span className="font-medium text-navy-900">{x.kind === 'utilization' ? formatMoney(x.amount) : `${x.item_name} x${x.quantity}`}</span> · {x.program} · {formatDate(x.used_on)}{x.note ? ` · ${x.note}` : ''} <span className="text-xs text-slate-500">({x.recorded_by_name})</span></li>
          ))}</ul>
        )}
      </Card>
      {!d.in_kind && (
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold text-navy-900">Record utilization</h3>
          {!can ? <p className="text-sm text-slate-500">{d.status === 'Voided' ? 'Voided donations are not used.' : 'Available once the allocation is confirmed (status Allocated).'}</p> : (
            <>
              <ErrorNote error={a.error && !Object.keys(a.errors).length ? a.error : null} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Amount used (₱)" required error={a.errors.amount}><input className="input" type="number" min="0.01" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
                <Field label="Program" required error={a.errors.program}><select className="input" value={v.program} onChange={(e) => setV({ ...v, program: e.target.value })}><option value="">Choose...</option>{programs.map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Date" required error={a.errors.used_on}><input className="input" type="date" max={isoDate()} value={v.used_on} onChange={(e) => setV({ ...v, used_on: e.target.value })} /></Field>
              </div>
              <Field label="What it paid for" hint="Never a child's name."><input className="input" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
              <Button loading={a.busy === 'use'} onClick={async () => { if (await a.run('use', '/utilization', 'POST', { ...v, amount: Number(v.amount) }, 'Utilization recorded.')) setV({ ...v, amount: '', note: '' }); }}>Record utilization</Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function DocumentsTab({ d, options, reload, onView }) {
  const { toast } = useApp();
  const a = useAction(d, reload);
  const [reason, setReason] = useState('');
  const [up, setUp] = useState({ kind: 'delivery_receipt', label: '', file: null, no_children: false });
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const latest = d.acknowledgments[d.acknowledgments.length - 1];
  const upload = async () => {
    const p = checkFile(up.file, { types: up.kind === 'photo' ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: 10 * MB })
      || (up.kind === 'photo' && !up.no_children ? 'Confirm that the photo shows no children.' : null);
    setProblem(p);
    if (p) return;
    setBusy(true);
    try {
      const f = await readFile(up.file);
      await api(`/donations/${d.donation_id}/documents`, { method: 'POST', body: { kind: up.kind, label: up.label || undefined, no_children: up.no_children, file: { name: f.name, data: f.data } } });
      toast('Document uploaded.'); setUp({ kind: up.kind, label: '', file: null, no_children: false }); reload();
    } catch (err) { setProblem(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="font-semibold text-navy-900">Acknowledgment</h3>
        <ErrorNote error={a.error && !Object.keys(a.errors).length ? a.error : null} />
        {d.acknowledgments.length === 0 ? <p className="text-sm text-slate-600">{d.status === 'Accepted' && !d.allocation_problems.length ? 'Not issued yet.' : d.status === 'Accepted' ? 'Not issued yet. Fix the allocation first (see the Overview tab).' : 'Issued once the donation is accepted (the allocation is required first).'}</p> : (
          <ul className="space-y-1 text-sm">{d.acknowledgments.map((k) => <li key={k.ack_id}>Version {k.version} · {formatDateTime(k.issued_at)}{k.issued_by_name ? ` · ${k.issued_by_name}` : ''}{k.reissue_reason ? ` · reissued: ${k.reissue_reason}` : ''}</li>)}</ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          {d.status === 'Accepted' && !latest && !d.allocation_problems.length && <Button loading={a.busy === 'ack'} onClick={() => a.run('ack', '/acknowledgment', 'POST', {}, 'Acknowledgment issued.')}>Generate acknowledgment</Button>}
          {latest && d.status !== 'Voided' && <>
            <Button variant="secondary" onClick={() => download(`/donations/${d.donation_id}/receipt`, `CareSphere-Acknowledgment-${d.donation_no}.pdf`).catch((e) => toast(e.message, 'error'))}><Download className="h-4 w-4" aria-hidden /> Download</Button>
            <Field label="Reason to reissue" error={a.errors.reason} className="min-w-[14rem] flex-1"><input className="input" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button variant="secondary" loading={a.busy === 'reissue'} onClick={() => a.run('reissue', '/acknowledgment', 'POST', { reason }, 'Acknowledgment reissued.')}>Reissue</Button>
          </>}
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        <h3 className="font-semibold text-navy-900">Documents</h3>
        {d.payment?.has_proof && <p className="text-sm"><button type="button" className="font-medium text-brand hover:underline" onClick={() => onView({ label: 'Proof of transfer (from the donor)', path: `/payments/${d.payment.payment_id}/proof` })}>Proof of transfer from the donor</button></p>}
        {d.documents.length === 0 ? <p className="text-sm text-slate-500">No documents uploaded.</p> : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{d.documents.map((x) => (
            <li key={x.document_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-400" aria-hidden /><span><span className="font-medium text-navy-900">{x.label}</span> <span className="text-xs text-slate-500">{options.document_kinds?.[x.kind]} · {x.uploaded_by_name}, {formatDate(x.uploaded_at)}</span></span></span>
              <Button size="sm" variant="secondary" onClick={() => onView({ label: x.label, path: `/donations/${d.donation_id}/documents/${x.document_id}` })}>View<span className="sr-only"> {x.label}</span></Button>
            </li>))}</ul>
        )}
        {d.status !== 'Voided' && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <Field label="Kind" className="w-48"><select className="input" value={up.kind} onChange={(e) => setUp({ ...up, kind: e.target.value })}>{Object.entries(options.document_kinds || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Label" className="min-w-[10rem] flex-1"><input className="input" maxLength={150} value={up.label} onChange={(e) => setUp({ ...up, label: e.target.value })} /></Field>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 hover:bg-brand-50">
              <Upload className="h-4 w-4" aria-hidden /> {up.file ? up.file.name.slice(0, 24) : 'Choose file'}
              <input type="file" className="sr-only" accept={up.kind === 'photo' ? 'image/jpeg,image/png' : 'application/pdf,image/jpeg,image/png'} onChange={(e) => setUp({ ...up, file: e.target.files?.[0] || null })} />
            </label>
            {up.kind === 'photo' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={up.no_children} onChange={(e) => setUp({ ...up, no_children: e.target.checked })} /> The photo shows no children</label>}
            <Button size="sm" variant="secondary" loading={busy} onClick={upload}>Upload</Button>
            {problem && <p className="w-full text-xs text-red-700" role="alert">{problem}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

const NEXT_TO = { Received: 'Received', 'Under inspection': 'Under inspection', Accepted: 'Accepted', Allocated: 'Allocated', Closed: 'Closed' };

export default function DonationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const setTab = (k) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); return n; }, { replace: true });
  const { data, loading, error, reload } = useApi(`/donations/${id}`);
  const options = useApi('/donations/options').data?.data || { programs: [], void_reasons: [], document_kinds: {} };
  const [modal, setModal] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (error?.status === 404) return <NotFound />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  const d = data.data;
  const step = async (to, note) => {
    setBusy(true);
    try { await api(`/donations/${d.donation_id}/status`, { method: 'POST', body: { to, note } }); toast(`Status: ${to}.`); reload(); }
    catch (err) { toast(err.message, 'error'); if (err.details?.problems) setModal('allocation'); } finally { setBusy(false); }
  };
  const next = d.next_action;
  const doNext = async () => {
    if (!next) return;
    if (next.key === 'verify_transfer') return navigate('/donations');
    if (next.key === 'allocation') return setModal('allocation');
    if (next.key === 'acknowledge') {
      setBusy(true);
      try { await api(`/donations/${d.donation_id}/acknowledgment`, { method: 'POST', body: {} }); toast('Acknowledgment issued.'); reload(); }
      catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
      return;
    }
    if (next.key === 'distribute') return setTab('inventory');
    if (next.key === 'utilize') return setTab('utilization');
    if (NEXT_TO[next.key]) return step(NEXT_TO[next.key]);
  };
  const shownTabs = TABS.filter(([k]) => k !== 'audit' || isAdmin);
  return (
    <>
      <DocumentViewer open={Boolean(viewing)} title={viewing?.label} path={viewing?.path} onClose={() => setViewing(null)} />
      <Link to="/donations" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Donations</Link>
      <div className="mb-4 mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold text-navy-900">{d.donation_no}</h1>
            <StatusBadge status={d.status} />
            <Badge tone="slate">{d.in_kind ? 'In-kind' : 'Cash'}</Badge>
            {d.void_requested && d.status !== 'Voided' && <Badge tone="amber">Void requested</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">{d.donor.display} · {d.received_at ? `received ${formatDate(d.received_at)}` : `recorded ${formatDate(d.created_at)}`} · <AmountCell d={d} linkToItems={false} /></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {next && d.status !== 'Voided' && <Button loading={busy} onClick={doNext}>{next.label}</Button>}
          {(d.allowed || []).includes('Rejected') && <Button variant="secondary" onClick={() => setRejecting(true)}>Reject</Button>}
          {(d.can_void || d.can_request_void) && <Button variant="ghost" className="text-red-700" onClick={() => setModal('void')}>{isAdmin ? 'Void' : 'Request a void'}</Button>}
        </div>
      </div>
      {d.status === 'Voided' && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="status">Voided: {d.void_reason}{d.void_note ? ` (${d.void_note})` : ''}. It stays on record and is left out of every total.</p>}
      <Stepper steps={d.stepper} />
      <div role="tablist" aria-label="Donation sections" className="relative mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {shownTabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} id={`dtab-${k}`} aria-controls={`dpanel-${k}`} onClick={() => setTab(k)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === k ? 'border-brand text-navy-900' : 'border-transparent text-slate-500 hover:text-navy-900'}`}>{l}</button>
        ))}
      </div>
      <div role="tabpanel" id={`dpanel-${tab}`} aria-labelledby={`dtab-${tab}`}>
        {tab === 'overview' && <Overview d={d} isAdmin={isAdmin} reload={reload} onAllocation={() => setModal('allocation')} onCorrection={() => setModal('correction')} onVoid={() => setModal('void')} />}
        {tab === 'donor' && <DonorTab d={d} />}
        {tab === 'items' && <ItemsTab d={d} onEdit={(l) => setModal({ item: l })} />}
        {tab === 'inventory' && <InventoryTab d={d} programs={options.programs} reload={reload} />}
        {tab === 'utilization' && <UtilizationTab d={d} programs={options.programs} reload={reload} />}
        {tab === 'documents' && <DocumentsTab d={d} options={options} reload={reload} onView={setViewing} />}
        {tab === 'timeline' && (
          <Card className="p-4">
            <ol className="space-y-3 border-l border-slate-200 pl-4">{d.timeline.map((h) => (
              <li key={h.history_id} className="text-sm"><p className="text-navy-900">{h.from_status ? `${h.from_status} → ` : ''}<span className="font-medium">{h.to_status}</span>{h.note ? ` · ${h.note}` : ''}</p><p className="text-xs text-slate-500">{h.actor_name || 'System'} · {formatDateTime(h.created_at)}</p></li>
            ))}</ol>
            <p className="mt-3 text-xs text-slate-500">The status history can't be edited.</p>
          </Card>
        )}
        {tab === 'audit' && isAdmin && (
          <Card>{(d.audit || []).length === 0 ? <p className="p-4 text-sm text-slate-500">No entries.</p> : (
            <Table label="Audit"><thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{d.audit.map((x) => <tr key={x.log_id}><td className="td whitespace-nowrap text-xs">{formatDateTime(x.created_at)}</td><td className="td text-sm">{x.user_name} <span className="text-xs text-slate-500">({x.user_role})</span></td><td className="td font-mono text-xs">{x.action_performed}</td></tr>)}</tbody>
            </Table>)}</Card>
        )}
      </div>
      {modal === 'allocation' && <AllocationModal d={d} programs={options.programs} onClose={() => setModal(null)} reload={reload} />}
      {modal === 'correction' && <CorrectionModal d={d} programs={options.programs} onClose={() => setModal(null)} reload={reload} />}
      {modal === 'void' && <VoidDialog d={d} options={options} isAdmin={isAdmin} onClose={() => setModal(null)} onDone={(m) => { setModal(null); toast(m); reload(); }} />}
      {modal?.item && <ItemValueModal d={d} line={modal.item} onClose={() => setModal(null)} reload={reload} />}
      <Modal open={rejecting} onClose={() => setRejecting(false)} size="sm" title={`Reject ${d.donation_no}?`}
        footer={<><Button variant="secondary" onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={async () => { await step('Rejected', rejectNote.trim()); setRejecting(false); }}>Reject</Button></>}>
        <Field label="Reason" required hint="For example, the items were not usable."><textarea className="input" rows={2} maxLength={255} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
