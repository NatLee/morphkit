/**
 * Documents (DOCX / Markdown / HTML / plain text / CSV / XLSX / JSON) — 100% in-browser.
 * Everything funnels through ONE intermediate: sanitized HTML.
 *   read:  docx → mammoth · md → marked · sheet → SheetJS (table) · json → table|pre · text → <p>
 *   write: html → md (turndown+gfm) · html → docx (docx lib) · html → text ·
 *          html → PDF / PNG through the layout engine in lib/docPaint — pages are
 *          rasterized (CJK-safe without font files; text is not selectable — documented).
 * Every library is lazy-imported; nothing here touches the main bundle.
 */
import { zipSync } from 'fflate';
import { docTypeOf, type DocType } from './formats';
import { A4, buildPdf, type PageSpec } from './pdf';

/** US Letter in points. */
export const LETTER: [number, number] = [612, 792];

// ---------- lazy libs ----------
const mammoth = () => import('mammoth/mammoth.browser.js').then((m) => (m.default ?? m) as typeof import('mammoth'));
const xlsx = () => import('xlsx');
const marked = () => import('marked');
const turndown = async () => {
  const [{ default: Turndown }, gfm] = await Promise.all([import('turndown'), import('turndown-plugin-gfm')]);
  const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  td.use(gfm.gfm);
  return td;
};
const docxLib = () => import('docx');

// ---------- read side: anything → HTML ----------

/** Drop scripts/styles/frames and inline handlers; keep structure + data-URI images. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, noscript').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n === 'data-page-break' || n === 'data-slide') continue;
      if (n.startsWith('on') || (n === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      if (n === 'src' && !/^data:image\//i.test(a.value) && !/^https?:/i.test(a.value)) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function rowsToTable(rows: unknown[][], header = true): string {
  const cell = (v: unknown) => esc(v == null ? '' : String(v));
  const [h, ...body] = header ? rows : [[] as unknown[], ...rows];
  return `<table>${header && h.length ? `<thead><tr>${h.map((c) => `<th>${cell(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function jsonToHtml(text: string): string {
  try {
    const v = JSON.parse(text) as unknown;
    if (Array.isArray(v) && v.length && v.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
      const keys = [...new Set(v.flatMap((r) => Object.keys(r as object)))];
      return rowsToTable([keys, ...v.map((r) => keys.map((k) => {
        const x = (r as Record<string, unknown>)[k];
        return x != null && typeof x === 'object' ? JSON.stringify(x) : x;
      }))]);
    }
    if (Array.isArray(v) && v.every((r) => Array.isArray(r))) return rowsToTable(v as unknown[][]);
    return `<pre>${esc(JSON.stringify(v, null, 2))}</pre>`;
  } catch {
    return `<pre>${esc(text)}</pre>`;
  }
}

export interface SheetInfo {
  names: string[];
  rows: Record<string, unknown[][]>;
}

/** Parse any SheetJS-readable file (xlsx/xls/ods/csv/tsv) into arrays of rows. */
export async function readSheets(file: File): Promise<SheetInfo> {
  const X = await xlsx();
  const t = docTypeOf(file);
  const wb = t === 'sheet' && /\.(csv|tsv)$/i.test(file.name)
    ? X.read(await file.text(), { type: 'string', FS: /\.tsv$/i.test(file.name) ? '\t' : undefined })
    : X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const rows: Record<string, unknown[][]> = {};
  for (const n of wb.SheetNames) rows[n] = X.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, blankrows: false });
  return { names: wb.SheetNames, rows };
}

/** Normalised HTML for any supported document. */
export async function docToHtml(file: File): Promise<string> {
  const t = docTypeOf(file);
  if (t === 'pptx') {
    const { pptxToHtml } = await import('./pptx');
    return sanitizeHtml(await pptxToHtml(file));
  }
  if (t === 'docx') {
    const m = await mammoth();
    const r = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return sanitizeHtml(r.value);
  }
  if (t === 'md') {
    const { marked: M } = await marked();
    return sanitizeHtml(await M.parse(await file.text(), { gfm: true, breaks: false }));
  }
  if (t === 'html') return sanitizeHtml(await file.text());
  if (t === 'sheet') {
    const s = await readSheets(file);
    return s.names
      .map((n) => (s.names.length > 1 ? `<h2>${esc(n)}</h2>` : '') + rowsToTable(s.rows[n]))
      .join('\n');
  }
  if (t === 'json') return jsonToHtml(await file.text());
  return textToHtml(await file.text());
}

