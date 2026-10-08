import { useState } from 'react';
import { CheckCircle2, Download, Plus, Printer, X } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download } from '../api/client';
import { Button, ErrorNote, Field, Modal, Spinner } from './ui';
import { formatDateTime } from '../lib/format';

/*
 * The one "Record donation" form. Used by the Donations page and by the Visitors page
 * (with `visit` set, so the donation is linked to that visit). Saving is a single server
 * transaction: donation, in-kind stock, visit link, receipt code and audit log. Every donation
 * recorded here is a general donation (not linked to specific children).
 */

/** Every method a donation can have (filters and old rows). */
export const METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Check', 'In-kind'];
/** Record a donation: what is handed over at the home. Online gifts come from the donor portal. */
export const RECORD_METHODS = ['Cash', 'In-kind'];
const NEW_ITEM = '__new__';
const PH_MOBILE = /^(09\d{9}|\+639\d{9}|639\d{9})$/;
const badInput = 'border-red-400 focus:border-red-500 focus:ring-red-200';
const blankLine = () => ({ item_id: '', quantity: '', item_name: '', category: '' });

/** Returns { field: message } for every invalid field. Empty object = valid. */
function validateDonation(f) {
  const e = {};
  if (!f.donor_type) e.donor_type = 'Donor type is required.';
  if (f.donor_type === 'registered' && !f.donor_id) e.donor_id = 'Donor is required.';
  if (f.donor_type === 'walk_in') {
    if (!f.walk_in_name.trim()) e.walk_in_name = 'Full name is required.';
    else if (f.walk_in_name.trim().length < 2) e.walk_in_name = 'Full name must be at least 2 characters.';
    if (f.walk_in_contact.trim() && !PH_MOBILE.test(f.walk_in_contact.replace(/[\s-]/g, ''))) {
      e.walk_in_contact = 'Enter a PH mobile number like 0917 123 4567, or leave it blank.';
    }
  }
  if (!f.payment_method) e.payment_method = 'Payment method is required.';
  const inKind = f.payment_method === 'In-kind';
  if (inKind) {
    if (String(f.amount).trim() && !(Number(f.amount) > 0)) e.amount = 'Leave blank or enter an amount greater than 0.';
    const picked = new Set();
    f.items.forEach((line, i) => {
      if (!line.item_id) e[`item_${i}`] = 'Choose an item, or create a new one.';
      else if (line.item_id === NEW_ITEM) {
        if (!line.item_name.trim()) e[`name_${i}`] = 'Item name is required.';
        if (!line.category.trim()) e[`category_${i}`] = 'Category is required.';
      } else if (picked.has(line.item_id)) e[`item_${i}`] = 'This item is already listed. Combine the quantities.';
      else picked.add(line.item_id);
      if (!String(line.quantity).trim()) e[`qty_${i}`] = 'Quantity is required.';
      else if (!Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1) e[`qty_${i}`] = 'Enter a whole number of at least 1.';
    });
  } else if (!String(f.amount).trim()) e.amount = 'Amount is required.';
  else if (!(Number(f.amount) > 0)) e.amount = 'Enter an amount greater than 0.';
  if (!f.description.trim()) e.description = 'Description is required.';
  if (!f.allocation_notes.trim()) e.allocation_notes = 'Allocation is required.';
  return e;
}


