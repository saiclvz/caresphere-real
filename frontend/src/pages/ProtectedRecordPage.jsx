import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Download, KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Field, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { DocumentPages } from '../components/DocumentViewer';

/**
 * Shows the record in the protected viewer (rendered pages, no browser PDF viewer, no file URL), with the
 * grant header (never in the URL). Download stays a separate button, only when the server allows it.
 */
function RecordViewer({ publicId, record, grant, expiresAt }) {
  const { toast } = useApp();
  const [verified, setVerified] = useState(null);
  const [left, setLeft] = useState(null);
  const headers = grant ? { 'X-Protected-Access': grant } : {};

  useEffect(() => {
    if (!expiresAt) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000)));
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const download = async () => {
    try {
      const res = await api(`/protected/${publicId}/download`, { raw: true, headers });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${record.label.replace(/[^\w ,.-]+/g, '')}-watermarked.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {verified === 'true' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Verified: file matches its SHA-256</span>}
        {verified === 'false' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Warning: file does not match its recorded SHA-256</span>}
        {left !== null && <span className="text-xs text-slate-500">Access ends in about {left} minute{left === 1 ? '' : 's'}.</span>}
        <span className="ml-auto" />
        {record.can_download && (
          <Button size="sm" variant="secondary" onClick={download}><Download className="h-4 w-4" /> Download (watermarked)</Button>
        )}
      </div>
      <DocumentPages path={`/protected/${publicId}/view`} headers={headers} title={record.label} onResponse={(res) => setVerified(res.headers.get('X-File-Verified'))} />
    </div>
  );
}

/**
 * /protected/:publicId - the address inside a Protected record QR.
 *  Admin: opens directly (sealed records ask for a reason and the NACC order number).
 *  Staff: "Enter token ID", then view-only for the token's remaining time.
 */
function ProtectedRecordInner() {
  const { publicId } = useParams();
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [access, setAccess] = useState(null); // { grant, expires_at, record }
  const [token, setToken] = useState('');
  const [reason, setReason] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [needsSealed, setNeedsSealed] = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    api(`/protected/${publicId}`).then((r) => setInfo(r.data)).catch(setError);
  }, [publicId]);

  const unlock = useCallback(async (e) => {
    e.preventDefault();
    setFieldError(null);
    if (!isAdmin && !token.trim()) { setFieldError('Enter the token ID.'); return; }
    if ((needsSealed || (isAdmin && info?.sealed)) && (reason.trim().length < 10 || !orderNo.trim())) {
      setFieldError('Type the reason (at least 10 characters) and the NACC order number.'); return;
    }
    setBusy(true);
    try {
      const res = isAdmin
        ? await api(`/protected/${publicId}/open-sealed`, { method: 'POST', body: { reason: reason.trim(), order_number: orderNo.trim() } })
        : await api(`/protected/${publicId}/unlock`, { method: 'POST', body: { token, reason: reason.trim() || undefined, order_number: orderNo.trim() || undefined } });
      setAccess(res.data);
      setToken('');
    } catch (err) {
      // A valid token on a sealed record asks for the reason and order number (the token is not used up).
      if (!isAdmin && err.status === 400 && /reason|order number/i.test(err.message)) { setNeedsSealed(true); setFieldError(err.message); }
      else setFieldError(err.message);
    } finally { setBusy(false); }
  }, [isAdmin, token, reason, orderNo, needsSealed, info, publicId]);

  if (error) return <ErrorNote error={error} />;
  if (!info) return <Spinner />;
  const whole = (access?.record?.whole_record && access.record) || (isAdmin && info.whole_record && info);
  if (whole) return <Navigate to={whole.application_id ? `/adoptions/${whole.application_id}` : `/children/${whole.child_id}`} replace />;

  const notice = (
    <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="note">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p><strong>Confidential protected record.</strong> Access is limited by RA 11642 Section 39 and the Data Privacy Act. Every view and download is recorded with your name and the time.</p>
    </div>
  );
  const sealedFields = (
    <>
      <Field label="Reason for opening this sealed record" required hint="Recorded in the sealed record access log.">
        <textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label="NACC Order of Adoption number" required>
        <input className="input font-mono" maxLength={80} value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
      </Field>
    </>
  );

  // Admin, not sealed: opens directly.
  if (isAdmin && !info.sealed) {
    return (
      <div className="space-y-4">
        {notice}
        <h1 className="text-xl font-semibold text-navy-900">{info.label}</h1>
        <RecordViewer publicId={publicId} record={{ ...info, can_download: true }} />
      </div>
    );
  }
  if (access) {
    return (
      <div className="space-y-4">
        {notice}
        <h1 className="text-xl font-semibold text-navy-900">{access.record.label}</h1>
        <p className="text-sm text-slate-500">View only. Access ends {formatDateTime(access.expires_at)}.</p>
        <RecordViewer publicId={publicId} record={{ ...access.record, can_download: isAdmin || access.record.allow_download }} grant={access.grant} expiresAt={access.expires_at} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md space-y-4">
      {notice}
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2 text-navy-900">
          {isAdmin ? <Lock className="h-5 w-5 text-red-600" aria-hidden /> : <KeyRound className="h-5 w-5 text-brand" aria-hidden />}
          <h1 className="text-lg font-semibold">{isAdmin ? 'Sealed original birth record' : 'Enter token ID'}</h1>
        </div>
        <p className="text-sm text-slate-600">{isAdmin
          ? 'This record is sealed. Opening it requires a reason and the NACC Order of Adoption number.'
          : 'This record is protected. Enter the token ID an administrator gave you for it.'}</p>
        <form onSubmit={unlock} noValidate className="space-y-4">
          {!isAdmin && (
            <Field label="Token ID" required>
              <input ref={inputRef} className="input text-center font-mono text-lg uppercase tracking-widest" autoFocus autoComplete="off" spellCheck={false}
                maxLength={16} placeholder="XXXX-XXXX-XXXX" value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} />
            </Field>
          )}
          {(isAdmin || needsSealed) && sealedFields}
          {fieldError && <p className="text-sm text-red-600" role="alert">{fieldError}</p>}
          <Button type="submit" className="w-full" loading={busy}>{isAdmin ? 'Open sealed record' : 'Open record'}</Button>
        </form>
      </Card>
    </div>
  );
}

export default function ProtectedRecordPage() {
  return <ProtectedRecordInner />;
}
