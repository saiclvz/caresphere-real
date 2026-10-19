import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, ErrorNote, Field } from '../components/ui';
import PasswordInput from '../components/PasswordInput';
import AuthShell from './AuthShell';
import { BackupCodes, BackupCodeUsed, MfaSetup, MfaVerify } from './MfaSteps';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Returns { field: message } for every invalid field. Empty object = valid. */
function validate(form) {
  const e = {};
  const email = form.email.trim();
  if (!email) e.email = 'Email is required.';
  else if (!EMAIL_RE.test(email)) e.email = 'Enter a valid email address.';
  if (!form.password.trim()) e.password = 'Password is required.';
  return e;
}

/**
 * The sign-in flow: email and password, then (Admin) two-step verification and backup codes. Shared by the Sign in
 * page and the home page's login card, so both use exactly the same validation, API call and error handling.
 * Frame draws the surroundings ({ title, subtitle, children }); `title` / `subtitle` replace the first step's
 * heading only.
 */
export function LoginFlow({ Frame = AuthShell, title = 'Sign in', subtitle = 'Sign in with your CareSphere account.', idPrefix }) {
  const { login, completeSession } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  // Admin two-step verification: { token, setup } after the password step,
  // then { codes | left, res } until the admin continues into the app.
  const [mfa, setMfa] = useState(null);
  const [finish, setFinish] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Re-check only fields already showing an error, so each message clears once it's fixed.
  const set = (k) => (e) => {
    const next = { ...form, [k]: e.target.value };
    setForm(next);
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const fresh = validate(next);
      return Object.fromEntries(Object.keys(prev).filter((f) => fresh[f]).map((f) => [f, fresh[f]]));
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setLoading(true);
    setError(null);
    try {
      const result = await login(form.email.trim(), form.password);
      if (result.mfa) setMfa(result.mfa);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const restart = () => { setMfa(null); setFinish(null); setForm((f) => ({ ...f, password: '' })); };

  if (finish?.codes) {
    return (
      <Frame title="Save your backup codes" subtitle="Two-step verification is on.">
        <BackupCodes codes={finish.codes} onContinue={() => completeSession(finish.res)} />
      </Frame>
    );
  }
  if (finish?.left !== undefined) {
    return (
      <Frame title="Signed in with a backup code" subtitle="That code can't be used again.">
        <BackupCodeUsed left={finish.left} onContinue={() => completeSession(finish.res)} />
      </Frame>
    );
  }
  if (mfa?.setup) {
    return (
      <Frame title="Set up two-step verification" subtitle="This account needs a code from an authenticator app every time it signs in.">
        <MfaSetup mfaToken={mfa.token} onRestart={restart}
          onDone={(res) => setFinish({ codes: res.backup_codes, res })} />
      </Frame>
    );
  }
  if (mfa) {
    return (
      <Frame title="Two-step verification" subtitle="Enter the code from your authenticator app to finish signing in.">
        <MfaVerify mfaToken={mfa.token} onRestart={restart}
          onDone={(res) => (res.backup_codes_left !== undefined ? setFinish({ left: res.backup_codes_left, res }) : completeSession(res))} />
      </Frame>
    );
  }

  return (
    <Frame title={title} subtitle={subtitle}>
      <form onSubmit={submit} noValidate className="space-y-4" id={idPrefix ? `${idPrefix}-form` : undefined}>
        <ErrorNote error={error} />
        <Field label="Email" required error={errors.email}>
          <input className={`input ${errors.email ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
            type="email" autoComplete="email" required value={form.email} onChange={set('email')}
            aria-invalid={!!errors.email || undefined} />
        </Field>
        <Field label="Password" required error={errors.password}>
          <PasswordInput value={form.password} onChange={set('password')} invalid={!!errors.password} autoComplete="current-password" />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={loading}>Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Want to support the home? <Link to="/register" className="font-medium text-brand hover:underline">Create a donor account</Link>
      </p>
    </Frame>
  );
}

export default function Login() {
  return <LoginFlow />;
}
