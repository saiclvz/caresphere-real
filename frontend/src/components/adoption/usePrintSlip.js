import { useEffect, useState } from 'react';

/** Prints one QR slip: mark it active, print, then clear. Returns [activeId, print(id)]. */
export default function usePrintSlip() {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (active === null) return undefined;
    const done = () => setActive(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [active]);
  return [active, setActive];
}
