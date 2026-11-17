import type { PDFDocument, PDFRawStream, PDFRef } from 'pdf-lib';

/**
 * Whole-document PDF tools behind the PDF editor's export and toolbar: page numbers, image
 * compression and the blank-page finder. Pure helpers here; buildPdf (lib/pdf) does the drawing.
 * pdf-lib arrives as a parameter: it is a lazy import, never a static one (invariant 25).
 */
type PdfLib = typeof import('pdf-lib');

// ---------- page numbers ----------

/** Where the number sits on the page as it is shown: top/bottom × left/centre/right. */
export type PageNumberPos = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export const PAGE_NUMBER_POSITIONS: readonly PageNumberPos[] = ['bc', 'br', 'bl', 'tc', 'tr', 'tl'];
/**
 * `{n}` = this page's number, `{total}` = the last number. ASCII only: the numbers are drawn in
 * Helvetica, one of the PDF standard fonts, so nothing is embedded or downloaded.
 */
export const PAGE_NUMBER_FORMATS = ['{n}', '{n} / {total}', '- {n} -', 'Page {n} of {total}'] as const;

export interface PageNumbers {
  pos: PageNumberPos;
  format: string;
  /** the number the first numbered page gets */
  start: number;
  /** leading pages left unnumbered (a cover, a title page) */
  skip: number;
  /** font size in points */
  size: number;
}

export const DEFAULT_PAGE_NUMBERS: PageNumbers = { pos: 'bc', format: '{n}', start: 1, skip: 0, size: 10 };
/** Distance from the page edges, in multiples of the font size. */
const PAGE_NUMBER_MARGIN_EM = 2.5;
/** Cap height of Helvetica as a share of the font size: puts a top number's letters, not its baseline, at the margin. */
const HELVETICA_CAP = 0.72;

/** The label of the page at `index` (0-based) in a document of `count` pages; null = unnumbered. */
export function pageNumberLabel(index: number, count: number, pn: PageNumbers): string | null {
  if (index < pn.skip) return null;
  const n = pn.start + index - pn.skip;
  const last = pn.start + count - pn.skip - 1;
  return pn.format.split('{n}').join(String(n)).split('{total}').join(String(last));
}

/**
 * Baseline-left point of a label `textW` points wide, as display fractions (0–1 from the top-left of
 * the page as shown, `w` × `h` points). lib/pdf `displayToUser` turns it into page space.
 */
export function pageNumberSpot(pos: PageNumberPos, w: number, h: number, textW: number, size: number): [number, number] {
  const m = size * PAGE_NUMBER_MARGIN_EM;
  const x = pos[1] === 'l' ? m : pos[1] === 'r' ? w - m - textW : (w - textW) / 2;
  const y = pos[0] === 't' ? m + size * HELVETICA_CAP : h - m;
  return [x / w, y / h];
}

// ---------- image compression ----------

export interface ImageSqueeze {
  /** longest side in px after downscaling */
  maxDim: number;
  /** JPEG quality 0–1 */
  quality: number;
}

/** Long side of an A4 page in inches: the presets cap an image as if it filled such a page. */
const A4_LONG_IN = 11.69;
/** `light` ≈ 200 dpi (print still looks right), `strong` ≈ 110 dpi (screen reading, e-mail). */
export const SQUEEZE_PRESETS = {
  light: { maxDim: Math.round(200 * A4_LONG_IN), quality: 0.8 },
  strong: { maxDim: Math.round(110 * A4_LONG_IN), quality: 0.6 },
} as const satisfies Record<string, ImageSqueeze>;
export type SqueezeLevel = keyof typeof SQUEEZE_PRESETS;
/** A re-encode must save at least this share of the image's bytes, or the original stays. */
const MIN_SAVING = 0.1;

/**
 * Re-encode the document's JPEG images smaller (downscale to `maxDim`, then JPEG at `quality`).
 * Only 8-bit JPEGs in RGB or grey are touched — CMYK, indexed, masks and `/Decode` remaps stay as
 * they are, as does any image the browser cannot decode or that would not shrink by MIN_SAVING.
 * The soft mask (transparency) of an image is kept; PDF lets it differ in size from the image.
 */
