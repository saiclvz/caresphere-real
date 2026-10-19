import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, Check, Copy, Flag, HandHeart, Info, ShieldCheck, Wallet } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { Button, Card, ErrorNote, Field, Modal, Notice, PageHeader, Spinner } from '../components/ui';
import SignedImage from '../components/donations/SignedImage';
import { checkFile, MB, readFile, uuid } from '../lib/files';
import { formatDate, formatMoney } from '../lib/format';

const PROOF_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(value).replace(/\s+/g, '')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:border-brand hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label={`Copy ${label}`}>
      {copied ? <><Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> Copied</> : <><Copy className="h-3.5 w-3.5" aria-hidden /> Copy</>}
    </button>
  );
}

/** One "Choose how to give" card: the home's official QR, the name and number exactly as the donor will see them, and the steps. */
function QrCard({ m, onReport, onProblem }) {
  const Icon = m.method_group === 'Bank transfer' ? Building2 : Wallet;
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand"><Icon className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0">
          <h3 className="font-semibold text-navy-900">{m.label}</h3>
          <p className="text-xs text-slate-500">{m.method_group}{m.bank_name && m.bank_name !== m.label ? ` · ${m.bank_name}` : ''}</p>
        </div>
      </div>
      <SignedImage url={m.qr_url} alt={`The home's official ${m.label} QR code`} className="mx-auto mt-4 aspect-square w-full max-w-[15rem] border border-slate-200 p-2" />
      <p className="mt-1 text-center text-xs text-slate-500">QR updated on {formatDate(m.updated_on)}</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div><dt className="text-slate-500">Account name (as shown in your app)</dt><dd className="font-semibold text-navy-900">{m.account_name}</dd></div>
        {m.account_number && (
          <div><dt className="text-slate-500">{m.method_group === 'Bank transfer' ? 'Account number' : 'Mobile or account number'}</dt>
            <dd className="flex flex-wrap items-center gap-2 font-mono font-medium text-navy-900">{m.account_number} <CopyButton value={m.account_number} label={`${m.label} number`} /></dd></div>
        )}
        {m.bank_name && <div><dt className="text-slate-500">{m.method_group === 'Bank transfer' ? 'Bank' : 'E-wallet'}</dt><dd className="font-medium text-navy-900">{m.bank_name}</dd></div>}
      </dl>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>Open your {m.method_group === 'Bank transfer' ? 'banking' : m.label} app and scan the QR.</li>
        <li>Check that the recipient name matches <strong className="text-navy-900">"{m.account_name}"</strong> before you send.</li>
        <li>Come back and tell us what you sent.</li>
      </ol>
      {m.instructions && <p className="mt-2 text-xs text-slate-500">{m.instructions}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Button onClick={() => onReport(m)}><HandHeart className="h-4 w-4" aria-hidden /> I have sent my donation</Button>
        <button type="button" onClick={() => onProblem(m)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <Flag className="h-4 w-4" aria-hidden /> Report a problem with this QR
        </button>
      </div>
    </Card>
  );
}

/** "I have sent my donation": what the donor sent, outside CareSphere. It waits for the home to confirm it. */
function ReportForm({ method, methods, limits, captcha, onCancel, onDone }) {
  const [f, setF] = useState({ method_id: method.method_id, amount: '', reference: '', sent_at: nowLocal(), sender_hint: '', note: '', consent: false, captcha_answer: '' });
  const [proof, setProof] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // One key per form: a double click or a retry after a lost connection can never create two reports.
  const key = useMemo(() => uuid(), []);
  const set = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const pickProof = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) { setProof(null); return; }
    const problem = checkFile(file, { types: PROOF_TYPES, maxBytes: 5 * MB });
    if (problem) { setErrors((x) => ({ ...x, proof: problem })); setProof(null); return; }
    setErrors((x) => ({ ...x, proof: undefined }));
    setProof(await readFile(file));
  };
  const validate = () => {
    const e = {};
    const s = f.amount.trim().replace(/,/g, '');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s) || Number(s) < limits.min_amount) e.amount = `Enter the amount in pesos (at least ₱${limits.min_amount}, up to 2 decimals).`;
    else if (Number(s) > limits.max_amount) e.amount = `The maximum is ${formatMoney(limits.max_amount)}. For a larger gift, contact the home.`;
    if (!/^[A-Za-z0-9 -]{4,60}$/.test(f.reference.trim())) e.reference = 'Enter the reference number shown in your app (letters and numbers).';
    if (!f.sent_at) e.sent_at = 'Enter when you sent it.';
    else if (new Date(f.sent_at).getTime() > Date.now() + 5 * 60000) e.sent_at = "The date and time can't be in the future.";
    if (/^\d+$/.test(f.sender_hint.replace(/\s/g, '')) && f.sender_hint.replace(/\s/g, '').length !== 4) e.sender_hint = 'Only the last 4 digits, or the name on the sending account.';
    if (!f.consent) e.consent = 'Tick the box to continue.';
    if (captcha && !f.captcha_answer.trim()) e.captcha = 'Answer the check question.';
    setErrors(e);
    return !Object.keys(e).length;
  };
  const submit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true); setError(null);
    try {
      const res = await api('/donor/donation-reports', { method: 'POST', body: {
        method_id: Number(f.method_id), amount: f.amount.trim().replace(/,/g, ''), reference: f.reference.trim(), sent_at: f.sent_at,
        sender_hint: f.sender_hint.trim() || undefined, note: f.note.trim() || undefined, proof: proof || undefined, consent: f.consent, idempotency_key: key,
        ...(captcha ? { captcha_token: captcha.token, captcha_answer: f.captcha_answer.trim() } : {}),
      } });
      onDone(res.data);
    } catch (err) {
      if (err.details?.errors) setErrors(err.details.errors);
      setError(err);
    } finally { setBusy(false); }
  };
  const chosen = methods.find((m) => String(m.method_id) === String(f.method_id));
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <ErrorNote error={error} />
      <Field label="How you gave" required error={errors.method_id}>
        <select className="input" value={f.method_id} onChange={set('method_id')}>{methods.map((m) => <option key={m.method_id} value={m.method_id}>{m.label}</option>)}</select>
      </Field>
      {chosen && <p className="-mt-2 text-xs text-slate-500">Sent to: <strong className="text-navy-900">{chosen.account_name}</strong>{chosen.account_number ? ` · ${chosen.account_number}` : ''}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount sent (PHP)" required error={errors.amount} hint={`₱${limits.min_amount} to ${formatMoney(limits.max_amount)}`}>
          <input className="input" inputMode="decimal" autoComplete="off" placeholder="0.00" value={f.amount} onChange={set('amount')} />
        </Field>
        <Field label="Date and time sent" required error={errors.sent_at} hint={`Within the last ${limits.max_age_days} days`}>
          <input className="input" type="datetime-local" max={nowLocal()} value={f.sent_at} onChange={set('sent_at')} />
        </Field>
      </div>
      <Field label="Transfer reference number" required error={errors.reference} hint="Exactly as shown in your app's receipt">
        <input className="input font-mono" autoComplete="off" maxLength={60} value={f.reference} onChange={set('reference')} />
      </Field>
      <Field label="Name on the sending account, or the last 4 digits of the number" error={errors.sender_hint} hint="Optional. Helps the home find your transfer.">
        <input className="input" autoComplete="off" maxLength={60} value={f.sender_hint} onChange={set('sender_hint')} />
      </Field>
      <Field label="Note" hint="Optional (up to 500 characters)"><textarea className="input" rows={2} maxLength={500} value={f.note} onChange={set('note')} /></Field>
      <Field label="Proof" error={errors.proof} hint="Optional: PDF, JPG or PNG up to 5 MB. Never required. The home checks its own account either way.">
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={pickProof} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy-900 hover:file:bg-brand-50" />
      </Field>
      {proof && <p className="-mt-2 text-xs text-slate-600">Attached: {proof.name} <button type="button" className="ml-1 font-medium text-brand hover:underline" onClick={() => setProof(null)}>Remove</button></p>}
      {captcha && (
        <Field label={captcha.question} required error={errors.captcha}><input className="input w-28" inputMode="numeric" value={f.captcha_answer} onChange={set('captcha_answer')} /></Field>
      )}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" checked={f.consent} onChange={set('consent')} aria-invalid={errors.consent ? true : undefined} />
        <span>I agree that the home may use these details only to check and record my donation, under the Data Privacy Act of 2012 (RA 10173) and the <Link to="/privacy" className="font-medium text-brand underline">Privacy Policy</Link>.</span>
      </label>
      {errors.consent && <p className="-mt-2 text-xs font-medium text-red-700">{errors.consent}</p>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <Button type="submit" loading={busy}>Send my report</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ProblemDialog({ method, problems, onClose, onSent }) {
  const [v, setV] = useState({ problem: '', note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!v.problem) { setError(new Error('Choose what is wrong.')); return; }
    setBusy(true); setError(null);
    try { await api('/donor/qr-problems', { method: 'POST', body: { method_id: method.method_id, problem: v.problem, note: v.note.trim() || undefined } }); onSent(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Report a problem with the ${method.label} QR`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={send}>Send to the home</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-600">If anything looks wrong, don't send money with this QR. The home's administrators are alerted right away.</p>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium text-navy-800">What is wrong?</legend>
          {problems.map((p) => (
            <label key={p.value} className="flex items-center gap-2 text-sm text-navy-900"><input type="radio" name="qr-problem" className="h-4 w-4 accent-brand" checked={v.problem === p.value} onChange={() => setV({ ...v, problem: p.value })} /> {p.label}</label>
          ))}
        </fieldset>
        <Field label="Details" hint="Optional"><textarea className="input" rows={2} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

const FAQ = [
  ['Does CareSphere take my money?', "No. CareSphere doesn't receive, hold or process payments. You send your donation with your own bank or e-wallet app to the home's account shown on this page."],
  ['When is my donation recorded?', 'After you tell us what you sent, it shows as "Waiting for the home to confirm". It is recorded once the home finds it in its own account.'],
  ['Do I need a screenshot?', 'No. The reference number, amount and time are enough. A proof file is optional.'],
  ['What if the name in my app is different?', 'Stop and don\'t send. Use "Report a problem with this QR" so the home can check it.'],
  ['I made a mistake in my report.', 'While it is still waiting, open Donation history, withdraw it and report it again with the right details.'],
];

/**
 * Donate (general donations only). CareSphere shows the home's official QR codes; the donor pays in their own app,
 * outside CareSphere, then reports what they sent. No online payment, checkout or card details here.
 */
export default function Donate() {
  const options = useApi('/donor/donate-options');
  const data = options.data?.data;
  const methods = data?.methods || [];
  const [reporting, setReporting] = useState(null);
  const [problem, setProblem] = useState(null);
  const [problemSent, setProblemSent] = useState(false);
  const [done, setDone] = useState(null);

  if (options.loading && !options.data) return <Spinner />;
  if (options.error) return <ErrorNote error={options.error} onRetry={options.reload} />;

  if (done) {
    return (
      <>
        <PageHeader title="Donate" description="Make a general donation to support the children in our care." />
        <Card className="mx-auto max-w-xl p-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100"><Check className="h-7 w-7 text-brand" aria-hidden /></span>
          <h2 className="mt-3 text-xl font-semibold text-navy-900">Thank you. We received your report.</h2>
          <p className="mt-2 text-sm text-slate-600">Donation <strong className="font-mono">{done.donation_no}</strong> shows as <strong>"{done.status}"</strong> until the home checks its account. You'll get a notification when it is confirmed.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to="/donations/history" className="inline-flex min-h-[2.5rem] items-center rounded-xl bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">Go to Donation history</Link>
            <Button variant="secondary" onClick={() => { setDone(null); setReporting(null); options.reload(); }}>Report another donation</Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Donate" description="Make a general donation to support the children in our care." />
      <Notice tone="info" className="mb-5" title="CareSphere doesn't receive or hold your money.">
        You send your donation with your own e-wallet or banking app to the home's account below. Your donation shows as "Waiting for the home to confirm" until the home checks its account.
      </Notice>
      {reporting ? (
        <Card className="mx-auto max-w-2xl p-6">
          <h2 className="mb-1 text-lg font-semibold text-navy-900">I have sent my donation</h2>
          <p className="mb-4 text-sm text-slate-500">Tell us what you sent so the home can find it in its {reporting.label} account. Don't send money from this page: CareSphere doesn't process payments.</p>
          <ReportForm method={reporting} methods={methods} limits={data.limits} captcha={data.captcha} onCancel={() => setReporting(null)} onDone={setDone} />
        </Card>
      ) : (
        <>
          <h2 className="mb-3 text-lg font-semibold text-navy-900">Choose how to give</h2>
          {methods.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-600"><AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-700" aria-hidden />The home hasn't added its donation QR codes yet. Please contact the home to give.</Card>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {methods.map((m) => <QrCard key={m.method_id} m={m} onReport={setReporting} onProblem={(x) => { setProblemSent(false); setProblem(x); }} />)}
            </div>
          )}
          {problemSent && <Notice tone="success" className="mt-4">Thank you. The home's administrators were alerted and will check the QR.</Notice>}
          <Card className="mt-6 p-5">
            <h2 className="flex items-center gap-2 font-semibold text-navy-900"><Info className="h-4 w-4 text-brand" aria-hidden /> Questions</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {FAQ.map(([q, a]) => <div key={q}><dt className="font-medium text-navy-900">{q}</dt><dd className="mt-0.5 text-slate-600">{a}</dd></div>)}
            </dl>
            <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 text-brand" aria-hidden /> Your report is used only to check and record your donation (RA 10173). See the <Link to="/privacy" className="font-medium text-brand underline">Privacy Policy</Link>.</p>
          </Card>
        </>
      )}
      {problem && <ProblemDialog method={problem} problems={data.problems} onClose={() => setProblem(null)} onSent={() => { setProblem(null); setProblemSent(true); }} />}
    </>
  );
}
