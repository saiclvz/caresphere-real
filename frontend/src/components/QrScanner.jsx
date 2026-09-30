import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, ImageUp, Keyboard } from 'lucide-react';
import { Button, Modal } from './ui';

const READER_ID = 'qr-reader';

/**
 * Camera QR scanner with two fallbacks:
 *  - scan a photo of the code (works on plain-HTTP LAN where browsers block cameras)
 *  - paste the code text
 */
export default function QrScanner({ open, onClose, onScan, title = 'Scan QR code', hint }) {
  const scannerRef = useRef(null);
  const handled = useRef(false);
  const [mode, setMode] = useState('camera');
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  const stop = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try { if (s.isScanning) await s.stop(); s.clear(); } catch { /* already stopped */ }
    }
  };

  const deliver = async (text) => {
    if (handled.current) return;
    handled.current = true;
    await stop();
    setBusy(true);
    try {
      await onScan(text.trim());
    } catch (err) {
      // Parent rejects when the server refuses the code; let the user retry.
      setError(err?.message || 'This code was not accepted.');
      setFailed(true);
    } finally {
      setBusy(false);
      handled.current = false;
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    handled.current = false;
    setError('');
    setFailed(false);
    if (mode !== 'camera') return undefined;

    if (!window.isSecureContext) {
      setError('Your browser only allows the camera on HTTPS or localhost. Use "Scan a photo" or "Enter code" instead.');
      return undefined;
    }
    const scanner = new Html5Qrcode(READER_ID, { verbose: false });
    scannerRef.current = scanner;
    scanner
      .start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, deliver, () => {})
      .catch((err) => setError(`Camera unavailable: ${err?.message || err}. Use "Scan a photo" or "Enter code".`));
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, attempt]);

  useEffect(() => { if (open) setManual(''); }, [open]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    const scanner = new Html5Qrcode(`${READER_ID}-file`, { verbose: false });
    try {
      const text = await scanner.scanFile(file, false);
      await deliver(text);
    } catch {
      setError('No QR code was found in that photo. Hold the camera closer and make sure the whole code is visible.');
    } finally {
      try { scanner.clear(); } catch { /* noop */ }
    }
  };

  const close = () => { stop(); onClose(); };

  const tabs = [
    { id: 'camera', label: 'Camera', icon: Camera },
    { id: 'file', label: 'Scan a photo', icon: ImageUp },
    { id: 'manual', label: 'Enter code', icon: Keyboard },
  ];

  return (
    <Modal open={open} onClose={close} title={title} size="sm">
      {hint && <p className="mb-4 text-sm text-slate-500">{hint}</p>}
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => { stop(); setMode(id); }}
            className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${mode === id ? 'bg-white text-navy-900 shadow-card' : 'text-slate-500'}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {mode === 'camera' && <div id={READER_ID} className="aspect-square w-full overflow-hidden rounded-xl bg-navy-900" />}

      {mode === 'file' && (
        <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-center hover:border-brand">
          <ImageUp className="mb-2 h-7 w-7 text-slate-400" aria-hidden />
          <span className="text-sm font-medium text-navy-900">Take or choose a photo of the code</span>
          <span className="mt-1 text-xs text-slate-500">Works on phones without HTTPS</span>
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} />
        </label>
      )}
      <div id={`${READER_ID}-file`} className="hidden" />

      {mode === 'manual' && (
        <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) deliver(manual); }} className="space-y-3">
          <textarea className="input font-mono text-xs" rows={4} value={manual} onChange={(e) => setManual(e.target.value)}
            placeholder="Paste the code shown under the QR image" aria-label="QR code text" />
          <Button type="submit" className="w-full" loading={busy} disabled={!manual.trim()}>Submit code</Button>
        </form>
      )}

      {busy && mode !== 'manual' && <p className="mt-3 text-center text-sm text-slate-500">Checking code…</p>}
      {error && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error}</p>}
      {failed && mode === 'camera' && (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => setAttempt((a) => a + 1)}>Scan again</Button>
      )}
    </Modal>
  );
}
