import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import { api } from '../api/client';

/**
 * Photos are served only through authorised API routes, and <img> cannot send
 * the sign-in token, so the image is fetched with it and shown from a blob URL.
 */
export default function AuthImage({ src, alt, className = '', fallbackClassName = '' }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) { setUrl(null); return undefined; }
    let objectUrl;
    let cancelled = false;
    setFailed(false);
    api(src, { raw: true })
      .then((res) => res.blob())
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);

  if (!src || failed || !url) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 text-slate-400 ${className} ${fallbackClassName}`} role="img" aria-label={alt}>
        <UserRound className="h-1/2 w-1/2" aria-hidden />
      </div>
    );
  }
  return <img src={url} alt={alt} className={`object-cover ${className}`} />;
}
