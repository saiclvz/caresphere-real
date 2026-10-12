/**
 * Display settings (per browser): text size, reduce motion, higher contrast. Stored in localStorage and
 * applied as classes on <html> (styles in index.css). They change presentation only, never what data a
 * user may see. The device's "reduce motion" setting is always respected as well.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'cs-display';
export const DEFAULT_PREFS = { textSize: 'normal', reduceMotion: false, contrast: false };
export const TEXT_SIZES = [
  { value: 'normal', label: 'Default' },
  { value: 'lg', label: 'Large' },
  { value: 'xl', label: 'Larger' },
];

export function readPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}

export function applyPrefs(p) {
  const el = document.documentElement;
  el.classList.toggle('cs-text-lg', p.textSize === 'lg');
  el.classList.toggle('cs-text-xl', p.textSize === 'xl');
  el.classList.toggle('cs-reduce-motion', Boolean(p.reduceMotion));
  el.classList.toggle('cs-contrast', Boolean(p.contrast));
}

export function useDisplayPrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => {
    applyPrefs(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode: still applied for this visit */ }
  }, [prefs]);
  const update = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), []);
  const reset = useCallback(() => setPrefs({ ...DEFAULT_PREFS }), []);
  return { prefs, update, reset };
}
