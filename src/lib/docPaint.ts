/**
 * Document layout engine, shared by BOTH page painters:
 *  - CanvasPainter → rasterized A4 pages (no downloads, text not selectable)
 *  - PdfPainter    → real pdf-lib text with on-demand Noto Sans TC/JP/KR subsets (lib/cjkFont)
 *    — selectable/searchable text, falls back to raster when the fonts can't be fetched.
 * The wrapping/measuring logic runs once per painter, so both outputs share line breaks logic
 * (not necessarily identical breaks — each painter measures with its own font metrics).
 */
import type { Block, Run } from './docs';
import { A4 } from './pdf';
import { loadCjkFontSet } from './cjkFont';

export interface PageStyle {
  /** page size in points */
  width: number;
  height: number;
  /** device scale (2 = 144 dpi) — canvas resolution; the pdf painter only uses it as a px→pt divisor */
  scale: number;
  margin: number;
  fontSize: number;
}
export const DEFAULT_STYLE: PageStyle = { width: A4[0], height: A4[1], scale: 2, margin: 56, fontSize: 11 };
const SANS = '"IBM Plex Sans", "Noto Sans TC", "Noto Sans JP", "Segoe UI", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace';

export interface FontSpec { px: number; bold?: boolean; italic?: boolean; code?: boolean }

/** Top-down device-pixel coordinates; painters translate to their own space. */
export interface Painter {
  W: number;
  H: number;
  newPage(): void;
  measure(text: string, f: FontSpec): number;
  text(text: string, x: number, baseline: number, f: FontSpec, color: string): void;
  /** filled rectangle */
  rect(x: number, y: number, w: number, h: number, color: string): void;
  /** stroked rectangle */
  frame(x: number, y: number, w: number, h: number, color: string, lw: number): void;
  image(src: string, x: number, y: number, w: number, h: number): Promise<void>;
}

interface Seg { text: string; f: FontSpec; underline?: boolean; w: number }
interface Line { segs: Seg[]; h: number }

const isCJK = (ch: string) => /[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch);

/** Break runs into lines that fit `maxW` px. Spaces and every CJK char are break points. */
function wrapRuns(p: Painter, runs: Run[], maxW: number, px: number, lh: number, base: { bold?: boolean } = {}): Line[] {
  const lines: Line[] = [];
  let cur: Seg[] = [];
  let curW = 0;
  const flush = () => { lines.push({ segs: cur, h: lh }); cur = []; curW = 0; };
  for (const r of runs) {
    const f: FontSpec = { px: r.code ? px * 0.92 : px, bold: r.bold || base.bold, italic: r.italic, code: r.code };
    const parts = r.text.split('\n');
    parts.forEach((part, pi) => {
      if (pi > 0) flush();
      const toks: string[] = [];
      let buf = '';
      for (const ch of part) {
        if (isCJK(ch)) { if (buf) toks.push(buf); buf = ''; toks.push(ch); }
        else if (ch === ' ') { buf += ch; toks.push(buf); buf = ''; }
        else buf += ch;
      }
      if (buf) toks.push(buf);
      for (const tk of toks) {
        const w = p.measure(tk, f);
        if (curW + w > maxW && cur.length) {
          flush();
          if (tk === ' ') continue;
        }
        if (w > maxW) {
          for (const ch of tk) {
            const cw = p.measure(ch, f);
            if (curW + cw > maxW && cur.length) flush();
            cur.push({ text: ch, f, underline: r.underline, w: cw });
            curW += cw;
          }
          continue;
        }
        cur.push({ text: tk, f, underline: r.underline, w });
        curW += w;
      }
    });
  }
  if (cur.length || !lines.length) flush();
  return lines;
}

function fitText(p: Painter, text: string, f: FontSpec, maxW: number): string {
  if (p.measure(text, f) <= maxW) return text;
  let out = '';
  let w = 0;
  const ell = p.measure('…', f);
  for (const ch of text) {
    const cw = p.measure(ch, f);
    if (w + cw + ell > maxW) return out + '…';
    out += ch;
    w += cw;
  }
  return out;
}

