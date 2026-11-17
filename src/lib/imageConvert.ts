import { ConvertError } from './errors';
import { decodeImage } from './decodeImage';

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
  const bitmap = await decodeImage(file).catch(() => {
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

// ---------- ICO (favicons) ----------

/** Sizes an .ico carries; Windows and browsers pick the closest. 256 is the format's maximum. */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

/** The icon sizes worth storing for a source: never enlarged, except that the smallest is always there. */
export function icoSizesFor(width: number, height: number): number[] {
  const longest = Math.max(width, height);
  const fit = ICO_SIZES.filter((s) => s <= longest);
  return fit.length ? fit : [ICO_SIZES[0]];
}

/**
 * Pack PNG images into an .ico file: a 6-byte header, one 16-byte entry per image, then the PNG data.
 * PNG-compressed entries are what every browser and Windows since Vista read; width/height 0 means 256.
 */
export function encodeIco(images: ReadonlyArray<{ size: number; png: Uint8Array }>): Uint8Array<ArrayBuffer> {
  const HEADER = 6;
  const ENTRY = 16;
  let offset = HEADER + ENTRY * images.length;
  const out = new Uint8Array(new ArrayBuffer(offset + images.reduce((n, i) => n + i.png.length, 0)));
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); // type 1 = icon
  dv.setUint16(4, images.length, true);
  images.forEach((img, i) => {
    const e = HEADER + ENTRY * i;
    out[e] = img.size >= 256 ? 0 : img.size;
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    dv.setUint16(e + 4, 1, true); // colour planes
    dv.setUint16(e + 6, 32, true); // bits per pixel
    dv.setUint32(e + 8, img.png.length, true);
    dv.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/**
 * Image → multi-size .ico. Each size holds the whole picture centred in a transparent square.
 * Sizes are drawn largest first and each from the one before (never more than 2× at a time), and
 * the first one is reached by halving the source, so a 4000 px photo still makes a clean 16 px icon.
 */
export async function convertToIco(file: File): Promise<Blob> {
  const bitmap = await decodeImage(file).catch(() => {
    throw new Error('decode');
  });
  try {
    const sizes = icoSizesFor(bitmap.width, bitmap.height).sort((a, b) => b - a);
    // halve the source until one more halving would go below the largest icon
    let src: CanvasImageSource = bitmap;
    let w = bitmap.width;
    let h = bitmap.height;
    while (Math.max(w, h) / 2 >= sizes[0]) {
      const [c, ctx] = canvasOf(Math.round(w / 2), Math.round(h / 2));
      ctx.drawImage(src, 0, 0, c.width, c.height);
      [src, w, h] = [c, c.width, c.height];
    }
    const images: Array<{ size: number; png: Uint8Array }> = [];
    let prev: HTMLCanvasElement | null = null;
    for (const size of sizes) {
      const [c, ctx] = canvasOf(size, size);
      if (prev) {
        ctx.drawImage(prev, 0, 0, size, size);
      } else {
        const k = size / Math.max(w, h);
        const dw = Math.max(1, Math.round(w * k));
        const dh = Math.max(1, Math.round(h * k));
        ctx.drawImage(src, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
      }
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('encode');
      images.unshift({ size, png: new Uint8Array(await blob.arrayBuffer()) }); // smallest first in the file
      prev = c;
    }
    return new Blob([encodeIco(images)], { type: 'image/x-icon' });
  } finally {
    bitmap.close();
  }
}
