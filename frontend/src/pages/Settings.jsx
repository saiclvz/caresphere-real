import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import PasswordChecklist from '../components/PasswordChecklist';
import { problem as passwordProblem } from '../lib/passwordPolicy';
import useApi from '../hooks/useApi';
import PaymentSettings from '../components/PaymentSettings';
import ScheduleAreasSettings from '../components/schedules/ScheduleAreasSettings';
import IdTypesSettings from '../components/IdTypesSettings';
import ChildAccessSettings from '../components/children/ChildAccessSettings';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Field, PageHeader, Spinner } from '../components/ui';

/** Document types Staff may download (watermarked) after an unlock. Others can only be viewed. */
function DownloadTypes({ value, onChange }) {
  const cfg = useApi('/adoptions/form-config');
  const docs = cfg.data?.data ? [...Object.entries(cfg.data.data.documents), ...Object.entries(cfg.data.data.stage_documents)] : [];
  const picked = new Set(String(value).split(',').map((x) => x.trim()).filter(Boolean));
  const toggle = (k) => { const n = new Set(picked); if (n.has(k)) n.delete(k); else n.add(k); onChange([...n].join(',')); };
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-navy-800">Staff may download</p>
      <p className="mb-2 text-xs text-slate-500">Unticked types can only be viewed (watermarked with the staff member's name and the time).</p>
      <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
        {docs.map(([k, d]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.has(k)} onChange={() => toggle(k)} /> {d.label}</label>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { toast, setOrgName } = useApp();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/settings');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwFieldError, setPwFieldError] = useState(null);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState(null);

  useEffect(() => { if (data) setForm(data.data); }, [data]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      // The DPO contact and child record access are saved in their own section below (logged with old and new values).
      const body = Object.fromEntries(Object.entries(form).filter(([k]) => !k.startsWith('dpo_') && !k.startsWith('child_')));
      const res = await api('/settings', { method: 'PUT', body });
      setForm(res.data); setOrgName(res.data.org_name); toast('Settings saved.');
    } catch (err) { setSaveError(err); } finally { setSaving(false); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwSaving(true); setPwError(null);
    const p = passwordProblem(pw.new_password, { email: user?.email, name: user?.full_name })
      || (pw.confirm_password !== pw.new_password ? 'Passwords do not match.' : null);
    setPwFieldError(p);
    if (p) { setPwSaving(false); return; }
    try { await api('/auth/password', { method: 'PUT', body: pw }); setPw({ current_password: '', new_password: '', confirm_password: '' }); toast('Password updated.'); }
    catch (err) { setPwError(err); } finally { setPwSaving(false); }
  };

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!form) return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Settings" description="Organisation details used on receipts and reports." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <form onSubmit={save} className="space-y-4">
            <h2 className="font-semibold text-navy-900">Organisation</h2>
            <ErrorNote error={saveError} />
            <Field label="Name"><input className="input" required maxLength={200} value={form.org_name || ''} onChange={set('org_name')} /></Field>
            <Field label="Address"><input className="input" maxLength={500} value={form.org_address || ''} onChange={set('org_address')} /></Field>
            <Field label="Contact details" hint="Phone or email printed on receipts"><input className="input" maxLength={200} value={form.org_contact || ''} onChange={set('org_contact')} /></Field>
            <Field label="Receipt footer"><textarea className="input" rows={2} maxLength={500} value={form.receipt_footer || ''} onChange={set('receipt_footer')} /></Field>
            <Field label="Default allocation for online donations" hint="Put on e-wallet donations paid through PayMongo so the receipt is issued at once. Staff can change it later.">
              <input className="input" maxLength={300} value={form.default_allocation_text || ''} onChange={set('default_allocation_text')} />
            </Field>
            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium text-navy-800">Sensitive record access</legend>
              <p className="text-xs text-slate-500">Token and unlock times (1 minute to type the Token ID, 3 minutes open) are set in backend/src/config/sensitiveAccess.js.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Access log retention (months)" hint="For review in the Audit log. Nothing is deleted automatically. 12 to 240.">
                  <input className="input" type="number" min="12" max="240" value={form.access_log_retention_months || ''} onChange={set('access_log_retention_months')} />
                </Field>
              </div>
              <Field label="ID scan retention (days)" hint="What the ID scan read is cleared this many days after an application is closed, declined or withdrawn. The ID photos and the audit log are kept. 1 to 3650.">
                <input className="input w-32" type="number" min="1" max="3650" value={form.id_scan_retention_days || ''} onChange={set('id_scan_retention_days')} />
              </Field>
              <DownloadTypes value={form.staff_download_doc_types || ''} onChange={(v) => setForm((f) => ({ ...f, staff_download_doc_types: v }))} />
            </fieldset>
            <Field label="Default low-stock level" hint="Pre-filled when adding inventory items">
              <input className="input w-32" type="number" min={0} value={form.default_min_threshold || ''} onChange={set('default_min_threshold')} />
            </Field>
            <Button type="submit" loading={saving}>Save settings</Button>
          </form>
        </Card>
        <Card className="p-6">
          <form onSubmit={changePassword} className="space-y-4">
            <h2 className="font-semibold text-navy-900">Your password</h2>
            <ErrorNote error={pwError} />
            <Field label="Current password" required><PasswordInput value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} autoComplete="current-password" /></Field>
            <Field label="New password" required error={pwFieldError}>
              <PasswordInput value={pw.new_password} onChange={(e) => { setPw({ ...pw, new_password: e.target.value }); setPwFieldError(null); }} autoComplete="new-password" invalid={!!pwFieldError} describedBy="set-pw-checklist" />
              <PasswordChecklist id="set-pw-checklist" password={pw.new_password} email={user?.email} name={user?.full_name} />
            </Field>
            <Field label="Confirm new password" required>
              <PasswordInput value={pw.confirm_password} onChange={(e) => { setPw({ ...pw, confirm_password: e.target.value }); setPwFieldError(null); }} autoComplete="new-password" />
            </Field>
            <Button type="submit" variant="dark" loading={pwSaving}>Update password</Button>
          </form>
        </Card>
      </div>
      <div className="mt-6"><ChildAccessSettings /></div>
      <div className="mt-6"><PaymentSettings /></div>
      <div className="mt-6"><ScheduleAreasSettings /></div>
      {user?.role === 'Admin' && <div className="mt-6"><IdTypesSettings /></div>}
    </>
  );
}
