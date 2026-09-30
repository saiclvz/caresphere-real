import { useEffect, useState } from 'react';
import { Check, Copy, Download, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../api/client';
import { Button, ErrorNote, Field, Spinner } from '../components/ui';

/* Two-step verification screens for Admin sign-in (setup, verify, backup codes). */

const TOTP_RE = /^\d{6}$/;
const BACKUP_RE = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i;
const badInput = 'border-red-400 focus:border-red-500 focus:ring-red-200';

function validateCode(value, mode) {
  const v = value.trim();
  if (mode === 'backup') {
    if (!v) return 'A backup code is required.';
    if (!BACKUP_RE.test(v)) return 'Enter a backup code like ABCD-EFGH.';
    return null;
  }
  if (!v) return 'The 6-digit code is required.';
  if (!TOTP_RE.test(v)) return 'Enter the 6 digits from your authenticator app.';
  return null;
}

/** Copies text, with a fallback for plain-http LAN addresses where navigator.clipboard is unavailable. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
}

/** The code input: numeric keypad for 6-digit codes, text for backup codes. */
function CodeInput({ value, onChange, error, mode = 'totp' }) {
  const totp = mode === 'totp';
  return (
    <Field label={totp ? '6-digit code' : 'Backup code'} required error={error}
      hint={totp ? 'Open your authenticator app and enter the current code for CareSphere.' : 'Each backup code works once.'}>
      <input className={`input text-center font-mono text-lg tracking-[0.3em] ${error ? badInput : ''}`}
        value={value} onChange={onChange} required autoFocus
        inputMode={totp ? 'numeric' : 'text'} autoComplete={totp ? 'one-time-code' : 'off'}
        maxLength={totp ? 6 : 9} placeholder={totp ? '000000' : 'ABCD-EFGH'}
        aria-invalid={!!error || undefined} />
    </Field>
  );
}

/** Shared behaviour for the two code forms: inline validation, API errors, "sign in again" state. */
function useCodeForm(mode) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);     // inline field error
  const [apiError, setApiError] = useState(null);
  const [restart, setRestart] = useState(false);
  const [loading, setLoading] = useState(false);

  const onChange = (e) => {
    const v = mode === 'totp' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value.toUpperCase();
    setCode(v);
    if (error) setError(validateCode(v, mode));
  };

  const run = async (request) => {
    const problem = validateCode(code, mode);
    setError(problem);
    if (problem) return null;
    setLoading(true); setApiError(null);
    try {
      return await request(code.trim());
    } catch (err) {
      setApiError(err);
      if (err.details?.restart) setRestart(true);
      setCode('');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setCode(''); setError(null); setApiError(null); };
  return { code, error, apiError, restart, loading, onChange, run, reset };
}

function RestartNote({ error, onRestart }) {
  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <Button className="w-full" size="lg" onClick={onRestart}>Back to sign in</Button>
    </div>
  );
}

/** Sign-in step 2 for admins who already set up MFA. */
export function MfaVerify({ mfaToken, onDone, onRestart }) {
  const [mode, setMode] = useState('totp');
  const f = useCodeForm(mode);

  const submit = async (e) => {
    e.preventDefault();
    const res = await f.run((code) => api('/auth/mfa/verify', { method: 'POST', body: { mfa_token: mfaToken, code } }));
    if (res) onDone(res);
  };

  if (f.restart) return <RestartNote error={f.apiError} onRestart={onRestart} />;
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <ErrorNote error={f.apiError} />
      <CodeInput key={mode} value={f.code} onChange={f.onChange} error={f.error} mode={mode} />
      <Button type="submit" className="w-full" size="lg" loading={f.loading}>Verify</Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="font-medium text-brand hover:underline"
          onClick={() => { setMode(mode === 'totp' ? 'backup' : 'totp'); f.reset(); }}>
          {mode === 'totp' ? 'Use a backup code instead' : 'Use the authenticator app instead'}
        </button>
        <button type="button" className="text-slate-500 hover:text-navy-900" onClick={onRestart}>Cancel</button>
      </div>
    </form>
  );
}

/** First sign-in for an admin without MFA: scan the QR code, confirm one code. */
export function MfaSetup({ mfaToken, onDone, onRestart }) {
  const [details, setDetails] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [copied, setCopied] = useState(false);
  const f = useCodeForm('totp');

  useEffect(() => {
    let alive = true;
    api('/auth/mfa/setup/start', { method: 'POST', body: { mfa_token: mfaToken } })
      .then((res) => alive && setDetails(res.data))
      .catch((err) => alive && setLoadError(err));
    return () => { alive = false; };
  }, [mfaToken]);

  const submit = async (e) => {
    e.preventDefault();
    const res = await f.run((code) => api('/auth/mfa/setup/confirm', { method: 'POST', body: { mfa_token: mfaToken, code } }));
    if (res) onDone(res);
  };

  if (loadError) return <RestartNote error={loadError} onRestart={onRestart} />;
  if (f.restart) return <RestartNote error={f.apiError} onRestart={onRestart} />;
  if (!details) return <Spinner label="Preparing setup" />;

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <ol className="space-y-4 text-sm text-slate-700">
        <li className="flex gap-3">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>Install an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.</span>
        </li>
        <li className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>In the app, add an account and scan this QR code.</span>
        </li>
      </ol>
      <div className="flex justify-center">
        <img src={details.qr_data_url} alt="QR code for your authenticator app" className="h-44 w-44 rounded-lg border border-slate-200 bg-white p-2" />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs text-slate-500">Can't scan it? Enter this key manually (account: {details.account}, time-based):</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <code className="break-all font-mono text-sm text-navy-900">{details.manual_key}</code>
          <Button size="sm" variant="ghost" aria-label="Copy key"
            onClick={async () => { if (await copyText(details.manual_key.replace(/\s/g, ''))) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <ErrorNote error={f.apiError} />
      <CodeInput value={f.code} onChange={f.onChange} error={f.error} />
      <Button type="submit" className="w-full" size="lg" loading={f.loading}>Verify and turn on</Button>
      <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-navy-900" onClick={onRestart}>Cancel</button>
    </form>
  );
}

/** Shown once after setup. Codes are only stored hashed, so they can't be shown again. */
export function BackupCodes({ codes, onContinue }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `CareSphere backup codes (each works once)\n\n${codes.join('\n')}\n`;

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'caresphere-backup-codes.txt';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Keep these somewhere safe. If you lose your phone, each code lets you sign in once. They won't be shown again.</span>
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-4 font-mono text-sm text-navy-900">
        {codes.map((c) => <li key={c} className="text-center">{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={download}><Download className="h-4 w-4" /> Download</Button>
        <Button variant="secondary" className="flex-1"
          onClick={async () => { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I have saved my backup codes.
      </label>
      <Button className="w-full" size="lg" disabled={!saved} onClick={onContinue}>Continue to CareSphere</Button>
    </div>
  );
}

/** Shown after signing in with a backup code. */
export function BackupCodeUsed({ left, onContinue }) {
  return (
    <div className="space-y-5">
      <div className={`rounded-lg border p-3 text-sm ${left <= 3 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}>
        Backup code accepted. You have <strong>{left}</strong> backup code{left === 1 ? '' : 's'} left.
        {left <= 3 && ' If you have lost your phone, ask another administrator to reset your two-step verification so you can set it up again.'}
      </div>
      <Button className="w-full" size="lg" onClick={onContinue}>Continue to CareSphere</Button>
    </div>
  );
}
