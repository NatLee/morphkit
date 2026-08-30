/**
 * PPTX — read via fflate + DOMParser (no library: slides are plain OOXML), write via pptxgenjs
 * (lazy). Reading produces the sanitized-HTML intermediate used by lib/docs, one
 * `<section data-slide>` per slide separated by page breaks, so every doc target (pdf/docx/md/
 * html/txt/png) works on presentations too. Writing splits blocks into slides on h1/h2.
 */
import { unzipSync, strFromU8 } from 'fflate';
import type { Block, Run } from './docs';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Rels { [id: string]: string }

function parseXml(u8: Uint8Array): Document {
  return new DOMParser().parseFromString(strFromU8(u8), 'application/xml');
}
function relsOf(zip: Record<string, Uint8Array>, path: string): Rels {
  const dir = path.slice(0, path.lastIndexOf('/'));
  const name = path.slice(path.lastIndexOf('/') + 1);
  const rels: Rels = {};
  const u8 = zip[`${dir}/_rels/${name}.rels`];
  if (!u8) return rels;
  const doc = parseXml(u8);
  for (const r of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = r.getAttribute('Id');
    let target = r.getAttribute('Target') ?? '';
    if (!id || !target) continue;
    // resolve relative to the part's directory
    if (!target.startsWith('/')) {
      const stack = dir.split('/');
      for (const seg of target.split('/')) {
        if (seg === '..') stack.pop();
        else if (seg !== '.') stack.push(seg);
      }
      target = stack.join('/');
    } else target = target.slice(1);
    rels[id] = target;
  }
  return rels;
}

/** local-name query that tolerates any namespace prefix */
function q(el: Element | Document, name: string): Element[] {
  const out: Element[] = [];
  const walk = (n: Element) => {
    if (n.localName === name) out.push(n);
    for (const c of Array.from(n.children)) walk(c);
  };
  const root = (el as Document).documentElement ?? (el as Element);
  if (root) walk(root as Element);
  return out;
}
const local = (n: Element, name: string): Element | null => Array.from(n.children).find((c) => c.localName === name) ?? null;