export async function squeezeImages(
  doc: PDFDocument,
  lib: PdfLib,
  sq: ImageSqueeze,
  onProgress?: (p: number) => void
): Promise<{ images: number; before: number; after: number }> {
  const { PDFName, PDFRawStream: RawStream, PDFNumber, PDFArray } = lib;
  await doc.flush(); // images added with embedJpg/embedPng only become objects here
  const name = (v: unknown) => (v instanceof PDFName ? v.decodeText() : null);
  const candidates = doc.context.enumerateIndirectObjects().filter(([, o]) => {
    if (!(o instanceof RawStream)) return false;
    const d = o.dict;
    if (name(d.get(PDFName.of('Subtype'))) !== 'Image') return false;
    const f = d.get(PDFName.of('Filter'));
    const filter = f instanceof PDFArray ? (f.size() === 1 ? name(f.get(0)) : null) : name(f);
    if (filter !== 'DCTDecode') return false;
    if (d.has(PDFName.of('Decode')) || d.has(PDFName.of('ImageMask'))) return false;
    const bpc = d.get(PDFName.of('BitsPerComponent'));
    if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) return false;
    const cs = d.lookup(PDFName.of('ColorSpace'));
    if (name(cs) === 'DeviceRGB' || name(cs) === 'DeviceGray') return true;
    // [/ICCBased <stream with /N 1 or 3>] — a tagged RGB or grey photo
    if (cs instanceof PDFArray && name(cs.get(0)) === 'ICCBased') {
      const icc = doc.context.lookup(cs.get(1));
      const n = icc instanceof RawStream ? icc.dict.get(PDFName.of('N')) : null;
      return n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3);
    }
    return false;
  }) as [PDFRef, PDFRawStream][];

  let before = 0;
  let after = 0;
  let images = 0;
  for (let i = 0; i < candidates.length; i++) {
    const [ref, stream] = candidates[i];
    onProgress?.((i + 1) / candidates.length);
    const old = stream.getContents();
    const bmp = await createImageBitmap(new Blob([old.slice()], { type: 'image/jpeg' })).catch(() => null);
    if (!bmp) continue;
    const scale = Math.min(1, sq.maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); continue; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', sq.quality));
    const w = canvas.width;
    const h = canvas.height;
    canvas.width = canvas.height = 0;
    if (!blob || blob.size > old.length * (1 - MIN_SAVING)) continue;
    const dict = stream.dict.clone(doc.context);
    dict.set(PDFName.of('Width'), PDFNumber.of(w));
    dict.set(PDFName.of('Height'), PDFNumber.of(h));
    // the browser always writes 3-channel sRGB JPEGs
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
    dict.delete(PDFName.of('DecodeParms'));
    doc.context.assign(ref, RawStream.of(dict, new Uint8Array(await blob.arrayBuffer())));
    before += old.length;
    after += blob.size;
    images++;
  }
  return { images, before, after };
}

// ---------- blank pages ----------

/** A page counts as blank when less than this share of its pixels is ink. */
export const BLANK_INK_SHARE = 0.002;
/** How much darker than the paper a pixel must be to count as ink (luma steps of 255). */
const INK_CONTRAST = 48;

/**
 * Share of `rgba` pixels that are ink: darker than the paper by INK_CONTRAST. The paper is the
 * most common brightness, so grey or yellowed scans and coloured pages work too; a transparent
 * pixel counts as white paper.
 */
export function inkShare(rgba: Uint8ClampedArray): number {
  const n = rgba.length / 4;
  if (!n) return 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    const l = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    hist[Math.round(l * a + 255 * (1 - a))]++;
  }
  let paper = 0;
  for (let v = 1; v < 256; v++) if (hist[v] > hist[paper]) paper = v;
  let ink = 0;
  for (let v = 0; v <= paper - INK_CONTRAST; v++) ink += hist[v];
  return ink / n;
}
