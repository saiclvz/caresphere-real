import { useEffect, useState } from 'react';

/** Counts down from `seconds` (re-starts when `key` changes). Calls onExpire once at 0. */
export default function useCountdown(seconds, key, onExpire) {
  const [remaining, setRemaining] = useState(seconds || 0);
  useEffect(() => {
    if (!seconds) { setRemaining(0); return undefined; }
    const end = Date.now() + seconds * 1000;
    setRemaining(seconds);
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, key]);
  return remaining;
}
