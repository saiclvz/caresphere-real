import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Ban, Download, Eye, FileSpreadsheet, HandCoins, Package, Pencil, Plus, ScanLine, SlidersHorizontal, Users, Wallet } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, download, downloadSigned, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Spinner, Table, TAB_ROW, tabClass } from '../components/ui';
import Pagination from '../components/Pagination';
import VerifyReceiptModal from '../components/VerifyReceiptModal';
import DonationForm from '../components/DonationForm';
import DonationSummary from './DonationReports';
import ToVerifyQueue from '../components/donations/ToVerifyQueue';
import Reconciliation from '../components/donations/Reconciliation';
import CashCounts from '../components/donations/CashCounts';
import { canVerifyDonations } from '../lib/duties';
import { formatDateTime, formatMoney } from '../lib/format';
import { SOURCE_LABEL, SOURCE_TONE, allocationText, statusMeta, typeMethod, inKindTotal } from '../lib/donations';

/** Filters live in the URL (shareable, back button works). Empty values are left out. */
const FILTER_KEYS = ['date', 'date_from', 'date_to', 'type', 'source', 'status', 'q', 'method', 'receipt', 'purpose', 'donor_type', 'needs_review', 'value_missing', 'attention', 'page', 'limit'];
const MORE_KEYS = ['method', 'receipt', 'purpose', 'donor_type', 'needs_review', 'value_missing'];
const DATE_OPTIONS = [['all', 'All dates'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['last7', 'Last 7 days'], ['custom', 'Custom range']];

export function StatusBadge({ status }) {
  const m = statusMeta(status);
  const Icon = m.icon;
  return <Badge tone={m.tone}><Icon className="mr-1 inline h-3 w-3" aria-hidden />{status}</Badge>;
}

export function SourceChip({ group }) {
  return <Badge tone={SOURCE_TONE[group]}>{SOURCE_LABEL[group]}</Badge>;
}

/** Amount or value: cash amounts are real; in-kind shows the estimate, or "Value not set" (never ₱0.00). */
export function AmountCell({ d, linkToItems = true }) {
  if (!d.in_kind) return <span className="font-semibold tabular-nums text-navy-900">{formatMoney(d.amount)}</span>;
  if (d.estimated_value !== null && d.estimated_value !== undefined) return <span className="tabular-nums text-navy-900">{formatMoney(d.estimated_value)} <span className="text-xs text-slate-500">estimated</span></span>;
  return (
    <span className="text-xs">
      <span className="text-amber-800">Value not set</span>
      {linkToItems && d.status !== 'Voided' && <Link to={`/donations/${d.donation_id}?tab=items`} className="block font-medium text-brand hover:underline">Add value</Link>}
    </span>
  );
}

export function AllocationCell({ d }) {
  if (d.allocation?.length) {
    return (
      <ul className="space-y-0.5 text-xs">
        {d.allocation.map((l) => (
          <li key={l.allocation_id} className={l.needs_review ? 'text-amber-800' : 'text-navy-900'}>
            {l.needs_review && <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />}{allocationText(l, formatMoney)}{l.needs_review && <span className="ml-1 font-medium">· Needs review</span>}
          </li>
        ))}
      </ul>
    );
  }
  if (d.allocation_text) return <span className="text-xs text-amber-800"><AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />{d.allocation_text} · Needs review</span>;
  if (['Pending verification', 'Rejected', 'Voided'].includes(d.status)) return <span className="text-xs text-slate-400">-</span>;
  return <Badge tone="amber">Not set</Badge>;
}

/** Edit: before acknowledgment only (the server checks). */
function EditDonation({ d, options, onClose, onSaved }) {
  const [v, setV] = useState({ amount: String(d.amount), purpose: d.purpose || '', description: d.item_description || '', anonymous: d.is_anonymous });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null); setErrors({});
    try {
      await api(`/donations/${d.donation_id}`, { method: 'PUT', body: { ...(d.in_kind ? {} : { amount: Number(v.amount) }), purpose: v.purpose, description: v.description, anonymous: v.anonymous } });
      onSaved();
    } catch (err) { if (err.details?.errors) setErrors(err.details.errors); setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Edit ${d.donation_no}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save changes</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <p className="text-xs text-slate-500">Editing is possible until the acknowledgment is issued. After that, changes are corrections with a reason (on the donation page). Change the allocation on the donation page.</p>
        {!d.in_kind && <Field label="Amount (₱)" required error={errors.amount}><input className="input" type="number" min="0.01" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>}
        <Field label="Purpose" required error={errors.purpose}>
          <select className="input" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}>{options.programs.map((p) => <option key={p}>{p}</option>)}</select>
        </Field>
        <Field label="Description" required><textarea className="input" rows={2} maxLength={2000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm text-navy-900"><input type="checkbox" className="h-4 w-4 accent-brand" checked={v.anonymous} onChange={(e) => setV({ ...v, anonymous: e.target.checked })} /> Anonymous donation</label>
      </div>
    </Modal>
  );
}

