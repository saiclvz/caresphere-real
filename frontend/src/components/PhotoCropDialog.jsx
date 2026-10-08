import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import { Minus, Plus, X } from 'lucide-react';
import { Button, ErrorNote } from './ui';
import { MB } from '../lib/files';

const OUTPUT_MAX = 800;          // px: the saved photo is at most 800 x 800
const MAX_BYTES = 5 * MB;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be opened. Try another JPG or PNG file.'));
    img.src = src;
  });
}

/** Draws the chosen square area onto a canvas and returns it as a data URL (same type as the original). */
async function cropToDataUrl(src, area, type) {
  const img = await loadImage(src);
  const size = Math.min(OUTPUT_MAX, Math.round(area.width));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error('The photo could not be cropped. Try again.');
  if (blob.size > MAX_BYTES) throw new Error('The cropped photo is larger than 5 MB. Try a smaller image.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The cropped photo could not be read.'));
    reader.readAsDataURL(blob);
  });
  return { data, size: blob.size, preview: URL.createObjectURL(blob) };
}

/**
 * Square crop step for a child's profile photo: drag to move, zoom with the slider,
 * buttons, mouse wheel or pinch. Arrow keys move the image when it has focus.
 * Confirm returns only the cropped image; Cancel (or Esc) keeps the existing photo.
 * @param file      the JPG/PNG File the user picked (already type- and size-checked)
 * @param onConfirm ({ name, type, data, size, preview }) => void | Promise
 */
export default function PhotoCropDialog({ file, onCancel, onConfirm, title = 'Crop profile photo' }) {
  const [src] = useState(() => URL.createObjectURL(file));
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  const onCropComplete = useCallback((_, pixels) => setArea(pixels), []);
  const nudgeZoom = (d) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + d) * 10) / 10)));

  const confirm = async () => {
    if (!area) return;
    setBusy(true); setError(null);
    try {
      const out = await cropToDataUrl(src, area, file.type === 'image/png' ? 'image/png' : 'image/jpeg');
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      await onConfirm({ name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}-cropped.${ext}`, type: file.type, ...out });
    } catch (err) { setError(err); setBusy(false); }
  };

  // Esc cancels only this dialog. stopPropagation keeps the form behind it open.
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onCancel(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-900/70 p-0 sm:items-center sm:p-4" onKeyDown={onKeyDown}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-modal sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-navy-900" aria-label="Cancel cropping">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <ErrorNote error={error} />
          <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-900">
            <Cropper image={src} crop={crop} zoom={zoom} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} aspect={1} showGrid
              onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} keyboardStep={10} />
          </div>
          <p className="text-xs text-slate-500">Drag the photo to position it. The saved photo is the square inside the frame.</p>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => nudgeZoom(-0.1)} disabled={zoom <= MIN_ZOOM}><Minus className="h-4 w-4" /></Button>
            <label className="flex-1">
              <span className="sr-only">Zoom</span>
              <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full accent-brand" aria-valuetext={`${Math.round(zoom * 100)} percent`} />
            </label>
            <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => nudgeZoom(0.1)} disabled={zoom >= MAX_ZOOM}><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button autoFocus onClick={confirm} loading={busy}>Confirm</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
