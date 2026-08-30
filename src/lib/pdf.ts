/**
 * PDF support — 100% in-browser.
 *  - READ / RENDER via pdfjs-dist (lazy-imported; worker bundled by Vite via `?url`)
 *  - WRITE / ASSEMBLE via pdf-lib (lazy-imported)
 *  - DECRYPT via qpdf-wasm (lib/qpdf.ts, lazy) — pdf.js reads encrypted files itself,
 *    but pdf-lib can only copy pages out of PLAIN bytes (`getPlainBytes`).
 * Every library is only downloaded the first time a PDF needs it.
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

/** Thrown by `openPdf` when the file needs a (different) user password. */
export class PdfPasswordError extends Error {
  constructor(public reason: 'need' | 'wrong') {
    super(reason === 'need' ? 'password required' : 'wrong password');
  }
}

/** loading task per document — `destroy()` lives on the task in pdf.js, not the proxy */
const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

/**
 * Parse a PDF into a pdf.js document (render / text / metadata). Pair with `closePdf`.
 * Owner-only (permissions) encryption opens with no password; user-password files throw
 * `PdfPasswordError` — 'need' when none was given, 'wrong' when `password` failed.
 */
export async function openPdf(data: ArrayBuffer | Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // pdf.js transfers the buffer to its worker — hand it a copy so callers keep theirs
  const task = lib.getDocument({ data: bytes.slice(), password });
  let pwErr: PdfPasswordError | null = null;
  task.onPassword = (_cb: (pw: string) => void, reason: number) => {
    // never prompt from here — surface a typed error so the UI can ask
    pwErr = new PdfPasswordError(reason === lib.PasswordResponses.INCORRECT_PASSWORD ? 'wrong' : 'need');
    void task.destroy();
  };
  try {
    const doc = await task.promise;
    tasks.set(doc, task);
    return doc;
  } catch (e) {
    if (pwErr) throw pwErr;
    if (e instanceof lib.PasswordException) throw new PdfPasswordError(password ? 'wrong' : 'need');
    throw e;
  }
}

/** Release worker memory held by a document opened with `openPdf`. */
export async function closePdf(doc: PDFDocumentProxy): Promise<void> {
  await tasks.get(doc)?.destroy();
  tasks.delete(doc);
}

/** Cheap sniff: does the trailer/xref mention /Encrypt? (false negatives possible for odd files) */
export async function sniffEncrypted(file: Blob): Promise<boolean> {
  const tail = await file.slice(Math.max(0, file.size - 65536)).text();
  return /\/Encrypt\b/.test(tail);
}

// ---------- plain-bytes cache (decryption) ----------

const plainCache = new WeakMap<Blob, Promise<ArrayBuffer>>();

/**
 * Bytes pdf-lib can work with. Plain files pass through; encrypted files are decrypted with
 * qpdf-wasm using `password` ('' for owner-only files). Throws `PdfPasswordError('wrong')` when
 * qpdf rejects the password, or a plain Error when qpdf itself fails (caller may rasterize).
 */
export function getPlainBytes(file: Blob, password: string | undefined, encrypted: boolean): Promise<ArrayBuffer> {
  if (!encrypted) return file.arrayBuffer();
  let p = plainCache.get(file);
  if (!p) {
    p = (async () => {
      const { decryptPdf, QpdfError } = await import('./qpdf');
      try {
        const out = await decryptPdf(new Uint8Array(await file.arrayBuffer()), password ?? '');
        return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      } catch (e) {
        if (e instanceof QpdfError && /password/i.test(e.log)) throw new PdfPasswordError('wrong');
        throw e;
      }
    })();
    plainCache.set(file, p);
    p.catch(() => plainCache.delete(file));
  }
  return p;
}

// ---------- page info / render ----------

export interface PdfPageInfo {
  /** page size in PDF points after the page's own /Rotate */
  width: number;
  height: number;
  /** the page's intrinsic /Rotate (0/90/180/270) */
  rotate: number;
}

export async function pageInfo(doc: PDFDocumentProxy, index: number): Promise<PdfPageInfo> {
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height, rotate: page.rotate };
}

/** A sticky note anchored in USER space: ux/uy are 0–1 fractions of the unrotated media box (y down). */
export interface PdfNote {
  id: string;
  ux: number;
  uy: number;
  text: string;
}

