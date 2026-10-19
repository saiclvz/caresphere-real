import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, LogOut, Pencil, Trash2, UserPlus, Users, X } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Spinner, Table, PageHeader } from '../components/ui';
import DonationForm from '../components/DonationForm';
import Pagination, { usePageState } from '../components/Pagination';
import { formatDateTime, formatMoney, isoDate } from '../lib/format';
import { hasDuty } from '../lib/duties';

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toInput = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');
const badInput = 'border-red-400 focus:border-red-500 focus:ring-red-200';

// ------------------------------------------------------------------ visit form
function validate(f, { requireOut = false } = {}) {
  const e = {};
  if (!f.visitor_name?.trim()) e.visitor_name = 'Visitor name is required.';
  if (!f.contact_number?.trim()) e.contact_number = 'Contact number is required.';
  else if (!/^[+\d][\d\s-]{6,19}$/.test(f.contact_number.trim())) e.contact_number = 'Enter a valid contact number.';
  if (!f.purpose?.trim()) e.purpose = 'Purpose of visit is required.';
  if (!f.check_in_time) e.check_in_time = 'Time in is required.';
  else if (f.check_in_time > nowLocal()) e.check_in_time = 'Time in cannot be in the future.';
  if (requireOut && !f.check_out_time) e.check_out_time = 'Time out is required.';
  if (f.check_out_time) {
    if (f.check_out_time > nowLocal()) e.check_out_time = 'Time out cannot be in the future.';
    else if (f.check_in_time && f.check_out_time < f.check_in_time) e.check_out_time = 'Time out cannot be earlier than time in.';
  }
  return e;
}

/** Link to the donation on the Donations page, filtered to its source. */
const donationLink = (v) => `/donations/${v.donation_id}`;

/** Visit type cell: the linked donation (items or amount), or "Just visited". */
function DonationSummary({ v }) {
  if (v.visit_type !== 'donation') {
    return (
      <div className="flex flex-wrap gap-1">
        <Badge tone="slate">Just visited</Badge>
        {v.needs_review && <Badge tone="amber">Needs review</Badge>}
      </div>
    );
  }
  return (
    <div className="space-y-1 text-xs">
      <Badge tone="green">Donated</Badge>
      {v.donation_method !== 'In-kind' ? (
        <p className="font-medium text-navy-900">{formatMoney(v.donation_amount)} <span className="font-normal text-slate-500">{v.donation_method}</span></p>
      ) : (
        <ul className="space-y-0.5">
          {(v.donated_items || []).map((it) => (
            <li key={it.item_id}><Link to={`/inventory?item=${it.item_id}`} className="text-brand hover:underline">{it.item_name} x{it.quantity}</Link></li>
          ))}
        </ul>
      )}
      <Link to={donationLink(v)} className="block text-brand hover:underline">View donation</Link>
    </div>
  );
}

