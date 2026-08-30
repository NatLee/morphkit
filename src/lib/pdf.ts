/**
 * PDF support — 100% in-browser.
 *  - READ / RENDER via pdfjs-dist (lazy-imported; worker bundled by Vite via `?url`)
 *  - WRITE / ASSEMBLE via pdf-lib (lazy-imported)
 * Both libraries are only downloaded the first time a PDF is touched.
 */
import { zipSync } from 'fflate';
import { extOf } from './formats';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// ---------- pdf.js loader ----------

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

async function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, worker] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })().catch((e) => {
      pdfjsPromise = null; // allow retry after a failed download
      throw e;
    });
  }
  return pdfjsPromise;
}

async function pdfLib() {
  return import('pdf-lib');
}

/** loading task per document — `destroy()` lives on the task in pdf.js, not the proxy */
const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

/** Parse a PDF into a pdf.js document (render / text / metadata). Pair with `closePdf`. */
export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // pdf.js transfers the buffer to its worker — hand it a copy so callers keep theirs
  const task = lib.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
}

/** Release worker memory held by a document opened with `openPdf`. */
export async function closePdf(doc: PDFDocumentProxy): Promise<void> {
  await tasks.get(doc)?.destroy();
  tasks.delete(doc);
}

export interface PdfPageInfo {
  /** page size in PDF points after the page's own /Rotate */
  width: number;
  height: number;
}

export async function pageInfo(doc: PDFDocumentProxy, index: number): Promise<PdfPageInfo> {
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

export interface RenderOpts {
  /** target width in CSS px (wins over scale) */
  width?: number;
  /** cap the longest edge in px */
  maxDim?: number;
  /** render scale (1 = 72 dpi) */
  scale?: number;
  /** extra clockwise rotation on top of the page's own /Rotate */
  rotate?: number;
  /** paint a white ground (PDF pages are transparent by default) */
  white?: boolean;
}

/** Render one page (0-based) to a canvas. */
export async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  opts: RenderOpts = {}
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(index + 1);
  const rotation = (page.rotate + (opts.rotate ?? 0) + 360) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  let scale = opts.scale ?? 1;
  if (opts.width) scale = opts.width / base.width;
  if (opts.maxDim && opts.maxDim > 0) {
    const long = Math.max(base.width, base.height) * scale;
    if (long > opts.maxDim) scale *= opts.maxDim / long;
  }
  const vp = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d')!;
  if (opts.white !== false) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

export interface PdfInfo {
  pages: number;
  width: number;
  height: number;
  title?: string;
  author?: string;
}

export async function pdfInfo(doc: PDFDocumentProxy): Promise<PdfInfo> {
  const first = await pageInfo(doc, 0);
  const out: PdfInfo = { pages: doc.numPages, ...first };
  try {
    const { info } = await doc.getMetadata();
    const i = info as Record<string, unknown>;
    if (typeof i.Title === 'string' && i.Title.trim()) out.title = i.Title.trim();
    if (typeof i.Author === 'string' && i.Author.trim()) out.author = i.Author.trim();
  } catch { /* no metadata */ }
  return out;
}

// ---------- conversions ----------

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), mime, quality)
  );
}

export type RasterTarget = 'png' | 'jpeg' | 'webp';

/**
 * PDF → raster image(s). One page → image blob; several → ZIP of numbered pages.
 * `dpi` 144 by default (2× screen); `maxDim` caps the longest edge (0 = off).
 */
export async function pdfToImages(
  file: File,
  target: RasterTarget,
  quality: number,
  maxDim: number,
  onProgress?: (p: number) => void
): Promise<{ blob: Blob; multi: boolean }> {
  const doc = await openPdf(await file.arrayBuffer());
  const mime = `image/${target}`;
  const ext = target === 'jpeg' ? 'jpg' : target;
  const n = doc.numPages;
  const base = file.name.replace(/\.[^.]+$/, '');
  const entries: Record<string, Uint8Array> = {};
  let single: Blob | null = null;
  for (let i = 0; i < n; i++) {
    const canvas = await renderPage(doc, i, { scale: 2, maxDim });
    const blob = await toBlob(canvas, mime, target === 'png' ? undefined : quality);
    canvas.width = canvas.height = 0;
    if (n === 1) single = blob;
    else entries[`${base}_p${String(i + 1).padStart(3, '0')}.${ext}`] = new Uint8Array(await blob.arrayBuffer());
    onProgress?.((i + 1) / n);
  }
  await closePdf(doc);
  if (single) return { blob: single, multi: false };
  const zipped = zipSync(entries, { level: 0 });
  return { blob: new Blob([zipped.slice()], { type: 'application/zip' }), multi: true };
}

