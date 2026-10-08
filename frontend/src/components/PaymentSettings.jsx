import { useEffect, useState } from 'react';
import { Building2, FlaskConical, Wallet } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field } from './ui';

/** One payment method: name, enabled, order, instructions, and (bank transfer) the home's account details. */
function MethodRow({ m, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState(m);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => setF(m), [m]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(m);
  const save = async () => {
    setBusy(true); setError(null);
    try { const res = await api(`/payment-methods/${m.method_id}`, { method: 'PUT', body: f }); onSaved(res.data); toast(`${f.name} saved.`); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const bank = m.method_type === 'manual';
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {bank ? <Building2 className="h-4 w-4 text-slate-500" aria-hidden /> : <Wallet className="h-4 w-4 text-slate-500" aria-hidden />}
        <span className="text-sm font-medium text-navy-900">{m.name}</span>
        <Badge tone={bank ? 'slate' : 'blue'}>{bank ? 'Manual (proof)' : 'PayMongo checkout'}</Badge>
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={!!f.enabled} onChange={set('enabled')} /> Shown to donors</label>
      </div>
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
        <Field label="Name"><input className="input" maxLength={60} value={f.name} onChange={set('name')} /></Field>
        <Field label="Order"><input className="input" type="number" min="0" max="999" value={f.sort_order} onChange={set('sort_order')} /></Field>
      </div>
      <Field label="Instructions for donors"><textarea className="input" rows={2} maxLength={1000} value={f.instructions || ''} onChange={set('instructions')} /></Field>
      {bank && (
        <fieldset className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-navy-800">Payment details (shown to donors)</legend>
          <Field label="Bank name"><input className="input" maxLength={120} value={f.bank_name || ''} onChange={set('bank_name')} /></Field>
          <Field label="Account name"><input className="input" maxLength={120} value={f.account_name || ''} onChange={set('account_name')} /></Field>
          <Field label="Account number"><input className="input font-mono" maxLength={60} value={f.account_number || ''} onChange={set('account_number')} /></Field>
          <Field label="Branch (optional)"><input className="input" maxLength={120} value={f.branch || ''} onChange={set('branch')} /></Field>
        </fieldset>
      )}
      <Button size="sm" loading={busy} disabled={!dirty} onClick={save}>Save</Button>
    </div>
  );
}

/** Settings > Payment methods and payment details (Admin). */
export default function PaymentSettings() {
  const { data, error, reload } = useApi('/payment-methods');
  const [rows, setRows] = useState(null);
  useEffect(() => { if (data) setRows(data.data); }, [data]);
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold text-navy-900">Payment methods and payment details</h2>
      <p className="text-xs text-slate-500">What donors can choose on the Donate page. Bank details are shown exactly as entered: check them carefully.</p>
      {data && !data.gateway_configured && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">PayMongo keys aren't set in backend/.env, so e-wallet methods are hidden from donors until they are.</p>}
      {data?.gateway_configured && data.demo && <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><FlaskConical className="h-3.5 w-3.5" aria-hidden /> PayMongo test keys: demo mode, no real money is charged.</p>}
      <ErrorNote error={error} onRetry={reload} />
      {(rows || []).map((m) => <MethodRow key={m.method_id} m={m} onSaved={setRows} />)}
    </Card>
  );
}
