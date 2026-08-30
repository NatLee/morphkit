import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { ImageEditor } from './ImageEditor';
import {
  A4,
  buildPdf,
  closePdf,
  imagePageSize,
  isPdfFile,
  openPdf,
  pageInfo,
  renderPage,
  type PageSpec,
} from '../lib/pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Item } from '../types';

/**
 * PDF page editor — ScreenToGif-style page strip for documents.
 * Every page is a `PPage` pointing at a SOURCE (a loaded PDF + index, an image blob, or
 * nothing = blank). Ops (delete / duplicate / reorder / rotate / insert from PDF+images /
 * rasterize-and-paint via ImageEditor) rewrite the page list; nothing is baked until Save,
 * when `buildPdf` assembles the specs with pdf-lib. Thumbnails render lazily one at a time.
 */

type Rot = 0 | 90 | 180 | 270;

type PageSrc =
  | { kind: 'pdf'; doc: string; index: number }
  | { kind: 'image'; blob: Blob }
  | { kind: 'blank' };

interface PPage {
  id: number;
  src: PageSrc;
  /** extra clockwise rotation (export-time) */
  rotate: Rot;
  /** page size in points, unrotated (before `rotate`) */
  w: number;
  h: number;
  /** dataURL thumbnail, rendered WITH `rotate` applied (re-rendered on rotate) */
  thumb?: string;
}

interface SrcDoc {
  bytes: ArrayBuffer;
  proxy: PDFDocumentProxy;
}

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose: () => void;
}

const THUMB_W = 168;
/** rasterized page edits: longest edge in px */
const EDIT_MAX = 2200;

let pageUid = 0;
let docUid = 0;

