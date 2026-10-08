import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Password input with a show/hide eye button on the right.
 * Shared by the Sign in and Create an account pages so both look and behave the same.
 */
export default function PasswordInput({ value, onChange, invalid = false, autoComplete = 'current-password', minLength, required = true, id, describedBy }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input className={`input pr-10 ${invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
        type={visible ? 'text' : 'password'} required={required} minLength={minLength} value={value} onChange={onChange}
        id={id} aria-describedby={describedBy} autoComplete={autoComplete} aria-invalid={invalid || undefined} />
      <button type="button" onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-slate-400 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
