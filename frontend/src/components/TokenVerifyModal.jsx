import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import useCountdown from '../hooks/useCountdown';
import { Button, ErrorNote, Field, Modal, Spinner } from './ui';

const TOKEN_LENGTH = 8;
const clean = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TOKEN_LENGTH);

/**
 * Staff "QR Token Verification" modal (no camera).
 * 1. A 180-second token is generated for this record and shown as a QR code.
 * 2. Staff scan it with their phone's built-in camera app, which shows the Token ID.
 * 3. Staff type the Token ID here and press Verify.
 * A fresh token is generated automatically whenever the current one expires.
 */
export default function TokenVerifyModal({ open, onClose, scope, targetId, onVerify }) {
  const [issued, setIssued] = useState(null);
  const [issueError, setIssueError] = useState(null);
  const [tokenId, setTokenId] = useState('');
  const [error, setError] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const issue = useCallback(async () => {
    setIssueError(null);
    try {
      const res = await api('/qr/generate-token', { method: 'POST', body: { scope, target_id: targetId } });
      setIssued({ ...res, key: Date.now() });
      setTokenId('');
    } catch (err) {
      setIssued(null);
      setIssueError(err);
    }
  }, [scope, targetId]);

  useEffect(() => {
    if (!open) return;
    setIssued(null);
    setTokenId('');
    setError(null);
    issue();
  }, [open, issue]);

  const remaining = useCountdown(open ? issued?.ttl_seconds : 0, issued?.key, () => {
    if (open) issue();
  });

  const verify = async () => {
    if (tokenId.length !== TOKEN_LENGTH) {
      setError(new Error(`The Token ID has ${TOKEN_LENGTH} characters.`));
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      await onVerify(tokenId);
    } catch (err) {
      setError(err);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="QR Token Verification" size="sm"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={verify} loading={verifying} disabled={!tokenId}>Verify</Button>
      </>}>
      <ErrorNote error={error} />

      <div className="flex flex-col items-center">
        <div className="flex h-60 w-60 items-center justify-center rounded-xl border border-slate-200 bg-white p-3">
          {issued ? (
            <img src={issued.qr_data_url} alt="Encrypted verification QR code" className="h-full w-full" />
          ) : issueError ? (
            <div className="text-center text-sm text-red-600" role="alert">
              <p>{issueError.message}</p>
              <button type="button" onClick={issue} className="mt-2 font-medium text-brand hover:underline">Try again</button>
            </div>
          ) : (
            <Spinner />
          )}
        </div>
        <p className="mt-3 text-sm text-slate-600" aria-live="polite">
          {issued ? <>Token expires in <span className="font-semibold tabular-nums text-navy-900">{remaining}s</span></> : '\u00a0'}
        </p>
      </div>

      <div className="mt-4">
        <Field label="Token ID">
          <input className="input text-center font-mono text-lg tracking-[0.3em] uppercase" value={tokenId}
            onChange={(e) => setTokenId(clean(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') verify(); }}
            placeholder="E.G. A1B2C3" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            maxLength={TOKEN_LENGTH + 4} aria-label="Token ID" />
        </Field>
      </div>
    </Modal>
  );
}
