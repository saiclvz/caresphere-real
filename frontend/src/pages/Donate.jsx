import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Check, Copy, FlaskConical, Heart, Info, Wallet } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Field, PageHeader, Spinner } from '../components/ui';
import { checkFile, MB, readFile } from '../lib/files';
import { formatMoney } from '../lib/format';

const PROOF_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const placeholder = (v) => v || <span className="text-slate-400">[set in Settings]</span>;

/** The home's bank details (from Settings > Payment details), with Copy for the account number. */
function BankDetails({ method }) {
  const [copied, setCopied] = useState(false);
  const ready = method.bank_name && method.account_name && method.account_number;
  const copy = async () => {
    try { await navigator.clipboard.writeText(method.account_number.replace(/\s+/g, '')); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setCopied(false); }
  };
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      {!ready && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="alert">The home's bank details aren't set yet, so bank transfer can't be used right now.</p>}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Bank name</dt><dd className="font-medium text-navy-900">{placeholder(method.bank_name)}</dd></div>
        <div><dt className="text-slate-500">Account name</dt><dd className="font-medium text-navy-900">{placeholder(method.account_name)}</dd></div>
        <div>
          <dt className="text-slate-500">Account number</dt>
          <dd className="flex items-center gap-2 font-mono font-medium text-navy-900">
            {placeholder(method.account_number)}
            {method.account_number && (
              <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 font-sans text-xs text-slate-600 hover:bg-slate-100" aria-label="Copy account number">
                {copied ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </button>
            )}
          </dd>
        </div>
        {method.branch && <div><dt className="text-slate-500">Branch</dt><dd className="font-medium text-navy-900">{method.branch}</dd></div>}
      </dl>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>Transfer the amount to this account.</li>
        <li>Enter your transfer reference number below.</li>
        <li>Enter the transfer date and amount. The staff check them against the home's bank statement.</li>
      </ol>
      {method.instructions && <p className="text-xs text-slate-500">{method.instructions}</p>}
    </div>
  );
}

/**
 * Donor Donate page. E-wallets go to PayMongo's secure checkout (the server sets the amount and the
 * donation is created only when PayMongo confirms payment). Bank transfer: the home's details, the
 * transfer reference, date and proof; Staff confirm it before the receipt is issued.
 */
export default function Donate() {
  const { orgName } = useApp();
  const options = useApi('/payments/options');
  const methods = options.data?.data?.methods || [];
  const demo = options.data?.data?.demo;
  const minAmount = options.data?.data?.min_amount || 20;
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ amount: '', reason: '', transfer_reference: '', transfer_date: today(), account_last4: '' });
  const [proof, setProof] = useState(null);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const method = methods.find((m) => m.code === code);
  const isBank = method?.method_type === 'manual';
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const pickProof = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkFile(file, { types: PROOF_TYPES, maxBytes: 5 * MB });
    if (problem) { setErrors((x) => ({ ...x, proof: problem })); setProof(null); return; }
    setErrors((x) => ({ ...x, proof: undefined }));
    setProof(await readFile(file));
  };

  const validate = () => {
    const e = {};
    if (!method) e.method = 'Choose a payment method.';
    const amount = Number(form.amount);
    if (!(amount >= minAmount)) e.amount = `Enter an amount of at least PHP ${minAmount}.`;
    if (!form.reason.trim()) e.reason = 'Reason for donation is required.';
    if (isBank) {
      if (!/^[A-Za-z0-9-\s]{4,100}$/.test(form.transfer_reference.trim())) e.transfer_reference = 'Enter the transfer reference number from your receipt.';
      if (!form.transfer_date || form.transfer_date > today()) e.transfer_date = 'Enter the date of the transfer (not in the future).';
      if (form.account_last4 && !/^\d{4}$/.test(form.account_last4)) e.account_last4 = 'Only the last 4 digits, or leave it empty.';
      if (!(method.bank_name && method.account_name && method.account_number)) e.method = "The home's bank details aren't set yet.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (isBank) {
        const res = await api('/payments/bank', { method: 'POST', body: {
          method_code: method.code, amount: Number(form.amount), reason: form.reason.trim(), transfer_reference: form.transfer_reference.trim(),
          transfer_date: form.transfer_date, account_last4: form.account_last4 || undefined, proof,
        } });
        setDone(res.data);
      } else {
        const res = await api('/payments/checkout', { method: 'POST', body: { method_code: method.code, amount: Number(form.amount), reason: form.reason.trim() } });
        window.location.assign(res.data.checkout_url); // PayMongo's hosted checkout
      }
    } catch (err) { setError(err); setStep('form'); } finally { setBusy(false); }
  };

  if (options.loading && !options.data) return <Spinner />;

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-6 text-center">
          <Building2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
          <h1 className="mt-3 text-xl font-semibold text-navy-900">Thank you! Your transfer was submitted.</h1>
          <p className="mt-2 text-sm text-slate-600">It is now <strong>Pending verification</strong>. The staff will check it against the home's account and confirm it. You'll get a notification, and your receipt will appear in Donation history.</p>
          <Link to="/donations/history" className="mt-4 inline-block"><Button>Go to Donation history</Button></Link>
        </Card>
      </div>
    );
  }

  const groups = ['E-wallet', 'Bank transfer'].map((g) => [g, methods.filter((m) => m.method_group === g)]).filter(([, list]) => list.length);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Donate" description="Make a general donation to support the children in our care." />
      {demo && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900" role="status">
          <FlaskConical className="h-4 w-4 shrink-0" aria-hidden /> Demo mode: no real money is charged.
        </p>
      )}
      <Card className="space-y-5 p-5">
        <ErrorNote error={error || options.error} />
        {step === 'form' ? (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-navy-800">Payment method<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></legend>
              {methods.length === 0 && <p className="text-sm text-slate-500">No payment methods are available right now. Please try again later.</p>}
              {groups.map(([group, list]) => (
                <div key={group} className="mb-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group === 'E-wallet' ? <Wallet className="h-3.5 w-3.5" aria-hidden /> : <Building2 className="h-3.5 w-3.5" aria-hidden />} {group}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((m) => (
                      <label key={m.code} className={`flex min-h-[3rem] cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${code === m.code ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="radio" name="method" className="h-4 w-4 accent-brand" checked={code === m.code} onChange={() => { setCode(m.code); setErrors((x) => ({ ...x, method: undefined })); }} />
                        <span className="font-medium text-navy-900">{m.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {errors.method && <p className="text-xs text-red-600" role="alert">{errors.method}</p>}
            </fieldset>
            {method && !isBank && method.instructions && <p className="flex gap-2 text-xs text-slate-500"><Info className="h-4 w-4 shrink-0" aria-hidden />{method.instructions}</p>}
            {isBank && <BankDetails method={method} />}
            <Field label="Amount (PHP)" required error={errors.amount}>
              <input className="input" type="number" min={minAmount} step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} />
            </Field>
            <Field label="Reason for donation" required error={errors.reason}>
              <textarea className="input" rows={2} maxLength={3000} value={form.reason} onChange={set('reason')} />
            </Field>
            {isBank && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Transfer reference number" required error={errors.transfer_reference}>
                    <input className="input font-mono uppercase" maxLength={100} value={form.transfer_reference} onChange={set('transfer_reference')} autoComplete="off" />
                  </Field>
                  <Field label="Date of transfer" required error={errors.transfer_date}>
                    <input className="input" type="date" max={today()} value={form.transfer_date} onChange={set('transfer_date')} />
                  </Field>
                </div>
                <Field label="Last 4 digits of your account (optional)" error={errors.account_last4} hint="Only to help staff match your transfer. Never enter the full number.">
                  <input className="input w-32 font-mono" inputMode="numeric" maxLength={4} value={form.account_last4} onChange={set('account_last4')} autoComplete="off" />
                </Field>
                <Field label="Bank receipt or confirmation (optional)" error={errors.proof} hint="Not required. If you have the bank's receipt or e-mail confirmation, you can attach it: JPG, PNG or PDF, up to 5 MB.">
                  <input className="input" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={pickProof} />
                  {proof && <p className="mt-1 text-xs text-emerald-700">{proof.name} ({Math.round(proof.size / 1024)} KB)</p>}
                </Field>
              </>
            )}
            <p className="flex gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <Heart className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              Donations support all the children in our care. To give goods or cash in person, please visit the home.
            </p>
            <Button className="w-full" onClick={() => validate() && setStep('review')}>Review donation</Button>
          </>
        ) : (
          <>
            <h2 className="font-semibold text-navy-900">Review your donation</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              {[['To', orgName], ['Amount', formatMoney(Number(form.amount))], ['Payment method', method.name], ['Type', 'General donation'], ['Reason', form.reason.trim()],
                ...(isBank ? [['Transfer reference', form.transfer_reference.trim().toUpperCase()], ['Date of transfer', form.transfer_date], ['Attachment', proof?.name || 'None']] : [])]
                .map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-navy-900">{v}</dd></div>)}
            </dl>
            <p className="text-xs text-slate-500">{isBank ? 'Your donation will be confirmed by the staff after they check the transfer.' : "You'll be sent to PayMongo's secure page to pay. CareSphere never sees your wallet login."}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStep('form')}>Back</Button>
              <Button className="flex-1" loading={busy} onClick={submit}>{isBank ? 'Submit transfer' : `Confirm and pay with ${method.name}`}</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