function VisitorForm({ initial, onClose, onSaved, canDonate = true }) {
  const editing = Boolean(initial);
  const [form, setForm] = useState(editing
    ? { visitor_name: initial.visitor_name, contact_number: initial.contact_number || '', purpose: initial.purpose,
      check_in_time: toInput(initial.check_in_time), check_out_time: toInput(initial.check_out_time), reviewed: false }
    : { visitor_name: '', contact_number: '', purpose: '', check_in_time: nowLocal(), check_out_time: '', donated: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const update = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const fresh = validate(next);
      return Object.fromEntries(Object.keys(prev).filter((k) => fresh[k]).map((k) => [k, fresh[k]]));
    });
  };
  const set = (k) => (e) => update({ [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true); setError(null);
    try {
      const body = { visitor_name: form.visitor_name.trim(), contact_number: form.contact_number.trim(), purpose: form.purpose.trim(), check_in_time: form.check_in_time };
      const res = editing
        ? await api(`/visitors/${initial.visitor_id}`, { method: 'PUT', body: { ...body, check_out_time: form.check_out_time || null, ...(form.reviewed && { needs_review: false }) } })
        : await api('/visitors', { method: 'POST', body });
      // A new visit marked "Donated" is saved first; the donation form opens next.
      onSaved(res.data, { created: !editing, openDonation: !editing && canDonate && form.donated });
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit visitor record' : 'Check in a visitor'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="visitor-form" loading={saving}>{editing ? 'Save changes' : canDonate && form.donated ? 'Check in and record donation' : 'Check in'}</Button></>}>
      <form id="visitor-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <Field label="Name" required error={errors.visitor_name}><input className={`input ${errors.visitor_name ? badInput : ''}`} maxLength={100} value={form.visitor_name} onChange={set('visitor_name')} /></Field>
        <Field label="Contact number" required error={errors.contact_number}><input className={`input ${errors.contact_number ? badInput : ''}`} inputMode="tel" value={form.contact_number} onChange={set('contact_number')} placeholder="09XX XXX XXXX" /></Field>
        <Field label="Purpose of visit" required error={errors.purpose}><textarea className={`input ${errors.purpose ? badInput : ''}`} rows={2} maxLength={1000} value={form.purpose} onChange={set('purpose')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time in" required error={errors.check_in_time}><input className={`input ${errors.check_in_time ? badInput : ''}`} type="datetime-local" max={nowLocal()} value={form.check_in_time} onChange={set('check_in_time')} /></Field>
          {editing && <Field label="Time out" hint="Leave empty if still on site." error={errors.check_out_time}><input className={`input ${errors.check_out_time ? badInput : ''}`} type="datetime-local" max={nowLocal()} value={form.check_out_time} onChange={set('check_out_time')} /></Field>}
        </div>

        {editing ? (
          <>
            {initial.visit_type === 'donation' && (
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="mb-1 font-medium text-navy-900">Donation linked to this visit</p>
                <DonationSummary v={initial} />
                <p className="mt-2 text-xs text-slate-500">This form only changes the visit details. Edit the donation on the Donations page.</p>
              </div>
            )}
            {initial.needs_review && initial.visit_type !== 'donation' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p>This visit was marked "Donated" before, but no matching donation was found. Record the donation from the visitor list, or mark it reviewed if it was only a visit.</p>
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.reviewed} onChange={(e) => update({ reviewed: e.target.checked })} />
                  Mark as reviewed (just visited)
                </label>
              </div>
            )}
          </>
        ) : !canDonate ? (
          <p className="rounded-lg border border-slate-200 px-4 py-3 text-xs text-slate-600">
            Recording a donation needs the Donations duty. Check the visitor in here, and ask an Admin or a staff member with that duty to record the donation.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
            <div>
              <p id="donated-label" className="text-sm font-medium text-navy-900">Donated</p>
              <p className="text-xs text-slate-500">The visit is saved first, then the donation form opens. If you cancel it, the visit stays "Just visited".</p>
            </div>
            <button type="button" role="switch" aria-checked={form.donated} aria-labelledby="donated-label"
              onClick={() => update({ donated: !form.donated })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${form.donated ? 'bg-brand' : 'bg-slate-300'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.donated ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function CheckOutModal({ visitor, onClose, onSaved }) {
  const [time, setTime] = useState(nowLocal());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const v = validate({ ...visitor, contact_number: visitor.contact_number || '0000000', check_in_time: toInput(visitor.check_in_time), check_out_time: time }, { requireOut: true });
    if (v.check_out_time) { setError(new Error(v.check_out_time)); return; }
    setSaving(true); setError(null);
    try { onSaved((await api(`/visitors/${visitor.visitor_id}/check-out`, { method: 'PUT', body: { check_out_time: time } })).data); }
    catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Check out ${visitor.visitor_name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Check out</Button></>}>
      <ErrorNote error={error} />
      <p className="mb-3 text-sm text-slate-600">Checked in {formatDateTime(visitor.check_in_time)}.</p>
      <Field label="Time out" required><input className="input" type="datetime-local" max={nowLocal()} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ filters
const DATE_OPTIONS = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'last7', label: 'Last 7 days' },
  { key: 'all', label: 'All dates' }, { key: 'custom', label: 'Custom range' },
];
const TIME_OPTIONS = [
  { key: 'any', label: 'Any time' }, { key: 'morning', label: 'Morning (12:00 AM to 11:59 AM)' },
  { key: 'afternoon', label: 'Afternoon (12:00 PM to 5:59 PM)' }, { key: 'evening', label: 'Evening (6:00 PM onward)' },
  { key: 'custom', label: 'Custom range' },
];
const TYPE_OPTIONS = [{ key: '', label: 'All', count: 'all' }, { key: 'visit', label: 'Just visited', count: 'visit' }, { key: 'donation', label: 'Donated', count: 'donation' }];
const DEFAULTS = { date: 'today', dateFrom: '', dateTo: '', time: 'any', timeFrom: '', timeTo: '', meal: 'all', type: '', openOnly: false };
const isDefault = (f) => Object.keys(DEFAULTS).every((k) => f[k] === DEFAULTS[k]);
const control = 'input h-10';
const fmt12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${(h % 12) || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };

/** Asks whether to keep or remove the donation when deleting a donated visit. */
function DeleteVisitModal({ visitor, onClose, onDone }) {
  const donated = visitor.visit_type === 'donation';
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('Entered by mistake');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (donated && !choice) { setError(new Error('Choose what happens to the donation.')); return; }
    setBusy(true); setError(null);
    try {
      const res = await api(`/visitors/${visitor.visitor_id}${donated ? `?donation=${choice}${choice === 'void' ? `&reason=${encodeURIComponent(reason)}` : ''}` : ''}`, { method: 'DELETE' });
      onDone(res.message);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Remove visitor record?" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Remove visit</Button></>}>
      <div className="space-y-3 text-sm text-slate-600">
        <ErrorNote error={error} />
        <p>The visit record for <strong>{visitor.visitor_name}</strong> ({formatDateTime(visitor.check_in_time)}) will be removed from the visitor log. It is kept in the archive.</p>
        {donated && (
          <fieldset className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <legend className="px-1 text-sm font-medium text-amber-900">This visit has a donation<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="donation-choice" className="mt-0.5 accent-brand" checked={choice === 'keep'} onChange={() => setChoice('keep')} />
              <span><span className="font-medium text-navy-900">Keep the donation</span> on the Donations page (it is no longer linked to a visit).</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="donation-choice" className="mt-0.5 accent-brand" checked={choice === 'void'} onChange={() => setChoice('void')} />
              <span><span className="font-medium text-navy-900">Void the donation.</span> It stays on the Donations page as Voided (never deleted), is left out of totals, and any items it added are taken back out of Inventory.</span>
            </label>
            {choice === 'void' && (
              <label className="block text-sm">
                <span className="font-medium text-navy-900">Void reason</span>
                <select className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {['Entered by mistake', 'Duplicate entry', 'Payment not received'].map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            )}
            <p className="text-xs text-amber-900">Your choice is recorded in the audit log.</p>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

export default function Visitors() {
  const { user } = useAuth();
  const { query, toast } = useApp();
  const isAdmin = user.role === 'Admin';
  // Recording a walk-in donation uses the Donations module, so it needs the Donations duty (server-enforced).
  const canDonate = hasDuty(user, 'donations');
  const [f, setF] = useState(DEFAULTS);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  // Meal periods come from the server config (backend/src/config/visitorFilters.js).
  const mealReq = useApi('/visitors/filter-options');
  const meals = mealReq.data?.data?.meal_periods || [];
  const [limit, setLimit] = useState(20);

  const dateError = f.date === 'custom' && f.dateFrom && f.dateTo && f.dateFrom > f.dateTo ? 'From must be on or before To.' : null;
  const params = {
    date: f.date,
    date_from: f.date === 'custom' ? f.dateFrom || undefined : undefined,
    date_to: f.date === 'custom' ? f.dateTo || undefined : undefined,
    time: f.time === 'any' ? undefined : f.time,
    time_from: f.time === 'custom' ? f.timeFrom || undefined : undefined,
    time_to: f.time === 'custom' ? f.timeTo || undefined : undefined,
    meal: f.meal === 'all' ? undefined : f.meal,
    type: f.type || undefined,
    open: f.openOnly ? 1 : undefined,
    q: query,
  };
  // Any filter change goes back to page 1; paging is done on the server with every filter applied.
  const [page, setPage] = usePageState(`${qs(params)}|${limit}`);
  const { data, loading, error, reload } = useApi(dateError ? null : `/visitors${qs({ ...params, page, limit })}`);
  const [form, setForm] = useState(null); // 'new' | visitor
  const [checkingOut, setCheckingOut] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [donatingFor, setDonatingFor] = useState(null); // visit the shared donation form is open for
  const rows = data?.data || [];
  const counts = data?.counts || {};

  // A chip for every active filter (anything other than the defaults), each removable.
  const chips = [];
  const label = (list, key) => list.find((o) => o.key === key)?.label;
  if (f.date === 'custom') {
    chips.push({ key: 'date', label: `Date: ${f.dateFrom || 'any'} to ${f.dateTo || 'any'}`, clear: () => set({ date: 'today', dateFrom: '', dateTo: '' }) });
  } else if (f.date !== 'today') chips.push({ key: 'date', label: `Date: ${label(DATE_OPTIONS, f.date)}`, clear: () => set({ date: 'today' }) });
  if (f.time === 'custom') {
    chips.push({ key: 'time', label: `Time in: ${fmt12(f.timeFrom) || '12:00 AM'} to ${fmt12(f.timeTo) || '11:59 PM'}`, clear: () => set({ time: 'any', timeFrom: '', timeTo: '' }) });
  } else if (f.time !== 'any') chips.push({ key: 'time', label: `Time: ${label(TIME_OPTIONS, f.time).replace(/ \(.*\)$/, '')}`, clear: () => set({ time: 'any' }) });
  if (f.meal !== 'all') {
    const m = meals.find((x) => x.key === f.meal);
    chips.push({ key: 'meal', label: `Meal: ${m ? `${m.label} (${fmt12(m.start)} to ${fmt12(m.end)})` : f.meal}`, clear: () => set({ meal: 'all' }) });
  }
  if (f.type) chips.push({ key: 'type', label: `Visit type: ${TYPE_OPTIONS.find((t) => t.key === f.type)?.label}`, clear: () => set({ type: '' }) });
  if (f.openOnly) chips.push({ key: 'open', label: 'Still on site', clear: () => set({ openOnly: false }) });
  if (query) chips.push({ key: 'q', label: `Search: "${query}"`, clear: null });
  const filtered = !isDefault(f) || Boolean(query);
  const reset = () => setF(DEFAULTS);

  return (
    <>
      <PageHeader title="Visitors" description="Log each visit, including walk-in donations. Donations logged here appear on the Donations page automatically."
        actions={<Button onClick={() => setForm('new')}><UserPlus className="h-4 w-4" /> Check in visitor</Button>} />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-2">
            <Field label="Date">
              <div className="flex gap-2">
                <select className={control} value={f.date} onChange={(e) => set({ date: e.target.value })}>
                  {DATE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <Button type="button" variant={f.date === 'all' ? 'dark' : 'secondary'} className="h-10 shrink-0" aria-pressed={f.date === 'all'} onClick={() => set({ date: 'all', dateFrom: '', dateTo: '' })}>All dates</Button>
              </div>
            </Field>
          </div>
          <div className="space-y-2">
            <Field label="Time in">
              <select className={control} value={f.time} onChange={(e) => set({ time: e.target.value })}>
                {TIME_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="space-y-2">
            <Field label="Meal period">
              <select className={control} value={f.meal} onChange={(e) => set({ meal: e.target.value })}>
                <option value="all">All</option>
                {meals.map((m) => <option key={m.key} value={m.key}>{m.label} ({fmt12(m.start)} to {fmt12(m.end)})</option>)}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="mb-1.5 block text-sm font-medium text-navy-800">Visit type</span>
            <div className="inline-flex h-10 w-full rounded-lg bg-slate-100 p-1 lg:w-auto" role="group" aria-label="Visit type">
              {TYPE_OPTIONS.map((t) => (
                <button key={t.key || 'all'} type="button" aria-pressed={f.type === t.key} onClick={() => set({ type: t.key })}
                  className={`flex-1 whitespace-nowrap rounded-md px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 lg:flex-none ${f.type === t.key ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900'}`}>
                  {t.label} <span className="tabular-nums text-slate-400">{counts[t.count] ?? ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {(f.date === 'custom' || f.time === 'custom') && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {f.date === 'custom' && <>
              <Field label="From date" error={dateError}><input className={`${control} ${dateError ? badInput : ''}`} type="date" value={f.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} /></Field>
              <Field label="To date"><input className={control} type="date" value={f.dateTo} onChange={(e) => set({ dateTo: e.target.value })} /></Field>
            </>}
            {f.time === 'custom' && <>
              <Field label="From time"><input className={control} type="time" value={f.timeFrom} onChange={(e) => set({ timeFrom: e.target.value })} /></Field>
              <Field label="To time"><input className={control} type="time" value={f.timeTo} onChange={(e) => set({ timeTo: e.target.value })} /></Field>
            </>}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm">
          <label className="inline-flex items-center gap-2 text-slate-600">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={f.openOnly} onChange={(e) => set({ openOnly: e.target.checked })} /> Still on site only
          </label>
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {c.label}
              {c.clear && <button type="button" onClick={c.clear} aria-label={`Remove ${c.label}`} className="rounded-full hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><X className="h-3 w-3" /></button>}
            </span>
          ))}
          <span className="ml-auto text-slate-500" aria-live="polite">{data?.pagination?.total ?? rows.length} visitor{(data?.pagination?.total ?? rows.length) === 1 ? '' : 's'}</span>
          {!isDefault(f) && <Button size="sm" variant="ghost" onClick={reset}>Clear filters</Button>}
        </div>
      </Card>

      <Card>
        {dateError ? <div className="p-5 text-sm text-red-600">{dateError}</div>
          : loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
            filtered
              ? <EmptyState icon={Users} title="No visitors match these filters" description="Try another date or time, or clear the search." action={<Button variant="secondary" onClick={reset}>Reset filters</Button>} />
              : <EmptyState icon={Users} title="No visitors today" description="Check in a visitor to start today's log." />
          ) : (
            <Table>
              <thead className="bg-slate-50"><tr>
                <th className="th">Visitor</th><th className="th">Contact</th><th className="th">Purpose</th><th className="th">Visit type</th>
                <th className="th">Time in</th><th className="th">Time out</th><th className="th"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((v) => (
                  <tr key={v.visitor_id}>
                    <td className="td"><p className="font-medium text-navy-900">{v.visitor_name}</p>{v.logged_by_name && <p className="text-xs text-slate-500">Logged by {v.logged_by_name}</p>}</td>
                    <td className="td whitespace-nowrap">{v.contact_number || <span className="text-slate-400">-</span>}</td>
                    <td className="td max-w-xs">{v.purpose}</td>
                    <td className="td max-w-[14rem]"><DonationSummary v={v} /></td>
                    <td className="td whitespace-nowrap">{formatDateTime(v.check_in_time)}</td>
                    <td className="td whitespace-nowrap">{v.check_out_time ? formatDateTime(v.check_out_time) : <Badge tone="green">on site</Badge>}</td>
                    <td className="td whitespace-nowrap text-right">
                      {v.visit_type !== 'donation' && canDonate && <Button size="sm" variant="secondary" onClick={() => setDonatingFor(v)}><HandCoins className="h-3.5 w-3.5" /> Record donation</Button>}{' '}
                      {!v.check_out_time && <Button size="sm" onClick={() => setCheckingOut(v)}><LogOut className="h-3.5 w-3.5" /> Time out</Button>}{' '}
                      <Button size="sm" variant="ghost" aria-label="Edit visit" onClick={() => setForm(v)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {isAdmin && <Button size="sm" variant="ghost" aria-label="Delete visit" onClick={() => setDeleting(v)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        <Pagination pagination={data?.pagination} onPageChange={setPage} onLimitChange={(l) => setLimit(l)} label="visitors" />
      </Card>

      {form && <VisitorForm initial={form === 'new' ? null : form} canDonate={canDonate} onClose={() => setForm(null)}
        onSaved={async (v, { created, openDonation }) => {
          setForm(null); await reload();
          toast(created ? `${v.visitor_name} checked in.` : 'Changes saved.');
          if (openDonation) setDonatingFor(v);
        }} />}
      {donatingFor && <DonationForm visit={donatingFor} onClose={() => setDonatingFor(null)}
        onSaved={async () => { setDonatingFor(null); await reload(); toast('Donation recorded. The visit now shows as Donated.'); }} />}
      {checkingOut && <CheckOutModal visitor={checkingOut} onClose={() => setCheckingOut(null)}
        onSaved={async (v) => { setCheckingOut(null); await reload(); toast(`${v.visitor_name} checked out.`); }} />}
      {deleting && <DeleteVisitModal visitor={deleting} onClose={() => setDeleting(null)}
        onDone={async (message) => { setDeleting(null); await reload(); toast(message); }} />}
    </>
  );
}
