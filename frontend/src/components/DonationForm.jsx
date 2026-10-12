import { useState } from 'react';
import { CheckCircle2, Download, Plus, Printer, X } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download } from '../api/client';
import { Button, ErrorNote, Field, Modal, Spinner } from './ui';
import { formatDateTime } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { hasDuty } from '../lib/duties';
import AllocationEditor, { allocationBody, blankAllocation } from './donations/AllocationEditor';

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
const blankLine = () => ({ item_id: '', quantity: '', item_name: '', category: '', estimated_value: '', expiry_date: '' });

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
      if (String(line.estimated_value).trim() && !(Number(line.estimated_value) > 0)) e[`value_${i}`] = 'Leave blank or enter a value greater than 0.';
    });
  } else if (!String(f.amount).trim()) e.amount = 'Amount is required.';
  else if (!(Number(f.amount) > 0)) e.amount = 'Enter an amount greater than 0.';
  if (!f.description.trim()) e.description = 'Description is required.';
  if (!f.purpose) e.purpose = 'Choose the purpose.';
  const lines = f.allocation.filter((l) => l.program || l.amount || l.intended_use);
  if (!lines.length) e.allocation = 'Add at least one allocation line.';
  lines.forEach((l, i) => {
    if (!l.program) e[`allocation_${i}`] = 'Choose a program.';
    else if (!inKind && !(Number(l.amount) > 0)) e[`allocation_${i}`] = 'Enter the amount for this program.';
    else if ((inKind || l.program === 'Other') && !String(l.intended_use || '').trim()) e[`allocation_${i}`] = l.program === 'Other' ? 'Describe the use for "Other".' : 'Describe the intended use.';
  });
  if (!inKind && lines.length && !Object.keys(e).some((k) => k.startsWith('allocation_')) && Number(f.amount) > 0) {
    const sum = Math.round(lines.reduce((x, l) => x + Number(l.amount), 0) * 100) / 100;
    if (Math.abs(sum - Number(f.amount)) > 0.009) e.allocation = 'The allocation must add up to the amount.';
  }
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Estimated value (₱)" error={errors[`value_${i}`]} hint="Optional. Shown as an estimate, never added to cash.">
              <input className={`input ${errors[`value_${i}`] ? badInput : ''}`} type="number" min="0.01" step="0.01" value={line.estimated_value} onChange={(e) => setLine(i, { estimated_value: e.target.value })} />
            </Field>
            <Field label="Expiry date" hint="Optional. Earliest-expiry stock is used first.">
              <input className="input" type="date" value={line.expiry_date} onChange={(e) => setLine(i, { expiry_date: e.target.value })} />
            </Field>
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
 * Prints the acknowledgment PDF (with the QR code and the receipt code under it). Falls back to downloading it
 * when the browser can't print a PDF from the page.
 */
export async function printReceipt(donationId, number) {
  const name = `CareSphere-Acknowledgment-${number || donationId}.pdf`;
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

/**
 * After saving: the donation number, and for an accepted walk-in gift the acknowledgment (walk-ins have no portal,
 * so they get it printed). In-kind gifts are inspected and accepted first; the acknowledgment comes after that.
 */
function Saved({ donation: d0, onClose }) {
  const [d, setD] = useState(d0);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = (kind, fn) => async () => { setBusy(kind); setError(null); try { await fn(); } catch (err) { setError(err); } finally { setBusy(null); } };
  const issue = async () => { const r = await api(`/donations/${d.donation_id}/acknowledgment`, { method: 'POST', body: {} }); setD(r.data); };
  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden /> Donation {d.donation_no} recorded · {d.status}</p>
      {d.can_download ? (
        <>
          <p className="text-sm text-slate-600">{d.donor_type === 'walk_in' ? 'Walk-in donors have no portal account, so give them the printed acknowledgment.' : 'The donor can also download it from their portal.'} It shows the QR code with the receipt code printed under it.</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">Receipt code</p><p className="break-all font-mono text-sm text-navy-900">{d.qr_receipt_code}</p></div>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === 'print'} onClick={run('print', () => printReceipt(d.donation_id, d.donation_no))}><Printer className="h-4 w-4" aria-hidden /> Print acknowledgment</Button>
            <Button variant="secondary" loading={busy === 'pdf'} onClick={run('pdf', () => download(`/donations/${d.donation_id}/receipt`, `CareSphere-Acknowledgment-${d.donation_no}.pdf`))}><Download className="h-4 w-4" aria-hidden /> Download PDF</Button>
            <Button variant="ghost" className="ml-auto" onClick={() => onClose(d)}>Done</Button>
          </div>
        </>
      ) : d.status === 'Accepted' ? (
        <>
          <p className="text-sm text-slate-600">The donation is accepted. Issue the acknowledgment now to print it, or later from the donation page.</p>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === 'ack'} onClick={run('ack', issue)}>Issue acknowledgment</Button>
            <Button variant="ghost" className="ml-auto" onClick={() => onClose(d)}>Later</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">{d.in_kind ? 'In-kind gifts are inspected and accepted first. The acknowledgment can be issued after that, from the donation page.' : 'Finish the allocation on the donation page to accept it and issue the acknowledgment.'}</p>
          <div className="flex justify-end"><Button variant="ghost" onClick={() => onClose(d)}>Done</Button></div>
        </>
      )}
    </div>
  );
}

