import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EyeOff, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { clientInfo } from '../lib/clientInfo';

export const CAPTURE_MESSAGE = 'Screenshot or screen capture is not allowed for protected data.';
const HOLD_CLASS = 'cs-capture-hold';

const Ctx = createContext(null);
/** Inside a protected view: { exempt, report }. Outside: null. */
export const useProtection = () => useContext(Ctx);

/**
 * The one guard for every screen with protected data (child, health, transition, adoption, donor, account
 * and audit records, and the documents opened from them). No screen implements its own copy.
 *
 * What it does, where technically possible. A web page CANNOT block operating-system screenshots, screen
 * recording, screen sharing or a phone camera; these layers deter and record, they don't prevent:
 *  1. Nothing inside renders until the listeners below are attached (no unguarded first paint).
 *  2. (No watermark: the home decided not to use one.)
 *  3. The content is hidden while the window is not active (another window or app is focused, the tab is
 *     hidden, the phone switches apps). It shows again when the window is active.
 *  4. Print Screen, capture shortcuts, Ctrl/Cmd+P, Ctrl/Cmd+S and print events hide the content with
 *     CAPTURE_MESSAGE. Only keys the browser actually receives can be seen: on macOS (Cmd+Shift+3/4/5),
 *     with the Windows Snipping Tool (Win+Shift+S), Xbox Game Bar and on phones the browser gets nothing.
 *  5. A print stylesheet hides protected content (index.css).
 *  6. No text selection, right-click menu, copying or dragging (form fields still work for typing).
 *  7. Every attempt it can see is logged on the server with the page, browser, OS and device.
 *
 * Admin: by the home's Admin screenshot policy, Admin may take screenshots and screen recordings, so for
 * Admin layers 3-4 are off (no hiding, no capture message). Layers 1, 5 and 6, role and duty
 * checks, download/export permissions and audit logging stay. This is the only account-based condition:
 * duties, settings and unlock state never change the protection.
 */
export default function ProtectedContent({ area, children }) {
  const parent = useContext(Ctx);
  if (parent) return children; // already inside a guard (e.g. a document viewer on a protected page)
  return <Guard area={area}>{children}</Guard>;
}

