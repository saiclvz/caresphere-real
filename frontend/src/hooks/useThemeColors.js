import { useEffect, useState } from 'react';

/**
 * Theme colours for places CSS classes can't reach (chart fills and strokes, SVG drawings). Reads the tokens in
 * styles/tokens.css and updates when Display settings switch light / dark / high contrast.
 */
const NAMES = { primary: 'primary', line: 'line', muted: 'muted', heading: 'heading', tint: 'tint-1', navy: 'navy-900', warning: 'warning-text', surface: 'surface' };
const FALLBACK = { primary: '#1B5FD1', line: '#D3E2F7', muted: '#51607F', heading: '#0B2A66', tint: '#EEF4FD', navy: '#1B2A6B', warning: '#8A4B00', surface: '#FFFFFF' };

function read() {
  if (typeof document === 'undefined') return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const [k, n] of Object.entries(NAMES)) {
    const v = cs.getPropertyValue(`--cs-${n}`).trim();
    out[k] = v ? `rgb(${v.split(/\s+/).join(', ')})` : FALLBACK[k];
  }
  return out;
}

export default function useThemeColors() {
  const [c, setC] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setC(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);
  return c;
}
