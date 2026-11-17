import { heifPixels, isHeif } from './heic';

/**
 * Decode an image file into a bitmap. `createImageBitmap` is the fast path, but Chrome and Edge
 * refuse some formats an <img> element shows fine — SVG above all (MorphKit accepts .svg, and
 * every SVG conversion used to fail with "Conversion failed"). When the fast path refuses a file,
 * load it through an <img> and make the bitmap from that; a file neither can read still throws.
 * HEIC/HEIF photos (iPhone) are something neither path reads in Chrome and Edge: they go through
 * libheif (lib/heic, loaded on first use).
 * Use this for anything a person dropped or imported; canvases and PNGs the app made itself can
 * keep calling `createImageBitmap` directly.
 */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (fast) {
    if (await isHeif(blob)) return createImageBitmap(await heifPixels(blob));
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      // an SVG without width/height has no intrinsic size: draw it at the size <img> lays it out
      const w = img.naturalWidth || img.width || 300;
      const h = img.naturalHeight || img.height || 150;
      return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h });
    } catch {
      throw fast;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
