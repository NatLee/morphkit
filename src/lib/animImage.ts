import { parseGIF, decompressFrames } from 'gifuct-js';
import UPNG from 'upng-js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { extOf } from './formats';

/** Animated-image pipeline: GIF ⇄ APNG (alpha preserved) + static fallbacks. */

export interface AnimFrame {
  img: ImageData;
  delay: number; // ms
}

export interface Anim {
  frames: AnimFrame[];
  width: number;
  height: number;
}

const FRAME_CAP = 300;

function isGifFile(file: File): boolean {
  return file.type === 'image/gif' || extOf(file.name) === 'gif';
}

function isPngFamily(file: File): boolean {
  const ext = extOf(file.name);
  return file.type === 'image/png' || file.type === 'image/apng' || ext === 'png' || ext === 'apng';
}

async function decodeGif(file: File): Promise<Anim> {
  const buf = await file.arrayBuffer();
  const gif = parseGIF(buf);
  const raw = decompressFrames(gif, true);
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  const compose = document.createElement('canvas');
  compose.width = w;
  compose.height = h;
  const ctx = compose.getContext('2d', { willReadFrequently: true })!;
  const patchCanvas = document.createElement('canvas');
  const pctx = patchCanvas.getContext('2d')!;
  const frames: AnimFrame[] = [];
  const cap = Math.min(raw.length, FRAME_CAP);
  for (let i = 0; i < cap; i++) {
    const fr = raw[i];
    patchCanvas.width = fr.dims.width;
    patchCanvas.height = fr.dims.height;
    pctx.putImageData(
      new ImageData(new Uint8ClampedArray(fr.patch), fr.dims.width, fr.dims.height),
      0,
      0
    );
    const before = fr.disposalType === 3 ? ctx.getImageData(0, 0, w, h) : null;
    ctx.drawImage(patchCanvas, fr.dims.left, fr.dims.top);
    frames.push({ img: ctx.getImageData(0, 0, w, h), delay: Math.max(fr.delay || 100, 20) });
    if (fr.disposalType === 2) {
      ctx.clearRect(fr.dims.left, fr.dims.top, fr.dims.width, fr.dims.height);
    } else if (fr.disposalType === 3 && before) {
      ctx.putImageData(before, 0, 0);
    }
  }
  return { frames, width: w, height: h };
}

async function decodePng(file: File): Promise<Anim> {
  const buf = await file.arrayBuffer();
  const img = UPNG.decode(buf);
  const rgba = UPNG.toRGBA8(img);
  const frames: AnimFrame[] = rgba.slice(0, FRAME_CAP).map((ab, i) => ({
    img: new ImageData(new Uint8ClampedArray(ab), img.width, img.height),
    delay: Math.max(img.frames?.[i]?.delay ?? 100, 20),
  }));
  return { frames, width: img.width, height: img.height };
}

async function decodeStatic(file: File): Promise<Anim> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return {
    frames: [{ img: ctx.getImageData(0, 0, c.width, c.height), delay: 100 }],
    width: c.width,
    height: c.height,
  };
}

/** Decode any supported image (animated GIF / APNG / static) into RGBA frames. */
export function decodeAnim(file: File): Promise<Anim> {
  if (isGifFile(file)) return decodeGif(file);
  if (isPngFamily(file)) return decodePng(file);
  return decodeStatic(file);
}

/** Encode APNG — full colour, alpha preserved (lossless). */
export function encodeAPNG(anim: Anim): Blob {
  const bufs = anim.frames.map((f) => f.img.data.slice().buffer);
  const delays = anim.frames.map((f) => f.delay);
  const out = UPNG.encode(bufs, anim.width, anim.height, 0, delays);
  return new Blob([out], { type: 'image/apng' });
}

/** Quantize + write one RGBA frame into a GIF encoder, with or without transparency. */
export function writeGifFrame(
  enc: ReturnType<typeof GIFEncoder>,
  data: Uint8ClampedArray,
  w: number,
  h: number,
  delay: number,
  keepAlpha: boolean
): void {
  if (keepAlpha) {
    // rgba4444 keeps an alpha slot; index 0 becomes the transparent colour
    const palette = quantize(data, 256, { format: 'rgba4444' });
    const index = applyPalette(data, palette, 'rgba4444');
    enc.writeFrame(index, w, h, { palette, delay, transparent: true, dispose: 2 });
  } else {
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    enc.writeFrame(index, w, h, { palette, delay });
  }
}

/**
 * Encode GIF.
 * `matte === null` keeps binary transparency (GIF's 1-bit alpha);
 * a colour string flattens the alpha channel onto that background.
 */
export async function encodeGIFBlob(anim: Anim, matte: string | null = null): Promise<Blob> {
  const { width: w, height: h } = anim;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d')!;
  const enc = GIFEncoder();
  for (let i = 0; i < anim.frames.length; i++) {
    const f = anim.frames[i];
    ctx.clearRect(0, 0, w, h);
    if (matte) {
      ctx.fillStyle = matte;
      ctx.fillRect(0, 0, w, h);
    }
    tctx.clearRect(0, 0, w, h);
    tctx.putImageData(f.img, 0, 0);
    ctx.drawImage(tmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    writeGifFrame(enc, data, w, h, f.delay, matte === null);
    if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
  }
  enc.finish();
  return new Blob([enc.bytes().slice()], { type: 'image/gif' });
}

/** Convert to an animated target, preserving every frame (and transparency). */
export async function convertAnimImage(file: File, target: 'apng' | 'gif'): Promise<Blob> {
  const anim = await decodeAnim(file);
  return target === 'apng' ? encodeAPNG(anim) : encodeGIFBlob(anim, null);
}
