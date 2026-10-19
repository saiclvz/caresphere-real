import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, ErrorNote, Field } from '../components/ui';
import PasswordInput from '../components/PasswordInput';
import PasswordChecklist from '../components/PasswordChecklist';
import { problem as passwordProblem } from '../lib/passwordPolicy';
import AuthShell from './AuthShell';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Returns { field: message } for every invalid field. Empty object = valid. */
function validate(form) {
  const e = {};
  const name = form.full_name.trim();
  const email = form.email.trim();
  if (!name) e.full_name = 'Full name is required.';
  else if (name.length < 2) e.full_name = 'Full name must be at least 2 characters.';
  if (!email) e.email = 'Email is required.';
  else if (!EMAIL_RE.test(email)) e.email = 'Enter a valid email address.';
  if (!form.password) e.password = 'Password is required.';
  else { const p = passwordProblem(form.password, { email: form.email, name: form.full_name }); if (p) e.password = p; }
  if (!form.confirm) e.confirm = 'Confirm password is required.';
  else if (form.confirm !== form.password) e.confirm = 'Passwords do not match.';
  if (!form.accept) e.accept = 'Read and agree to the Terms and Conditions and the Privacy Policy to create an account.';
  return e;
}

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '', accept: false });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Update a field, and re-check only the fields that are already showing an error,
  // so each message clears as soon as the user fixes it.
  const set = (k) => (e) => {
    const next = { ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value };
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
      await register({
        full_name: form.full_name.trim(), email: form.email.trim(),
        password: form.password, confirm_password: form.confirm, accept_terms: form.accept === true,
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const bad = (k) => (errors[k] ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : '');
  return (
    <AuthShell title="Create an account" subtitle="Support the children in our care through donations, or apply to adopt, all from one account.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <Field label="Full name" required error={errors.full_name}>
          <input className={`input ${bad('full_name')}`} required maxLength={100} value={form.full_name} onChange={set('full_name')}
            autoComplete="name" aria-invalid={!!errors.full_name || undefined} />
        </Field>
        <Field label="Email" required error={errors.email}>
          <input className={`input ${bad('email')}`} type="email" required maxLength={100} value={form.email} onChange={set('email')}
            autoComplete="email" aria-invalid={!!errors.email || undefined} />
        </Field>
        <Field label="Password" required error={errors.password}>
          <PasswordInput value={form.password} onChange={set('password')} invalid={!!errors.password} autoComplete="new-password" minLength={8} describedBy="reg-pw-checklist" />
          <PasswordChecklist id="reg-pw-checklist" password={form.password} email={form.email} name={form.full_name} />
        </Field>
        <Field label="Confirm password" required error={errors.confirm}>
          <PasswordInput value={form.confirm} onChange={set('confirm')} invalid={!!errors.confirm} autoComplete="new-password" minLength={8} />
        </Field>
        <div>
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand" required checked={form.accept} onChange={set('accept')}
              aria-invalid={!!errors.accept || undefined} aria-describedby={errors.accept ? 'reg-accept-error' : undefined} />
            <span>I have read and agree to the CareSphere <Link to="/terms" target="_blank" rel="noopener" className="font-medium text-brand underline">Terms and Conditions</Link> and
              acknowledge the CareSphere <Link to="/privacy" target="_blank" rel="noopener" className="font-medium text-brand underline">Privacy Policy</Link>.</span>
          </label>
          {errors.accept && <p id="reg-accept-error" className="mt-1 text-xs text-red-600">{errors.accept}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" loading={loading}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already registered? <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
