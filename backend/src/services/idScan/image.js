/**
 * Image measurements for an uploaded ID photo (uses sharp, which runs on this server): size, brightness,
 * blur, glare, a perceptual hash, camera data, and an upright, cleaned-up copy for OCR. Measurements only;
 * the image itself is not changed on disk.
 */
const sharp = require('sharp');

const LIMITS = {
  minShortSide: 600,      // pixels on the short side of the photo
  minBrightness: 60,      // 0-255 average
  maxBrightness: 230,
  minSharpness: 40,       // variance of the Laplacian on a 1000 px wide grey copy (higher = sharper)
  maxGlare: 0.03,         // share of fully saturated (255) pixels
};

// Common screen sizes (either orientation): an image this size with no camera data is likely a screenshot.
const SCREEN_SIZES = new Set(['1920x1080', '1366x768', '1536x864', '1440x900', '1280x720', '1600x900', '2560x1440', '1280x800', '1920x1200',
  '1080x2400', '1080x2340', '1170x2532', '1179x2556', '1284x2778', '1290x2796', '828x1792', '750x1334', '1242x2688', '720x1600', '1080x1920']);

/** Variance of the Laplacian of a grey image (3x3 kernel). */
function laplacianVariance(px, w, h) {
  let sum = 0; let sum2 = 0; let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const v = px[i - w] + px[i + w] + px[i - 1] + px[i + 1] - 4 * px[i];
      sum += v; sum2 += v * v; n += 1;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/** 64-bit difference hash, as 16 hex characters. */
async function dhash(input) {
  const { data } = await sharp(input).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}
const hamming = (a, b) => { if (!a || !b) return 64; let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`); let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

/**
 * Analyses one photo. Returns { quality: {...measurements}, problems: [codes], hints, upright (PNG for OCR),
 * rgba (for QR decoding), dhash, camera } or throws if the file isn't an image sharp can read.
 */
async function analyse(buffer) {
  const base = sharp(buffer, { failOn: 'error' }).rotate(); // apply the camera's EXIF orientation
  const meta = await sharp(buffer).metadata();
  const upright = await base.toBuffer();
  const um = await sharp(upright).metadata();
  const width = um.width; const height = um.height;

  const greyW = Math.min(1000, width);
  const grey = await sharp(upright).greyscale().resize({ width: greyW }).raw().toBuffer({ resolveWithObject: true });
  const px = grey.data; const gw = grey.info.width; const gh = grey.info.height;
  let total = 0; let saturated = 0;
  for (let i = 0; i < px.length; i += 1) { total += px[i]; if (px[i] >= 255) saturated += 1; }
  const brightness = Math.round(total / px.length);
  const sharpness = Math.round(laplacianVariance(px, gw, gh));
  const glare = saturated / px.length;

  const camera = Boolean(meta.exif && meta.exif.length > 64);
  const sizeKey = `${width}x${height}`;
  const screenSized = SCREEN_SIZES.has(sizeKey) || SCREEN_SIZES.has(`${height}x${width}`);

  const problems = [];
  if (Math.min(width, height) < LIMITS.minShortSide) problems.push('low_resolution');
  if (brightness < LIMITS.minBrightness) problems.push('too_dark');
  if (brightness > LIMITS.maxBrightness) problems.push('too_bright');
  if (sharpness < LIMITS.minSharpness) problems.push('blurry');
  if (glare > LIMITS.maxGlare) problems.push('glare');

  // A cleaned-up copy for OCR: grey, contrast-stretched, about 2000 px wide.
  const ocrImage = await sharp(upright).greyscale().normalise().resize({ width: Math.min(2000, Math.max(width, 1400)) }).png().toBuffer();
  // RGBA pixels for QR decoding (two sizes are tried later).
  const rgba = await sharp(upright).resize({ width: Math.min(1600, width) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  return {
    quality: { width, height, brightness, sharpness, glare: Math.round(glare * 1000) / 10, format: meta.format, camera_data: camera },
    problems,
    possibleScreenshot: !camera && (meta.format === 'png' || screenSized),
    upright, ocrImage, rgba: { data: new Uint8ClampedArray(rgba.data.buffer, rgba.data.byteOffset, rgba.data.length), width: rgba.info.width, height: rgba.info.height },
    dhash: await dhash(upright),
  };
}

/** Rotates a PNG by 90, 180 or 270 degrees (for OCR retries). */
const rotate = (png, deg) => sharp(png).rotate(deg).png().toBuffer();

const PROBLEM_TEXT = {
  low_resolution: 'The photo is too small. Move closer so the card fills the frame.',
  too_dark: 'The photo is too dark. Take it in good light.',
  too_bright: 'The photo is too bright or washed out. Avoid direct light on the card.',
  blurry: 'The photo is blurry. Hold the phone steady and tap to focus.',
  glare: 'There is glare on the card. Tilt it slightly or move away from the light.',
};

module.exports = { analyse, rotate, dhash, hamming, LIMITS, PROBLEM_TEXT };