async function imageDims(src: string): Promise<{ w: number; h: number } | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    const d = { w: bmp.width, h: bmp.height };
    bmp.close();
    return d;
  } catch { return null; }
}

/** Lay the block list out through a painter (the pagination brain shared by both outputs). */
export async function renderBlocks(blocks: Block[], st: PageStyle, p: Painter, onProgress?: (pr: number) => void): Promise<void> {
  const S = st.scale;
  const { W, H } = p;
  const M = Math.round(st.margin * S);
  const px = st.fontSize * S * 1.333;
  const lh = px * 1.55;
  const contentW = W - 2 * M;
  let y = M;
  const newPage = () => { p.newPage(); y = M; };
  p.newPage();
  const ensure = (h: number) => { if (y + h > H - M && y > M) newPage(); };
  const drawLines = (lines: Line[], x0: number, color = '#111111') => {
    for (const ln of lines) {
      ensure(ln.h);
      let x = x0;
      const baseline = y + ln.h * 0.78;
      for (const s of ln.segs) {
        p.text(s.text, x, baseline, s.f, color);
        if (s.underline) p.rect(x, baseline + 1.5 * S, s.w, Math.max(1, S * 0.6), color);
        x += s.w;
      }
      y += ln.h;
    }
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.kind === 'pagebreak') {
      if (y > M) newPage();
    } else if (b.kind === 'heading') {
      const size = px * [2.0, 1.6, 1.35, 1.15, 1.05, 1][Math.min(5, b.level - 1)];
      const lines = wrapRuns(p, b.runs, contentW, size, size * 1.35, { bold: true });
      y += b.level <= 2 ? lh * 0.8 : lh * 0.5;
      ensure(lines.length * size * 1.35);
      drawLines(lines, M);
      if (b.level === 1) p.rect(M, y + 4, contentW, Math.max(1, S * 0.6), '#999999');
      y += lh * 0.4;
    } else if (b.kind === 'para') {
      const indent = (b.indent ?? 0) * px * 1.6 + (b.quote ? px * 1.2 : 0);
      const bulletW = b.bullet ? px * 1.4 : 0;
      const lines = wrapRuns(p, b.runs, contentW - indent - bulletW, px, lh);
      ensure(Math.min(lines.length, 2) * lh);
      const y0 = y;
      if (b.bullet) p.text(b.bullet, M + indent - bulletW + px * 0.2, y + lh * 0.78, { px }, '#111111');
      drawLines(lines, M + indent, b.quote ? '#555555' : '#111111');
      if (b.quote) p.rect(M + indent - px * 1.0, y0, S * 1.5, y - y0, '#bbbbbb');
      y += lh * 0.45;
    } else if (b.kind === 'pre') {
      const f: FontSpec = { px: px * 0.9, code: true };
      const lineH = f.px * 1.5;
      const pad = px * 0.6;
      const raw = b.text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
      let i = 0;
      while (i < raw.length) {
        ensure(lineH + pad * 2);
        const avail = Math.floor((H - M - y - pad * 2) / lineH);
        const chunk = raw.slice(i, i + Math.max(1, avail));
        p.rect(M, y, contentW, chunk.length * lineH + pad * 2, '#f3f3f3');
        y += pad;
        for (const lnText of chunk) {
          p.text(fitText(p, lnText, f, contentW - pad * 2), M + pad, y + lineH * 0.75, f, '#222222');
          y += lineH;
        }
        y += pad;
        i += chunk.length;
      }
      y += lh * 0.5;
    } else if (b.kind === 'hr') {
      ensure(lh);
      p.rect(M, y + lh / 2, contentW, Math.max(1, S * 0.6), '#cccccc');
      y += lh;
    } else if (b.kind === 'image') {
      const dims = await imageDims(b.src);
      if (dims) {
        let w = Math.min(contentW, dims.w * (S / 1.333));
        let h = w * (dims.h / dims.w);
        const maxH = (H - 2 * M) * 0.7;
        if (h > maxH) { h = maxH; w = h * (dims.w / dims.h); }
        ensure(h);
        await p.image(b.src, M, y, w, h);
        y += h + lh * 0.5;
      }
    } else if (b.kind === 'table') {
      const cols = Math.max(...b.rows.map((r) => r.length), 1);
      const colW = contentW / cols;
      const pad = px * 0.35;
      const cellPx = px * 0.9;
      const cellLh = cellPx * 1.45;
      for (let ri = 0; ri < b.rows.length; ri++) {
        const row = b.rows[ri];
        const wrapped = Array.from({ length: cols }, (_, ci) =>
          wrapRuns(p, [{ text: row[ci] ?? '', bold: b.header && ri === 0 }], colW - pad * 2, cellPx, cellLh));
        const rowH = Math.max(...wrapped.map((l) => l.length)) * cellLh + pad * 2;
        ensure(rowH);
        const y0 = y;
        if (b.header && ri === 0) p.rect(M, y0, contentW, rowH, '#eef1f8');
        for (let ci = 0; ci < cols; ci++) {
          let cy = y0 + pad;
          for (const ln of wrapped[ci]) {
            let x = M + ci * colW + pad;
            for (const s of ln.segs) { p.text(s.text, x, cy + ln.h * 0.78, s.f, '#111111'); x += s.w; }
            cy += ln.h;
          }
          p.frame(M + ci * colW, y0, colW, rowH, '#bbbbbb', Math.max(1, S * 0.5));
        }
        y = y0 + rowH;
      }
      y += lh * 0.6;
    }
    onProgress?.((bi + 1) / blocks.length);
  }
}

