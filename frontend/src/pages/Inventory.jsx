import { useState } from 'react';
import { Boxes, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDateTime } from '../lib/format';

const EMPTY = { item_name: '', category: '', quantity: 0, min_threshold: 5, is_needed_by_donors: false };
const CATEGORIES = ['Food', 'Hygiene', 'Medical', 'Clothing', 'School supplies', 'Cleaning'];

function validate(form) {
  const e = {};
  if (!form.item_name.trim()) e.item_name = 'Item name is required.';
  else if (form.item_name.trim().length > 100) e.item_name = 'Use 100 characters or fewer.';
  if (!form.category.trim()) e.category = 'Category is required.';
  const q = Number(form.quantity);
  if (form.quantity === '' || !Number.isInteger(q) || q < 0) e.quantity = 'Quantity must be a whole number of 0 or more.';
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
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true); setError(null);
    try {
      const body = { item_name: form.item_name.trim(), category: form.category.trim(), quantity: Number(form.quantity),
        min_threshold: Number(form.min_threshold), is_needed_by_donors: form.is_needed_by_donors };
      const res = initial
        ? await api(`/inventory/${initial.item_id}`, { method: 'PUT', body })
        : await api('/inventory', { method: 'POST', body });
      onSaved(res.data, !initial);
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit ${initial.item_name}` : 'Add inventory item'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="item-form" loading={saving}>{initial ? 'Save changes' : 'Add item'}</Button></>}>
      <form id="item-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <Field label="Item name" error={errors.item_name}><input className="input" maxLength={100} value={form.item_name} onChange={set('item_name')} placeholder="Infant formula (0-6 months)" /></Field>
        <Field label="Category" error={errors.category}><input className="input" maxLength={50} list="inv-categories" value={form.category} onChange={set('category')} /></Field>
        <datalist id="inv-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity" error={errors.quantity}><input className="input" type="number" min={0} step={1} value={form.quantity} onChange={set('quantity')} /></Field>
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

export default function Inventory() {
  const { query, toast, refreshLowStock } = useApp();
  const [lowOnly, setLowOnly] = useState(false);
  const { data, loading, error, reload } = useApi(`/inventory${qs({ low: lowOnly ? 1 : undefined, q: query })}`);
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(null);
  const rows = data?.data || [];

  const afterChange = async (message) => { await reload(); refreshLowStock(); if (message) toast(message); };

  const adjust = async (item, delta) => {
    const quantity = item.quantity + delta;
    if (quantity < 0) return;
    setBusy(item.item_id);
    try { await api(`/inventory/${item.item_id}`, { method: 'PUT', body: { quantity } }); await afterChange(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  const remove = async () => {
    setBusy('delete');
    try { await api(`/inventory/${deleting.item_id}`, { method: 'DELETE' }); setDeleting(null); await afterChange('Item deleted.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Inventory" description="Supplies on hand. Items at or below their low-stock level are flagged and shown to donors."
        actions={<Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add item</Button>} />
      <label className="mb-4 inline-flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" className="h-4 w-4 accent-brand" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Show low stock only
      </label>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Boxes} title={lowOnly ? 'Nothing is low on stock' : 'No inventory items yet'} />
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
                    <div className="mt-0.5 flex gap-1">{i.is_low_stock ? <Badge tone="amber">Low stock</Badge> : null}{i.is_needed_by_donors ? <Badge tone="blue">Donor request</Badge> : null}</div></td>
                  <td className="td">{i.category}</td>
                  <td className="td">
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" aria-label={`Decrease ${i.item_name}`} disabled={busy === i.item_id || i.quantity === 0} onClick={() => adjust(i, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                      <span className="w-10 text-center font-semibold tabular-nums text-navy-900">{i.quantity}</span>
                      <Button size="sm" variant="ghost" aria-label={`Increase ${i.item_name}`} disabled={busy === i.item_id} onClick={() => adjust(i, 1)}><Plus className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                  <td className="td">{i.min_threshold}</td>
                  <td className="td text-xs text-slate-500">{formatDateTime(i.updated_at)}{i.last_updated_by_name ? <><br />{i.last_updated_by_name}</> : null}</td>
                  <td className="td whitespace-nowrap text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(i)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>{' '}
                    <Button size="sm" variant="ghost" aria-label={`Delete ${i.item_name}`} onClick={() => setDeleting(i)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && (
        <ItemForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={async (item, created) => { setEditing(null); await afterChange(created ? `${item.item_name} added.` : 'Changes saved.'); }} />
      )}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} loading={busy === 'delete'} onConfirm={remove}
        title="Confirm delete" confirmLabel="Confirm Delete"
        message={deleting ? `Are you sure you want to delete this inventory item? "${deleting.item_name}" will be removed permanently.` : ''} />
    </>
  );
}
