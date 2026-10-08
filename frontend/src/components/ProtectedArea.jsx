import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../api/client';

const MESSAGE = 'Screenshot or screen capture is not allowed for protected data.';

/**
 * Wraps pages with protected data (child, health, transition, adoption, donor, account and audit records).
 *
 * A website can't block the operating system's screenshot or screen-recording tools, or a phone camera.
 * So this deters and records instead:
 *  - the content is covered when the Print Screen key or a capture shortcut is pressed, and when printing,
 *  - text can't be selected, copied, dragged or opened with the right-click menu,
 *  - each attempt it can see is logged on the server (who, when, which page, what).
 */
export default function ProtectedArea({ area, children }) {
  const [covered, setCovered] = useState(false);
  const last = useRef({});

  // One log per kind every 20 seconds at most (holding a key repeats the event).
  const report = useCallback((kind) => {
    const t = Date.now();
    if (last.current[kind] && t - last.current[kind] < 20000) return;
    last.current[kind] = t;
    api('/security/capture-attempts', { method: 'POST', body: { area, kind, path: window.location.pathname } }).catch(() => {});
  }, [area]);

  const capture = useCallback((kind) => {
    setCovered(true);
    report(kind);
    // Replace whatever the capture put on the clipboard, where the browser allows it.
    try { navigator.clipboard?.writeText?.(' ').catch(() => {}); } catch { /* not allowed */ }
  }, [report]);

  useEffect(() => {
    const onKey = (e) => {
      const k = String(e.key || '');
      if (k === 'PrintScreen' || e.code === 'PrintScreen') { e.preventDefault?.(); capture('print_screen'); return; }
      // Windows Snipping Tool (Win+Shift+S) and macOS capture shortcuts (Cmd+Shift+3/4/5), when the browser sees them.
      if ((e.metaKey || e.key === 'Meta') && e.shiftKey && ['s', 'S', '3', '4', '5'].includes(k)) { capture('capture_shortcut'); return; }
      if ((e.ctrlKey || e.metaKey) && ['p', 'P'].includes(k)) { e.preventDefault(); capture('print'); return; }
      if ((e.ctrlKey || e.metaKey) && ['s', 'S'].includes(k) && !e.shiftKey) { e.preventDefault(); report('save_page'); }
    };
    const onPrint = () => capture('print');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('beforeprint', onPrint);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('beforeprint', onPrint);
    };
  }, [capture, report]);

  const block = (kind) => (e) => {
    const t = e.target;
    if (t && ['INPUT', 'TEXTAREA'].includes(t.tagName) && !t.readOnly) return; // typing, pasting and right-click paste in a form field stay normal
    e.preventDefault();
    report(kind);
  };

  return (
    <div className="cs-protected" onCopy={block('copy')} onCut={block('cut')} onContextMenu={block('right_click')} onDragStart={block('drag')}>
      {children}
      {covered && (
        <div className="cs-shield" role="alertdialog" aria-modal="true" aria-labelledby="shield-title">
          <div className="mx-4 max-w-md rounded-2xl bg-white p-6 text-center shadow-modal">
            <ShieldAlert className="mx-auto h-8 w-8 text-red-600" aria-hidden />
            <p id="shield-title" className="mt-2 font-semibold text-navy-900">{MESSAGE}</p>
            <p className="mt-1 text-sm text-slate-600">This attempt has been recorded.</p>
            <button type="button" autoFocus className="mt-4 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white" onClick={() => setCovered(false)}>Continue</button>
          </div>
        </div>
      )}
    </div>
  );
}
