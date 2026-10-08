import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import useCountdown from '../hooks/useCountdown';
import QrCode from './QrCode';
import { Button, ErrorNote, Field, Modal, Spinner } from './ui';

const TOKEN_LENGTH = 8;
const clean = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TOKEN_LENGTH);

export const CONFIDENTIALITY_NOTICE = 'This record is confidential. Open it only for the purpose you state, do not copy or share it, and remember that every view is recorded with your name, the time and your device.';

/**
 * "QR Token Verification" for every sensitive record (health, adoption applications, Transition Review).
 *  1. Purpose: a reason from the list for this record type (Other needs a note), plus the confidentiality tick.
 *  2. QR: plain text ("CareSphere ... Pass", the Token ID and its server-side expiry). The phone's camera
 *     shows it; no page or sign-in is needed. It refreshes when it expires and the old token stops working.
 *  3. Verify: type the Token ID. It works once, for this record and this signed-in session only.
 */
export default function TokenVerifyModal({ open, onClose, recordType, recordId, recordLabel, onUnlocked }) {
  const options = useApi(open ? `/unlock/options?record_type=${recordType}` : null);
  const purposes = options.data?.data?.purposes || [];
  const minutes = options.data ? Math.round(options.data.data.access_session / 60) : null;
  const [step, setStep] = useState('purpose');
  const [purpose, setPurpose] = useState('');
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [challenge, setChallenge] = useState(null);
  const [issueError, setIssueError] = useState(null);
  const [tokenId, setTokenId] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('purpose'); setPurpose(''); setNote(''); setAck(false); setFieldErrors({});
    setChallenge(null); setIssueError(null); setTokenId(''); setError(null);
  }, [open]);

  const issue = useCallback(async (refresh) => {
    setIssueError(null);
    try {
      const res = await api('/unlock/challenges', { method: 'POST', body: {
        record_type: recordType, record_id: String(recordId), purpose, purpose_note: note.trim() || undefined, acknowledged: true, refresh,
      } });
      setChallenge({ ...res.data, key: Date.now() });
      setTokenId('');
      return true;
    } catch (err) {
      setChallenge(null);
      setIssueError(err);
      return false;
    }
  }, [recordType, recordId, purpose, note]);

  const remaining = useCountdown(open && step === 'qr' ? challenge?.expires_in : 0, challenge?.key, () => {
    if (open && step === 'qr') issue(true);
  });

  const toQr = async () => {
    const e = {};
    if (!purpose) e.purpose = 'Choose the purpose.';
    if (purpose === 'Other' && note.trim().length < 5) e.note = 'Describe the purpose (at least 5 characters).';
    if (!ack) e.ack = 'Tick the box to continue.';
    setFieldErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const ok = await issue(false);
    setBusy(false);
    if (ok) setStep('qr');
  };

  const verify = async () => {
    if (tokenId.length !== TOKEN_LENGTH) { setError(new Error(`The Token ID has ${TOKEN_LENGTH} characters.`)); return; }
    setBusy(true); setError(null);
    try {
      const res = await api('/unlock/verify', { method: 'POST', body: { record_type: recordType, record_id: String(recordId), token: tokenId } });
      await onUnlocked(res.data);
    } catch (err) {
      setError(err.status === 429 ? err : new Error(err.status === 403 && !err.details?.not_assigned ? "That token isn't valid or has expired." : err.message));
      setTokenId('');
    } finally { setBusy(false); }
  };

  const notice = (
    <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900" role="note">
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /><p>{CONFIDENTIALITY_NOTICE}</p>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="QR Token Verification" size="sm"
      footer={step === 'purpose'
        ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={toQr} loading={busy}>Continue</Button></>
        : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={verify} loading={busy} disabled={!tokenId}>Verify</Button></>}>
      <div className="space-y-4">
        {notice}
        {step === 'purpose' ? (
          <>
            <ErrorNote error={issueError || options.error} />
            <p className="text-sm text-slate-600">Opening <strong>{recordLabel}</strong>{minutes ? ` for ${minutes} minute${minutes === 1 ? '' : 's'}` : ''}. State why you need it.</p>
            <Field label="Purpose" required error={fieldErrors.purpose}>
              <select className="input h-11" value={purpose} onChange={(e) => { setPurpose(e.target.value); setFieldErrors((x) => ({ ...x, purpose: undefined })); }}>
                <option value="">Select...</option>
                {purposes.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label={purpose === 'Other' ? 'Describe the purpose' : 'Note (optional)'} required={purpose === 'Other'} error={fieldErrors.note}>
              <textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => { setNote(e.target.value); setFieldErrors((x) => ({ ...x, note: undefined })); }} />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand" checked={ack} onChange={(e) => { setAck(e.target.checked); setFieldErrors((x) => ({ ...x, ack: undefined })); }} />
              <span>I will use this record only for the purpose I selected.<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></span>
            </label>
            {fieldErrors.ack && <p className="text-xs text-red-600" role="alert">{fieldErrors.ack}</p>}
          </>
        ) : (
          <>
            <ErrorNote error={error} />
            <div className="flex flex-col items-center">
              <div className="flex h-60 w-60 items-center justify-center rounded-xl border border-slate-200 bg-white p-3">
                {challenge ? <QrCode value={challenge.qr_text} size={216} label="Verification QR code" />
                  : issueError ? (
                    <div className="text-center text-sm text-red-600" role="alert">
                      <p>{issueError.message}</p>
                      <button type="button" onClick={() => issue(true)} className="mt-2 font-medium text-brand hover:underline">Try again</button>
                    </div>
                  ) : <Spinner />}
              </div>
              <p className="mt-3 text-sm text-slate-600" aria-live="polite">
                {challenge ? <>Token expires in <span className="font-semibold tabular-nums text-navy-900">{remaining}s</span></> : '\u00a0'}
              </p>
              <p className="mt-1 text-center text-xs text-slate-500">Scan with your phone's camera. Your phone shows the Token ID. Type it below within 1 minute.</p>
            </div>
            <Field label="Token ID">
              <input className="input h-12 text-center font-mono text-lg uppercase tracking-[0.3em]" value={tokenId} autoFocus
                onChange={(e) => { setTokenId(clean(e.target.value)); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') verify(); }}
                placeholder="XXXXXXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={TOKEN_LENGTH + 4} aria-label="Token ID" />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