/** HTML → readable plain text (block elements become line breaks, tables become TSV-ish rows). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { out.push((n.textContent ?? '').replace(/\s+/g, ' ')); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') { out.push('\n'); return; }
    if (tag === 'tr') { out.push([...el.children].map((c) => (c.textContent ?? '').trim()).join('\t'), '\n'); return; }
    if (tag === 'li') out.push('• ');
    if (tag === 'pre') { out.push(el.textContent ?? '', '\n\n'); return; }
    el.childNodes.forEach(walk);
    if (/^(p|div|h[1-6]|li|blockquote|table|ul|ol|hr)$/.test(tag)) out.push(tag === 'li' ? '\n' : '\n\n');
  };
  doc.body.childNodes.forEach(walk);
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Word/mammoth tables have no <thead> and wrap every cell in <p>; turndown-gfm only converts
 * tables whose first row is a header and would emit paragraph breaks inside cells. Normalise.
 */
function normalizeTablesForMd(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('table').forEach((table) => {
    table.querySelectorAll('td, th').forEach((cell) => {
      // unwrap block children → inline text separated by spaces
      const parts: string[] = [];
      cell.querySelectorAll('p, div, br').forEach(() => { /* handled via innerHTML below */ });
      const tmp = cell.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div)>\s*<(p|div)[^>]*>/gi, ' ').replace(/<\/?(p|div)[^>]*>/gi, '');
      parts.push(tmp.trim());
      cell.innerHTML = parts.join(' ');
    });
    if (!table.querySelector('thead')) {
      const first = table.querySelector('tr');
      if (first) {
        first.querySelectorAll('td').forEach((td) => {
          const th = doc.createElement('th');
          th.innerHTML = td.innerHTML.replace(/<\/?(strong|b)>/gi, '');
          td.replaceWith(th);
        });
        const thead = doc.createElement('thead');
        thead.appendChild(first);
        table.insertBefore(thead, table.firstChild);
      }
    }
  });
  return doc.body.innerHTML;
}

export async function htmlToMarkdown(html: string): Promise<string> {
  const td = await turndown();
  return td.turndown(normalizeTablesForMd(html)).trim() + '\n';
}

export async function markdownToHtml(md: string): Promise<string> {
  const { marked: M } = await marked();
  return sanitizeHtml(await M.parse(md, { gfm: true }));
}

/** Wrap a body fragment in a minimal standalone HTML document. */
export function wrapHtmlDocument(body: string, title: string): string {
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title>\n<style>body{max-width:820px;margin:40px auto;padding:0 20px;font:16px/1.6 -apple-system,"Segoe UI","Noto Sans TC","Noto Sans JP",sans-serif;color:#222}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}pre{background:#f4f4f4;padding:10px;overflow:auto}img{max-width:100%}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px;color:#555}</style></head>\n<body>\n${body}\n</body></html>\n`;
}

// ---------- block model (shared by the paginator and the docx writer) ----------

export interface Run { text: string; bold?: boolean; italic?: boolean; code?: boolean; underline?: boolean }
export type Block =
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'para'; runs: Run[]; indent?: number; quote?: boolean; bullet?: string }
  | { kind: 'pre'; text: string }
  | { kind: 'table'; rows: string[][]; header: boolean }
  | { kind: 'image'; src: string }
  | { kind: 'hr' }
  | { kind: 'pagebreak' };

function inlineRuns(el: Node, st: Run = { text: '' }, out: Run[] = []): Run[] {
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ');
      if (t) out.push({ ...st, text: t });
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as HTMLElement;
    const tag = e.tagName.toLowerCase();
    if (tag === 'br') { out.push({ ...st, text: '\n' }); return; }
    if (tag === 'img') { out.push({ ...st, text: '' }); return; }
    const next: Run = {
      ...st,
      bold: st.bold || tag === 'strong' || tag === 'b' || tag === 'th',
      italic: st.italic || tag === 'em' || tag === 'i',
      code: st.code || tag === 'code',
      underline: st.underline || tag === 'u' || tag === 'a',
    };
    inlineRuns(e, next, out);
  });
  return out;
}

