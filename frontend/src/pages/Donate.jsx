import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Baby, CheckCircle2, Gift, HeartHandshake } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import AuthImage from '../components/AuthImage';
import { Button, Card, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner } from '../components/ui';
import { formatMoney } from '../lib/format';
import { uuid } from '../lib/files';

const METHODS = ['GCash', 'Maya', 'Bank Transfer', 'Cash', 'Check', 'In-kind'];
const EMPTY = { payment_method: 'GCash', amount: '', item_description: '', reason_for_donation: '' };

function validate(form, selected) {
  const e = {};
  if (selected.length === 0) e.children = 'Select at least one child to support.';
  const amount = Number(form.amount);
  if (!form.amount || !Number.isFinite(amount) || amount <= 0) {
    e.amount = form.payment_method === 'In-kind' ? 'Enter the estimated value of the items.' : 'Enter an amount greater than zero.';
  } else if (amount >= 100000000) e.amount = 'Amount must be below 100,000,000.';
  if (form.payment_method === 'In-kind' && !form.item_description.trim()) e.item_description = 'Describe the items you are donating.';
  if (!form.reason_for_donation.trim()) e.reason_for_donation = 'Please provide a reason for your donation.';
  return e;
}

export default function Donate() {
  const { query } = useApp();
  const { data, loading, error, reload } = useApi(`/public-children${qs({ q: query })}`);
  const children = data?.data || [];
  const [selected, setSelected] = useState([]); // [{ child_id, display_name }]
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [done, setDone] = useState(null);
  // One key per donation attempt: resubmitting (double click, retry) cannot create a duplicate.
  const keyRef = useRef(uuid());

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const isSelected = (id) => selected.some((c) => c.child_id === id);
  const toggle = (c) => {
    setSelected((list) => (isSelected(c.child_id) ? list.filter((x) => x.child_id !== c.child_id) : [...list, { child_id: c.child_id, display_name: c.display_name }]));
    setErrors((x) => ({ ...x, children: undefined }));
  };

  const review = () => {
    const e = validate(form, selected);
    setErrors(e);
    if (Object.keys(e).length === 0) { setSubmitError(null); setReviewing(true); }
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api('/donor/donations', {
        method: 'POST',
        headers: { 'Idempotency-Key': keyRef.current },
        body: { ...form, amount: Number(form.amount), child_ids: selected.map((c) => c.child_id) },
      });
      setReviewing(false);
      setDone(res.data);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    keyRef.current = uuid();
    setSelected([]); setForm(EMPTY); setErrors({}); setDone(null);
  };

  if (done) {
    return (
      <Card className="mx-auto max-w-xl p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-navy-900">Thank you for your donation</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your donation of <strong>{formatMoney(done.amount)}</strong> ({done.payment_method}) for {done.supported_children} has been recorded
          and is <strong>pending</strong> until the home confirms it was received. Your receipt will be available in your donation history after that.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/donations/history"><Button variant="secondary">View donation history</Button></Link>
          <Button onClick={startOver}>Make another donation</Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Donate" description="Choose the children you want to support, tell us about your donation, and review it before you submit." />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-navy-900">1. Choose children to support</h2>
            <p className="text-sm text-slate-500">To protect their privacy, children are shown by first name and last initial only.</p>
            {errors.children && <p className="mt-2 text-sm text-red-600" role="alert">{errors.children}</p>}
          </div>
          {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : children.length === 0 ? (
            query ? <NoMatches /> : <EmptyState icon={Baby} title="No child profiles are available right now" description="Please check back later." />
          ) : (
            <ul className="grid gap-3 p-4 sm:grid-cols-2">
              {children.map((c) => {
                const on = isSelected(c.child_id);
                return (
                  <li key={c.child_id}>
                    <label className={`flex h-full cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${on ? 'border-brand bg-blue-50/60 ring-2 ring-brand/20' : 'border-slate-200 hover:border-slate-300'}`}>
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={on} onChange={() => toggle(c)} aria-label={`Support ${c.display_name}`} />
                      <AuthImage src={c.photo_url} alt={c.display_name} className="h-14 w-14 shrink-0 rounded-lg" />
                      <div className="min-w-0">
                        <p className="font-medium text-navy-900">{c.display_name}</p>
                        <p className="text-xs text-slate-500">{c.age_label} · {c.gender}</p>
                        {c.public_bio && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{c.public_bio}</p>}
                        {c.urgent_needs && <p className="mt-1 line-clamp-2 text-xs text-amber-800">Needs: {c.urgent_needs}</p>}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="h-fit p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold text-navy-900">2. Donation details</h2>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {selected.length ? <>Supporting <strong>{selected.map((c) => c.display_name).join(', ')}</strong></> : 'No children selected yet.'}
            </p>
            <Field label="Donation type / method">
              <select className="input" value={form.payment_method} onChange={set('payment_method')}>
                {METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label={form.payment_method === 'In-kind' ? 'Estimated value (PHP)' : 'Amount (PHP)'} error={errors.amount}>
              <input className="input" type="number" min="1" step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} aria-invalid={!!errors.amount} />
            </Field>
            {form.payment_method === 'In-kind' && (
              <Field label="Items you are donating" error={errors.item_description}>
                <textarea className="input" rows={2} value={form.item_description} onChange={set('item_description')} aria-invalid={!!errors.item_description} />
              </Field>
            )}
            <Field label="Reason for donation" error={errors.reason_for_donation}>
              <textarea className="input" rows={3} value={form.reason_for_donation} onChange={set('reason_for_donation')}
                placeholder="For example: for school supplies this term" aria-invalid={!!errors.reason_for_donation} />
            </Field>
            <Button className="w-full" onClick={review}><HeartHandshake className="h-4 w-4" /> Review donation</Button>
          </div>
        </Card>
      </div>

      <Modal open={reviewing} onClose={() => !submitting && setReviewing(false)} title="Review your donation" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setReviewing(false)} disabled={submitting}>Back</Button>
          <Button onClick={submit} loading={submitting} disabled={submitting}><Gift className="h-4 w-4" /> Confirm and submit</Button>
        </>}>
        <ErrorNote error={submitError} />
        <dl className="space-y-3 text-sm">
          <div><dt className="text-slate-500">Children supported</dt><dd className="font-medium text-navy-900">{selected.map((c) => c.display_name).join(', ')}</dd></div>
          <div><dt className="text-slate-500">Type / method</dt><dd className="font-medium text-navy-900">{form.payment_method}</dd></div>
          <div><dt className="text-slate-500">{form.payment_method === 'In-kind' ? 'Estimated value' : 'Amount'}</dt><dd className="font-medium text-navy-900">{formatMoney(form.amount)}</dd></div>
          {form.item_description.trim() && <div><dt className="text-slate-500">Items</dt><dd className="whitespace-pre-wrap text-navy-900">{form.item_description.trim()}</dd></div>}
          <div><dt className="text-slate-500">Reason for donation</dt><dd className="whitespace-pre-wrap text-navy-900">{form.reason_for_donation.trim()}</dd></div>
        </dl>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          CareSphere does not process payments. Send your donation through your chosen method; staff will mark it received and your receipt will appear in your history.
        </p>
      </Modal>
    </>
  );
}
