import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Button, Card, ConfirmModal, ErrorNote, Field, Skeleton, Table } from '../ui';
import { formatDateTime } from '../../lib/format';

const NUMBERS = [
  ['child_care_card_review_days', 'Care card review reminder (days)', 'The case worker is reminded to review the Care card.', 7, 365],
  ['admission_stale_draft_days', 'Unfinished admission flagged after (days)', 'Shown as stale on the Intake page. Admissions are never deleted.', 3, 365],
];

function Changed({ s }) {
  if (!s?.updated_by_name) return null;
  return <p className="mt-0.5 text-xs text-slate-500">Last changed by {s.updated_by_name}, {formatDateTime(s.updated_at)}</p>;
}

/** "Would be blocked" (Log only): by staff member and by child, case numbers only. */
function WouldBlock() {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useApi(`/child-access/would-block?days=${days}`);
  const d = data?.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold text-navy-900">Would be blocked</h3>
          <p className="text-xs text-slate-500">What each staff member opened that Enforce would have refused (core record, Care card). Nothing was blocked.</p>
        </div>
        <Field label="Period" className="w-36"><select className="input h-9" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></Field>
      </div>
      {loading && !data ? <Skeleton rows={3} /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-slate-200">
            {d.by_staff.length === 0 ? <p className="p-3 text-sm text-slate-500">No staff member would have been blocked.</p> : (
              <Table label="Would be blocked, by staff member">
                <thead className="bg-slate-50"><tr><th className="th">Staff</th><th className="th text-right">Children</th><th className="th text-right">Times</th><th className="th">Last</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{d.by_staff.map((r) => <tr key={r.user_id}><td className="td">{r.user_name}</td><td className="td text-right tabular-nums">{r.children}</td><td className="td text-right tabular-nums">{r.hits}</td><td className="td whitespace-nowrap text-xs">{formatDateTime(r.last_at)}</td></tr>)}</tbody>
              </Table>
            )}
          </div>
          <div className="rounded-lg border border-slate-200">
            {d.by_child.length === 0 ? <p className="p-3 text-sm text-slate-500">No child record.</p> : (
              <Table label="Would be blocked, by child">
                <thead className="bg-slate-50"><tr><th className="th">Case number</th><th className="th text-right">Staff</th><th className="th text-right">Times</th><th className="th">Last</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{d.by_child.map((r) => <tr key={r.child_id}><td className="td font-mono text-sm">{r.child_id}</td><td className="td text-right tabular-nums">{r.staff}</td><td className="td text-right tabular-nums">{r.hits}</td><td className="td whitespace-nowrap text-xs">{formatDateTime(r.last_at)}</td></tr>)}</tbody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings > Data protection > Child record access (Admin). Every change is logged with old and new values. */
export default function ChildAccessSettings() {
  const { toast } = useApp();
  const { data, loading, error, reload, setData } = useApi('/child-access/settings');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [confirmEnforce, setConfirmEnforce] = useState(false);
  const s = data?.data?.settings;
  useEffect(() => { if (s) setForm(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v.value ?? '')]))); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Card className="p-6"><Skeleton rows={6} /></Card>;
  if (error) return <Card className="p-6"><ErrorNote error={error} onRetry={reload} /></Card>;
  if (!form) return null;
  const errs = saveError?.details?.errors || {};
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (confirm = false) => {
    setSaving(true); setSaveError(null);
    try {
      const res = await api('/child-access/settings', { method: 'PUT', body: { ...form, confirm: confirm || undefined } });
      setData(res); setConfirmEnforce(false); toast(res.message);
    } catch (err) {
      if (err.details?.needs_confirmation) setConfirmEnforce(true); else setSaveError(err);
    } finally { setSaving(false); }
  };
  return (
    <Card className="p-6" id="child-access">
      <h2 className="flex items-center gap-2 font-semibold text-navy-900"><ShieldCheck className="h-4 w-4 text-brand" aria-hidden /> Data protection: child record access</h2>
      <p className="mb-4 text-sm text-slate-600">Directory, Care card and core record for Staff; health, adoption and Transition Review stay behind the unlock step. Each change is recorded in the Audit log with the old and new value.</p>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-5">
        <ErrorNote error={saveError && !Object.keys(errs).length ? saveError : null} />
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-navy-800">Rollout mode</legend>
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm"><input type="radio" name="mode" className="mt-1 accent-brand" checked={form.child_access_mode === 'log_only'} onChange={() => setForm({ ...form, child_access_mode: 'log_only' })} />
              <span><strong>Log only</strong>: nothing is blocked; what would be blocked is recorded (report below).</span></label>
            <label className="flex items-start gap-2 text-sm"><input type="radio" name="mode" className="mt-1 accent-brand" checked={form.child_access_mode === 'enforce'} onChange={() => setForm({ ...form, child_access_mode: 'enforce' })} />
              <span><strong>Enforce</strong>: Staff see only what their level allows. You will be asked to confirm. You can switch back.</span></label>
          </div>
          <Changed s={s.child_access_mode} />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBERS.map(([k, l, hint, min, max]) => (
            <Field key={k} label={l} hint={hint} error={errs[k]}>
              <input className="input w-32" type="number" min={min} max={max} value={form[k]} onChange={set(k)} />
              <Changed s={s[k]} />
            </Field>
          ))}
          <Field label="Care card visible to" error={errs.child_care_card_visibility}>
            <select className="input" value={form.child_care_card_visibility} onChange={set('child_care_card_visibility')}>
              <option value="children_duty">Staff with the Child records duty</option>
              <option value="on_shift">Staff on shift only (Staff schedules)</option>
            </select>
            <Changed s={s.child_care_card_visibility} />
          </Field>
          <Field label="Default case worker" hint="Suggested as the case worker when an Admin approves an admission (the Admin can change it)." error={errs.child_default_case_worker_id}>
            <select className="input" value={form.child_default_case_worker_id} onChange={set('child_default_case_worker_id')}>
              <option value="">None (Admin assigns each child)</option>
              {data.data.staff.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
            </select>
            <Changed s={s.child_default_case_worker_id} />
          </Field>
        </div>
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-navy-800">Required admission documents</legend>
          <p className="mb-2 text-xs text-slate-500">A required document must be Received (or Not applicable with a reason) to submit an admission, and verified by the reviewing Admin before approval, unless the Admin approves an exception with a reason. Conditional and optional documents are not enforced.</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {(data.data.admission_checklist || []).map((c) => {
              const keys = String(form.admission_required_documents || '').split(',').filter(Boolean);
              const on = keys.includes(c.key);
              return (
                <label key={c.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={on}
                    onChange={() => setForm({ ...form, admission_required_documents: (on ? keys.filter((k) => k !== c.key) : [...keys, c.key]).join(',') })} />
                  <span>{c.label}{c.condition && <span className="block text-xs text-slate-500">Conditional: {c.condition}</span>}</span>
                </label>
              );
            })}
          </div>
          {errs.admission_required_documents && <p className="mt-1 text-xs text-red-700">{errs.admission_required_documents}</p>}
          <Changed s={s.admission_required_documents} />
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-navy-800">Data Protection Officer (RA 10173)</legend>
          <p className="text-xs text-slate-500">Shown to applicants in the privacy notice, and told when a staff member reports a privacy concern (when this email is a CareSphere account). Serious breaches must be reported to the National Privacy Commission and the affected people within 72 hours.</p>
          <Field label="Name" error={errs.dpo_name}><input className="input" maxLength={150} value={form.dpo_name} onChange={set('dpo_name')} /><Changed s={s.dpo_name} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" error={errs.dpo_email}><input className="input" type="email" maxLength={150} value={form.dpo_email} onChange={set('dpo_email')} /><Changed s={s.dpo_email} /></Field>
            <Field label="Phone" error={errs.dpo_phone}><input className="input" maxLength={50} value={form.dpo_phone} onChange={set('dpo_phone')} /><Changed s={s.dpo_phone} /></Field>
          </div>
        </fieldset>
        <Button type="submit" loading={saving}>Save child record access</Button>
      </form>
      <div className="mt-6 border-t border-slate-100 pt-4"><WouldBlock /></div>
      <ConfirmModal open={confirmEnforce} onClose={() => setConfirmEnforce(false)} loading={saving} onConfirm={() => save(true)} confirmLabel="Switch to Enforce"
        title="Switch to Enforce?" message="Staff will see only the directory and the Care card of children they are not assigned to. Check the 'Would be blocked' report first. You can switch back to Log only at any time." />
    </Card>
  );
}