/** Flatten sanitized HTML into a linear block list. */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: Block[] = [];
  const pushPara = (el: Element, extra: Partial<Extract<Block, { kind: 'para' }>> = {}) => {
    const runs = inlineRuns(el);
    // pull images out of paragraphs as their own blocks
    el.querySelectorAll('img').forEach((img) => { const src = img.getAttribute('src'); if (src) blocks.push({ kind: 'image', src }); });
    if (runs.some((r) => r.text.trim())) blocks.push({ kind: 'para', runs, ...extra });
  };
  const walk = (el: Element, indent: number, quote: boolean) => {
    for (const n of [...el.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.textContent ?? '').trim();
        if (t) blocks.push({ kind: 'para', runs: [{ text: t }], indent, quote });
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const e = n as HTMLElement;
      const tag = e.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) blocks.push({ kind: 'heading', level: Number(tag[1]), runs: inlineRuns(e) });
      else if (tag === 'p') pushPara(e, { indent, quote });
      else if (tag === 'pre') blocks.push({ kind: 'pre', text: e.textContent ?? '' });
      else if (tag === 'hr' || (tag === 'div' && e.hasAttribute('data-page-break')))
        blocks.push({ kind: e.hasAttribute('data-page-break') ? 'pagebreak' : 'hr' });
      else if (tag === 'img') { const src = e.getAttribute('src'); if (src) blocks.push({ kind: 'image', src }); }
      else if (tag === 'blockquote') walk(e, indent, true);
      else if (tag === 'ul' || tag === 'ol') {
        let i = 1;
        for (const li of [...e.children].filter((c) => c.tagName.toLowerCase() === 'li')) {
          const bullet = tag === 'ol' ? `${i++}.` : '•';
          // li text (excluding nested lists) first, then nested lists
          const clone = li.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('ul, ol').forEach((x) => x.remove());
          const runs = inlineRuns(clone);
          blocks.push({ kind: 'para', runs: runs.length ? runs : [{ text: '' }], indent: indent + 1, quote, bullet });
          for (const sub of [...li.children].filter((c) => /^(ul|ol)$/i.test(c.tagName))) walk(li, indent + 1, quote), void sub;
          // (walk(li) re-visits nested lists only — paragraphs/text inside li were consumed above)
        }
      } else if (tag === 'table') {
        const rows: string[][] = [];
        let header = false;
        e.querySelectorAll('tr').forEach((tr, ri) => {
          const cells = [...tr.children].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
          if (ri === 0 && [...tr.children].every((c) => c.tagName.toLowerCase() === 'th')) header = true;
          rows.push(cells);
        });
        if (rows.length) blocks.push({ kind: 'table', rows, header });
      } else if (tag === 'li') {
        // stray li (reached through the nested-list re-walk): only descend into its lists
        for (const sub of [...e.children].filter((c) => /^(ul|ol)$/i.test(c.tagName))) walk(e, indent, quote), void sub;
      } else walk(e, indent, quote); // div/section/span/… → transparent container
    }
  };
  walk(doc.body, 0, false);
  return blocks;
}

// ---------- page rendering (lib/docPaint: canvas raster OR pdf-lib embedded-font text) ----------

const toBlob = (c: HTMLCanvasElement, mime: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), mime, q));

export type PdfTextMode = 'text' | 'raster';

/**
 * HTML → PDF. 'text' embeds subsetted Noto CJK fonts (selectable text; needs the network once —
 * falls back to raster on failure); 'raster' paints A4 canvases (offline, not selectable).
 */
export async function htmlToPdf(html: string, title: string, onProgress?: (p: number) => void, mode: PdfTextMode = 'raster', style: DocPageStyle = {}): Promise<Blob> {
  const blocks = htmlToBlocks(html);
  const st = pageStyleOf(style);
  if (mode === 'text') {
    try {
      const { renderPdfBlob } = await import('./docPaint');
      return await renderPdfBlob(blocks, title, htmlToText(html), st, onProgress);
    } catch (e) {
      console.warn('[doc pdf] embedded-font mode failed — falling back to raster pages', e);
    }
  }
  const { renderCanvases } = await import('./docPaint');
  const pages = await renderCanvases(blocks, st, (p) => onProgress?.(p * 0.6));
  const specs: PageSpec[] = [];
  for (const c of pages) {
    const blob = await toBlob(c, 'image/jpeg', 0.92);
    c.width = c.height = 0;
    specs.push({ kind: 'image', blob, width: st.width ?? A4[0], height: st.height ?? A4[1], rotate: 0 });
  }
  return buildPdf(specs, { title, onProgress: (p) => onProgress?.(0.6 + p * 0.4) });
}

