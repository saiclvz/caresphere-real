import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock, Info, MinusCircle, RotateCcw, ShieldCheck, Upload, X, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { Modal } from '../ui';
import { checkPhoto, HINT_TEXT } from '../../lib/imageHints';
import { formatDate } from '../../lib/format';

const SLOTS = [
  { docType: 'valid_id', side: 'front' },
  { docType: 'valid_id_back', side: 'back' },
];
const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
const POLL_MS = 2500;
const POLL_LIMIT = 48; // about two minutes

/** Card IDs are 85.6 x 54 mm (ISO ID-1); a passport data page is about 125 x 88 mm. */
const frameRatio = (passport) => (passport ? 125 / 88 : 85.6 / 54);

/** Icon and word for a check state (never color alone). */
function StateMark({ state }) {
  const map = {
    pass: [CheckCircle2, 'Passed', 'var(--ad-success)'],
    fail: [XCircle, 'Needs a fix', 'var(--ad-danger)'],
    pending: [Clock, 'Waiting', 'var(--ad-muted)'],
    'n/a': [MinusCircle, 'Not needed', 'var(--ad-muted)'],
  };
  const [Icon, word, color] = map[state] || map.pending;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold" style={{ color }}>
      <Icon className="h-4 w-4" aria-hidden /> {word}
    </span>
  );
}

const sideResult = (s) => {
  if (!s) return null;
  if (s.state !== 'done') return { word: 'Scanning...', cls: 'cs-chip-info' };
  if (s.result === 'passed') return { word: 'Checks passed', cls: 'cs-chip-done' };
  if (s.result === 'unreadable') return { word: "Couldn't read", cls: 'cs-chip-warn' };
  return { word: 'Needs a fix', cls: 'cs-chip-missing' };
};

/**
 * Camera with a guide frame. Only the area inside the frame (plus a small margin) is kept, so the card
 * fills the photo. Needs HTTPS (or localhost); otherwise the parent falls back to the phone's camera app.
 */
function CameraCapture({ side, passport, onCapture, onClose }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [dims, setDims] = useState({ w: 16, h: 9 });

  useEffect(() => {
    let alive = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      })
      .catch(() => alive && setError('The camera could not be opened. Allow camera access, or close this and choose a photo instead.'));
    return () => { alive = false; stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // The guide frame as fractions of the video picture.
  const ratio = frameRatio(passport);
  let fw = 0.86; let fh = (fw * dims.w) / ratio / dims.h;
  if (fh > 0.8) { fh = 0.8; fw = (fh * dims.h * ratio) / dims.w; }
  const fx = (1 - fw) / 2; const fy = (1 - fh) / 2;

  const take = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const m = 0.04; // keep a little margin around the frame so the card's edges are in the photo
    const sx = Math.max(0, (fx - m * fw) * v.videoWidth); const sy = Math.max(0, (fy - m * fh) * v.videoHeight);
    const sw = Math.min(v.videoWidth - sx, fw * (1 + 2 * m) * v.videoWidth); const sh = Math.min(v.videoHeight - sy, fh * (1 + 2 * m) * v.videoHeight);
    const c = document.createElement('canvas');
    c.width = Math.round(sw); c.height = Math.round(sh);
    c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) { setError('The photo could not be taken. Try again.'); return; }
      onCapture(new File([blob], `id-${side}-camera.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  return (
    <Modal open onClose={onClose} title={`Take a photo of the ${side === 'front' ? (passport ? 'passport photo page' : 'front of your ID') : 'back of your ID'}`} size="lg" initialFocus="first"
      footer={<>
        <button type="button" className="cs-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="cs-btn cs-btn-primary" onClick={take} disabled={!ready}><Camera className="h-4 w-4" aria-hidden /> Take photo</button>
      </>}>
      <div className="cs-theme space-y-3">
        {error ? <div className="cs-notice cs-notice-error" role="alert">{error}</div> : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={video} playsInline muted className="block h-auto w-full"
              onLoadedMetadata={(e) => { setDims({ w: e.target.videoWidth || 16, h: e.target.videoHeight || 9 }); setReady(true); }} />
            {ready && (
              <div aria-hidden="true" className="pointer-events-none absolute rounded-xl border-4 border-white"
                style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, width: `${fw * 100}%`, height: `${fh * 100}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
            )}
          </div>
        )}
        <p className="text-sm">Put the card inside the frame. Lay it on a flat, plain surface, in good light, with no glare. All four corners should show.</p>
      </div>
    </Modal>
  );
}

