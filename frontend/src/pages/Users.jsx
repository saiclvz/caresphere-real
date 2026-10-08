import { useState } from 'react';
import PasswordInput from '../components/PasswordInput';
import PasswordChecklist from '../components/PasswordChecklist';
import { problem as passwordProblem } from '../lib/passwordPolicy';
import { KeyRound, Pencil, Plus, UserCheck, UserCog, UserX } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
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
  const [pwErrors, setPwErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // Deactivate / Reactivate confirmation: the user row being changed.
  const [toggling, setToggling] = useState(null);
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

  /** Password rules: required on create; on edit only when a new password is typed. */
  const passwordErrors = (f) => {
    const e = {};
    if (String(f.full_name || '').trim().length < 2) e.full_name = 'Full name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(f.email || '').trim())) e.email = 'Enter a valid email address.';
    const needs = !f.user_id || f.password;
    if (!f.user_id && !f.password) e.password = 'Password is required.';
    else if (needs) { const p = passwordProblem(f.password, { email: f.email, name: f.full_name }); if (p) e.password = p; }
    if (needs && !f.confirm) e.confirm = f.user_id ? 'Confirm new password is required.' : 'Confirm password is required.';
    else if (needs && f.confirm !== f.password) e.confirm = 'Passwords do not match.';
    return e;
  };
  const updateForm = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    // Errors clear as soon as they are fixed.
    if (Object.keys(pwErrors).length) { const fresh = passwordErrors(next); setPwErrors(Object.fromEntries(Object.keys(pwErrors).filter((k) => fresh[k]).map((k) => [k, fresh[k]]))); }
  };

  const submit = async (e) => {
    e.preventDefault();
    const pe = passwordErrors(form);
    setPwErrors(pe);
    if (Object.keys(pe).length) return;
    setSaving(true); setFormError(null);
    try {
      if (form.user_id) {
        const body = { full_name: form.full_name, email: form.email, role: form.role };
        if (form.password) { body.password = form.password; body.confirm_password = form.confirm; }
        await api(`/users/${form.user_id}`, { method: 'PUT', body });
      } else {
        await api('/users', { method: 'POST', body: { full_name: form.full_name, email: form.email, role: form.role, password: form.password, confirm_password: form.confirm } });
      }
      setForm(null); toast('Account saved.'); reload();
    } catch (err) { setFormError(err); } finally { setSaving(false); }
  };

  const setActive = async () => {
    setSaving(true);
    try {
      const res = await api(`/users/${toggling.user_id}/active`, { method: 'PUT', body: { is_active: !toggling.is_active } });
      setToggling(null); toast(res.message); reload();
    } catch (err) { toast(err.message, 'error'); setToggling(null); } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title="User accounts" description="Create staff and admin accounts, change roles, and deactivate people who have left."
        actions={<Button onClick={() => { setForm({ full_name: '', email: '', password: '', confirm: '', role: 'Staff' }); setFormError(null); setPwErrors({}); }}><Plus className="h-4 w-4" /> Create account</Button>} />

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
                      <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => { setForm({ ...u, role: safeRole(u.role), is_active: Boolean(u.is_active), password: '', confirm: '' }); setFormError(null); setPwErrors({}); }}><Pencil className="h-4 w-4" /></Button>
                      {/* Two-step verification exists only for Admin accounts. */}
                      {u.role === 'Admin' && u.mfa_enabled && u.user_id !== me.user_id && <Button size="sm" variant="ghost" aria-label="Reset two-step verification" title="Reset two-step verification" onClick={() => openReset(u)}><KeyRound className="h-4 w-4" /></Button>}
                      {u.user_id !== me.user_id && (u.is_active
                        ? <Button size="sm" variant="ghost" aria-label={`Deactivate ${u.full_name}`} title="Deactivate" className="text-red-600" onClick={() => setToggling(u)}><UserX className="h-4 w-4" /></Button>
                        : <Button size="sm" variant="ghost" aria-label={`Reactivate ${u.full_name}`} title="Reactivate" className="text-emerald-700" onClick={() => setToggling(u)}><UserCheck className="h-4 w-4" /></Button>)}
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
          <form id="user-form" onSubmit={submit} noValidate className="space-y-4">
            <ErrorNote error={formError} />
            <Field label="Full name" required error={pwErrors.full_name}><input className="input" maxLength={100} value={form.full_name} onChange={(e) => updateForm({ full_name: e.target.value })} /></Field>
            <Field label="Email" required error={pwErrors.email}><input className="input" type="email" maxLength={100} value={form.email} onChange={(e) => updateForm({ email: e.target.value })} /></Field>
            <Field label="Role" hint={form.user_id === me.user_id ? 'You cannot change your own role.' : undefined}>
              <select className="input" value={form.role} disabled={form.user_id === me.user_id} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            <Field label={form.user_id ? 'New password' : 'Password'} required={!form.user_id} error={pwErrors.password}
              hint={form.user_id ? 'Leave blank to keep the current password.' : 'Share it with the person privately.'}>
              <PasswordInput value={form.password} onChange={(e) => updateForm({ password: e.target.value })} invalid={!!pwErrors.password}
                autoComplete="new-password" required={!form.user_id} describedBy="pw-checklist" />
              {(!form.user_id || form.password) && <PasswordChecklist id="pw-checklist" password={form.password} email={form.email} name={form.full_name} />}
            </Field>
            {(!form.user_id || form.password) && (
              <Field label={form.user_id ? 'Confirm new password' : 'Confirm password'} required error={pwErrors.confirm}>
                <PasswordInput value={form.confirm} onChange={(e) => updateForm({ confirm: e.target.value })} invalid={!!pwErrors.confirm} autoComplete="new-password" />
              </Field>
            )}
            {form.user_id && (
              <p className="text-sm text-slate-600">
                Status: {form.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Deactivated</Badge>}
                <span className="mt-1 block text-xs text-slate-500">To change it, use Deactivate or Reactivate in the accounts list.</span>
              </p>
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
      <Modal open={Boolean(toggling)} onClose={() => setToggling(null)} size="sm"
        title={toggling?.is_active ? 'Deactivate account?' : 'Reactivate account?'}
        footer={<>
          <Button variant="secondary" onClick={() => setToggling(null)}>Cancel</Button>
          <Button variant={toggling?.is_active ? 'danger' : 'primary'} loading={saving} onClick={setActive}>
            {toggling?.is_active ? 'Deactivate' : 'Reactivate'}
          </Button>
        </>}>
        {toggling && (
          <p className="text-sm text-slate-600">
            {toggling.is_active
              ? <><strong>{toggling.full_name}</strong> will be signed out right away and won't be able to sign in. Their records and history are kept, and you can reactivate the account at any time.</>
              : <><strong>{toggling.full_name}</strong> will be able to sign in again with their existing password.</>}
          </p>
        )}
      </Modal>
    </>
  );
}
