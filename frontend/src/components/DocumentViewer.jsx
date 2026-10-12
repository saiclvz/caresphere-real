import { useEffect, useRef, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { api } from '../api/client';
import { ErrorNote, Modal, Spinner } from './ui';
import ProtectedContent from './ProtectedContent';

const MAX_PAGES = 60;
const MAX_WIDTH = 1100;

/**
 * pdf.js is loaded only when a PDF is opened (keeps the rest of the app small). The "legacy" build is used
 * because it includes the fallbacks older phone and desktop browsers need.
 */
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

function newCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = Math.round(width);
  c.height = Math.round(height);
  c.className = 'block h-auto w-full select-none rounded border border-slate-200 bg-white shadow-sm';
  c.setAttribute('aria-hidden', 'true');
  c.draggable = false;
  return c;
}

/**
 * Shows a permission-checked file as rendered pages: PDFs page by page and photos as pictures, drawn on
 * canvases. There is no browser PDF viewer, so no toolbar, Save or Print button, and no file URL to copy.
 * The file is fetched with the sign-in token (never in a URL), with no-store headers, and kept only in
 * memory while it is shown. A screenshot or a photo of the screen can still capture what is displayed.
 */
export function DocumentPages({ path, headers = {}, title = 'Document', onResponse }) {
  const box = useRef(null);
  const [state, setState] = useState({ loading: true, error: null, pages: 0, unsupported: false });

  useEffect(() => {
    let cancelled = false;
    let pdf = null;
    const host = box.current;
    host.replaceChildren();
    setState({ loading: true, error: null, pages: 0, unsupported: false });
    (async () => {
      try {
        const res = await api(path, { raw: true, headers });
        onResponse?.(res);
        const type = (res.headers.get('Content-Type') || '').split(';')[0].trim();
        const blob = await res.blob();
        if (cancelled) return;
        const width = Math.min(host.clientWidth || MAX_WIDTH, MAX_WIDTH) * (window.devicePixelRatio || 1);
        if (type.startsWith('image/')) {
          const img = await createImageBitmap(blob);
          const scale = Math.min(1, width / img.width);
          const c = newCanvas(img.width * scale, img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          img.close?.();
          if (!cancelled) { host.append(c); setState({ loading: false, error: null, pages: 1, unsupported: false }); }
          return;
        }
        if (type !== 'application/pdf') { setState({ loading: false, error: null, pages: 0, unsupported: true }); return; }
        const pdfjs = await loadPdfJs();
        pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        const count = Math.min(pdf.numPages, MAX_PAGES);
        for (let n = 1; n <= count && !cancelled; n += 1) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: width / base.width });
          const c = newCanvas(viewport.width, viewport.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
          if (cancelled) return;
          host.append(c);
          setState({ loading: n < count, error: null, pages: pdf.numPages, unsupported: false });
        }
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err, pages: 0, unsupported: false });
      }
    })();
    return () => { cancelled = true; pdf?.destroy?.(); host.replaceChildren(); };
  }, [path, JSON.stringify(headers)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2" aria-label={title} role="document">
      {state.error && <ErrorNote error={state.error} />}
      {state.unsupported && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><FileWarning className="h-4 w-4" aria-hidden />This file type can't be shown here. Only PDF, JPG and PNG files are displayed.</p>
      )}
      <div ref={box} className="space-y-3" onContextMenu={(e) => e.preventDefault()} />
      {state.loading && !state.error && <Spinner label="Opening the document..." />}
      {state.pages > MAX_PAGES && <p className="text-xs text-slate-500">Showing the first {MAX_PAGES} of {state.pages} pages.</p>}
    </div>
  );
}

/** The document viewer as a dialog, inside the protection guard (it joins the page's guard if there is one). */
export default function DocumentViewer({ open, title, path, headers, onClose, actions = null }) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={title} size="xl" footer={actions}>
      <ProtectedContent area="Documents">
        <DocumentPages path={path} headers={headers} title={title} />
      </ProtectedContent>
    </Modal>
  );
}
