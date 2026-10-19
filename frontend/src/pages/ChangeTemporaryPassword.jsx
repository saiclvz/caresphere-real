import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import AuthShell from './AuthShell';
import PasswordInput from '../components/PasswordInput';
import PasswordChecklist from '../components/PasswordChecklist';
import { Button, Notice } from '../components/ui';

/**
 * Shown right after signing in with a temporary password an administrator set: the user chooses their own before
 * anything else (the server refuses every other request until then). The temporary password works for 72 hours.
 */
export default function ChangeTemporaryPassword() {
  const { user, passwordChanged, logout } = useAuth();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setError(null); };
  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.confirm_password) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      const res = await api('/auth/password', { method: 'PUT', body: f });
      await passwordChanged(res);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Choose your own password" subtitle="An administrator set a temporary password for this account. Choose a new one to continue.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <label className="block text-sm" htmlFor="tp-current"><span className="mb-1 block font-medium text-navy-900">Temporary password</span>
          <PasswordInput id="tp-current" value={f.current_password} onChange={set('current_password')} autoComplete="current-password" /></label>
        <label className="block text-sm" htmlFor="tp-new"><span className="mb-1 block font-medium text-navy-900">New password</span>
          <PasswordInput id="tp-new" value={f.new_password} onChange={set('new_password')} autoComplete="new-password" describedBy="tp-rules" /></label>
        <PasswordChecklist id="tp-rules" password={f.new_password} email={user?.email} name={user?.full_name} />
        <label className="block text-sm" htmlFor="tp-confirm"><span className="mb-1 block font-medium text-navy-900">Confirm new password</span>
          <PasswordInput id="tp-confirm" value={f.confirm_password} onChange={set('confirm_password')} autoComplete="new-password" /></label>
        <Button type="submit" loading={busy} className="w-full">Save my new password</Button>
        <button type="button" className="w-full text-center text-sm font-medium text-brand hover:underline" onClick={logout}>Sign out</button>
      </form>
    </AuthShell>
  );
}