// ---------- canvas painter ----------

class CanvasPainter implements Painter {
  W: number;
  H: number;
  pages: HTMLCanvasElement[] = [];
  private ctx!: CanvasRenderingContext2D;
  private meas = document.createElement('canvas').getContext('2d')!;
  constructor(st: PageStyle) {
    this.W = Math.round(st.width * st.scale);
    this.H = Math.round(st.height * st.scale);
  }
  private fontOf(f: FontSpec): string {
    return `${f.italic ? 'italic ' : ''}${f.bold ? '700' : '400'} ${f.px}px ${f.code ? MONO : SANS}`;
  }
  newPage(): void {
    const c = document.createElement('canvas');
    c.width = this.W;
    c.height = this.H;
    this.ctx = c.getContext('2d')!;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.W, this.H);
    this.ctx.textBaseline = 'alphabetic';
    this.pages.push(c);
  }
  measure(text: string, f: FontSpec): number {
    this.meas.font = this.fontOf(f);
    return this.meas.measureText(text).width;
  }
  text(text: string, x: number, baseline: number, f: FontSpec, color: string): void {
    this.ctx.font = this.fontOf(f);
    this.ctx.fillStyle = color;
    this.ctx.fillText(text, x, baseline);
  }
  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }
  frame(x: number, y: number, w: number, h: number, color: string, lw: number): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lw;
    this.ctx.strokeRect(x, y, w, h);
  }
  async image(src: string, x: number, y: number, w: number, h: number): Promise<void> {
    try {
      const bmp = await createImageBitmap(await (await fetch(src)).blob());
      this.ctx.drawImage(bmp, x, y, w, h);
      bmp.close();
    } catch { /* skip */ }
  }
}

/** blocks → painted A4 canvases (raster path). */
export async function renderCanvases(blocks: Block[], style: Partial<PageStyle> = {}, onProgress?: (p: number) => void): Promise<HTMLCanvasElement[]> {
  const st = { ...DEFAULT_STYLE, ...style };
  const painter = new CanvasPainter(st);
  await renderBlocks(blocks, st, painter, onProgress);
  return painter.pages;
}

// ---------- pdf-lib painter (embedded CJK fonts, selectable text) ----------

type PdfLib = typeof import('pdf-lib');