/** HTML → PNG page images (single page → PNG, several → ZIP). */
export async function htmlToPngs(html: string, base: string, onProgress?: (p: number) => void, style: DocPageStyle = {}): Promise<{ blob: Blob; multi: boolean }> {
  const { renderCanvases } = await import('./docPaint');
  const pages = await renderCanvases(htmlToBlocks(html), pageStyleOf(style), onProgress);
  if (pages.length === 1) { const b = await toBlob(pages[0], 'image/png'); return { blob: b, multi: false }; }
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i < pages.length; i++) {
    entries[`${base}_p${String(i + 1).padStart(3, '0')}.png`] = new Uint8Array(await (await toBlob(pages[i], 'image/png')).arrayBuffer());
    pages[i].width = pages[i].height = 0;
  }
  return { blob: new Blob([zipSync(entries, { level: 0 }).slice()], { type: 'application/zip' }), multi: true };
}

// ---------- docx writer ----------

async function dataUrlToImage(src: string): Promise<{ data: Uint8Array; type: 'png' | 'jpg'; width: number; height: number } | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    let { width, height } = bmp;
    bmp.close();
    let data: Uint8Array;
    let type: 'png' | 'jpg';
    if (blob.type === 'image/jpeg') { data = new Uint8Array(await blob.arrayBuffer()); type = 'jpg'; }
    else if (blob.type === 'image/png') { data = new Uint8Array(await blob.arrayBuffer()); type = 'png'; }
    else {
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d')!.drawImage(await createImageBitmap(blob), 0, 0);
      data = new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer());
      type = 'png';
    }
    const maxW = 600;
    if (width > maxW) { height = Math.round(height * (maxW / width)); width = maxW; }
    return { data, type, width, height };
  } catch { return null; }
}

/** HTML → .docx via the `docx` library (headings, runs, bullets, tables, images, code). */
export async function htmlToDocx(html: string, title: string): Promise<Blob> {
  const D = await docxLib();
  const blocks = htmlToBlocks(html);
  const children: (InstanceType<typeof D.Paragraph> | InstanceType<typeof D.Table>)[] = [];
  const runsOf = (runs: Run[]) => runs.flatMap((r) => r.text.split('\n').flatMap((t, i) => [
    ...(i > 0 ? [new D.TextRun({ break: 1 })] : []),
    new D.TextRun({ text: t, bold: r.bold, italics: r.italic, underline: r.underline ? {} : undefined, font: r.code ? 'Consolas' : undefined }),
  ]));
  const HEAD = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  for (const b of blocks) {
    if (b.kind === 'heading') children.push(new D.Paragraph({ heading: HEAD[Math.min(5, b.level - 1)], children: runsOf(b.runs) }));
    else if (b.kind === 'para') {
      children.push(new D.Paragraph({
        children: runsOf(b.bullet && b.bullet !== '•' ? [{ text: `${b.bullet} ` }, ...b.runs] : b.runs),
        bullet: b.bullet === '•' ? { level: Math.max(0, (b.indent ?? 1) - 1) } : undefined,
        indent: b.quote ? { left: 720 } : b.bullet && b.bullet !== '•' ? { left: 720 * Math.max(1, b.indent ?? 1) } : undefined,
        border: b.quote ? { left: { style: D.BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } } : undefined,
        spacing: { after: 120 },
      }));
    } else if (b.kind === 'pre') {
      for (const line of b.text.replace(/\n$/, '').split('\n')) {
        children.push(new D.Paragraph({ children: [new D.TextRun({ text: line || ' ', font: 'Consolas', size: 18 })], shading: { type: D.ShadingType.CLEAR, fill: 'F3F3F3' }, spacing: { after: 0 } }));
      }
      children.push(new D.Paragraph({ text: '' }));
    } else if (b.kind === 'pagebreak') {
      children.push(new D.Paragraph({ pageBreakBefore: true, text: '' }));
    } else if (b.kind === 'hr') {
      children.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } }, text: '' }));
    } else if (b.kind === 'image') {
      const img = await dataUrlToImage(b.src);
      if (img) children.push(new D.Paragraph({ children: [new D.ImageRun({ data: img.data, type: img.type, transformation: { width: img.width, height: img.height } })] }));
    } else if (b.kind === 'table') {
      const cols = Math.max(...b.rows.map((r) => r.length), 1);
      children.push(new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        rows: b.rows.map((r, ri) => new D.TableRow({
          tableHeader: b.header && ri === 0,
          children: Array.from({ length: cols }, (_, ci) => new D.TableCell({
            children: [new D.Paragraph({ children: [new D.TextRun({ text: r[ci] ?? '', bold: b.header && ri === 0 })] })],
            shading: b.header && ri === 0 ? { type: D.ShadingType.CLEAR, fill: 'EEF1F8' } : undefined,
          })),
        })),
      }));
      children.push(new D.Paragraph({ text: '' }));
    }
  }
  const doc = new D.Document({ title, creator: 'MorphKit', sections: [{ children }] });
  return D.Packer.toBlob(doc);
}