/**
 * @param visit   optional { visitor_id, visitor_name, contact_number, check_in_time } to link and prefill
 * @param onSaved called with the saved donation (after the walk-in receipt step, if any)
 */
export default function DonationForm({ visit = null, onClose, onSaved }) {
  const donors = useApi('/donations/donors');
  const options = useApi('/donations/options');
  const programs = options.data?.data?.programs || [];
  const { user } = useAuth();
  // Staff without the Inventory duty get the item list through the Donations module (names and stock only).
  const inventory = useApi(hasDuty(user, 'inventory') ? '/inventory' : '/donations/inventory-items');
  const [form, setForm] = useState({
    donor_type: visit ? 'walk_in' : '', donor_id: '',
    walk_in_name: visit?.visitor_name || '', walk_in_contact: visit?.contact_number || '',
    walk_in_kind: 'Individual', anonymous: false,
    amount: '', payment_method: 'Cash', items: [blankLine()],
    description: '', purpose: '', allocation: [blankAllocation()],
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
        walk_in_kind: form.donor_type === 'walk_in' ? form.walk_in_kind : undefined,
        anonymous: form.anonymous,
        visit_id: visit?.visitor_id,
        amount: inKind ? undefined : Number(form.amount),
        payment_method: form.payment_method,
        items: inKind ? form.items.map((l) => (l.item_id === NEW_ITEM
          ? { new_item: { item_name: l.item_name.trim(), category: l.category.trim() }, quantity: Number(l.quantity), estimated_value: l.estimated_value || undefined, expiry_date: l.expiry_date || undefined }
          : { item_id: Number(l.item_id), quantity: Number(l.quantity), estimated_value: l.estimated_value || undefined, expiry_date: l.expiry_date || undefined })) : undefined,
        description: form.description.trim(),
        purpose: form.purpose,
        allocation: allocationBody(form.allocation, inKind),
      } });
      setSaved(res.data);
    } catch (err) { if (err.details?.errors) setErrors(err.details.errors); setError(err); } finally { setSaving(false); }
  };

  if (saved) {
    return (
      <Modal open onClose={() => onSaved(saved)} title="Donation recorded">
        <Saved donation={saved} onClose={(d) => onSaved(d)} />
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
              {donorList.map((d) => <option key={d.user_id} value={d.user_id}>{d.full_name}{d.email ? ` (${d.email})` : ''}</option>)}
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

        {form.donor_type === 'walk_in' && (
          <Field label="Donor is" hint="An organization (company, school, church group) or a person.">
            <select className="input" value={form.walk_in_kind} onChange={set('walk_in_kind')}><option>Individual</option><option>Organization</option></select>
          </Field>
        )}
        {form.donor_type && (
          <label className="flex items-center gap-2 text-sm text-navy-900">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.anonymous} onChange={(e) => update({ anonymous: e.target.checked })} />
            Anonymous donation (shown as "Anonymous donor" everywhere)
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" required error={errors.payment_method} hint="Cash, or items (in-kind).">
            <select className={`input ${errors.payment_method ? badInput : ''}`} value={form.payment_method} onChange={set('payment_method')}>
              {RECORD_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          {!inKind && (
            <Field label="Amount (₱)" required error={errors.amount}>
              <input className={`input ${errors.amount ? badInput : ''}`} type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} />
            </Field>
          )}
        </div>
        {inKind && <ItemsPicker items={form.items} setItems={(items) => update({ items })} errors={errors} inventory={inventory} />}

        <Field label="Description" required error={errors.description} hint="What was given, e.g. cash gift, 2 boxes of school supplies.">
          <textarea className={`input ${errors.description ? badInput : ''}`} rows={2} maxLength={2000} value={form.description} onChange={set('description')} />
        </Field>

        <Field label="Purpose" required error={errors.purpose} hint="What the donor's gift is for. The only intent field.">
          <select className={`input ${errors.purpose ? badInput : ''}`} value={form.purpose} onChange={(e) => {
            const p = e.target.value;
            // Prefill a single allocation line with the purpose (and the full amount for cash) when nothing is set yet.
            const blank = form.allocation.length === 1 && !form.allocation[0].program && !form.allocation[0].amount;
            update({ purpose: p, ...(blank ? { allocation: [{ ...blankAllocation(p), amount: inKind ? '' : form.amount }] } : {}) });
          }}>
            <option value="">Choose...</option>{programs.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <AllocationEditor lines={form.allocation} onChange={(allocation) => update({ allocation })} inKind={inKind} amount={form.amount} programs={programs} errors={errors} />
      </form>
    </Modal>
  );
}