/** PDF → plain text (pages separated by a blank line). */
export async function pdfToText(file: File, onProgress?: (p: number) => void): Promise<Blob> {
  const doc = await openPdf(await file.arrayBuffer());
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let s = '';
    for (const it of tc.items) {
      if ('str' in it) {
        s += it.str;
        if (it.hasEOL) s += '\n';
        else if (it.str && !it.str.endsWith(' ')) s += ' ';
      }
    }
    parts.push(s.replace(/[ \t]+\n/g, '\n').trim());
    page.cleanup();
    onProgress?.(i / doc.numPages);
  }
  await closePdf(doc);
  return new Blob([parts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
}

// ---------- assembly (pdf-lib) ----------

/** One output page. `rotate` = extra clockwise degrees applied at export. */
export type PageSpec =
  | { kind: 'pdf'; bytes: ArrayBuffer; index: number; rotate: number }
  | { kind: 'image'; blob: Blob; width: number; height: number; rotate: number }
  | { kind: 'blank'; width: number; height: number; rotate: number };

/** Decode any browser image to PNG bytes + pixel size (JPEG passes through). */
export async function imageForPdf(
  blob: Blob
): Promise<{ bytes: Uint8Array; width: number; height: number; jpeg: boolean }> {
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  if (blob.type === 'image/jpeg') {
    bmp.close();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, jpeg: true };
  }
  let png = blob;
  if (blob.type !== 'image/png') {
    // re-encode (webp/gif/bmp/avif…) — animated inputs collapse to frame 1
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    png = await toBlob(c, 'image/png');
  }
  bmp.close();
  return { bytes: new Uint8Array(await png.arrayBuffer()), width, height, jpeg: false };
}

/** Assemble a PDF from page specs. Pages copied from the same source share one copier pass. */
export async function buildPdf(
  pages: PageSpec[],
  onProgress?: (p: number) => void
): Promise<Blob> {
  const { PDFDocument, degrees } = await pdfLib();
  const out = await PDFDocument.create();
  out.setProducer('MorphKit');
  out.setCreator('MorphKit');

  // load each distinct source document once
  const srcDocs = new Map<ArrayBuffer, Awaited<ReturnType<typeof PDFDocument.load>>>();
  for (const p of pages) {
    if (p.kind === 'pdf' && !srcDocs.has(p.bytes)) {
      srcDocs.set(p.bytes, await PDFDocument.load(p.bytes, { ignoreEncryption: true, updateMetadata: false }));
    }
  }
  // first use of a (doc,index) pair comes from one bulk copy; repeats copy again
  const bulk = new Map<ArrayBuffer, Map<number, unknown[]>>();
  for (const [bytes, doc] of srcDocs) {
    const idx = [...new Set(pages.filter((p) => p.kind === 'pdf' && p.bytes === bytes).map((p) => (p as { index: number }).index))];
    const copied = await out.copyPages(doc, idx);
    const m = new Map<number, unknown[]>();
    idx.forEach((i, k) => m.set(i, [copied[k]]));
    bulk.set(bytes, m);
  }

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.kind === 'pdf') {
      const pool = bulk.get(p.bytes)!.get(p.index)!;
      let page = pool.pop() as Awaited<ReturnType<typeof out.copyPages>>[number] | undefined;
      if (!page) [page] = await out.copyPages(srcDocs.get(p.bytes)!, [p.index]);
      if (p.rotate) page.setRotation(degrees((page.getRotation().angle + p.rotate) % 360));
      out.addPage(page);
    } else if (p.kind === 'image') {
      const img = await imageForPdf(p.blob);
      const emb = img.jpeg ? await out.embedJpg(img.bytes) : await out.embedPng(img.bytes);
      const page = out.addPage([p.width, p.height]);
      page.drawImage(emb, { x: 0, y: 0, width: p.width, height: p.height });
      if (p.rotate) page.setRotation(degrees(p.rotate % 360));
    } else {
      const page = out.addPage([p.width, p.height]);
      if (p.rotate) page.setRotation(degrees(p.rotate % 360));
    }
    onProgress?.((i + 1) / pages.length);
  }
  const bytes = await out.save({ useObjectStreams: true });
  return new Blob([bytes.slice()], { type: 'application/pdf' });
}

/** A4 portrait in points. */
export const A4: [number, number] = [595.28, 841.89];

/** Image pixels → page points: 96 dpi screen pixels map to 72 dpi points. */
export function imagePageSize(w: number, h: number): [number, number] {
  return [w * 0.75, h * 0.75];
}

export function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || extOf(f.name) === 'pdf';
}

/**
 * Merge any mix of PDFs and images into one PDF (order preserved).
 * Images become full-bleed pages sized to the image.
 */
export async function mergeToPdf(files: File[], onProgress?: (p: number) => void): Promise<Blob> {
  const specs: PageSpec[] = [];
  for (const f of files) {
    if (isPdfFile(f)) {
      const bytes = await f.arrayBuffer();
      const doc = await openPdf(bytes);
      for (let i = 0; i < doc.numPages; i++) specs.push({ kind: 'pdf', bytes, index: i, rotate: 0 });
      await closePdf(doc);
    } else {
      const bmp = await createImageBitmap(f);
      const [width, height] = imagePageSize(bmp.width, bmp.height);
      bmp.close();
      specs.push({ kind: 'image', blob: f, width, height, rotate: 0 });
    }
  }
  return buildPdf(specs, onProgress);
}

/** Single image → one-page PDF (the image→PDF converter path). */
export function imageToPdf(file: File): Promise<Blob> {
  return mergeToPdf([file]);
}
