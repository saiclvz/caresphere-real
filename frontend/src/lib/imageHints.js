/**
 * Quick checks on an ID photo in the browser, before it is uploaded: size, brightness, blur and glare.
 * They are hints only. The server repeats the same measurements (backend/src/services/idScan/image.js, same
 * limits) and its result is the one that counts. Card-cut-off and wrong-side checks need text reading, so
 * they come from the server scan a few seconds after the upload.
 */
export const LIMITS = { minShortSide: 600, minBrightness: 60, maxBrightness: 230, minSharpness: 40, maxGlare: 0.03 };

export const HINT_TEXT = {
  low_resolution: 'The photo is too small. Move closer so the card fills the frame.',
  too_dark: 'The photo is too dark. Take it in good light.',
  too_bright: 'The photo is too bright or washed out. Avoid direct light on the card.',
  blurry: 'The photo looks blurry. Hold the phone steady and tap to focus.',
  glare: 'There is glare on the card. Tilt it slightly or move away from the light.',
  screenshot: 'This looks like a screenshot. A photo of the actual card works best.',
};

async function toBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/** Measures a JPG or PNG. Returns { width, height, hints: [codes] }; PDFs and unreadable files return no hints. */
export async function checkPhoto(file) {
  if (!file || !/^image\/(jpeg|png)$/.test(file.type)) return { hints: [] };
  let bmp;
  try { bmp = await toBitmap(file); } catch { return { hints: [] }; }
  const width = bmp.width; const height = bmp.height;
  const gw = Math.min(1000, width); const gh = Math.max(1, Math.round((height * gw) / width));
  const canvas = document.createElement('canvas');
  canvas.width = gw; canvas.height = gh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, gw, gh);
  if (bmp.close) bmp.close();
  const { data } = ctx.getImageData(0, 0, gw, gh);
  const px = new Float32Array(gw * gh);
  let total = 0; let saturated = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const g = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    px[j] = g; total += g; if (g >= 255) saturated += 1;
  }
  let sum = 0; let sum2 = 0; let n = 0;
  for (let y = 1; y < gh - 1; y += 1) {
    for (let x = 1; x < gw - 1; x += 1) {
      const i = y * gw + x;
      const v = px[i - gw] + px[i + gw] + px[i - 1] + px[i + 1] - 4 * px[i];
      sum += v; sum2 += v * v; n += 1;
    }
  }
  const brightness = total / px.length;
  const sharpness = n ? sum2 / n - (sum / n) ** 2 : 0;
  const glare = saturated / px.length;
  const hints = [];
  if (Math.min(width, height) < LIMITS.minShortSide) hints.push('low_resolution');
  if (brightness < LIMITS.minBrightness) hints.push('too_dark');
  if (brightness > LIMITS.maxBrightness) hints.push('too_bright');
  if (sharpness < LIMITS.minSharpness) hints.push('blurry');
  if (glare > LIMITS.maxGlare) hints.push('glare');
  if (file.type === 'image/png') hints.push('screenshot');
  return { width, height, hints };
}