function mimeOfMedia(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext] ?? 'application/octet-stream';
}
function toDataUrl(u8: Uint8Array, mime: string): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode(...u8.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** slide paragraph → html: bullets become nested <ul> by indent level */
function shapeHtml(sp: Element, isTitle: boolean): string {
  const paras: { lvl: number; bullet: boolean; html: string }[] = [];
  for (const p of q(sp, 'p')) {
    if (p.localName !== 'p' || p.namespaceURI?.includes('presentationml')) continue;
    const pPr = local(p, 'pPr');
    const lvl = Number(pPr?.getAttribute('lvl') ?? 0);
    const noBullet = !!(pPr && local(pPr, 'buNone'));
    let html = '';
    for (const r of Array.from(p.children)) {
      if (r.localName === 'r') {
        const t = q(r, 't').map((x) => x.textContent ?? '').join('');
        if (!t) continue;
        const rPr = local(r, 'rPr');
        const b = rPr?.getAttribute('b') === '1';
        const i = rPr?.getAttribute('i') === '1';
        html += `${b ? '<strong>' : ''}${i ? '<em>' : ''}${esc(t)}${i ? '</em>' : ''}${b ? '</strong>' : ''}`;
      } else if (r.localName === 'br') html += '<br>';
    }
    if (html.trim()) paras.push({ lvl, bullet: !isTitle && !noBullet, html });
  }
  if (!paras.length) return '';
  if (isTitle) return `<h3>${paras.map((p) => p.html).join(' ')}</h3>`;
  // body text: runs of bullet paragraphs become (nested) lists
  let out = '';
  let depth = -1;
  const closeTo = (d: number) => { while (depth > d) { out += '</ul>'; depth--; } };
  for (const p of paras) {
    if (p.bullet) {
      while (depth < p.lvl) { out += '<ul>'; depth++; }
      closeTo(p.lvl);
      out += `<li>${p.html}</li>`;
    } else {
      closeTo(-1);
      out += `<p>${p.html}</p>`;
    }
  }
  closeTo(-1);
  return out;
}

/** PPTX file → sanitizable HTML (h2 per slide title-less header, page-break markers between slides). */
export async function pptxToHtml(file: File): Promise<string> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const pres = zip['ppt/presentation.xml'];
  if (!pres) throw new Error('not a pptx');
  const presRels = relsOf(zip, 'ppt/presentation.xml');
  const slidePaths = q(parseXml(pres), 'sldId')
    .map((el) => presRels[el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? el.getAttribute('r:id') ?? ''])
    .filter((p): p is string => !!p && p.includes('slides/'));
  const parts: string[] = [];
  slidePaths.forEach((path, si) => {
    const u8 = zip[path];
    if (!u8) return;
    const doc = parseXml(u8);
    const rels = relsOf(zip, path);
    const chunks: string[] = [];
    let sawTitle = false;
    const root = q(doc, 'spTree')[0] ?? doc.documentElement;
    const walkTree = (parent: Element) => {
      for (const node of Array.from(parent.children)) {
        if (node.localName === 'sp') {
          const phType = q(node, 'ph')[0]?.getAttribute('type') ?? '';
          const isTitle = !sawTitle && (phType === 'title' || phType === 'ctrTitle');
          const html = shapeHtml(node, isTitle);
          if (html) { chunks.push(html); if (isTitle) sawTitle = true; }
        } else if (node.localName === 'pic') {
          const embed = q(node, 'blip')[0]?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
          const media = embed ? zip[rels[embed]] : undefined;
          if (media && media.length < 8 * 1024 * 1024) chunks.push(`<p><img src="${toDataUrl(media, mimeOfMedia(rels[embed!]))}"></p>`);
        } else if (node.localName === 'graphicFrame') {
          const tbl = q(node, 'tbl')[0];
          if (tbl) {
            const rows = q(tbl, 'tr').map((tr) =>
              Array.from(tr.children).filter((c) => c.localName === 'tc')
                .map((tc) => q(tc, 't').map((x) => x.textContent ?? '').join(' ')));
            if (rows.length) {
              chunks.push(`<table><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
            }
          }
        } else if (node.localName === 'grpSp') walkTree(node);
      }
    };
    walkTree(root);
    // <hr data-page-break> = slide boundary: hr survives html→md as `---` (Marp-style) and
    // the attribute tells the paginator/docx writer to break the page without drawing a rule
    parts.push(`${si > 0 ? '<hr data-page-break>' : ''}<section data-slide>${chunks.join('\n')}</section>`);
  });
  if (!parts.length) throw new Error('empty pptx');
  return parts.join('\n');
}

// ---------- write (pptxgenjs) ----------

const runsText = (runs: Run[]) => runs.map((r) => r.text).join('').trim();

/** blocks → slides: a heading (h1/h2) starts a new slide and becomes its title. */
export async function blocksToPptx(blocks: Block[], title: string): Promise<Blob> {
  const { default: PptxGen } = await import('pptxgenjs');
  const p = new PptxGen();
  p.defineLayout({ name: 'WIDE', width: 10, height: 5.625 });
  p.layout = 'WIDE';
  p.title = title;

  interface SlideAcc { title: string | null; bullets: { text: string; indent: number; bold?: boolean }[]; tables: string[][][]; images: string[] }
  const slides: SlideAcc[] = [];
  let cur: SlideAcc | null = null;
  const ensure = () => cur ?? (slides.push((cur = { title: null, bullets: [], tables: [], images: [] })), cur);
  for (const b of blocks) {
    if (b.kind === 'heading' && b.level <= 2) {
      slides.push((cur = { title: runsText(b.runs), bullets: [], tables: [], images: [] }));
    } else if (b.kind === 'heading') {
      ensure().bullets.push({ text: runsText(b.runs), indent: 0, bold: true });
    } else if (b.kind === 'para') {
      const t = runsText(b.runs);
      if (t) ensure().bullets.push({ text: b.bullet && b.bullet !== '•' ? `${b.bullet} ${t}` : t, indent: Math.max(0, (b.indent ?? 0) - (b.bullet ? 1 : 0)) + (b.bullet ? Math.max(0, (b.indent ?? 1) - 1) : 0) });
    } else if (b.kind === 'pre') {
      for (const line of b.text.replace(/\n$/, '').split('\n')) ensure().bullets.push({ text: line, indent: 1 });
    } else if (b.kind === 'table') {
      ensure().tables.push(b.rows);
    } else if (b.kind === 'image' && b.src.startsWith('data:')) {
      ensure().images.push(b.src);
    } else if (b.kind === 'pagebreak' || b.kind === 'hr') {
      cur = null; // hr (`---`) is the Markdown idiom for a slide break
    }
  }

  for (const s of slides.length ? slides : [{ title, bullets: [], tables: [], images: [] }]) {
    const slide = p.addSlide();
    let y = 0.4;
    if (s.title) {
      slide.addText(s.title, { x: 0.5, y, w: 9, h: 0.9, fontSize: 28, bold: true });
      y += 1.1;
    }
    if (s.bullets.length) {
      const h = Math.min(4.6 - (y - 0.4), 0.32 * s.bullets.length + 0.2);
      slide.addText(
        s.bullets.map((b, i) => ({ text: b.text, options: { bullet: b.indent >= 0 && !b.bold ? { indent: 12 } : false, indentLevel: Math.min(4, b.indent), bold: b.bold, breakLine: i < s.bullets.length - 1 } })),
        { x: 0.6, y, w: 8.9, h: Math.max(0.5, h), fontSize: 16, valign: 'top' }
      );
      y += Math.max(0.5, h) + 0.15;
    }
    for (const rows of s.tables) {
      const body = rows.map((r) => r.map((c) => ({ text: c })));
      slide.addTable(body, { x: 0.6, y: Math.min(y, 4.6), w: 8.9, fontSize: 12, border: { type: 'solid', color: 'AAB2C8', pt: 0.5 } });
      y += 0.5 + rows.length * 0.3;
    }
    s.images.forEach((src, i) => {
      slide.addImage({ data: src, x: 6.6 - i * 0.3, y: 3.2, w: 2.8, h: 2.1, sizing: { type: 'contain', w: 2.8, h: 2.1 } });
    });
  }
  return (await p.write({ outputType: 'blob' })) as Blob;
}
