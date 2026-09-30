import { useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2, UserCog } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDate, matches } from '../lib/format';

const ROLES = ['Admin', 'Staff', 'Donor'];
// Any role that no longer exists (e.g. the old Applicant role) shows as Donor, so the dropdown is never blank.
const safeRole = (r) => (ROLES.includes(r) ? r : 'Donor');
const TONE = { Admin: 'blue', Staff: 'green', Donor: 'amber' };

export default function Users() {
  const { user: me } = useAuth();
  const { query, toast } = useApp();
  const [role, setRole] = useState('');
  const { data, loading, error, reload } = useApi(`/users${qs({ role })}`);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  // Reset two-step verification (lost device): the acting admin confirms with their own code.
  const [resetting, setResetting] = useState(null);
  const [resetCode, setResetCode] = useState('');
  const [resetError, setResetError] = useState(null);
  const [resetFieldError, setResetFieldError] = useState(null);

  const openReset = (u) => { setResetting(u); setResetCode(''); setResetError(null); setResetFieldError(null); };
  const checkResetCode = (v) => {
    const t = v.trim();
    if (!t) return 'Your 6-digit code is required.';
    if (!/^\d{6}$/.test(t) && !/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(t)) return 'Enter the 6-digit code from your authenticator app, or a backup code.';
    return null;
  };
  const submitReset = async (e) => {
    e.preventDefault();
    const problem = checkResetCode(resetCode);
    setResetFieldError(problem);
    if (problem) return;
    setSaving(true); setResetError(null);
    try {
      const res = await api(`/users/${resetting.user_id}/mfa/reset`, { method: 'POST', body: { code: resetCode.trim() } });
      setResetting(null); toast(res.message); reload();
    } catch (err) { setResetError(err); setResetCode(''); } finally { setSaving(false); }
  };

  const rows = (data?.data || []).filter((u) => matches(query, u.full_name, u.email, u.role));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      if (form.user_id) {
        const body = { full_name: form.full_name, email: form.email, role: form.role, is_active: form.is_active };
        if (form.password) body.password = form.password;
        await api(`/users/${form.user_id}`, { method: 'PUT', body });
      } else {
        await api('/users', { method: 'POST', body: form });
      }
      setForm(null); toast('Account saved.'); reload();
    } catch (err) { setFormError(err); } finally { setSaving(false); }
  };

  const remove = async () => {
    setSaving(true);
    try { await api(`/users/${deleting.user_id}`, { method: 'DELETE' }); setDeleting(null); toast('Account deleted.'); reload(); }
    catch (err) { toast(err.message, 'error'); setDeleting(null); } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title="User accounts" description="Create staff and admin accounts, change roles, and deactivate people who have left."
        actions={<Button onClick={() => { setForm({ full_name: '', email: '', password: '', role: 'Staff' }); setFormError(null); }}><Plus className="h-4 w-4" /> Create account</Button>} />

      <div className="mb-4 inline-flex rounded-lg bg-white p-1 shadow-card">
        {['', ...ROLES].map((r) => (
          <button key={r || 'all'} type="button" onClick={() => setRole(r)} aria-pressed={role === r}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${role === r ? 'bg-brand text-white' : 'text-slate-600 hover:text-navy-900'}`}>{r || 'All'}</button>
        ))}
      </div>

      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={UserCog} title="No accounts in this view" />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Name</th><th className="th">Email</th><th className="th">Role</th>
              <th className="th">Status</th><th className="th">Created</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((u) => (
                <tr key={u.user_id}>
                  <td className="td font-medium text-navy-900">{u.full_name}{u.user_id === me.user_id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                  <td className="td">{u.email}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={TONE[u.role]}>{u.role}</Badge>
                      {u.role === 'Admin' && (u.mfa_enabled
                        ? <Badge tone="green">MFA on</Badge>
                        : <Badge tone="amber">MFA setup pending</Badge>)}
                    </div>
                  </td>
                  <td className="td">{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Deactivated</Badge>}</td>
                  <td className="td">{formatDate(u.created_at)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => { setForm({ ...u, role: safeRole(u.role), is_active: Boolean(u.is_active), password: '' }); setFormError(null); }}><Pencil className="h-4 w-4" /></Button>
                      {u.mfa_enabled && u.user_id !== me.user_id && <Button size="sm" variant="ghost" aria-label="Reset two-step verification" title="Reset two-step verification" onClick={() => openReset(u)}><KeyRound className="h-4 w-4" /></Button>}
                      {u.user_id !== me.user_id && <Button size="sm" variant="ghost" aria-label="Delete" className="text-red-600" onClick={() => setDeleting(u)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.user_id ? 'Edit account' : 'Create account'}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="user-form" loading={saving}>{form?.user_id ? 'Save changes' : 'Create account'}</Button></>}>
        {form && (
          <form id="user-form" onSubmit={submit} className="space-y-4">
            <ErrorNote error={formError} />
            <Field label="Full name"><input className="input" required maxLength={100} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" required maxLength={100} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Role"><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label={form.user_id ? 'New password' : 'Password'} hint={form.user_id ? 'Leave blank to keep the current password' : 'At least 8 characters. Share it with the person privately.'}>
              <input className="input" type="password" autoComplete="new-password" minLength={8} required={!form.user_id} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            {form.user_id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300 text-brand" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Account is active
              </label>
            )}
          </form>
        )}
      </Modal>
      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)} title="Reset two-step verification" size="sm"
        footer={<><Button variant="secondary" onClick={() => setResetting(null)}>Cancel</Button><Button type="submit" form="mfa-reset-form" variant="danger" loading={saving}>Reset</Button></>}>
        {resetting && (
          <form id="mfa-reset-form" onSubmit={submitReset} noValidate className="space-y-4">
            <p className="text-sm text-slate-600">
              Use this when <strong>{resetting.full_name}</strong> has lost their phone. Their authenticator setup and backup codes
              stop working, they are signed out, and they set up two-step verification again at their next sign-in.
            </p>
            <ErrorNote error={resetError} />
            <Field label="Your 6-digit code" required error={resetFieldError} hint="Confirm with the current code from your own authenticator app.">
              <input className={`input text-center font-mono tracking-[0.3em] ${resetFieldError ? 'border-red-400' : ''}`} value={resetCode}
                onChange={(e) => { setResetCode(e.target.value); if (resetFieldError) setResetFieldError(checkResetCode(e.target.value)); }}
                inputMode="numeric" autoComplete="one-time-code" maxLength={9} placeholder="000000" required aria-invalid={!!resetFieldError || undefined} />
            </Field>
          </form>
        )}
      </Modal>
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={saving} title="Delete account?"
        message={`${deleting?.full_name}'s account will be removed. Accounts with activity history can't be deleted; deactivate them instead.`} />
    </>
  );
}
