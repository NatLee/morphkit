import { ConvertError } from './errors';

/** Lowest quality anything goes to: the quality sliders' minimum and the floor of `fitToSize`. */
export const MIN_QUALITY = 0.4;
/** `fitToSize` stops narrowing the quality once the window is this small. */
const QUALITY_STEP = 0.02;
/** `fitToSize` gives up after shrinking this many times (each round aims ~10% under the target). */
const MAX_SHRINK_ROUNDS = 6;

/** Encodes the image at a quality (0–1) and a scale (1 = the size before fitting). */
export type Encoder = (quality: number, scale: number) => Promise<Blob>;

/**
 * The biggest output that still fits in `maxBytes`. Quality goes first: the highest quality in
 * [minQuality, maxQuality] that fits at full size. When even `minQuality` is too big, the image
 * shrinks — file size grows roughly with the pixel count, so each round scales by
 * √(target / size) with a 10% margin — and the quality search runs again at the new size.
 * Pass `minQuality = maxQuality` for formats without a quality setting (PNG): only the size moves.
 * Throws `ConvertError('fitTooSmall')` when nothing fits.
 */
export async function fitToSize(
  encode: Encoder,
  maxBytes: number,
  maxQuality: number,
  minQuality = MIN_QUALITY
): Promise<Blob> {
  let scale = 1;
  for (let round = 0; round <= MAX_SHRINK_ROUNDS; round++) {
    const top = await encode(maxQuality, scale);
    if (top.size <= maxBytes) return top;
    const floor = minQuality < maxQuality ? await encode(minQuality, scale) : top;
    if (floor.size <= maxBytes) {
      // floor fits, top does not: binary search the quality in between
      let lo = minQuality;
      let hi = maxQuality;
      let best = floor;
      while (hi - lo > QUALITY_STEP) {
        const mid = (lo + hi) / 2;
        const b = await encode(mid, scale);
        if (b.size <= maxBytes) { lo = mid; best = b; } else hi = mid;
      }
      return best;
    }
    scale *= Math.sqrt(maxBytes / floor.size) * 0.9;
  }
  throw new ConvertError('fitTooSmall');
}

/** Convert an image entirely in the browser via Canvas — no library download needed. */
export async function convertImage(
  file: File,
  target: 'png' | 'jpeg' | 'webp',
  quality: number,
  /** Longest-edge cap in px; 0 keeps the original size. Never upscales. */
  maxDim = 0,
  /** Size target in bytes (see `fitToSize`); 0 = encode once at `quality`. */
  maxBytes = 0
): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('decode');
  });
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const base = maxDim > 0 && longest > maxDim ? maxDim / longest : 1;
    const encode: Encoder = async (q, scale) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * base * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * base * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      if (target === 'jpeg') {
        // JPEG has no alpha channel — composite on white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, `image/${target}`, q)
      );
      if (!blob) throw new Error('encode');
      return blob;
    };
    if (maxBytes > 0) {
      // PNG is lossless: the browser ignores the quality, so only the size can move
      return await fitToSize(encode, maxBytes, quality, target === 'png' ? quality : MIN_QUALITY);
    }
    return await encode(quality, 1);
  } finally {
    bitmap.close();
  }
}
