import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { api } from '../../api/client';

/**
 * An image served only through a short-lived signed link (Payment QR images): fetched with the session, kept in
 * memory as a blob, never a public or third-party URL.
 */
export default function SignedImage({ url, alt, className = '' }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setFailed(false); setSrc(null);
    if (!url) return undefined;
    api(url, { raw: true }).then((r) => r.blob()).then((b) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(b);
      setSrc(objectUrl);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (failed) return <div className={`flex items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-500 ${className}`}><ImageOff className="mr-1 h-4 w-4" aria-hidden /> Couldn't load the QR. Refresh the page.</div>;
  if (!src) return <div className={`animate-pulse rounded-xl bg-slate-100 ${className}`} aria-label="Loading the QR code" role="img" />;
  return <img src={src} alt={alt} className={`rounded-xl bg-white object-contain ${className}`} draggable={false} />;
}