/** In-kind items: an existing inventory item or a new one, each with a quantity. */
function ItemsPicker({ items, setItems, errors, inventory }) {
  const stock = inventory.data?.data || [];
  const categories = [...new Set(stock.map((i) => i.category))].sort();
  const setLine = (i, patch) => setItems(items.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  if (inventory.loading && !inventory.data) return <Spinner label="Loading inventory" />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Each item's quantity is added to Inventory when you save.</p>
      {items.map((line, i) => (
        <div key={i} className="space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-start">
            <Field label={`Item ${i + 1}`} required error={errors[`item_${i}`]}>
              <select className={`input ${errors[`item_${i}`] ? badInput : ''}`} value={line.item_id} onChange={(e) => setLine(i, { item_id: e.target.value })}>
                <option value="">Select...</option>
                {stock.map((it) => <option key={it.item_id} value={String(it.item_id)}>{it.item_name} ({it.category}, {it.quantity} in stock)</option>)}
                <option value={NEW_ITEM}>+ New inventory item</option>
              </select>
            </Field>
            <Field label="Quantity" required error={errors[`qty_${i}`]}>
              <input className={`input ${errors[`qty_${i}`] ? badInput : ''}`} type="number" min="1" step="1" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
            </Field>
            {items.length > 1 && (
              <Button size="sm" variant="ghost" className="sm:mt-7" aria-label={`Remove item ${i + 1}`}
                onClick={() => setItems(items.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
            )}
          </div>
          {line.item_id === NEW_ITEM && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New item name" required error={errors[`name_${i}`]}>
                <input className={`input ${errors[`name_${i}`] ? badInput : ''}`} maxLength={100} value={line.item_name} onChange={(e) => setLine(i, { item_name: e.target.value })} />
              </Field>
              <Field label="Category" required error={errors[`category_${i}`]}>
                <input className={`input ${errors[`category_${i}`] ? badInput : ''}`} maxLength={50} list="donation-item-categories" value={line.category} onChange={(e) => setLine(i, { category: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
      ))}
      <datalist id="donation-item-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <Button size="sm" variant="secondary" onClick={() => setItems([...items, blankLine()])}><Plus className="h-4 w-4" /> Add another item</Button>
    </div>
  );
}

/**
 * Prints the receipt PDF (with the QR code and the receipt code under it). Falls back to
 * downloading it when the browser can't print a PDF from the page.
 */
export async function printReceipt(donationId) {
  const name = `CareSphere-Receipt-${String(donationId).padStart(6, '0')}.pdf`;
  const res = await api(`/donations/${donationId}/receipt`, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed'; frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0';
  frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { download(`/donations/${donationId}/receipt`, name); }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
  };
  document.body.appendChild(frame);
}

/** Shown after a walk-in donation is saved: walk-ins have no portal, so they get a printed receipt. */
function WalkInSaved({ donation, onClose }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = (kind, fn) => async () => { setBusy(kind); setError(null); try { await fn(); } catch (err) { setError(err); } finally { setBusy(null); } };
  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden /> Donation #{String(donation.donation_id).padStart(6, '0')} recorded</p>
      <p className="text-sm text-slate-600">{donation.donor_name} is a walk-in donor with no portal account, so give them a printed receipt. It shows the QR code with the receipt code printed under it.</p>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs text-slate-500">Receipt code</p>
        <p className="break-all font-mono text-sm text-navy-900">{donation.qr_receipt_code}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button loading={busy === 'print'} onClick={run('print', () => printReceipt(donation.donation_id))}><Printer className="h-4 w-4" /> Print receipt</Button>
        <Button variant="secondary" loading={busy === 'pdf'} onClick={run('pdf', () => download(`/donations/${donation.donation_id}/receipt`, `CareSphere-Receipt-${String(donation.donation_id).padStart(6, '0')}.pdf`))}>
          <Download className="h-4 w-4" /> Download PDF
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

/**
 * @param visit   optional { visitor_id, visitor_name, contact_number, check_in_time } to link and prefill
 * @param onSaved called with the saved donation (after the walk-in receipt step, if any)
 */
export default function DonationForm({ visit = null, onClose, onSaved }) {
  const donors = useApi('/donations/donors');
  const inventory = useApi('/inventory');
  const [form, setForm] = useState({
    donor_type: visit ? 'walk_in' : '', donor_id: '',
    walk_in_name: visit?.visitor_name || '', walk_in_contact: visit?.contact_number || '',
    amount: '', payment_method: 'Cash', items: [blankLine()],
    description: '', allocation_notes: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null); // walk-in donation waiting for its receipt

  // Update the form and re-check only the fields already showing an error. Hidden fields
  // (e.g. the walk-in name while "Registered donor" is chosen) keep their values.
  const update = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const fresh = validateDonation(next);
      return Object.fromEntries(Object.keys(prev).filter((k) => fresh[k]).map((k) => [k, fresh[k]]));
    });
  };
  const set = (k) => (e) => update({ [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const found = validateDonation(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true); setError(null);
    const inKind = form.payment_method === 'In-kind';
    try {
      const res = await api('/donations', { method: 'POST', body: {
        donor_type: form.donor_type,
        donor_id: form.donor_type === 'registered' ? Number(form.donor_id) : undefined,
        walk_in_name: form.donor_type === 'walk_in' ? form.walk_in_name.trim() : undefined,
        walk_in_contact: form.donor_type === 'walk_in' && form.walk_in_contact.trim() ? form.walk_in_contact.trim() : undefined,
        visit_id: visit?.visitor_id,
        amount: String(form.amount).trim() ? Number(form.amount) : (inKind ? 0 : undefined),
        payment_method: form.payment_method,
        items: inKind ? form.items.map((l) => (l.item_id === NEW_ITEM
          ? { new_item: { item_name: l.item_name.trim(), category: l.category.trim() }, quantity: Number(l.quantity) }
          : { item_id: Number(l.item_id), quantity: Number(l.quantity) })) : undefined,
        description: form.description.trim(),
        is_general: true, // every donation recorded by Admin or Staff is general
        allocation_notes: form.allocation_notes.trim(),
      } });
      if (res.data.donor_type === 'walk_in') setSaved(res.data);
      else onSaved(res.data);
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  if (saved) {
    return (
      <Modal open onClose={() => onSaved(saved)} title="Donation recorded">
        <WalkInSaved donation={saved} onClose={() => onSaved(saved)} />
      </Modal>
    );
  }

  const donorList = donors.data?.data || [];
  const inKind = form.payment_method === 'In-kind';
  return (
    <Modal open onClose={onClose} title={visit ? `Record donation from ${visit.visitor_name}` : 'Record a donation'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="donation-form" loading={saving}>Record donation</Button></>}>
      <form id="donation-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error || donors.error || inventory.error} />
        {visit && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Linked to the visit at {formatDateTime(visit.check_in_time)}. After saving, the visit shows as Donated.
          </p>
        )}

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-navy-800">Donor type<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></legend>
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Donor type">
            <label className="flex items-center gap-2">
              <input type="radio" name="donor_type" value="registered" className="accent-brand" checked={form.donor_type === 'registered'} onChange={() => update({ donor_type: 'registered' })} />
              Registered donor
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="donor_type" value="walk_in" className="accent-brand" checked={form.donor_type === 'walk_in'} onChange={() => update({ donor_type: 'walk_in' })} />
              Walk-in
            </label>
          </div>
          {errors.donor_type && <p className="mt-1 text-xs text-red-600">{errors.donor_type}</p>}
        </fieldset>

        {form.donor_type === 'registered' && (
          <Field label="Donor" required error={errors.donor_id} hint={donorList.length === 0 && !donors.loading ? 'No donor accounts yet. Use Walk-in, or have the donor register.' : 'The receipt and history appear in this donor\'s portal.'}>
            <select className={`input ${errors.donor_id ? badInput : ''}`} value={form.donor_id} onChange={set('donor_id')}>
              <option value="">Select a donor</option>
              {donorList.map((d) => <option key={d.user_id} value={d.user_id}>{d.full_name} ({d.email})</option>)}
            </select>
          </Field>
        )}
        {form.donor_type === 'walk_in' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={errors.walk_in_name}>
              <input className={`input ${errors.walk_in_name ? badInput : ''}`} maxLength={100} value={form.walk_in_name} onChange={set('walk_in_name')} autoComplete="off" />
            </Field>
            <Field label="Contact number" error={errors.walk_in_contact} hint="Optional. Walk-ins get a printed receipt.">
              <input className={`input ${errors.walk_in_contact ? badInput : ''}`} inputMode="tel" placeholder="09XX XXX XXXX" value={form.walk_in_contact} onChange={set('walk_in_contact')} />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={inKind ? 'Estimated value (₱)' : 'Amount (₱)'} required={!inKind} error={errors.amount} hint={inKind ? 'Optional for in-kind gifts.' : undefined}>
            <input className={`input ${errors.amount ? badInput : ''}`} type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} />
          </Field>
          <Field label="Payment method" required error={errors.payment_method}>
            <select className={`input ${errors.payment_method ? badInput : ''}`} value={form.payment_method} onChange={set('payment_method')}>
              {RECORD_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
        </div>
        {inKind && <ItemsPicker items={form.items} setItems={(items) => update({ items })} errors={errors} inventory={inventory} />}

        <Field label="Description" required error={errors.description} hint="What was given, e.g. cash gift, 2 boxes of school supplies.">
          <textarea className={`input ${errors.description ? badInput : ''}`} rows={2} maxLength={2000} value={form.description} onChange={set('description')} />
        </Field>

        <Field label="Allocation" required error={errors.allocation_notes} hint="How the donation will be used. Visible to registered donors in their portal.">
          <textarea className={`input ${errors.allocation_notes ? badInput : ''}`} rows={3} maxLength={3000} value={form.allocation_notes} onChange={set('allocation_notes')} placeholder="e.g. 20 cans of infant formula for the nursery" />
        </Field>
      </form>
    </Modal>
  );
}