// ---------- sheets ----------

function csvOf(rows: unknown[][], X: Awaited<ReturnType<typeof xlsx>>, sep = ','): string {
  return X.utils.sheet_to_csv(X.utils.aoa_to_sheet(rows), { FS: sep });
}

export async function sheetsToXlsx(s: SheetInfo): Promise<Blob> {
  const X = await xlsx();
  const wb = X.utils.book_new();
  for (const n of s.names) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(s.rows[n]), n.slice(0, 31));
  const out = X.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** first sheet → CSV; several → ZIP of CSVs */
export async function sheetsToCsv(s: SheetInfo, base: string): Promise<{ blob: Blob; multi: boolean }> {
  const X = await xlsx();
  if (s.names.length === 1) return { blob: new Blob([csvOf(s.rows[s.names[0]], X)], { type: 'text/csv;charset=utf-8' }), multi: false };
  const entries: Record<string, Uint8Array> = {};
  for (const n of s.names) entries[`${base}_${n.replace(/[\\/:*?"<>|]/g, '_')}.csv`] = new TextEncoder().encode(csvOf(s.rows[n], X));
  return { blob: new Blob([zipSync(entries, { level: 0 }).slice()], { type: 'application/zip' }), multi: true };
}

export function sheetsToJson(s: SheetInfo): Blob {
  const toObjs = (rows: unknown[][]) => {
    const [h, ...body] = rows;
    if (!h) return [];
    return body.map((r) => Object.fromEntries(h.map((k, i) => [String(k ?? `col${i + 1}`), r[i] ?? null])));
  };
  const v = s.names.length === 1 ? toObjs(s.rows[s.names[0]]) : Object.fromEntries(s.names.map((n) => [n, toObjs(s.rows[n])]));
  return new Blob([JSON.stringify(v, null, 2)], { type: 'application/json' });
}

export function rowsToMarkdown(rows: unknown[][]): string {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const line = (r: unknown[]) => `| ${Array.from({ length: cols }, (_, i) => cell(r[i])).join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') + '\n';
}

async function jsonRows(file: File): Promise<unknown[][]> {
  const v = JSON.parse(await file.text()) as unknown;
  if (Array.isArray(v) && v.every((r) => Array.isArray(r))) return v as unknown[][];
  if (Array.isArray(v) && v.every((r) => r && typeof r === 'object')) {
    const keys = [...new Set(v.flatMap((r) => Object.keys(r as object)))];
    return [keys, ...v.map((r) => keys.map((k) => { const x = (r as Record<string, unknown>)[k]; return x != null && typeof x === 'object' ? JSON.stringify(x) : x; }))];
  }
  throw new Error('json shape');
}

// ---------- the converter entry point ----------

export interface ConvertDocOpts {
  /** PDF output: embed CJK fonts for selectable text (settings.docPdfText) */
  pdfText?: boolean;
  pageSize?: 'a4' | 'letter';
  fontSize?: number;
}

interface DocPageStyle { pageSize?: 'a4' | 'letter'; fontSize?: number; width?: number; height?: number }
function pageStyleOf(o: DocPageStyle): { width?: number; height?: number; fontSize?: number } {
  const dims = o.pageSize === 'letter' ? LETTER : o.pageSize === 'a4' ? A4 : undefined;
  return { ...(dims ? { width: dims[0], height: dims[1] } : {}), ...(o.fontSize ? { fontSize: o.fontSize } : {}) };
}

/** Convert a document to `target`. Returns the blob and whether it is a multi-file ZIP. */
export async function convertDoc(file: File, target: string, onProgress?: (p: number) => void, opts: ConvertDocOpts = {}): Promise<{ blob: Blob; multi: boolean }> {
  const t = docTypeOf(file);
  const base = file.name.replace(/\.[^.]+$/, '');
  const one = (blob: Blob) => ({ blob, multi: false });

  // spreadsheet-ish sources have their own fast paths (no HTML detour for data formats)
  if (t === 'sheet' || t === 'json') {
    const s: SheetInfo = t === 'json'
      ? { names: [base], rows: { [base]: await jsonRows(file) } }
      : await readSheets(file);
    if (target === 'xlsx') return one(await sheetsToXlsx(s));
    if (target === 'csv') return sheetsToCsv(s, base);
    if (target === 'json') return one(sheetsToJson(s));
    if (target === 'md') return one(new Blob([s.names.map((n) => (s.names.length > 1 ? `## ${n}\n\n` : '') + rowsToMarkdown(s.rows[n])).join('\n')], { type: 'text/markdown' }));
  }

  const html = await docToHtml(file);
  onProgress?.(0.15);
  const prog = (p: number) => onProgress?.(0.15 + p * 0.85);
  switch (target) {
    case 'html': return one(new Blob([wrapHtmlDocument(html, base)], { type: 'text/html;charset=utf-8' }));
    case 'md': return one(new Blob([await htmlToMarkdown(html)], { type: 'text/markdown;charset=utf-8' }));
    case 'txt': return one(new Blob([htmlToText(html)], { type: 'text/plain;charset=utf-8' }));
    case 'docx': return one(await htmlToDocx(html, base));
    case 'pptx': {
      const { blocksToPptx } = await import('./pptx');
      return one(await blocksToPptx(htmlToBlocks(html), base));
    }
    case 'pdf': return one(await htmlToPdf(html, base, prog, opts.pdfText ? 'text' : 'raster', opts));
    case 'png': return htmlToPngs(html, base, prog, opts);
    default: throw new Error(`unsupported doc target ${target}`);
  }
}

