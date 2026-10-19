import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, Boxes, FileSpreadsheet, History, Minus, Pencil, Plus, RotateCcw } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, Notice, PageHeader, Spinner, Table, IconButton, TAB_ROW, tabClass } from '../components/ui';
import { formatDateTime } from '../lib/format';

const EMPTY = { item_name: '', category: '', quantity: 0, min_threshold: 5, is_needed_by_donors: false };
const CATEGORIES = ['Food', 'Hygiene', 'Medical', 'Clothing', 'School supplies', 'Cleaning'];
const TYPE_TONE = { stock_in: 'green', stock_out: 'amber', adjustment: 'blue', disposal: 'red' };
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Quantity with - and +. Nothing changes silently: each button opens the stock movement dialog (Stock out or
 * Stock in, quantity 1) where the reason is chosen; the server records the movement and the new quantity.
 */
function QuantityControl({ item, onMove }) {
  const btnCls = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-navy-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={`Quantity of ${item.item_name}`}>
      <button type="button" className={btnCls} onClick={() => onMove(item, 'stock_out')} disabled={item.quantity <= 0} aria-label={`Remove stock of ${item.item_name}`}><Minus className="h-3.5 w-3.5" aria-hidden /></button>
      <span className="min-w-[2.5rem] text-center font-semibold tabular-nums text-navy-900">{item.quantity}</span>
      <button type="button" className={btnCls} onClick={() => onMove(item, 'stock_in')} aria-label={`Add stock of ${item.item_name}`}><Plus className="h-3.5 w-3.5" aria-hidden /></button>
    </div>
  );
}

function validate(form, creating) {
  const e = {};
  if (!form.item_name.trim()) e.item_name = 'Item name is required.';
  else if (form.item_name.trim().length > 100) e.item_name = 'Use 100 characters or fewer.';
  if (!form.category.trim()) e.category = 'Category is required.';
  if (creating) {
    const q = Number(form.quantity);
    if (form.quantity === '' || !Number.isInteger(q) || q < 0) e.quantity = 'Opening quantity must be a whole number of 0 or more.';
  }
  const m = Number(form.min_threshold);
  if (form.min_threshold === '' || !Number.isInteger(m) || m < 0) e.min_threshold = 'Low-stock level must be a whole number of 0 or more.';
  return e;
}

function ItemForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}), is_needed_by_donors: Boolean(initial?.is_needed_by_donors) });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setErrors((x) => ({ ...x, [k]: undefined })); };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate(form, !initial);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true); setError(null);
    try {
      const body = { item_name: form.item_name.trim(), category: form.category.trim(), min_threshold: Number(form.min_threshold), is_needed_by_donors: form.is_needed_by_donors };
      const res = initial
        ? await api(`/inventory/${initial.item_id}`, { method: 'PUT', body })
        : await api('/inventory', { method: 'POST', body: { ...body, quantity: Number(form.quantity) } });
      onSaved(res.data, !initial);
    } catch (err) { setError(err); setErrors((x) => ({ ...x, ...(err.details?.errors || {}) })); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit ${initial.item_name}` : 'Add inventory item'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="item-form" loading={saving}>{initial ? 'Save changes' : 'Add item'}</Button></>}>
      <form id="item-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error && !error.details?.errors ? error : null} />
        <Field label="Item name" error={errors.item_name}><input className="input" maxLength={100} value={form.item_name} onChange={set('item_name')} placeholder="Infant formula (0-6 months)" /></Field>
        <Field label="Category" error={errors.category}><input className="input" maxLength={50} list="inv-categories" value={form.category} onChange={set('category')} /></Field>
        <datalist id="inv-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="grid grid-cols-2 gap-4">
          {initial
            ? <Field label="Quantity" hint="Change it with a stock movement (- / + or History)"><p className="input flex items-center bg-slate-50 tabular-nums">{initial.quantity}</p></Field>
            : <Field label="Opening quantity" hint="Recorded as Stock in: Opening balance" error={errors.quantity}><input className="input" type="number" min={0} step={1} value={form.quantity} onChange={set('quantity')} /></Field>}
          <Field label="Low-stock level" hint="Flagged at or below this" error={errors.min_threshold}><input className="input" type="number" min={0} step={1} value={form.min_threshold} onChange={set('min_threshold')} /></Field>
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={form.is_needed_by_donors} onChange={set('is_needed_by_donors')} />
          <span><span className="block text-sm font-medium text-navy-900">Ask donors for this</span><span className="text-xs text-slate-500">Shown on the donor portal even when stock isn't low.</span></span>
        </label>
      </form>
    </Modal>
  );
}

/** Stock in, Stock out, Adjustment or Disposal: type, quantity, reason (and a note for "Other"). */
function MovementDialog({ item, initialType, types, onClose, onSaved }) {
  const [f, setF] = useState({ type: initialType || 'stock_in', quantity: '1', reason: '', note: '', reference: '', direction: 'remove' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const def = types.find((t) => t.key === f.type);
  const qty = Number(f.quantity);
  const sign = f.type === 'adjustment' ? (f.direction === 'add' ? 1 : -1) : def?.sign || 1;
  const after = Number.isInteger(qty) && qty > 0 ? item.quantity + sign * qty : null;
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'type' ? { reason: '' } : {}) })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const submit = async (e) => {
    e.preventDefault();
    const v = {};
    if (!Number.isInteger(qty) || qty < 1) v.quantity = 'Enter a whole number of at least 1.';
    else if (after < 0) v.quantity = `Only ${item.quantity} in stock.`;
    if (!f.reason) v.reason = 'Choose a reason.';
    if (f.reason === 'Other' && !f.note.trim()) v.note = 'Describe the reason.';
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true); setError(null);
    try {
      const res = await api(`/inventory/${item.item_id}/movements`, { method: 'POST', body: { type: f.type, quantity: qty, reason: f.reason, note: f.note.trim(), reference: f.reference.trim(), direction: f.direction } });
      onSaved(res.data);
    } catch (err) { setError(err); setErrors((x) => ({ ...x, ...(err.details?.errors || {}) })); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Stock movement: ${item.item_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="move-form" loading={saving}>Confirm</Button></>}>
      <form id="move-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error && !error.details?.errors ? error : null} />
        <p className="text-sm text-slate-600">In stock now: <strong className="tabular-nums text-navy-900">{item.quantity}</strong>
          {after !== null && after >= 0 && <> · after this: <strong className="tabular-nums text-navy-900">{after}</strong></>}</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Movement type" error={errors.type}>
            <select className="input" value={f.type} onChange={set('type')}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          </Field>
          <Field label="Quantity" error={errors.quantity}><input className="input" type="number" min={1} step={1} value={f.quantity} onChange={set('quantity')} /></Field>
        </div>
        {f.type === 'adjustment' && (
          <Field label="Adjustment" error={errors.direction}>
            <select className="input" value={f.direction} onChange={set('direction')}><option value="remove">Remove from stock (-)</option><option value="add">Add to stock (+)</option></select>
          </Field>
        )}
        <Field label="Reason" error={errors.reason}>
          <select className="input" value={f.reason} onChange={set('reason')}>
            <option value="">Choose a reason</option>{(def?.reasons || []).map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label={f.reason === 'Other' ? 'Details' : 'Note (optional)'} error={errors.note}><input className="input" maxLength={255} value={f.note} onChange={set('note')} /></Field>
        {f.type === 'stock_in' && <Field label="Reference (optional)" hint="For example a receipt or delivery number"><input className="input" maxLength={100} value={f.reference} onChange={set('reference')} /></Field>}
        <p className="text-xs text-slate-500">Donations add stock on their own from the Donations page. The quantity can't go below 0.</p>
      </form>
    </Modal>
  );
}

/** The item's movement history (newest first), with previous and new quantity for each. */
function HistoryDialog({ item, onClose }) {
  const { data, loading, error, reload } = useApi(`/inventory/${item.item_id}/movements`);
  const h = data?.data;
  return (
    <Modal open onClose={onClose} title={`History: ${item.item_name}`} size="wide" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {loading && !h ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <>
          <p className="mb-3 text-sm text-slate-600">In stock: <strong className="tabular-nums text-navy-900">{h.item.quantity}</strong>
            {h.reconciled ? <span className="ml-2 text-xs text-emerald-700">The movements below add up to this quantity.</span>
              : <span className="ml-2 text-xs text-amber-800">The movements add up to {h.movement_total}. Record an Adjustment (Physical count correction) to match the count.</span>}</p>
          {h.movements.length === 0 ? <p className="text-sm text-slate-500">No movements yet.</p> : <MovementTable rows={h.movements} showItem={false} />}
        </>
      )}
    </Modal>
  );
}

function MovementTable({ rows, showItem = true }) {
  return (
    <Table label="Stock movements">
      <thead className="bg-slate-50"><tr>
        <th className="th">Date</th>{showItem && <th className="th">Item</th>}<th className="th">Type</th><th className="th text-right">Quantity</th>
        <th className="th text-right">Previous</th><th className="th text-right">New</th><th className="th">Reason</th><th className="th">User</th><th className="th">Related</th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((m) => (
          <tr key={m.movement_id}>
            <td className="td whitespace-nowrap text-xs">{formatDateTime(m.at)}</td>
            {showItem && <td className="td text-sm">{m.item_name}</td>}
            <td className="td"><Badge tone={TYPE_TONE[m.type]}>{m.type_label}</Badge></td>
            <td className={`td text-right font-semibold tabular-nums ${m.change < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{signed(m.change)}</td>
            <td className="td text-right tabular-nums">{m.quantity_before}</td>
            <td className="td text-right tabular-nums">{m.quantity_after}</td>
            <td className="td max-w-xs break-words text-sm">{m.reason || '-'}{m.note && <span className="block text-xs text-slate-500">{m.note}</span>}</td>
            <td className="td text-sm">{m.user_name}</td>
            <td className="td text-xs">{m.donation ? <Link className="text-brand hover:underline" to={`/donations?donation=${m.donation.donation_id}`}>Donation {m.donation.donation_no || `#${m.donation.donation_id}`}</Link> : m.reference || '-'}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Inventory reports: current stock, stock in / out / adjustments / disposal, low stock, movements by date. */
function Reports() {
  const { toast } = useApp();
  const [f, setF] = useState({ from: '', to: '', category: '', type: '', item_id: '' });
  const rangeError = f.from && f.to && f.from > f.to ? 'From must be on or before To.' : null;
  const query = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const { data, loading, error, reload } = useApi(rangeError ? null : `/inventory/reports${qs(query)}`);
  const items = useApi('/inventory');
  const r = data?.data;
  const [busy, setBusy] = useState(false);
  const exportCsv = async () => {
    setBusy(true);
    try { await download(`/inventory/reports${qs({ ...query, format: 'csv' })}`, 'inventory-movements.csv'); toast('Report exported.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" error={rangeError}><input className="input h-10 w-40" type="date" value={f.from} onChange={set('from')} /></Field>
          <Field label="To"><input className="input h-10 w-40" type="date" value={f.to} onChange={set('to')} /></Field>
          <Field label="Item"><select className="input h-10 w-52" value={f.item_id} onChange={set('item_id')}><option value="">All items</option>{(items.data?.data || []).map((i) => <option key={i.item_id} value={i.item_id}>{i.item_name}</option>)}</select></Field>
          <Field label="Category"><select className="input h-10 w-44" value={f.category} onChange={set('category')}><option value="">All categories</option>{(r?.options.categories || []).map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Movement type"><select className="input h-10 w-44" value={f.type} onChange={set('type')}><option value="">All types</option>{(r?.options.types || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
          <Button variant="secondary" className="ml-auto" loading={busy} onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Export CSV</Button>
        </div>
      </Card>
      {loading && !r ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : r && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {r.options.types.map((t) => (
              <Card key={t.key} className="p-4">
                <p className="text-xs text-slate-500">{t.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">{signed(r.totals[t.key].quantity)}</p>
                <p className="text-xs text-slate-500">{r.totals[t.key].count} movement{r.totals[t.key].count === 1 ? '' : 's'}</p>
              </Card>
            ))}
          </div>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-navy-900">Current inventory</h2>
              {r.current.length === 0 ? <p className="p-4 text-sm text-slate-500">No items.</p> : (
                <Table label="Current inventory"><thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th">Category</th><th className="th text-right">Quantity</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{r.current.map((c) => <tr key={c.item_id}><td className="td text-sm">{c.item_name}{c.is_low_stock && <span className="ml-1.5"><Badge tone="amber">Low</Badge></span>}</td><td className="td text-sm">{c.category}</td><td className="td text-right tabular-nums">{c.quantity}</td></tr>)}</tbody></Table>
              )}
            </Card>
            <Card>
              <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-navy-900">Low-stock items</h2>
              {r.low_stock.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing is low on stock.</p> : (
                <Table label="Low-stock items"><thead className="bg-slate-50"><tr><th className="th">Item</th><th className="th text-right">Quantity</th><th className="th text-right">Low-stock level</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{r.low_stock.map((c) => <tr key={c.item_id}><td className="td text-sm">{c.item_name}</td><td className="td text-right tabular-nums">{c.quantity}</td><td className="td text-right tabular-nums">{c.min_threshold}</td></tr>)}</tbody></Table>
              )}
            </Card>
          </div>
          <Card>
            <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-navy-900">Movements{r.truncated ? ' (first 5,000; narrow the dates)' : ''}</h2>
            {r.movements.length === 0 ? <p className="p-4 text-sm text-slate-500">No movements match these filters.</p> : <MovementTable rows={r.movements} />}
          </Card>
        </>
      )}
    </>
  );
}

export default function Inventory() {
  const { query, toast, refreshLowStock } = useApp();
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'reports' ? 'reports' : 'items';
  const [lowOnly, setLowOnly] = useState(false);
  const [archived, setArchived] = useState(false);
  const { data, loading, error, reload } = useApi(tab === 'items' ? `/inventory${qs({ low: lowOnly ? 1 : undefined, q: query, archived: archived ? 1 : undefined })}` : null);
  const opts = useApi('/inventory/options');
  const types = opts.data?.data?.types || [];
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [moving, setMoving] = useState(null); // { item, type }
  const [history, setHistory] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);
  const refs = useRef({});
  // ?item=ID (linked from a visitor donation) shows just that item until cleared.
  const focusId = Number(params.get('item')) || null;
  const allRows = useMemo(() => data?.data || [], [data]);
  const rows = focusId ? allRows.filter((i) => i.item_id === focusId) : allRows;
  useEffect(() => { if (tab === 'reports') setArchived(false); }, [tab]);

  const afterChange = async (message) => { await reload(); refreshLowStock(); if (message) toast(message); };
  const archive = async () => {
    setBusy('archive');
    try { await api(`/inventory/${archiving.item_id}`, { method: 'DELETE', body: { reason: reason.trim() } }); setArchiving(null); await afterChange('Item archived. Its stock history is kept.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const restore = async (i) => {
    setBusy(`restore-${i.item_id}`);
    try { await api(`/inventory/${i.item_id}/restore`, { method: 'POST', body: {} }); await afterChange(`${i.item_name} restored.`); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const selectTab = (key) => setParams((p) => { const n = new URLSearchParams(p); if (key === 'items') n.delete('tab'); else n.set('tab', key); return n; });
  const TABS = [{ key: 'items', label: 'Items' }, { key: 'reports', label: 'Reports' }];
  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    selectTab(t.key); refs.current[t.key]?.focus();
  };

  return (
    <>
      <PageHeader title="Inventory" description="Supplies on hand. Every change is a stock movement with a reason. Items at or below their low-stock level are flagged and shown to donors."
        actions={tab === 'items' && !archived && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add item</Button>} />
      <div className={TAB_ROW} role="tablist" aria-label="Inventory sections" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} type="button" role="tab" aria-selected={tab === t.key} tabIndex={tab === t.key ? 0 : -1} onClick={() => selectTab(t.key)}
            className={tabClass(tab === t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'reports' ? <Reports /> : (
        <>
          {focusId && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
              <span>Showing the item from a visitor donation.</span>
              <Button size="sm" variant="secondary" onClick={() => setParams({})}>Show all items</Button>
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Show low stock only
            </label>
            {isAdmin && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived items
              </label>
            )}
          </div>
          {archived && <div className="mb-4"><Notice tone="info">Archived items are kept with their stock history. Restore one to use it again.</Notice></div>}
          <Card>
            {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
              query ? <NoMatches /> : <EmptyState icon={Boxes} title={archived ? 'No archived items' : lowOnly ? 'Nothing is low on stock' : 'No inventory items yet'} />
            ) : (
              <Table>
                <thead className="bg-slate-50"><tr>
                  <th className="th">Item</th><th className="th">Category</th><th className="th">Quantity</th>
                  <th className="th">Low-stock level</th><th className="th">Last updated</th><th className="th"><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((i) => (
                    <tr key={i.item_id}>
                      <td className="td"><p className="font-medium text-navy-900">{i.item_name}</p>
                        <div className="mt-1 flex flex-wrap gap-1">{!archived && Number(i.quantity) === 0 ? <Badge tone="red">Out of stock</Badge> : i.is_low_stock && !archived ? <Badge tone="amber">Low stock</Badge> : null}{i.is_needed_by_donors && !archived ? <Badge tone="blue">Donor request</Badge> : null}
                          {i.archived_at && <Badge tone="slate">Archived{i.archive_reason ? `: ${i.archive_reason}` : ''}</Badge>}</div></td>
                      <td className="td">{i.category}</td>
                      <td className="td">{archived ? <span className="font-semibold tabular-nums">{i.quantity}</span> : <QuantityControl item={i} onMove={(item, type) => setMoving({ item, type })} />}</td>
                      <td className="td">{i.min_threshold}</td>
                      <td className="td text-xs text-slate-500">{formatDateTime(i.updated_at)}{i.last_updated_by_name ? <><br />{i.last_updated_by_name}</> : null}</td>
                      <td className="td whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {archived ? <Button size="sm" variant="secondary" loading={busy === `restore-${i.item_id}`} onClick={() => restore(i)}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore</Button>
                            : <Button size="sm" variant="secondary" onClick={() => setMoving({ item: i, type: 'adjustment' })}>Stock movement</Button>}
                          <IconButton icon={History} label={`History of ${i.item_name}`} onClick={() => setHistory(i)} />
                          {!archived && <IconButton icon={Pencil} label={`Edit ${i.item_name}`} onClick={() => setEditing(i)} />}
                          {!archived && <IconButton icon={Archive} tone="danger" label={`Archive ${i.item_name}`} onClick={() => { setReason(''); setArchiving(i); }} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      {editing && (
        <ItemForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={async (item, created) => { setEditing(null); await afterChange(created ? `${item.item_name} added.` : 'Changes saved.'); }} />
      )}
      {moving && types.length > 0 && (
        <MovementDialog item={moving.item} initialType={moving.type} types={types} onClose={() => setMoving(null)}
          onSaved={async (d) => { setMoving(null); await afterChange(`${d.item.item_name}: ${d.movement.before} → ${d.movement.after}. Movement recorded.`); }} />
      )}
      {history && <HistoryDialog item={history} onClose={() => setHistory(null)} />}
      <ConfirmModal open={!!archiving} onClose={() => setArchiving(null)} loading={busy === 'archive'} onConfirm={archive}
        title="Archive this item?" confirmLabel="Archive" confirmDisabled={!reason.trim()}
        message={archiving ? `"${archiving.item_name}" leaves the inventory list and the donation pickers. Nothing is deleted: its stock history stays, and an Admin can restore it. Only an item with 0 in stock can be archived.` : ''}>
        <label className="mt-3 block text-sm font-medium text-navy-900">Reason (required)
          <input className="input mt-1" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: No longer stocked" />
        </label>
      </ConfirmModal>
    </>
  );
}
