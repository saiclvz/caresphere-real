import { useEffect, useState } from 'react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Field, PageHeader, Spinner } from '../components/ui';

export default function SettingsPage() {
  const { toast, setOrgName } = useApp();
  const { data, loading, error, reload } = useApi('/settings');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState(null);

  useEffect(() => { if (data) setForm(data.data); }, [data]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      const res = await api('/settings', { method: 'PUT', body: form });
      setForm(res.data); setOrgName(res.data.org_name); toast('Settings saved.');
    } catch (err) { setSaveError(err); } finally { setSaving(false); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwSaving(true); setPwError(null);
    try { await api('/auth/password', { method: 'PUT', body: pw }); setPw({ current_password: '', new_password: '' }); toast('Password updated.'); }
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
            <Field label="Current password"><input className="input" type="password" required autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters"><input className="input" type="password" required minLength={8} autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <Button type="submit" variant="dark" loading={pwSaving}>Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
