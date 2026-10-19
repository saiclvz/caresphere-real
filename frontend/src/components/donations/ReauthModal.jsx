import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import { Button, ErrorNote, Field, Modal } from '../ui';
import PasswordInput from '../PasswordInput';

/**
 * "Confirm it is you": password and the two-step code again. Returns a one-time grant (5 minutes, this session and
 * this purpose only) that the next request sends in the X-Reauth header.
 */
export default function ReauthModal({ purpose, what, onClose, onGrant }) {
  const [v, setV] = useState({ password: '', code: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api('/auth/reauth', { method: 'POST', body: { password: v.password, code: v.code.replace(/\s/g, ''), purpose } });
      setV({ password: '', code: '' });
      await onGrant(r.data.grant);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Confirm it is you"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!v.password || v.code.replace(/\s/g, '').length < 6} onClick={submit}>Confirm</Button></>}>
      <form onSubmit={submit} className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-slate-600"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /> {what} Enter your password and the code from your authenticator app.</p>
        <ErrorNote error={error} />
        <Field label="Password" required><PasswordInput value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="Two-step code" required><input className="input w-36 font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