/** Void (Admin) or request a void (Staff). A reason is required; "Other" needs a note. */
export function VoidDialog({ d, options, isAdmin, onClose, onDone }) {
  const [v, setV] = useState({ reason: '', note: '', correction: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [needsCorrection, setNeedsCorrection] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const e = {};
    if (!v.reason) e.reason = 'Choose the reason.';
    if (v.reason === 'Other' && !v.note.trim()) e.note = 'Describe the reason.';
    if (v.correction && !v.note.trim()) e.note = 'Explain the correction.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try {
      const res = await api(`/donations/${d.donation_id}/${isAdmin ? 'void' : 'void-request'}`, { method: 'POST', body: { reason: v.reason, note: v.note.trim(), correction: v.correction } });
      onDone(res.message);
    } catch (err) {
      if (err.details?.needs_correction) setNeedsCorrection(true);
      if (err.details?.errors) setErrors(err.details.errors);
      setError(err);
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={isAdmin ? `Void ${d.donation_no}?` : `Request a void of ${d.donation_no}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>{isAdmin ? 'Void donation' : 'Send request'}</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorNote error={error} />
        <p className="text-slate-600">{isAdmin
          ? 'The donation stays in the list with a "Voided" chip and the reason, and is left out of every total and report. Stock it added is taken back out with reversal entries. This is recorded in the audit log.'
          : 'An administrator reviews the request. Until then the donation stays as it is.'}</p>
        <Field label="Reason" required error={errors.reason}>
          <select className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>
            <option value="">Choose...</option>{options.void_reasons.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label={v.reason === 'Other' || v.correction ? 'Note' : 'Note (optional)'} required={v.reason === 'Other' || v.correction} error={errors.note}>
          <textarea className="input" rows={2} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
        {isAdmin && needsCorrection && (
          <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-amber-900">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={v.correction} onChange={(e) => setV({ ...v, correction: e.target.checked })} />
            Record this void as a correction. Items already distributed stay distributed; only what is left is reversed.
          </label>
        )}
      </div>
    </Modal>
  );
}

function Cards({ cards, onPick, canSeeDonors, navigate }) {
  if (!cards) return null;
  const items = [
    { key: 'cash', icon: Wallet, label: 'Cash (verified)', value: formatMoney(cards.cash.total), sub: `${cards.cash.count} donation${cards.cash.count === 1 ? '' : 's'}`, filter: { type: 'cash', status: 'counted' } },
    { key: 'in_kind', icon: Package, label: 'In-kind (estimated value)', value: inKindTotal(cards.in_kind.count, cards.in_kind.estimated_value, formatMoney), sub: cards.in_kind.no_value ? `${cards.in_kind.no_value} with no value yet` : `${cards.in_kind.count} donation${cards.in_kind.count === 1 ? '' : 's'}`, filter: { type: 'in_kind', status: 'counted' }, subFilter: cards.in_kind.no_value ? { type: 'in_kind', value_missing: '1' } : null },
    { key: 'donations', icon: HandCoins, label: 'Donations', value: cards.donations, sub: 'verified or accepted', filter: { status: 'counted' } },
    { key: 'donors', icon: Users, label: 'Donors', value: cards.donors, sub: canSeeDonors ? 'open the donor list' : 'giving donors', filter: canSeeDonors ? null : { status: 'counted' }, go: canSeeDonors ? '/donors' : null },
    { key: 'attention', icon: AlertTriangle, label: 'Needs attention', value: cards.needs_attention, sub: 'waiting for a person', filter: { attention: '1' }, warn: cards.needs_attention > 0 },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Donation totals (verified or accepted, never voided)">
      {items.map(({ key, icon: Icon, label, value, sub, filter, subFilter, go, warn }) => (
        <div key={key} className={`relative rounded-xl border bg-white p-4 shadow-card ${warn ? 'border-amber-200' : 'border-slate-200/70'}`}>
          <button type="button" onClick={() => (go ? navigate(go) : onPick(filter))} className="block w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-500"><Icon className={`h-4 w-4 ${warn ? 'text-amber-600' : 'text-brand'}`} aria-hidden /> {label}</span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums text-navy-900">{value}</span>
            {!subFilter && <span className="block text-xs text-slate-500">{sub}</span>}
          </button>
          {subFilter && <button type="button" onClick={() => onPick(subFilter)} className="rounded text-xs font-medium text-amber-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">{sub}</button>}
        </div>
      ))}
    </div>
  );
}

export default function Donations() {
  const { user } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const verifier = canVerifyDonations(user);
  const VIEWS = [['list', 'Donations'], ...(verifier ? [['verify', 'To verify'], ['reconciliation', 'Reconciliation']] : []), ['cash', 'Cash count'], ['summary', 'Summary']];
  const view = VIEWS.some(([k]) => k === params.get('view')) ? params.get('view') : 'list';
  const summary = view === 'summary';
  const [tick, setTick] = useState(0);
  const setF = (patch, keepPage = false) => setParams((p) => {
    const n = new URLSearchParams(p);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    if (!keepPage) n.delete('page');
    return n;
  }, { replace: true });
  const [search, setSearch] = useState(f.q);
  useEffect(() => { const t = setTimeout(() => { if (search.trim() !== f.q) setF({ q: search.trim() }); }, 350); return () => clearTimeout(t); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const [more, setMore] = useState(() => MORE_KEYS.some((k) => f[k]));
  const rangeError = f.date === 'custom' && f.date_from && f.date_to && f.date_from > f.date_to ? 'From must be on or before To.' : null;
  const apiQuery = Object.fromEntries(Object.entries({ ...f, page: f.page || '1', limit: f.limit || '20' }).filter(([, v]) => v));
  const { data, loading, error, reload } = useApi(rangeError || view !== 'list' ? null : `/donations${qs(apiQuery)}`);
  const optionsApi = useApi('/donations/options');
  const options = optionsApi.data?.data || { methods: [], statuses: [], programs: [], void_reasons: [], donor_types: [], can_see_donors: false };
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(null);
  const rows = data?.data || [];
  const shown = data?.meta?.shown ?? 0;
  const filtered = FILTER_KEYS.filter((k) => !['page', 'limit'].includes(k)).some((k) => f[k] && !(k === 'date' && f[k] === 'all'));
  const clear = () => { setSearch(''); setParams(summary ? { view: 'summary' } : {}, { replace: true }); };
  const showView = (v) => setParams((p) => { const n = new URLSearchParams(v === 'summary' ? p : v === 'list' ? p : ''); if (v === 'list') n.delete('view'); else n.set('view', v); n.delete('page'); n.delete('queue'); return n; }, { replace: true });
  const dateQuery = Object.fromEntries(Object.entries({ date: f.date || 'all', date_from: f.date === 'custom' ? f.date_from : '', date_to: f.date === 'custom' ? f.date_to : '' }).filter(([, v]) => v));

  const ack = async (d) => {
    setBusy(d.donation_id);
    try { await downloadSigned(`/donations/${d.donation_id}/receipt/link`, `CareSphere-Acknowledgment-${d.donation_no}.pdf`); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const exportCsv = async () => {
    setBusy('export');
    try { await download(`/donations/export${qs(Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !['page', 'limit'].includes(k))))}`, 'donations.csv'); toast('Exported with donor codes only. The export was logged.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };

  const dateFields = (
    <>
      <Field label="Date" className="w-36">
        <select className="input h-10" value={f.date || 'all'} onChange={(e) => setF({ date: e.target.value === 'all' ? '' : e.target.value, ...(e.target.value !== 'custom' ? { date_from: '', date_to: '' } : {}) })}>
          {DATE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      {f.date === 'custom' && <>
        <Field label="From" className="w-40" error={rangeError}><input className="input h-10" type="date" value={f.date_from} onChange={(e) => setF({ date_from: e.target.value })} /></Field>
        <Field label="To" className="w-40"><input className="input h-10" type="date" value={f.date_to} onChange={(e) => setF({ date_to: e.target.value })} /></Field>
      </>}
    </>
  );

  return (
    <>
      <PageHeader title="Donations" description="Every donation in one place: walk-in visitors, gifts donors reported after using the home's QR codes, and gifts recorded by staff. All donations are general."
        actions={<>
          <Button variant="secondary" onClick={() => setVerifying(true)}><ScanLine className="h-4 w-4" aria-hidden /> Verify receipt</Button>
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Record donation</Button>
        </>} />
      {!options.can_see_donors && optionsApi.data && (
        <p className="mb-3 text-xs text-slate-500">Donor names and contact details need the Donor directory duty: you see donor codes and initials. Search works by donation number or donor code.</p>
      )}
      <div role="tablist" aria-label="Donations view" className={TAB_ROW}>
        {VIEWS.map(([k, l]) => {
          const on = k === view;
          return <button key={k} type="button" role="tab" aria-selected={on} onClick={() => showView(k)}
            className={tabClass(on)}>{l}</button>;
        })}
      </div>
      {view === 'verify' ? <ToVerifyQueue onChanged={reload} /> : view === 'reconciliation' ? <Reconciliation onChanged={reload} /> : view === 'cash' ? <CashCounts /> : summary ? (
        <>
          <Card className="mb-4 p-3">
            <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Summary period">{dateFields}</div>
          </Card>
          {rangeError ? <p className="text-sm text-red-600">{rangeError}</p> : <DonationSummary key={tick} query={dateQuery} />}
        </>
      ) : (<>
      <Cards cards={data?.meta?.cards} canSeeDonors={options.can_see_donors} navigate={navigate} onPick={(filter) => { setSearch(''); setParams(new URLSearchParams(filter), { replace: true }); }} />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter donations">
          {dateFields}
          <Field label="Type" className="w-32">
            <select className="input h-10" value={f.type} onChange={(e) => setF({ type: e.target.value })}><option value="">Both</option><option value="cash">Cash</option><option value="in_kind">In-kind</option></select>
          </Field>
          <Field label="Source" className="w-40">
            <select className="input h-10" value={f.source} onChange={(e) => setF({ source: e.target.value })}>
              <option value="">All sources</option>{Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Status" className="w-48">
            <select className="input h-10" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
              <option value="">All statuses</option><option value="counted">Verified or accepted</option>{options.statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Search" className="min-w-[12rem] flex-1">
            <input className="input h-10" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={options.can_see_donors ? 'Donation number or donor' : 'Donation number or donor code'} />
          </Field>
          <Button variant="secondary" className="h-10" aria-expanded={more} aria-controls="more-filters" onClick={() => setMore(!more)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> More filters{MORE_KEYS.filter((k) => f[k]).length ? ` (${MORE_KEYS.filter((k) => f[k]).length})` : ''}
          </Button>
        </div>
        {more && (
          <div id="more-filters" className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <Field label="Method" className="w-44">
              <select className="input h-10" value={f.method} onChange={(e) => setF({ method: e.target.value })}>
                <option value="">All methods</option>{options.methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Receipt" className="w-40">
              <select className="input h-10" value={f.receipt} onChange={(e) => setF({ receipt: e.target.value })}><option value="">Any</option><option value="issued">Issued</option><option value="not_issued">Not issued</option></select>
            </Field>
            <Field label="Purpose" className="w-48">
              <select className="input h-10" value={f.purpose} onChange={(e) => setF({ purpose: e.target.value })}><option value="">All purposes</option>{options.programs.map((p) => <option key={p}>{p}</option>)}</select>
            </Field>
            <Field label="Donor type" className="w-44">
              <select className="input h-10" value={f.donor_type} onChange={(e) => setF({ donor_type: e.target.value })}>
                <option value="">All donors</option>{options.donor_types.map((t) => <option key={t}>{t}</option>)}<option value="anonymous">Anonymous</option>
              </select>
            </Field>
            <label className="flex h-10 items-center gap-2 text-sm text-navy-900"><input type="checkbox" className="h-4 w-4 accent-brand" checked={f.needs_review === '1'} onChange={(e) => setF({ needs_review: e.target.checked ? '1' : '' })} /> Allocation needs review</label>
            <label className="flex h-10 items-center gap-2 text-sm text-navy-900"><input type="checkbox" className="h-4 w-4 accent-brand" checked={f.value_missing === '1'} onChange={(e) => setF({ value_missing: e.target.checked ? '1' : '' })} /> Value not set</label>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2 text-sm text-slate-500" aria-live="polite">
          <span>{loading && !data ? 'Loading...' : `${shown} donation${shown === 1 ? '' : 's'} shown`}{f.attention ? ' · needs attention' : ''}</span>
          {filtered && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
          <Button size="sm" variant="ghost" className="ml-auto" loading={busy === 'export'} onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Export (donor codes)</Button>
        </div>
      </Card>

      <Card>
        {rangeError ? <div className="p-5 text-sm text-red-600">{rangeError}</div>
          : loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
            filtered
              ? <EmptyState icon={HandCoins} title="No donations match these filters" description="Try a wider date range, or clear the filters." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
              : <EmptyState icon={HandCoins} title="No donations yet" action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Record donation</Button>} />
          ) : (
            <Table label="Donations">
              <thead className="bg-slate-50"><tr>
                <th className="th">Donation</th><th className="th">Donor</th><th className="th">Type and method</th><th className="th text-right">Amount or value</th>
                <th className="th">Purpose</th><th className="th">Status</th><th className="th">Allocation</th><th className="th"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => {
                  const voided = d.status === 'Voided';
                  return (
                    <tr key={d.donation_id} className={voided ? 'bg-slate-50/60' : undefined}>
                      <td className="td whitespace-nowrap">
                        <Link to={`/donations/${d.donation_id}`} className="font-mono font-medium text-brand hover:underline">{d.donation_no}</Link>
                        <p className="text-xs text-slate-500">{formatDateTime(d.created_at)}</p>
                      </td>
                      <td className="td">
                        {options.can_see_donors && d.donor_ref_id && !d.is_anonymous
                          ? <Link to={`/donors/${d.donor_ref_id}`} className="font-medium text-navy-900 hover:text-brand hover:underline">{d.donor_display}</Link>
                          : <span className="font-medium text-navy-900">{d.donor_display}</span>}
                        <div className="mt-0.5"><SourceChip group={d.source_group} /></div>
                      </td>
                      <td className="td">
                        <p className="text-navy-900">{typeMethod(d)}</p>
                        {d.in_kind && d.items_summary && <p className="max-w-[14rem] truncate text-xs text-slate-500" title={d.items_summary}>{d.items_summary}</p>}
                      </td>
                      <td className="td whitespace-nowrap text-right"><AmountCell d={d} /></td>
                      <td className="td text-sm">{d.purpose || <span className="text-slate-400">-</span>}</td>
                      <td className="td">
                        <StatusBadge status={d.status} />
                        {voided ? <p className="mt-0.5 text-xs text-red-700">{d.void_reason}{d.void_note ? `: ${d.void_note}` : ''}</p>
                          : <p className={`mt-0.5 text-xs ${d.has_acknowledgment ? 'text-emerald-700' : 'text-slate-500'}`}>{d.has_acknowledgment ? 'Receipt issued' : 'Receipt not issued'}</p>}
                        {d.void_requested && !voided && <Badge tone="amber">Void requested</Badge>}
                      </td>
                      <td className="td max-w-[16rem]"><AllocationCell d={d} /></td>
                      <td className="td">
                        <div className="flex justify-end gap-0.5">
                          <Button size="sm" variant="ghost" title="View" onClick={() => navigate(`/donations/${d.donation_id}`)}><Eye className="h-4 w-4" aria-hidden /><span className="sr-only">View {d.donation_no}</span></Button>
                          <Button size="sm" variant="ghost" title={d.can_edit ? 'Edit' : d.can_correct ? 'Acknowledged: make a correction on the donation page' : 'Cannot be edited'} disabled={!d.can_edit} onClick={() => setEditing(d)}>
                            <Pencil className="h-4 w-4" aria-hidden /><span className="sr-only">Edit {d.donation_no}</span>
                          </Button>
                          <Button size="sm" variant="ghost" title={d.can_download ? 'Download acknowledgment' : 'No acknowledgment yet'} disabled={!d.can_download} loading={busy === d.donation_id} onClick={() => ack(d)}>
                            <Download className="h-4 w-4" aria-hidden /><span className="sr-only">Download acknowledgment for {d.donation_no}</span>
                          </Button>
                          {(d.can_void || d.can_request_void) && (
                            <Button size="sm" variant="ghost" className="text-red-700" title={isAdmin ? 'Void' : 'Request a void'} onClick={() => setVoiding(d)}>
                              <Ban className="h-4 w-4" aria-hidden /><span className="sr-only">{isAdmin ? 'Void' : 'Request a void of'} {d.donation_no}</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        <Pagination pagination={data?.pagination} label="donations" onPageChange={(p) => setF({ page: String(p) }, true)} onLimitChange={(l) => setF({ limit: String(l) })} />
      </Card>
      </>)}

      {adding && <DonationForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toast('Donation recorded.'); reload(); setTick((t) => t + 1); }} />}
      {editing && <EditDonation d={editing} options={options} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Donation updated.'); reload(); }} />}
      {voiding && <VoidDialog d={voiding} options={options} isAdmin={isAdmin} onClose={() => setVoiding(null)} onDone={(m) => { setVoiding(null); toast(m); reload(); }} />}
      <VerifyReceiptModal open={verifying} onClose={() => setVerifying(false)} />
    </>
  );
}
