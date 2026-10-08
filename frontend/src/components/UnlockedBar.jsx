import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Lock, Unlock } from 'lucide-react';
import { api } from '../api/client';
import { Button } from './ui';

/**
 * Shown while a record is unlocked: the purpose, a live countdown and "Lock now". When the time
 * runs out (or Lock now is pressed) the page locks again; the server enforces the same expiry.
 */
export default function UnlockedBar({ recordType, recordId, expiresAt, purpose, headers, onLocked, warningSeconds = 30 }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  const [busy, setBusy] = useState(false);
  const warned = useRef(false);
  useEffect(() => {
    warned.current = false;
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s > 0 && s <= warningSeconds && !warned.current) {
        warned.current = true;
        api('/unlock/events', { method: 'POST', headers, body: { record_type: recordType, record_id: String(recordId), event: 'warning_shown' } }).catch(() => {});
      }
      if (s === 0) onLocked('expired');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const lockNow = async () => {
    setBusy(true);
    await api('/unlock/lock', { method: 'POST', headers, body: { record_type: recordType, record_id: String(recordId) } }).catch(() => {});
    setBusy(false);
    onLocked('locked');
  };
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const warning = left > 0 && left <= warningSeconds;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${warning ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
      role={warning ? 'alert' : 'status'}>
      {warning ? <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden /> : <Unlock className="h-5 w-5 shrink-0" aria-hidden />}
      <p className="min-w-0 flex-1">{warning
        ? <>Locks in <span className="font-semibold tabular-nums">{left} seconds</span>. Save your work now.</>
        : <>Unlocked for <strong>{purpose}</strong>. Locks in <span className="font-semibold tabular-nums">{mm}:{ss}</span>.</>}</p>
      <Button size="sm" variant="secondary" loading={busy} onClick={lockNow}><Lock className="h-4 w-4" /> Lock now</Button>
    </div>
  );
}