/** Existing /Text (sticky) annotations of a page as user-space fractions. */
export async function readNotes(doc: PDFDocumentProxy, index: number): Promise<PdfNote[]> {
  const page = await doc.getPage(index + 1);
  const annots = await page.getAnnotations();
  const [x0, y0, x1, y1] = page.view;
  const W = x1 - x0;
  const H = y1 - y0;
  const out: PdfNote[] = [];
  for (const a of annots as { subtype?: string; contentsObj?: { str: string }; contents?: string; rect?: number[]; id?: string }[]) {
    if (a.subtype !== 'Text' || !a.rect) continue;
    // annotation rect is in user space (y up); take its top-left corner
    const ux = (a.rect[0] - x0) / W;
    const uy = 1 - (a.rect[3] - y0) / H;
    out.push({ id: `n${a.id ?? Math.random().toString(36).slice(2)}`, ux, uy, text: a.contentsObj?.str ?? a.contents ?? '' });
  }
  return out;
}

/** unrotated-page fraction (y down) → display fraction under a clockwise rotation */
export function userToDisplay(ux: number, uy: number, rot: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90: return [1 - uy, ux];
    case 180: return [1 - ux, 1 - uy];
    case 270: return [uy, 1 - ux];
    default: return [ux, uy];
  }
}
/** inverse of `userToDisplay` */
export function displayToUser(nx: number, ny: number, rot: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90: return [ny, 1 - nx];
    case 180: return [1 - nx, 1 - ny];
    case 270: return [1 - ny, nx];
    default: return [nx, ny];
  }
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
  const out: PdfInfo = { pages: doc.numPages, width: first.width, height: first.height };
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
 * Renders at 144 dpi (2×); `maxDim` caps the longest edge (0 = off).
 */
export async function pdfToImages(
  file: File,
  target: RasterTarget,
  quality: number,
  maxDim: number,
  onProgress?: (p: number) => void,
  password?: string,
  scale = 2
): Promise<{ blob: Blob; multi: boolean }> {
  const doc = await openPdf(await file.arrayBuffer(), password);
  const mime = `image/${target}`;
  const ext = target === 'jpeg' ? 'jpg' : target;
  const n = doc.numPages;
  const base = file.name.replace(/\.[^.]+$/, '');
  const entries: Record<string, Uint8Array> = {};
  let single: Blob | null = null;
  for (let i = 0; i < n; i++) {
    const canvas = await renderPage(doc, i, { scale, maxDim });
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
export async function pdfToText(file: File, onProgress?: (p: number) => void, password?: string): Promise<Blob> {
  const doc = await openPdf(await file.arrayBuffer(), password);
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

/** Per-page geometry + notes shared by every PageSpec. Flips are in DISPLAY space. */
interface PageCommon {
  /** extra clockwise degrees applied at export */
  rotate: number;
  flipH?: boolean;
  flipV?: boolean;
  /** sticky notes to write (user-space fractions) — replaces any existing /Text annots */
  notes?: PdfNote[];
  /**
   * Drawing overlay: transparent PNG in USER space (unrotated page orientation, same aspect
   * as the media box), drawn over the original content so vectors/text stay intact.
   */
  overlay?: Blob;
  /** stamp the document watermark (BuildOpts.watermark) on this page */
  watermark?: boolean;
}

/** Document-level watermark; text is rasterized through a canvas so CJK works without fonts. */
export interface Watermark {
  text: string;
  /** an image watermark wins over text when set */
  image?: Blob | null;
  /** 0–1 */
  opacity: number;
  /** degrees, counter-clockwise as seen on the page */
  angle: number;
  /** width as a fraction of the page's display width (0.1–1) */
  scale: number;
  color: string;
  mode: 'center' | 'tile';
}

/** One output page. `bytes` for pdf pages must already be PLAIN (see getPlainBytes). */
export type PageSpec =
  | ({ kind: 'pdf'; bytes: ArrayBuffer; index: number } & PageCommon)
  | ({ kind: 'image'; blob: Blob; width: number; height: number } & PageCommon)
  | ({ kind: 'blank'; width: number; height: number } & PageCommon);

export interface BuildOpts {
  title?: string;
  author?: string;
  watermark?: Watermark | null;
  /** AES-256 encrypt the result (qpdf-wasm). `user` may be '' for permissions-only. */
  encrypt?: { user: string; owner: string } | null;
  onProgress?: (p: number) => void;
}

/** Render a text watermark to a transparent canvas (`px` wide). Used for export AND preview. */
export function watermarkCanvas(wm: Watermark, px = 1200): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const text = wm.text.trim() || ' ';
  const ctx0 = c.getContext('2d')!;
  // fit the font so the text spans `px`
  ctx0.font = `bold 100px ${'"Chakra Petch", "IBM Plex Sans", "Noto Sans TC", "Noto Sans JP", sans-serif'}`;
  const w100 = Math.max(1, ctx0.measureText(text).width);
  const size = Math.max(8, (100 * px) / w100);
  c.width = Math.ceil(px);
  c.height = Math.ceil(size * 1.3);
  const ctx = c.getContext('2d')!;
  ctx.font = `bold ${size}px "Chakra Petch", "IBM Plex Sans", "Noto Sans TC", "Noto Sans JP", sans-serif`;
  ctx.fillStyle = wm.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, c.height / 2);
  return c;
}

/**
 * Composite a watermark onto a DISPLAY-space canvas of a page (preview + thumbs share this
 * with the export math: same scale fraction, same tiling rhythm).
 */
export function drawWatermarkPreview(ctx: CanvasRenderingContext2D, W: number, H: number, wm: Watermark, art: HTMLCanvasElement | ImageBitmap) {
  const aw = art.width;
  const ah = art.height;
  const tw = W * wm.scale;
  const th = tw * (ah / aw);
  ctx.save();
  ctx.globalAlpha = wm.opacity;
  const stamp = (cx: number, cy: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-wm.angle * Math.PI) / 180);
    ctx.drawImage(art, -tw / 2, -th / 2, tw, th);
    ctx.restore();
  };
  if (wm.mode === 'center') stamp(W / 2, H / 2);
  else {
    const gx = tw * 1.6;
    const gy = Math.max(th * 3, tw * 0.9);
    for (let y = gy / 2; y < H + gy; y += gy) {
      for (let x = gx / 2; x < W + gx; x += gx) stamp(x + ((Math.floor(y / gy) % 2) * gx) / 2, y);
    }
  }
  ctx.restore();
}