class PdfPainter implements Painter {
  W: number;
  H: number;
  private page!: import('pdf-lib').PDFPage;
  constructor(
    private lib: PdfLib,
    private doc: import('pdf-lib').PDFDocument,
    private fonts: Map<string, import('pdf-lib').PDFFont>,
    private seg: (text: string, bold: boolean) => { text: string; key: string }[],
    private st: PageStyle
  ) {
    this.W = Math.round(st.width * st.scale);
    this.H = Math.round(st.height * st.scale);
  }
  private pt(v: number): number { return v / this.st.scale; }
  private col(hex: string) {
    const n = parseInt(hex.slice(1), 16);
    return this.lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  newPage(): void {
    this.page = this.doc.addPage([this.st.width, this.st.height]);
  }
  measure(text: string, f: FontSpec): number {
    let w = 0;
    for (const s of this.seg(text, !!f.bold)) {
      const font = this.fonts.get(s.key);
      if (font) w += font.widthOfTextAtSize(s.text, this.pt(f.px)) * this.st.scale;
    }
    return w;
  }
  text(text: string, x: number, baseline: number, f: FontSpec, color: string): void {
    let cx = x;
    for (const s of this.seg(text, !!f.bold)) {
      const font = this.fonts.get(s.key);
      if (!font) continue;
      this.page.drawText(s.text, { x: this.pt(cx), y: this.st.height - this.pt(baseline), size: this.pt(f.px), font, color: this.col(color) });
      cx += font.widthOfTextAtSize(s.text, this.pt(f.px)) * this.st.scale;
    }
  }
  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.page.drawRectangle({ x: this.pt(x), y: this.st.height - this.pt(y + h), width: this.pt(w), height: this.pt(h), color: this.col(color) });
  }
  frame(x: number, y: number, w: number, h: number, color: string, lw: number): void {
    this.page.drawRectangle({ x: this.pt(x), y: this.st.height - this.pt(y + h), width: this.pt(w), height: this.pt(h), borderColor: this.col(color), borderWidth: this.pt(lw) });
  }
  async image(src: string, x: number, y: number, w: number, h: number): Promise<void> {
    try {
      const blob = await (await fetch(src)).blob();
      let img;
      if (blob.type === 'image/jpeg') img = await this.doc.embedJpg(await blob.arrayBuffer());
      else if (blob.type === 'image/png') img = await this.doc.embedPng(await blob.arrayBuffer());
      else {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
        const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
        if (!png) return;
        img = await this.doc.embedPng(await png.arrayBuffer());
      }
      this.page.drawImage(img, { x: this.pt(x), y: this.st.height - this.pt(y + h), width: this.pt(w), height: this.pt(h) });
    } catch { /* skip */ }
  }
}

/**
 * blocks → PDF with EMBEDDED, subsetted Noto fonts (selectable text). `allText` decides which
 * font subsets download. Throws when fonts can't be fetched — the caller falls back to raster.
 */
export async function renderPdfBlob(blocks: Block[], title: string, allText: string, style: Partial<PageStyle> = {}, onProgress?: (p: number) => void): Promise<Blob> {
  const st = { ...DEFAULT_STYLE, ...style };
  const [lib, fontkit, fontSet] = await Promise.all([
    import('pdf-lib'),
    import('@pdf-lib/fontkit').then((m) => m.default),
    loadCjkFontSet(allText + '•…?123456789', (p) => onProgress?.(p * 0.3)),
  ]);
  const doc = await lib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setProducer('MorphKit');
  doc.setCreator('MorphKit');
  const fonts = new Map<string, import('pdf-lib').PDFFont>();
  // bytes are decompressed TTFs (lib/cjkFont toTtf) — pdf-lib re-subsets them to just the used glyphs
  for (const [key, bytes] of fontSet.bytes) fonts.set(key, await doc.embedFont(bytes, { subset: true }));
  const painter = new PdfPainter(lib, doc, fonts, fontSet.segment, st);
  await renderBlocks(blocks, st, painter, (p) => onProgress?.(0.3 + p * 0.65));
  const out = await doc.save({ useObjectStreams: true });
  onProgress?.(1);
  return new Blob([out.slice()], { type: 'application/pdf' });
}