/** One side: the file, the scan result for that side, and Take a photo / Choose a file. */
function SideSlot({ slot, label, required, hint, file, scan, attemptsUsed, maxAttempts, disabled, passport, onFile, onRemove, canRemove, requiredError }) {
  const pickRef = useRef(null);
  const camRef = useRef(null);
  const [camera, setCamera] = useState(false);
  const status = sideResult(scan);
  const fails = (scan?.checks || []).filter((c) => c.result === 'fail');
  const retakesLeft = Math.max(0, maxAttempts - attemptsUsed);
  const outOfTries = attemptsUsed >= maxAttempts;
  const needsRetake = scan && scan.state === 'done' && scan.result !== 'passed';
  const liveCamera = typeof window !== 'undefined' && window.isSecureContext && navigator.mediaDevices?.getUserMedia;

  const choose = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(slot, f); };
  const openCamera = () => (liveCamera ? setCamera(true) : camRef.current?.click());

  return (
    <div id={`f-doc:${slot.docType}`} tabIndex={-1} className={`cs-file ${file && !needsRetake ? 'has-file' : ''} ${requiredError && !file ? 'cs-file-error' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="cs-title text-sm">{label}{required ? <span className="cs-req" aria-hidden="true">*</span> : <span className="cs-muted font-normal"> (optional)</span>}</p>
          <p className="cs-hint">{hint} JPG, PNG or PDF, up to 10 MB.</p>
        </div>
        {status && <span className={`cs-chip ${status.cls}`}>{status.word}</span>}
      </div>

      {file && (
        <p className="mt-2 flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{file.original_name}</span>
          {canRemove && (
            <button type="button" className="cs-btn cs-btn-sm cs-btn-danger" onClick={() => onRemove(file)} aria-label={`Remove ${label}`}><X className="h-4 w-4" aria-hidden /></button>
          )}
        </p>
      )}
      {needsRetake && (
        <ul className="mt-2 space-y-1 text-sm">
          {scan.result === 'unreadable' && !fails.length && <li style={{ color: 'var(--ad-danger)' }}>We couldn't read this side. Please try again in good light.</li>}
          {fails.map((c) => <li key={c.check} className="flex gap-1.5" style={{ color: 'var(--ad-danger)' }}><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{c.message}</span></li>)}
        </ul>
      )}

      {outOfTries ? (
        <p className="cs-notice cs-notice-info mt-2 text-sm">You have used all the retakes for this side. Our team will check your ID by hand. You don't need to do anything else.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={`cs-btn cs-btn-sm ${needsRetake ? 'cs-btn-primary' : ''}`} onClick={openCamera} disabled={disabled}>
            {needsRetake ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />} {needsRetake ? 'Retake this side' : file ? 'Take a new photo' : 'Take a photo'}
          </button>
          <button type="button" className="cs-btn cs-btn-sm" onClick={() => pickRef.current?.click()} disabled={disabled}>
            <Upload className="h-4 w-4" aria-hidden /> {file ? 'Choose another file' : 'Choose a file'}
          </button>
          {attemptsUsed > 0 && <span className="cs-muted text-xs">{retakesLeft} {retakesLeft === 1 ? 'retake' : 'retakes'} left</span>}
        </div>
      )}
      {requiredError && !file && <p className="cs-error">{requiredError}</p>}
      <input ref={pickRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept={ACCEPT} onChange={choose} />
      <input ref={camRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept="image/jpeg,image/png" capture="environment" onChange={choose} />
      {camera && <CameraCapture side={slot.side} passport={passport} onClose={() => setCamera(false)} onCapture={(f) => { setCamera(false); onFile(slot, f); }} />}
    </div>
  );
}

/**
 * Page 3 (and after submitting, while the ID isn't verified): the front and back of the government ID, with
 * camera capture, instant photo hints, the automatic scan results, and what was read. The applicant cannot
 * edit what was read; a wrong reading means a clearer photo. The scan never says an ID is real: only the
 * home's verification can.
 */
export default function IdCapture({ appId, config, form, documents, onUpload, onRemove, canRemove = true, disabled = false, errors = {} }) {
  const rules = config.verification?.id_type_rules || [];
  const rule = rules.find((r) => r.key === form.id_type) || null;
  const passport = rule?.key === 'Passport';
  const needsBack = rule ? rule.needs_back : true;
  const maxAttempts = config.verification?.max_id_attempts || 6;
  const files = Object.fromEntries(SLOTS.map((s) => [s.side, documents.find((d) => d.doc_type === s.docType && d.status !== 'Replaced') || null]));
  const [scan, setScan] = useState(null);
  const [pending, setPending] = useState(null); // { slot, file, hints, url }
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const polls = useRef(0);
  const timer = useRef(null);
  const docKey = `${files.front?.document_id || ''}-${files.back?.document_id || ''}`;

  const filesRef = useRef(files);
  filesRef.current = files;
  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const res = await api(`/adoptions/${appId}/id-scan`);
      setScan(res.data);
      // Keep asking while a scan is running, or while a just-uploaded side has no scan row yet.
      const stale = SLOTS.some((s) => filesRef.current[s.side] && res.data[s.side]?.document_id !== filesRef.current[s.side].document_id);
      if ((res.data.overall?.state === 'scanning' || stale) && polls.current < POLL_LIMIT) {
        polls.current += 1;
        timer.current = setTimeout(load, POLL_MS);
      }
    } catch { /* the slots still work; results appear on the next upload */ }
  }, [appId]);
  useEffect(() => { polls.current = 0; if (files.front || files.back) load(); else setScan(null); return () => clearTimeout(timer.current); }, [docKey, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (slot, file) => {
    setBusy(slot.side); setError(null);
    try { await onUpload(slot.docType, file); } catch (err) { setError(err.message); } finally { setBusy(null); }
  };

  /** Checks type and size, then the quick photo hints. With a hint, the applicant chooses to retake or use it. */
  const onFile = async (slot, file) => {
    setError(null);
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) { setError('Only JPG, PNG or PDF files are accepted.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('The file is larger than 10 MB.'); return; }
    if (!file.size) { setError('The file is empty.'); return; }
    const { hints } = await checkPhoto(file);
    if (hints.length) { setPending({ slot, file, hints, url: URL.createObjectURL(file) }); return; }
    send(slot, file);
  };
  const closePending = () => { if (pending?.url) URL.revokeObjectURL(pending.url); setPending(null); };

  const frontLabel = passport ? 'Passport photo (data) page' : 'Front of ID';
  const labels = { front: frontLabel, back: 'Back of ID' };
  const hints = {
    front: passport ? 'The page with your photo and the two lines of letters at the bottom.' : 'The side with your photo and name.',
    back: passport ? 'Not needed for a passport.' : rule?.machine === 'qr' ? 'The side with the QR code.' : 'The other side of the card.',
  };
  const stale = SLOTS.some((sl) => files[sl.side] && scan?.[sl.side]?.document_id !== files[sl.side].document_id);
  const overall = stale ? { state: 'scanning', message: 'Scanning your ID...' } : scan?.overall;
  const read = scan?.front?.fields || {};
  const auth = scan?.authenticity;
  const anyFile = files.front || files.back;

  return (
    <section className="space-y-3" aria-labelledby="id-capture-title">
      <div>
        <h3 id="id-capture-title" className="cs-title text-base">Photos of your ID</h3>
        <p className="cs-muted text-sm">{passport ? 'Upload the passport photo page. The back is optional.' : 'Upload both the front and the back of the ID you chose above.'}</p>
      </div>
      <div className="cs-notice cs-notice-info flex gap-3 text-sm">
        <Info className="h-5 w-5 shrink-0" aria-hidden />
        <p>Take a photo of the actual card, not a screenshot or a photocopy. Lay it flat in good light, avoid glare, and keep all four corners in the photo.</p>
      </div>

      {!form.id_type && <p className="cs-notice cs-notice-warn text-sm">Choose the type of ID above first, so we know what to look for.</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {SLOTS.map((slot) => (
          <SideSlot key={slot.side} slot={slot} label={labels[slot.side]} hint={hints[slot.side]} passport={passport}
            required={slot.side === 'front' || needsBack} file={files[slot.side]}
            scan={files[slot.side] && scan?.[slot.side]?.document_id === files[slot.side].document_id ? scan[slot.side] : files[slot.side] ? { state: 'pending' } : null}
            attemptsUsed={scan?.attempts?.[slot.side] || 0} maxAttempts={maxAttempts}
            disabled={disabled || busy !== null || !form.id_type} onFile={onFile} onRemove={onRemove} canRemove={canRemove} requiredError={errors[`doc:${slot.docType}`]} />
        ))}
      </div>
      {busy && <p className="cs-muted text-sm" aria-live="polite">Uploading the {labels[busy].toLowerCase()}...</p>}
      {error && <p className="cs-error" role="alert">{error}</p>}

      {anyFile && overall && (
        <div className="cs-card cs-surface-2 space-y-3 p-4" aria-live="polite">
          <div className={`cs-notice ${overall.state === 'passed' ? 'cs-notice-success' : overall.state === 'failed' ? 'cs-notice-error' : overall.state === 'scanning' ? 'cs-notice-info' : 'cs-notice-warn'} text-sm`}>
            <p className="font-semibold">{overall.message}</p>
            {overall.state === 'failed' && overall.reasons?.length > 0 && (
              <ul className="mt-1 list-disc pl-5">{[...new Set(overall.reasons)].map((r) => <li key={r}>{r}</li>)}</ul>
            )}
            {(overall.state === 'failed' || overall.state === 'unreadable') && overall.retake?.length > 0 && (
              <p className="mt-1">Use "Retake this side" for: {overall.retake.map((s) => labels[s]).join(', ')}.</p>
            )}
          </div>

          {!stale && scan.checklist?.length > 0 && (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {scan.checklist.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-2 text-sm"><span>{c.label}</span><StateMark state={c.state} /></li>
              ))}
            </ul>
          )}

          {!stale && scan.front?.state === 'done' && (
            <div>
              <p className="cs-title text-sm">What we read from your ID</p>
              <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {[['Name', read.full_name], ['Date of birth', read.date_of_birth && formatDate(read.date_of_birth)], ['ID number', read.id_number], ['Expiry date', read.expiry_date && formatDate(read.expiry_date)]].map(([k, v]) => (
                  <div key={k} className="flex gap-2"><dt className="cs-muted">{k}:</dt><dd className="font-medium">{v || <span className="cs-muted font-normal">not found</span>}</dd></div>
                ))}
              </dl>
              <p className="cs-hint">You can't edit what was read. If something is wrong, take a clearer photo. Only the last 4 characters of the ID number are shown.</p>
            </div>
          )}

          <p className="flex items-start gap-2 border-t pt-2 text-sm cs-divider">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {auth?.official ? <><strong>Verified – real and valid.</strong> Confirmed through an official verification.</>
                : auth?.manual ? <><strong>Accepted by the home</strong> after a manual check of your ID.</>
                  : <><strong>Manual verification required.</strong> The automatic scan only checks the photo and the details. The home confirms your ID {auth ? 'before your application can move on' : 'after you submit'}.</>}
            </span>
          </p>
        </div>
      )}

      <div className="cs-card cs-surface-2 p-3 text-xs">
        <p className="cs-title text-sm">Privacy notice: what we read from your ID, and why</p>
        <p className="mt-1">CareSphere's own server reads your name, date of birth, ID number, address, and the issue and expiry dates from the photos, plus the QR code or the passport's machine-readable lines. We use them only to check that the ID belongs to you and matches your application (RA 10173, Data Privacy Act of 2012). The photos and what we read are stored encrypted, can be opened only by the authorized staff handling your application, and are not sent to any outside service. What we read is cleared after the retention period set by the home once your application is closed. See the full privacy notice on the last page.</p>
      </div>

      {pending && (
        <Modal open onClose={closePending} title="Check this photo" size="md" initialFocus="first"
          footer={<>
            <button type="button" className="cs-btn" onClick={closePending}>Take another photo</button>
            <button type="button" className="cs-btn cs-btn-primary" onClick={() => { const p = pending; closePending(); send(p.slot, p.file); }}>Use this photo anyway</button>
          </>}>
          <div className="cs-theme space-y-3">
            {pending.file.type !== 'application/pdf' && <img src={pending.url} alt="" className="max-h-64 w-full rounded-lg object-contain" />}
            <ul className="space-y-1 text-sm">
              {pending.hints.map((h) => <li key={h} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--ad-warning)' }} aria-hidden /><span>{HINT_TEXT[h]}</span></li>)}
            </ul>
            <p className="cs-hint">These are quick checks in your browser. The full check runs after upload.</p>
          </div>
        </Modal>
      )}
    </section>
  );
}