// ---------- editor bridge ----------

export type EditMode = 'md' | 'text' | 'html' | 'csv' | 'json';

/** What the DocEditor edits for a given file, plus how it renders/saves. */
export async function docEditSource(file: File): Promise<{ mode: EditMode; text: string; sheetName?: string }> {
  const t = docTypeOf(file);
  if (t === 'docx' || t === 'pptx') return { mode: 'md', text: await htmlToMarkdown(await docToHtml(file)) };
  if (t === 'md') return { mode: 'md', text: await file.text() };
  if (t === 'html') return { mode: 'html', text: await file.text() };
  if (t === 'json') return { mode: 'json', text: await file.text() };
  if (t === 'sheet') {
    const s = await readSheets(file);
    const X = await xlsx();
    return { mode: 'csv', text: csvOf(s.rows[s.names[0]], X), sheetName: s.names[0] };
  }
  // plain text edits as Markdown (preview renders headings/lists); saving keeps the .txt bytes verbatim
  return { mode: 'md', text: await file.text() };
}

/** Preview HTML for the editor pane. */
export async function previewHtml(mode: EditMode, text: string): Promise<string> {
  if (mode === 'md') return markdownToHtml(text);
  if (mode === 'html') return sanitizeHtml(text);
  if (mode === 'json') return jsonToHtml(text);
  if (mode === 'csv') {
    const X = await xlsx();
    const wb = X.read(text, { type: 'string' });
    return rowsToTable(X.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }));
  }
  return textToHtml(text);
}

/** Save edited text back in the ORIGINAL file's format (docx / xlsx are re-generated). */
export async function docSave(original: File, mode: EditMode, text: string, sheetName?: string): Promise<File> {
  const t = docTypeOf(original);
  const name = original.name;
  if (t === 'docx') return new File([await htmlToDocx(await markdownToHtml(text), name.replace(/\.docx$/i, ''))], name, { type: original.type });
  if (t === 'pptx') {
    const { blocksToPptx } = await import('./pptx');
    return new File([await blocksToPptx(htmlToBlocks(await markdownToHtml(text)), name.replace(/\.pptx$/i, ''))], name, { type: original.type });
  }
  if (t === 'sheet' && !/\.(csv|tsv)$/i.test(name)) {
    const X = await xlsx();
    const wb = X.read(text, { type: 'string' });
    const rows = X.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
    const s = await readSheets(original);
    s.rows[sheetName ?? s.names[0]] = rows;
    return new File([await sheetsToXlsx(s)], name, { type: original.type });
  }
  return new File([text], name, { type: original.type || 'text/plain' });
}

export type { DocType };