function Guard({ area, children }) {
  const { user } = useAuth();
  const exempt = user?.role === 'Admin';
  const [ready, setReady] = useState(false);
  const [cover, setCover] = useState(null); // null | 'capture' | 'away'
  const last = useRef({});
  const client = useMemo(() => clientInfo(), []);

  // One log per kind every 20 seconds at most (holding a key repeats the event).
  const report = useCallback((kind) => {
    const t = Date.now();
    if (last.current[kind] && t - last.current[kind] < 20000) return;
    last.current[kind] = t;
    api('/security/capture-attempts', { method: 'POST', body: { area, kind, path: window.location.pathname, client } }).catch(() => {});
  }, [area, client]);

  const capture = useCallback((kind) => {
    if (exempt) return;
    setCover('capture');
    report(kind);
    // Replace whatever the capture put on the clipboard, where the browser allows it.
    try { navigator.clipboard?.writeText?.(' ').catch(() => {}); } catch { /* not allowed */ }
  }, [exempt, report]);

  // Attached before the first paint of the protected content (useLayoutEffect), then the content renders.
  useLayoutEffect(() => {
    // "Hold": the content is blanked at once (a class on <html>, styled in index.css, no React render) while
    // a key that starts a capture shortcut is held down: the Windows key (Win+Shift+S, Win+PrtScn,
    // Win+Alt+PrtScn, Win+Alt+R, Win+G), Cmd on macOS (Cmd+Shift+3/4/5), Alt (Alt+PrtScn) and Print Screen.
    // When the shortcut completes while the key is held, the capture shows the "not allowed" message
    // instead of the data. It only works when the browser receives the key-down: Print Screen on its own is
    // often handled by Windows first, and phones send no keys.
    const root = document.documentElement;
    const hold = () => { if (!exempt) root.classList.add(HOLD_CLASS); };
    const release = () => root.classList.remove(HOLD_CLASS);
    const editable = (t) => t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);
    const onKey = (e) => {
      const k = String(e.key || '');
      const mod = e.ctrlKey || e.metaKey;
      const down = e.type === 'keydown';
      if (k === 'Meta' || k === 'OS' || (k === 'Alt' && !editable(e.target))) { if (down) hold(); else release(); return; }
      if (k === 'PrintScreen' || e.code === 'PrintScreen') { hold(); e.preventDefault?.(); capture('print_screen'); if (!down) setTimeout(release, 1500); return; } // Windows usually sends it only on key-up
      if ((e.metaKey || k === 'Meta' || k === 'OS') && e.shiftKey && ['s', 'S', '3', '4', '5'].includes(k)) { capture('capture_shortcut'); return; }
      if (mod && ['p', 'P'].includes(k)) { e.preventDefault(); if (exempt) report('print'); else capture('print'); return; }
      if (mod && ['s', 'S'].includes(k) && !e.shiftKey) { e.preventDefault(); if (exempt) report('save_page'); else capture('save_page'); }
    };
    const onPrint = () => (exempt ? report('print') : capture('print'));
    const away = () => { if (!exempt) { hold(); setCover((c) => c || 'away'); } };
    const back = () => { release(); setCover((c) => (c === 'away' && document.visibilityState === 'visible' && document.hasFocus() ? null : c)); };
    // If Windows swallowed the key-up (e.g. after Win+Shift+S), the next mouse move without the key held releases.
    const onPointer = (e) => { if (!e.metaKey && !e.altKey && root.classList.contains(HOLD_CLASS) && document.hasFocus()) release(); };
    const onVisibility = () => (document.visibilityState === 'hidden' ? away() : back());
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('beforeprint', onPrint);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('visibilitychange', onVisibility);
    setReady(true);
    if (!exempt && (document.visibilityState === 'hidden' || !document.hasFocus())) away();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('beforeprint', onPrint);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [capture, report, exempt]);

  const block = (kind) => (e) => {
    const t = e.target;
    if (t && ['INPUT', 'TEXTAREA'].includes(t.tagName) && !t.readOnly) return; // typing and pasting in form fields stay normal
    e.preventDefault();
    report(kind);
  };

  const value = useMemo(() => ({ exempt, report }), [exempt, report]);
  return (
    <Ctx.Provider value={value}>
      <div className="cs-protected" onCopy={block('copy')} onCut={block('cut')} onContextMenu={block('right_click')} onDragStart={block('drag')}>
        {ready ? children : null}
        {cover === 'capture' && (
          <div className="cs-shield" role="alertdialog" aria-modal="true" aria-labelledby="shield-title">
            <div className="mx-4 max-w-md rounded-2xl bg-white p-6 text-center shadow-modal">
              <ShieldAlert className="mx-auto h-8 w-8 text-red-600" aria-hidden />
              <p id="shield-title" className="mt-2 font-semibold text-navy-900">{CAPTURE_MESSAGE}</p>
              <p className="mt-1 text-sm text-slate-600">This attempt has been recorded.</p>
              <button type="button" autoFocus className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-white" onClick={() => setCover(null)}>Continue</button>
            </div>
          </div>
        )}
        {cover === 'away' && (
          <div className="cs-shield" role="status" aria-live="polite">
            <div className="mx-4 max-w-sm rounded-2xl bg-white p-6 text-center shadow-modal">
              <EyeOff className="mx-auto h-7 w-7 text-navy-700" aria-hidden />
              <p className="mt-2 font-semibold text-navy-900">Protected data is hidden</p>
              <p className="mt-1 text-sm text-slate-600">It shows again when this window is active. Click here to continue.</p>
              <button type="button" className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-white" onClick={() => window.focus()}>Show</button>
            </div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