/**
 * Bake the watermark into a full-page transparent PNG in DISPLAY space, then rotate into
 * USER space so `buildPdf` can draw it like an overlay. `dispW/dispH` in points.
 */
async function watermarkOverlay(wm: Watermark, art: HTMLCanvasElement | ImageBitmap, dispW: number, dispH: number, totalRot: number, flipH: boolean, flipV: boolean): Promise<Blob> {
  const scale = Math.min(2, 1600 / Math.max(dispW, dispH));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(dispW * scale));
  c.height = Math.max(1, Math.round(dispH * scale));
  drawWatermarkPreview(c.getContext('2d')!, c.width, c.height, wm, art);
  return toBlob(displayToUserCanvas(c, totalRot, flipH, flipV), 'image/png');
}

/** Undo display flips then rotate a display-space canvas back into page user space. */
export function displayToUserCanvas(c: HTMLCanvasElement, totalRot: number, flipH: boolean, flipV: boolean): HTMLCanvasElement {
  const r = ((totalRot % 360) + 360) % 360;
  const side = r === 90 || r === 270;
  const out = document.createElement('canvas');
  out.width = side ? c.height : c.width;
  out.height = side ? c.width : c.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((-r * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

/** Inverse of `displayToUserCanvas`: user-space canvas → how it appears on screen. */
export function userToDisplayCanvas(c: HTMLCanvasElement | ImageBitmap, totalRot: number, flipH: boolean, flipV: boolean): HTMLCanvasElement {
  const r = ((totalRot % 360) + 360) % 360;
  const side = r === 90 || r === 270;
  const out = document.createElement('canvas');
  out.width = side ? c.height : c.width;
  out.height = side ? c.width : c.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

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

/**
 * Assemble a PDF from page specs. Pages copied from the same source share one copier pass.
 * Flipped pages are re-drawn as form XObjects (keeps vectors, drops links/form fields).
 * Notes are written as real /Text annotations (UTF-16, so CJK survives); pre-existing
 * sticky notes on copied pages are stripped first so the model is the single source of truth.
 */
export async function buildPdf(pages: PageSpec[], opts: BuildOpts = {}): Promise<Blob> {
  const lib = await pdfLib();
  const { PDFDocument, degrees, PDFName, PDFArray, PDFDict, PDFHexString, PDFNumber } = lib;
  const out = await PDFDocument.create();
  out.setProducer('MorphKit');
  out.setCreator('MorphKit');
  if (opts.title != null) out.setTitle(opts.title);
  if (opts.author != null) out.setAuthor(opts.author);

  // load each distinct source document once
  const srcDocs = new Map<ArrayBuffer, Awaited<ReturnType<typeof PDFDocument.load>>>();
  for (const p of pages) {
    if (p.kind === 'pdf' && !srcDocs.has(p.bytes)) {
      srcDocs.set(p.bytes, await PDFDocument.load(p.bytes, { ignoreEncryption: true, updateMetadata: false }));
    }
  }
  // first use of a (doc,index) pair comes from one bulk copy; repeats copy again
  type Page = Awaited<ReturnType<typeof out.copyPages>>[number];
  const bulk = new Map<ArrayBuffer, Map<number, Page[]>>();
  for (const [bytes, doc] of srcDocs) {
    const idx = [...new Set(pages.filter((p) => p.kind === 'pdf' && p.bytes === bytes).map((p) => (p as { index: number }).index))];
    const copied = await out.copyPages(doc, idx);
    const m = new Map<number, Page[]>();
    idx.forEach((i, k) => m.set(i, [copied[k]]));
    bulk.set(bytes, m);
  }

  const stripTextAnnots = (page: Page) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    const keep = PDFArray.withContext(out.context);
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const d = out.context.lookup(ref);
      const sub = d instanceof PDFDict ? d.get(PDFName.of('Subtype')) : null;
      if (sub instanceof PDFName && sub.decodeText() === 'Text') continue;
      keep.push(ref);
    }
    page.node.set(PDFName.of('Annots'), keep);
  };

  const addNotes = (page: Page, notes: PdfNote[]) => {
    if (!notes.length) return;
    const { x, y, width: W, height: H } = page.getMediaBox();
    const existing = page.node.lookup(PDFName.of('Annots'));
    const arr = existing instanceof PDFArray ? existing : PDFArray.withContext(out.context);
    for (const n of notes) {
      const ax = x + n.ux * W;
      const ay = y + (1 - n.uy) * H;
      const dict = out.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [ax, ay - 20, ax + 20, ay],
        Contents: PDFHexString.fromText(n.text),
        T: PDFHexString.fromText('MorphKit'),
        Name: 'Comment',
        F: 4,
        C: [1, 0.85, 0.2],
        Open: false,
      });
      arr.push(out.context.register(dict));
    }
    page.node.set(PDFName.of('Annots'), arr);
    void PDFNumber;
  };

  /** re-draw `page` mirrored; returns the replacement page (same size, same rotation) */
  const flipPage = async (page: Page, fh: boolean, fv: boolean): Promise<Page> => {
    const emb = await out.embedPage(page);
    const { width: W, height: H } = page.getMediaBox();
    const np = out.addPage([W, H]);
    np.drawPage(emb, { x: fh ? W : 0, y: fv ? H : 0, xScale: fh ? -1 : 1, yScale: fv ? -1 : 1 });
    np.setRotation(page.getRotation());
    out.removePage(out.getPageCount() - 1); // we add it back in order below
    return np;
  };

  let wmArt: HTMLCanvasElement | ImageBitmap | null = null;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let page: Page;
    let intrinsic = 0;
    if (p.kind === 'pdf') {
      const pool = bulk.get(p.bytes)!.get(p.index)!;
      let got = pool.pop();
      if (!got) [got] = await out.copyPages(srcDocs.get(p.bytes)!, [p.index]);
      page = got;
      intrinsic = page.getRotation().angle;
      stripTextAnnots(page);
      if (p.rotate) page.setRotation(degrees((intrinsic + p.rotate) % 360));
    } else if (p.kind === 'image') {
      const img = await imageForPdf(p.blob);
      const emb = img.jpeg ? await out.embedJpg(img.bytes) : await out.embedPng(img.bytes);
      page = out.addPage([p.width, p.height]);
      page.drawImage(emb, { x: 0, y: 0, width: p.width, height: p.height });
      out.removePage(out.getPageCount() - 1);
      if (p.rotate) page.setRotation(degrees(p.rotate % 360));
    } else {
      page = out.addPage([p.width, p.height]);
      out.removePage(out.getPageCount() - 1);
      if (p.rotate) page.setRotation(degrees(p.rotate % 360));
    }
    const totalRot = (intrinsic + p.rotate) % 360;
    if (p.flipH || p.flipV) {
      // display flips → user-space axes swap under sideways rotation
      const side = totalRot === 90 || totalRot === 270;
      page = await flipPage(page, side ? !!p.flipV : !!p.flipH, side ? !!p.flipH : !!p.flipV);
    }
    // drawing overlay: user-space PNG stretched over the media box — original content untouched
    const drawUserPng = async (blob: Blob) => {
      const png = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
      const { x, y, width: W, height: H } = page.getMediaBox();
      page.drawImage(png, { x, y, width: W, height: H });
    };
    if (p.overlay) await drawUserPng(p.overlay);
    if (p.watermark && opts.watermark) {
      const wm = opts.watermark;
      if (!wmArt) wmArt = wm.image ? await createImageBitmap(wm.image) : watermarkCanvas(wm);
      const { width: W, height: H } = page.getMediaBox();
      const side = totalRot === 90 || totalRot === 270;
      await drawUserPng(await watermarkOverlay(wm, wmArt, side ? H : W, side ? W : H, totalRot, !!p.flipH, !!p.flipV));
    }
    if (p.notes?.length) addNotes(page, p.notes);
    out.addPage(page);
    opts.onProgress?.((i + 1) / pages.length);
  }
  let bytes: Uint8Array = await out.save({ useObjectStreams: true });
  if (opts.encrypt && (opts.encrypt.user || opts.encrypt.owner)) {
    const { encryptPdf } = await import('./qpdf');
    bytes = await encryptPdf(bytes, opts.encrypt.user, opts.encrypt.owner);
  }
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

