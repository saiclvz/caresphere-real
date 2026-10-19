/**
 * Display settings (per browser): text size, theme (light, dark or the device's setting), sidebar colour,
 * reduce motion, high contrast, underlined links, easy-read spacing. Stored in localStorage and applied to <html> as classes and data-theme (colours
 * in styles/tokens.css). They change presentation only, never what data a user may see. The device's "reduce
 * motion" setting is always respected as well.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'cs-display';
export const DEFAULT_PREFS = { textSize: 'normal', theme: 'light', sidebar: 'light', reduceMotion: false, contrast: false, underlineLinks: false, easyRead: false };
export const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Device' },
];
export const SIDEBARS = [
  { value: 'light', label: 'Light' },
  { value: 'navy', label: 'Navy' },
];
export const TEXT_SIZES = [
  { value: 'normal', label: 'Default' },
  { value: 'lg', label: 'Large' },
  { value: 'xl', label: 'Larger' },
];

export function readPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; }
}

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
/** The theme actually shown: "system" follows the device's light/dark setting. */
export const resolvedTheme = (p) => (p.theme === 'dark' || (p.theme === 'system' && darkQuery()?.matches) ? 'dark' : 'light');

export function applyPrefs(p) {
  const el = document.documentElement;
  el.classList.toggle('cs-text-lg', p.textSize === 'lg');
  el.classList.toggle('cs-text-xl', p.textSize === 'xl');
  el.classList.toggle('cs-reduce-motion', Boolean(p.reduceMotion));
  el.classList.toggle('cs-contrast', Boolean(p.contrast));
  el.classList.toggle('cs-underline-links', Boolean(p.underlineLinks));
  el.classList.toggle('cs-easy-read', Boolean(p.easyRead));
  el.classList.toggle('cs-sidebar-navy', p.sidebar === 'navy');
  el.dataset.theme = resolvedTheme(p);
}

export function useDisplayPrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => {
    applyPrefs(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode: still applied for this visit */ }
    // "Device" theme: follow the device when it switches between light and dark.
    const q = prefs.theme === 'system' ? darkQuery() : null;
    if (!q) return undefined;
    const onChange = () => applyPrefs(prefs);
    q.addEventListener?.('change', onChange);
    return () => q.removeEventListener?.('change', onChange);
  }, [prefs]);
  const update = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), []);
  const reset = useCallback(() => setPrefs({ ...DEFAULT_PREFS }), []);
  return { prefs, update, reset };
}
