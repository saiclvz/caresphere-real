import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Building2, CalendarClock, KeyRound, QrCode, ScanLine, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import PasswordChecklist from '../components/PasswordChecklist';
import { problem as passwordProblem } from '../lib/passwordPolicy';
import useApi from '../hooks/useApi';
import PaymentQrSettings from '../components/donations/PaymentQrSettings';
import ScheduleAreasSettings from '../components/schedules/ScheduleAreasSettings';
import IdTypesSettings from '../components/IdTypesSettings';
import ChildAccessSettings from '../components/children/ChildAccessSettings';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Field, PageHeader, Spinner, Tabs } from '../components/ui';

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

/** Settings are grouped into sections (the same settings and saves as before; only how they are shown changed). */
const SECTIONS = [
  { key: 'organisation', label: 'Organisation', icon: Building2 },
  { key: 'security', label: 'Security and privacy', icon: ShieldCheck },
  { key: 'payments', label: 'Payment QR', icon: QrCode, admin: true },
  { key: 'schedules', label: 'Schedules', icon: CalendarClock },
  { key: 'ids', label: 'ID verification', icon: ScanLine, admin: true },
  { key: 'account', label: 'Your account', icon: KeyRound },
];
const HASH_TO_SECTION = { 'child-access': 'security' };
const CONTROL_KEY = /^(donation_claim_|donation_duplicate_|donation_stale_|donation_sod_|cash_dual_control_|payment_qr_)/;

export default function SettingsPage() {
  const { toast, setOrgName } = useApp();
  const { user, passwordChanged } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const sections = SECTIONS.filter((x) => !x.admin || user?.role === 'Admin');
  const fromHash = HASH_TO_SECTION[location.hash?.slice(1)];
  const section = sections.some((x) => x.key === params.get('section')) ? params.get('section') : fromHash || 'organisation';
  const pick = (k) => setParams((p) => { const n = new URLSearchParams(p); n.set('section', k); return n; }, { replace: true });
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
      // Donation controls are saved only under Payment QR (they need re-authentication).
      const body = Object.fromEntries(Object.entries(form).filter(([k]) => !k.startsWith('dpo_') && !k.startsWith('child_') && !CONTROL_KEY.test(k)));
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
    try { const res = await api('/auth/password', { method: 'PUT', body: pw }); await passwordChanged(res); setPw({ current_password: '', new_password: '', confirm_password: '' }); toast('Password updated. Your other sessions were signed out.'); }
    catch (err) { setPwError(err); } finally { setPwSaving(false); }
  };

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!form) return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // The organisation, sensitive-record and low-stock fields are one settings record, saved together (as before);
  // each section that shows some of them has the same Save button.
  const saveBar = <div className="flex items-center gap-3 border-t border-slate-100 pt-4"><Button type="submit" loading={saving}>Save settings</Button></div>;

  return (
    <>
      <PageHeader title="Settings" description="How CareSphere is set up for the home: organisation details, security and privacy, the donation QR codes, schedules and ID checks." />
      <Tabs tabs={sections} value={section} onChange={pick} label="Settings sections" panelId="settings-panel" />
      <div id="settings-panel" role="tabpanel" className="space-y-6">
        {section === 'organisation' && (
          <Card className="max-w-3xl p-6">
            <form onSubmit={save} className="space-y-4">
              <div><h2 className="text-lg font-semibold text-navy-900">Organisation</h2><p className="text-sm text-slate-500">Printed on receipts and reports.</p></div>
              <ErrorNote error={saveError} />
              <Field label="Name"><input className="input" required maxLength={200} value={form.org_name || ''} onChange={set('org_name')} /></Field>
              <Field label="Address"><input className="input" maxLength={500} value={form.org_address || ''} onChange={set('org_address')} /></Field>
              <Field label="Contact details" hint="Phone or email printed on receipts"><input className="input" maxLength={200} value={form.org_contact || ''} onChange={set('org_contact')} /></Field>
              <Field label="Receipt footer"><textarea className="input" rows={2} maxLength={500} value={form.receipt_footer || ''} onChange={set('receipt_footer')} /></Field>
              <Field label="Default low-stock level" hint="Pre-filled when adding inventory items">
                <input className="input w-32" type="number" min={0} value={form.default_min_threshold || ''} onChange={set('default_min_threshold')} />
              </Field>
              {saveBar}
            </form>
          </Card>
        )}
        {section === 'security' && (<>
          <Card className="max-w-3xl p-6">
            <form onSubmit={save} className="space-y-4">
              <div><h2 className="text-lg font-semibold text-navy-900">Sensitive record access</h2>
                <p className="text-sm text-slate-500">Token and unlock times (1 minute to type the Token ID, 3 minutes open) are set in backend/src/config/sensitiveAccess.js.</p></div>
              <ErrorNote error={saveError} />
              <Field label="Access log retention (months)" hint="For review in the Audit log. Nothing is deleted automatically. 12 to 240.">
                <input className="input w-32" type="number" min="12" max="240" value={form.access_log_retention_months || ''} onChange={set('access_log_retention_months')} />
              </Field>
              <Field label="ID scan retention (days)" hint="What the ID scan read is cleared this many days after an application is closed, declined or withdrawn. The ID photos and the audit log are kept. 1 to 3650.">
                <input className="input w-32" type="number" min="1" max="3650" value={form.id_scan_retention_days || ''} onChange={set('id_scan_retention_days')} />
              </Field>
              <DownloadTypes value={form.staff_download_doc_types || ''} onChange={(v) => setForm((f) => ({ ...f, staff_download_doc_types: v }))} />
              {saveBar}
            </form>
          </Card>
          <ChildAccessSettings />
        </>)}
        {section === 'payments' && <PaymentQrSettings />}
        {section === 'schedules' && <ScheduleAreasSettings />}
        {section === 'ids' && user?.role === 'Admin' && <IdTypesSettings />}
        {section === 'account' && (
          <Card className="max-w-xl p-6">
            <form onSubmit={changePassword} className="space-y-4">
              <h2 className="text-lg font-semibold text-navy-900">Your password</h2>
              <ErrorNote error={pwError} />
              <Field label="Current password" required><PasswordInput value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} autoComplete="current-password" /></Field>
              <Field label="New password" required error={pwFieldError}>
                <PasswordInput value={pw.new_password} onChange={(e) => { setPw({ ...pw, new_password: e.target.value }); setPwFieldError(null); }} autoComplete="new-password" invalid={!!pwFieldError} describedBy="set-pw-checklist" />
                <PasswordChecklist id="set-pw-checklist" password={pw.new_password} email={user?.email} name={user?.full_name} />
              </Field>
              <Field label="Confirm new password" required>
                <PasswordInput value={pw.confirm_password} onChange={(e) => { setPw({ ...pw, confirm_password: e.target.value }); setPwFieldError(null); }} autoComplete="new-password" />
              </Field>
              <Button type="submit" loading={pwSaving}>Update password</Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