export function PdfEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const docsRef = useRef<Map<string, SrcDoc>>(new Map());
  const [pages, setPages] = useState<PPage[]>([]);
  const pagesRef = useRef<PPage[]>([]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ pageId: number; file: File; w: number; h: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [addAt, setAddAt] = useState<number | null>(null);

  // ---- load a PDF file into the doc store, return its page list ----
  const loadPdfPages = useCallback(async (file: File): Promise<PPage[]> => {
    const bytes = await file.arrayBuffer();
    const proxy = await openPdf(bytes);
    const key = `d${++docUid}`;
    docsRef.current.set(key, { bytes, proxy });
    const out: PPage[] = [];
    for (let i = 0; i < proxy.numPages; i++) {
      const info = await pageInfo(proxy, i);
      out.push({ id: ++pageUid, src: { kind: 'pdf', doc: key, index: i }, rotate: 0, w: info.width, h: info.height });
    }
    return out;
  }, []);

  const imagePages = useCallback(async (file: File): Promise<PPage[]> => {
    const bmp = await createImageBitmap(file);
    const [w, h] = imagePageSize(bmp.width, bmp.height);
    bmp.close();
    return [{ id: ++pageUid, src: { kind: 'image', blob: file }, rotate: 0, w, h }];
  }, []);

  // initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await loadPdfPages(item.file);
        if (!alive) return;
        setPages(p);
        setLoaded(true);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
      for (const d of docsRef.current.values()) void closePdf(d.proxy);
      docsRef.current.clear();
    };
  }, [item.file, loadPdfPages]);

  // ---- lazy thumbnails: one at a time, always the first page missing one ----
  const thumbBusy = useRef(false);
  useEffect(() => {
    if (thumbBusy.current) return;
    const target = pages.find((p) => !p.thumb);
    if (!target) return;
    thumbBusy.current = true;
    (async () => {
      let thumb = '';
      try {
        thumb = await renderThumb(target, docsRef.current);
      } catch {
        thumb = blankThumb(target.w, target.h);
      }
      thumbBusy.current = false;
      setPages((prev) => prev.map((p) => (p.id === target.id ? { ...p, thumb } : p)));
    })();
  }, [pages]);

  // ---- helpers ----
  const selectedIdx = () => pagesRef.current.map((p, i) => (sel.has(p.id) ? i : -1)).filter((i) => i >= 0);
  const insertPos = () => {
    const idx = selectedIdx();
    return idx.length ? idx[idx.length - 1] + 1 : pagesRef.current.length;
  };

  const clickPage = (e: React.MouseEvent, idx: number) => {
    const id = pages[idx].id;
    if (e.shiftKey && anchor != null) {
      const a = pages.findIndex((p) => p.id === anchor);
      const [lo, hi] = a < idx ? [a, idx] : [idx, a];
      setSel(new Set(pages.slice(lo, hi + 1).map((p) => p.id)));
    } else if (e.ctrlKey || e.metaKey) {
      const n = new Set(sel);
      if (n.has(id)) n.delete(id); else n.add(id);
      setSel(n);
      setAnchor(id);
    } else {
      setSel(new Set([id]));
      setAnchor(id);
    }
  };
  const togglePage = (id: number) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSel(n);
    setAnchor(id);
  };

  const rotateSel = (d: 90 | -90) =>
    setPages((prev) => prev.map((p) => (sel.has(p.id) ? { ...p, rotate: (((p.rotate + d) % 360 + 360) % 360) as Rot, thumb: undefined } : p)));

  const deleteSel = () => {
    setPages((prev) => prev.filter((p) => !sel.has(p.id)));
    setSel(new Set());
  };

  const duplicateSel = () => {
    const next: PPage[] = [];
    const ids: number[] = [];
    for (const p of pages) {
      next.push(p);
      if (sel.has(p.id)) {
        const c = { ...p, id: ++pageUid };
        next.push(c);
        ids.push(c.id);
      }
    }
    setPages(next);
    setSel(new Set(ids));
  };

  const moveSel = (dir: -1 | 1) => {
    const idx = selectedIdx();
    if (!idx.length) return;
    const arr = [...pages];
    if (dir < 0) {
      for (const i of idx) {
        if (i === 0 || sel.has(arr[i - 1].id)) continue;
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      }
    } else {
      for (const i of [...idx].reverse()) {
        if (i === arr.length - 1 || sel.has(arr[i + 1].id)) continue;
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      }
    }
    setPages(arr);
  };

  const addBlank = () => {
    const ref = pages.find((p) => sel.has(p.id)) ?? pages[0];
    const [w, h] = ref ? [ref.w, ref.h] : A4;
    const pg: PPage = { id: ++pageUid, src: { kind: 'blank' }, rotate: 0, w, h, thumb: blankThumb(w, h) };
    const at = insertPos();
    setPages((prev) => [...prev.slice(0, at), pg, ...prev.slice(at)]);
    setSel(new Set([pg.id]));
  };

  const pickFiles = (at: number | null) => {
    setAddAt(at);
    fileRef.current?.click();
  };

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const added: PPage[] = [];
      for (const f of files) {
        try {
          added.push(...(isPdfFile(f) ? await loadPdfPages(f) : await imagePages(f)));
        } catch { /* skip undecodable file */ }
      }
      if (added.length) {
        const at = addAt ?? insertPos();
        setPages((prev) => [...prev.slice(0, at), ...added, ...prev.slice(at)]);
        setSel(new Set(added.map((p) => p.id)));
      }
    } finally {
      setBusy(false);
      setAddAt(null);
    }
  };

  // ---- rasterize + paint one page in the ImageEditor ----
  const editPage = async () => {
    const idx = selectedIdx();
    if (idx.length !== 1) return;
    const p = pages[idx[0]];
    setBusy(true);
    try {
      const canvas = await renderFull(p, docsRef.current, EDIT_MAX);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) return;
      const rotated = p.rotate === 90 || p.rotate === 270;
      const [w, h] = rotated ? [p.h, p.w] : [p.w, p.h];
      setEditing({ pageId: p.id, file: new File([blob], `page-${idx[0] + 1}.png`, { type: 'image/png' }), w, h });
    } catch { /* render failed */ } finally {
      setBusy(false);
    }
  };

  // pseudo-Item for the ImageEditor — memoized so its init effect runs once (invariant 15)
  const editItem = useMemo<Item | null>(
    () => (editing ? { id: `pdfpage-${editing.pageId}`, file: editing.file, kind: 'image', target: 'png', quality: 1, status: 'ready', progress: 0 } : null),
    [editing]
  );
  const onPageEdited = (_id: string, file: File) => {
    if (!editing) return;
    const { pageId, w, h } = editing;
    // the raster already includes the rotation → page becomes an upright image page
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, src: { kind: 'image', blob: file }, rotate: 0, w, h, thumb: undefined } : p)));
    setEditing(null);
  };

  // ---- mouse drag reorder (touch uses the move buttons; the grid must stay scrollable) ----
  const onThumbDown = (e: React.PointerEvent, idx: number) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      if (!started) { started = true; setDragIdx(idx); }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-idx]');
      setOverIdx(hit ? Number(hit.dataset.idx) : null);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (started) {
        const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-idx]');
        const to = hit ? Number(hit.dataset.idx) : null;
        if (to != null && to !== idx) {
          setPages((prev) => {
            const arr = [...prev];
            const [pg] = arr.splice(idx, 1);
            arr.splice(to, 0, pg);
            return arr;
          });
        }
      }
      setDragIdx(null);
      setOverIdx(null);
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // ---- export ----
  const save = async () => {
    if (!pages.length) return;
    setBusy(true);
    setProg(0);
    try {
      const specs: PageSpec[] = pages.map((p) => {
        if (p.src.kind === 'pdf') return { kind: 'pdf', bytes: docsRef.current.get(p.src.doc)!.bytes, index: p.src.index, rotate: p.rotate };
        if (p.src.kind === 'image') return { kind: 'image', blob: p.src.blob, width: p.w, height: p.h, rotate: p.rotate };
        return { kind: 'blank', width: p.w, height: p.h, rotate: p.rotate };
      });
      const blob = await buildPdf(specs, setProg);
      const name = item.file.name.replace(/\.pdf$/i, '') + '_edited.pdf';
      onSave(item.id, new File([blob], name, { type: 'application/pdf' }));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  // keyboard: Delete removes, Escape closes (unless painting a page)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); deleteSel(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(new Set(pages.map((p) => p.id))); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, pages, editing]);

  const nSel = sel.size;
  const Icon = ({ d }: { d: string }) => (
    <svg viewBox="0 0 24 24" width="14" height="14"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );

  const body = (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor editor-wide pdf-editor" role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="ed-toolbar pdf-tools">
          <button className="btn btn-ghost btn-sm" disabled={busy || !loaded} onClick={() => pickFiles(null)} title={t('pdfAddFilesTip')}>
            <Icon d="M12 5v14M5 12h14" />{t('pdfAddFiles')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !loaded} onClick={addBlank}>
            <Icon d="M6 3h8l5 5v13H6zM14 3v5h5" />{t('pdfBlank')}
          </button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => rotateSel(-90)} title={t('pdfRotL')}>
            <Icon d="M4 10a8 8 0 1 1 2.3 7.7M4 4v6h6" />
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => rotateSel(90)} title={t('pdfRotR')}>
            <Icon d="M20 10a8 8 0 1 0-2.3 7.7M20 4v6h-6" />
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => moveSel(-1)} title={t('pdfMoveL')}>
            <Icon d="M15 6l-6 6 6 6" />
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => moveSel(1)} title={t('pdfMoveR')}>
            <Icon d="M9 6l6 6-6 6" />
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={duplicateSel} title={t('pdfDup')}>
            <Icon d="M9 9h11v11H9zM4 15V4h11" />
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || nSel !== 1} onClick={() => void editPage()} title={t('pdfEditPageTip')}>
            <Icon d="M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3" />{t('pdfEditPage')}
          </button>
          <button className="btn btn-ghost btn-sm pdf-del" disabled={busy || !nSel} onClick={deleteSel} title={t('pdfDelete')}>
            <Icon d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" />
          </button>
          <span className="opt-spacer" />
          <button className="btn btn-ghost btn-sm" disabled={!pages.length} onClick={() => setSel(new Set(pages.map((p) => p.id)))}>
            {t('pdfSelectAll')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!nSel} onClick={() => setSel(new Set())}>
            {t('pdfSelectNone')}
          </button>
        </div>

        <div className="pdf-grid" role="listbox" aria-multiselectable="true">
          {!loaded && !error && <p className="pdf-status"><span className="spinner" /> {t('pdfLoading')}</p>}
          {error && <p className="pdf-status danger">{t('pdfLoadError')}</p>}
          {loaded && !pages.length && <p className="pdf-status">{t('pdfEmpty')}</p>}
          {pages.map((p, i) => {
            const rotated = p.rotate === 90 || p.rotate === 270;
            // thumb is pre-rotated; the box just needs the rotated aspect
            const ratio = rotated ? p.w / p.h : p.h / p.w;
            const cls = [
              'pdf-page',
              sel.has(p.id) ? 'sel' : '',
              dragIdx === i ? 'dragging' : '',
              overIdx === i && dragIdx !== null && dragIdx !== i ? (dragIdx < i ? 'over-after' : 'over-before') : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={p.id}
                className={cls}
                data-idx={i}
                role="option"
                aria-selected={sel.has(p.id)}
                onClick={(e) => clickPage(e, i)}
                onDoubleClick={() => { setSel(new Set([p.id])); void editPage(); }}
                onPointerDown={(e) => onThumbDown(e, i)}
              >
                <div className="pdf-thumb" style={{ aspectRatio: `1 / ${ratio}` }}>
                  {p.thumb ? (
                    <img src={p.thumb} alt="" draggable={false} />
                  ) : (
                    <span className="spinner" />
                  )}
                  {p.src.kind !== 'pdf' && <span className="pdf-badge">{p.src.kind === 'image' ? t('pdfBadgeImage') : t('pdfBadgeBlank')}</span>}
                  {p.rotate !== 0 && <span className="pdf-badge rot">{p.rotate}°</span>}
                </div>
                <div className="pdf-page-foot">
                  <button
                    className={`pdf-check${sel.has(p.id) ? ' on' : ''}`}
                    onClick={(e) => { e.stopPropagation(); togglePage(p.id); }}
                    aria-label={t('pdfToggleSelect')}
                  >
                    {sel.has(p.id) && <svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </button>
                  <span className="pdf-num">{i + 1}</span>
                  <button className="pdf-ins" onClick={(e) => { e.stopPropagation(); pickFiles(i + 1); }} title={t('pdfInsertAfter')} aria-label={t('pdfInsertAfter')}>
                    <svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {busy && prog > 0 && (
          <div className="fc-progress-row pdf-progress">
            <div className="fc-progress"><div className="fc-bar" style={{ width: `${Math.round(prog * 100)}%` }} /></div>
            <span className="fc-pct">{Math.round(prog * 100)}%</span>
          </div>
        )}

        <div className="ed-foot">
          <span className="ed-hint">
            {busy ? t('processing') : t('pdfSummary', { n: String(pages.length), sel: String(nSel) })}
            <span className="kbd-hints"> · {t('pdfDragHint')}</span>
          </span>
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={() => void save()} disabled={busy || !loaded || !pages.length}>
              {busy ? t('processing') : t('pdfSave')}
            </button>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept="application/pdf,.pdf,image/*"
          onChange={(e) => { void onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        />
      </div>
    </div>
  );

  // the ImageEditor sits OUTSIDE the overlay: it portals to body too, and React would
  // bubble its synthetic clicks into our backdrop onClose otherwise
  return createPortal(
    <>
      {body}
      {editItem && <ImageEditor item={editItem} onSave={onPageEdited} onClose={() => setEditing(null)} />}
    </>,
    document.body
  );
}

// ---------- rendering helpers ----------

function blankCanvas(w: number, h: number, scale = THUMB_W / w): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function blankThumb(w: number, h: number): string {
  return blankCanvas(w, h).toDataURL('image/png');
}

async function drawImageTo(blob: Blob, maxW: number, maxDim?: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  let s = maxW / bmp.width;
  if (maxDim) s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

/** Rotate a canvas clockwise by 0/90/180/270 (returns the input when 0). */
function rotateCanvas(c: HTMLCanvasElement, rot: Rot): HTMLCanvasElement {
  if (!rot) return c;
  const side = rot === 90 || rot === 270;
  const r = document.createElement('canvas');
  r.width = side ? c.height : c.width;
  r.height = side ? c.width : c.height;
  const ctx = r.getContext('2d')!;
  ctx.translate(r.width / 2, r.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  c.width = c.height = 0;
  return r;
}

async function renderThumb(p: PPage, docs: Map<string, SrcDoc>): Promise<string> {
  let c: HTMLCanvasElement;
  if (p.src.kind === 'pdf') {
    c = await renderPage(docs.get(p.src.doc)!.proxy, p.src.index, { width: THUMB_W, rotate: p.rotate });
  } else {
    const base = p.src.kind === 'image' ? await drawImageTo(p.src.blob, THUMB_W) : blankCanvas(p.w, p.h);
    c = rotateCanvas(base, p.rotate);
  }
  const url = c.toDataURL('image/jpeg', 0.8);
  c.width = c.height = 0;
  return url;
}

/** Full-res raster of a page WITH its extra rotation baked in (for the paint round-trip). */
async function renderFull(p: PPage, docs: Map<string, SrcDoc>, maxDim: number): Promise<HTMLCanvasElement> {
  let c: HTMLCanvasElement;
  if (p.src.kind === 'pdf') {
    c = await renderPage(docs.get(p.src.doc)!.proxy, p.src.index, { scale: 2, maxDim, rotate: p.rotate });
    return c;
  }
  if (p.src.kind === 'image') c = await drawImageTo(p.src.blob, 0, maxDim);
  else c = blankCanvas(p.w, p.h, Math.min(2, maxDim / Math.max(p.w, p.h)));
  // rotate the raster so the editor shows the page as exported
  return rotateCanvas(c, p.rotate);
}