/** A file to merge + its password (encrypted inputs must already be unlocked by the UI). */
export interface MergeInput {
  file: File;
  password?: string;
  encrypted?: boolean;
}

/**
 * Merge any mix of PDFs and images into one PDF (order preserved).
 * Images become full-bleed pages sized to the image.
 */
export async function mergeToPdf(inputs: (File | MergeInput)[], onProgress?: (p: number) => void): Promise<Blob> {
  const specs: PageSpec[] = [];
  for (const inp of inputs) {
    const { file, password, encrypted } = inp instanceof File ? { file: inp, password: undefined, encrypted: false } : inp;
    if (isPdfFile(file)) {
      const bytes = await getPlainBytes(file, password, !!encrypted);
      const doc = await openPdf(bytes);
      for (let i = 0; i < doc.numPages; i++) specs.push({ kind: 'pdf', bytes, index: i, rotate: 0 });
      await closePdf(doc);
    } else {
      const bmp = await createImageBitmap(file);
      const [width, height] = imagePageSize(bmp.width, bmp.height);
      bmp.close();
      specs.push({ kind: 'image', blob: file, width, height, rotate: 0 });
    }
  }
  return buildPdf(specs, { onProgress });
}

/** Single image → one-page PDF (the image→PDF converter path). */
export function imageToPdf(file: File): Promise<Blob> {
  return mergeToPdf([file]);
}

/**
 * Raster fallback (plan B): every page rendered at 144 dpi and re-embedded as an image page.
 * Used when qpdf cannot decrypt a file pdf.js can still read.
 */
export async function rasterizePdf(file: File, password: string | undefined, onProgress?: (p: number) => void): Promise<Blob> {
  const doc = await openPdf(await file.arrayBuffer(), password);
  const specs: PageSpec[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    const info = await pageInfo(doc, i);
    const c = await renderPage(doc, i, { scale: 2 });
    const blob = await toBlob(c, 'image/jpeg', 0.9);
    c.width = c.height = 0;
    specs.push({ kind: 'image', blob, width: info.width, height: info.height, rotate: 0 });
    onProgress?.((i + 1) / (doc.numPages * 2));
  }
  await closePdf(doc);
  return buildPdf(specs, { onProgress: (p) => onProgress?.(0.5 + p / 2) });
}
