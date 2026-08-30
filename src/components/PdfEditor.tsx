import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { zipSync } from 'fflate';
import { useI18n } from '../i18n';
import { ImageEditor } from './ImageEditor';
import { Overlay } from './Overlay';
import { PdfPasswordModal } from './PdfPasswordModal';
import { useSplitter } from '../lib/useSplitter';
import { ColorPicker } from './ColorPicker';
import {
  A4,
  buildPdf,
  closePdf,
  displayToUser,
  displayToUserCanvas,
  drawWatermarkPreview,
  getPlainBytes,
  imagePageSize,
  isPdfFile,
  openPdf,
  pageInfo,
  PdfPasswordError,
  readNotes,
  renderPage,
  sniffEncrypted,
  userToDisplay,
  userToDisplayCanvas,
  watermarkCanvas,
  type PageSpec,
  type PdfNote,
  type Watermark,
} from '../lib/pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Item } from '../types';

/**
 * PDF page editor — page strip + live preview for documents.
 * Every page is a `PPage` pointing at a SOURCE (a loaded PDF + index, an image blob, or
 * nothing = blank) plus non-destructive decorations: extra rotation, display flips, a drawing
 * OVERLAY (transparent PNG kept in page user space — the original vectors/text are never
 * rasterized), sticky notes (real /Text annotations, user-space anchored) and a watermark flag.
 * Nothing is baked until Save, when `buildPdf` assembles the specs with pdf-lib.
 * Encrypted sources: pdf.js opens them with the password for display; export decrypts with
 * qpdf-wasm (`getPlainBytes`) and falls back to rasterized pages when that fails.
 */

type Rot = 0 | 90 | 180 | 270;

type PageSrc =
  | { kind: 'pdf'; doc: string; index: number }
  | { kind: 'image'; blob: Blob }
  | { kind: 'blank' };

interface PPage {
  id: number;
  src: PageSrc;
  /** the source page's own /Rotate (pdf) — 0 otherwise */
  intrinsic: Rot;
  /** extra clockwise rotation (export-time) */
  rotate: Rot;
  flipH: boolean;
  flipV: boolean;
  /** display size in points at rotate 0 (after intrinsic) */
  w: number;
  h: number;
  /** drawing overlay PNG in USER space */
  overlay?: Blob;
  notes: PdfNote[];
  watermark: boolean;
  /** dataURL thumbnail of the page as it will export (re-rendered when anything changes) */
  thumb?: string;
}

interface SrcDoc {
  file: Blob;
  proxy: PDFDocumentProxy;
  password?: string;
  encrypted: boolean;
}

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose?: () => void;
  /** Studio workspace mode: no chrome, save = write back to the asset */
  inline?: boolean;
  /** files pushed in by the Studio asset panel */
  importFiles?: File[] | null;
  onImportDone?: () => void;
}

interface ExportOpts {
  scope: 'all' | 'selected';
  split: boolean;
  title: string;
  author: string;
  encrypt: boolean;
  userPw: string;
  ownerPw: string;
}

const THUMB_W = 168;
/** rasterized page edits / previews: longest edge in px */
const EDIT_MAX = 2200;
const PREVIEW_MAX = 1600;
const HIST_CAP = 40;

const DEFAULT_WM: Watermark = { text: 'CONFIDENTIAL', image: null, opacity: 0.18, angle: 30, scale: 0.6, color: '#ff3366', mode: 'center' };

let pageUid = 0;
let docUid = 0;
const nid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** display-space fractions of a note under the page's current rotation + flips */
function noteDisplay(p: PPage, n: PdfNote): [number, number] {
  const [x, y] = userToDisplay(n.ux, n.uy, p.intrinsic + p.rotate);
  return [p.flipH ? 1 - x : x, p.flipV ? 1 - y : y];
}
function noteFromDisplay(p: PPage, nx: number, ny: number): [number, number] {
  return displayToUser(p.flipH ? 1 - nx : nx, p.flipV ? 1 - ny : ny, p.intrinsic + p.rotate);
}

export function PdfEditor({ item, onSave, onClose, inline, importFiles, onImportDone }: Props) {
  const { t } = useI18n();
  const docsRef = useRef<Map<string, SrcDoc>>(new Map());
  const [pages, setPages] = useState<PPage[]>([]);
  const pagesRef = useRef<PPage[]>([]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [note, setNote] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ pageId: number; file: File; base: HTMLCanvasElement } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wmFileRef = useRef<HTMLInputElement>(null);
  const [addAt, setAddAt] = useState<number | null>(null);
  // preview
  const [previewOpen, setPreviewOpen] = useState(true);
  // desktop: draggable preview width (persisted); .pdf-gutter is hidden ≤760 where the panel stacks
  const prevSplit = useSplitter('morphkit-pdfpw', 400, 280, 800, { invert: true });
  const [zoomed, setZoomed] = useState(false);
  const [preview, setPreview] = useState<{ id: number; url: string; w: number; h: number } | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  // watermark
  const [wm, setWm] = useState<Watermark>(DEFAULT_WM);
  const [wmOpen, setWmOpen] = useState(false);
  // export
  const [exportOpen, setExportOpen] = useState(false);
  const [xo, setXo] = useState<ExportOpts>({ scope: 'all', split: false, title: '', author: '', encrypt: false, userPw: '', ownerPw: '' });
  // password prompts (one at a time)
  const [pwAsk, setPwAsk] = useState<{ file: File; resolve: (pw: string | null) => void } | null>(null);
  // history (page-list snapshots)
  const histRef = useRef<PPage[][]>([]);
  const redoRef = useRef<PPage[][]>([]);
  const [histVer, setHistVer] = useState(0);

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(''), 4000);
  };

  // ---- history ----
  const commit = useCallback((next: PPage[] | ((prev: PPage[]) => PPage[])) => {
    const prev = pagesRef.current;
    const val = typeof next === 'function' ? next(prev) : next;
    histRef.current.push(prev);
    if (histRef.current.length > HIST_CAP) histRef.current.shift();
    redoRef.current = [];
    pagesRef.current = val;
    setPages(val);
    setHistVer((v) => v + 1);
  }, []);
  const undo = () => {
    const prev = histRef.current.pop();
    if (!prev) return;
    redoRef.current.push(pagesRef.current);
    pagesRef.current = prev;
    setPages(prev);
    setSel((s) => new Set([...s].filter((id) => prev.some((p) => p.id === id))));
    setHistVer((v) => v + 1);
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    histRef.current.push(pagesRef.current);
    pagesRef.current = next;
    setPages(next);
    setHistVer((v) => v + 1);
  };

  // ---- password prompt as a promise ----
  const askPassword = (file: File) => new Promise<string | null>((resolve) => setPwAsk({ file, resolve }));

  /** open with retries; returns null when the user cancels */
  const openWithPrompt = async (file: File, bytes: ArrayBuffer): Promise<{ proxy: PDFDocumentProxy; password?: string; encrypted: boolean } | null> => {
    let password: string | undefined;
    for (;;) {
      try {
        const proxy = await openPdf(bytes, password);
        return { proxy, password, encrypted: password != null || await sniffEncrypted(file) };
      } catch (e) {
        if (!(e instanceof PdfPasswordError)) throw e;
        const pw = await askPassword(file);
        if (pw == null) return null;
        password = pw;
      }
    }
  };

  // ---- load a PDF file into the doc store, return its page list ----
  const loadPdfPages = useCallback(async (file: File, password?: string): Promise<PPage[] | null> => {
    const bytes = await file.arrayBuffer();
    let opened: { proxy: PDFDocumentProxy; password?: string; encrypted: boolean } | null;
    if (password != null) {
      opened = { proxy: await openPdf(bytes, password), password, encrypted: true };
    } else {
      opened = await openWithPrompt(file, bytes);
    }
    if (!opened) return null;
    const key = `d${++docUid}`;
    docsRef.current.set(key, { file, proxy: opened.proxy, password: opened.password, encrypted: opened.encrypted });
    const out: PPage[] = [];
    for (let i = 0; i < opened.proxy.numPages; i++) {
      const info = await pageInfo(opened.proxy, i);
      let notes: PdfNote[] = [];
      try { notes = await readNotes(opened.proxy, i); } catch { /* no annots */ }
      out.push({
        id: ++pageUid, src: { kind: 'pdf', doc: key, index: i }, intrinsic: ((info.rotate % 360 + 360) % 360) as Rot,
        rotate: 0, flipH: false, flipV: false, w: info.width, h: info.height, notes, watermark: false,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const imagePages = useCallback(async (file: File): Promise<PPage[]> => {
    const bmp = await createImageBitmap(file);
    const [w, h] = imagePageSize(bmp.width, bmp.height);
    bmp.close();
    return [{ id: ++pageUid, src: { kind: 'image', blob: file }, intrinsic: 0, rotate: 0, flipH: false, flipV: false, w, h, notes: [], watermark: false }];
  }, []);

  // initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await loadPdfPages(item.file, item.pdfPassword);
        if (!alive) return;
        if (!p) { onClose?.(); return; }
        pagesRef.current = p;
        setPages(p);
        setLoaded(true);
        if (p.length) setSel(new Set([p[0].id]));
      } catch {
        if (alive) setError('pdfLoadError');
      }
    })();
    return () => {
      alive = false;
      for (const d of docsRef.current.values()) void closePdf(d.proxy);
      docsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.file, loadPdfPages]);

  // Studio pushes files in through props
  useEffect(() => {
    if (!importFiles?.length || !loaded) return;
    void onFiles(importFiles).then(() => onImportDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importFiles, loaded]);

  // ---- rendering (display space: rotation + flips + overlay + watermark) ----
  const wmArtRef = useRef<{ key: string; art: HTMLCanvasElement | ImageBitmap } | null>(null);
  const wmArt = async (): Promise<HTMLCanvasElement | ImageBitmap> => {
    const key = wm.image ? `img:${wm.image.size}:${wm.image.type}` : `txt:${wm.text}:${wm.color}`;
    if (wmArtRef.current?.key === key) return wmArtRef.current.art;
    const art = wm.image ? await createImageBitmap(wm.image) : watermarkCanvas(wm);
    wmArtRef.current = { key, art };
    return art;
  };

  const renderDisplay = useCallback(async (p: PPage, opts: { width?: number; maxDim?: number; decorate?: boolean }): Promise<HTMLCanvasElement> => {
    let c: HTMLCanvasElement;
    if (p.src.kind === 'pdf') {
      const d = docsRef.current.get(p.src.doc)!;
      c = await renderPage(d.proxy, p.src.index, { width: opts.width, maxDim: opts.maxDim, scale: 2, rotate: p.rotate });
      if (p.flipH || p.flipV) c = userToDisplayCanvas(c, 0, p.flipH, p.flipV);
    } else {
      const base = p.src.kind === 'image'
        ? await drawImageTo(p.src.blob, opts.width ?? 0, opts.maxDim)
        : blankCanvas(p.w, p.h, opts.width ? opts.width / p.w : Math.min(2, (opts.maxDim ?? 2000) / Math.max(p.w, p.h)));
      c = userToDisplayCanvas(base, p.rotate, p.flipH, p.flipV);
    }
    if (opts.decorate === false) return c;
    const ctx = c.getContext('2d')!;
    if (p.overlay) {
      const bmp = await createImageBitmap(p.overlay);
      const disp = userToDisplayCanvas(bmp, p.intrinsic + p.rotate, p.flipH, p.flipV);
      bmp.close();
      ctx.drawImage(disp, 0, 0, c.width, c.height);
    }
    if (p.watermark) drawWatermarkPreview(ctx, c.width, c.height, wm, await wmArt());
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wm]);

  // watermark settings changed → every stamped page re-thumbs; preview follows via deps
  useEffect(() => {
    setPages((prev) => (prev.some((p) => p.watermark) ? prev.map((p) => (p.watermark ? { ...p, thumb: undefined } : p)) : prev));
  }, [wm]);

  // lazy thumbnails: one at a time, always the first page missing one
  const thumbBusy = useRef(false);
  useEffect(() => {
    if (thumbBusy.current) return;
    const target = pages.find((p) => !p.thumb);
    if (!target) return;
    thumbBusy.current = true;
    (async () => {
      let thumb = '';
      try {
        const c = await renderDisplay(target, { width: THUMB_W });
        thumb = c.toDataURL('image/jpeg', 0.8);
        c.width = c.height = 0;
      } catch {
        thumb = blankCanvas(target.w, target.h).toDataURL('image/png');
      }
      thumbBusy.current = false;
      // never touch history for a thumb refresh
      setPages((prev) => prev.map((p) => (p.id === target.id ? { ...p, thumb } : p)));
    })();
  }, [pages, renderDisplay]);

  // preview of the LAST selected page
  const selIdxList = pages.map((p, i) => (sel.has(p.id) ? i : -1)).filter((i) => i >= 0);
  const focusIdx = selIdxList.length ? selIdxList[selIdxList.length - 1] : -1;
  const focusPage = focusIdx >= 0 ? pages[focusIdx] : null;
  const focusKey = focusPage ? `${focusPage.id}:${focusPage.rotate}:${focusPage.flipH}:${focusPage.flipV}:${focusPage.overlay?.size ?? 0}:${focusPage.watermark}` : '';
  useEffect(() => {
    if (!previewOpen || !focusPage) { setPreview(null); return; }
    let alive = true;
    void (async () => {
      try {
        const c = await renderDisplay(focusPage, { maxDim: PREVIEW_MAX });
        if (!alive) return;
        setPreview({ id: focusPage.id, url: c.toDataURL('image/jpeg', 0.86), w: c.width, h: c.height });
        c.width = c.height = 0;
      } catch { /* keep the old preview */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, previewOpen, wm, loaded]);

  // ---- helpers ----
  const insertPos = () => (selIdxList.length ? selIdxList[selIdxList.length - 1] + 1 : pagesRef.current.length);
  const patchSel = (fn: (p: PPage) => Partial<PPage>) =>
    commit((prev) => prev.map((p) => (sel.has(p.id) ? { ...p, ...fn(p), thumb: undefined } : p)));
  const patchPage = (id: number, fn: (p: PPage) => Partial<PPage>, history = true) => {
    const upd = (prev: PPage[]) => prev.map((p) => (p.id === id ? { ...p, ...fn(p) } : p));
    if (history) commit(upd);
    else { pagesRef.current = upd(pagesRef.current); setPages(pagesRef.current); }
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
    setActiveNote(null);
  };
  const togglePage = (id: number) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSel(n);
    setAnchor(id);
  };

  const rotateSel = (d: 90 | -90) => patchSel((p) => ({ rotate: (((p.rotate + d) % 360 + 360) % 360) as Rot }));
  const flipSel = (axis: 'h' | 'v') => patchSel((p) => (axis === 'h' ? { flipH: !p.flipH } : { flipV: !p.flipV }));
  const deleteSel = () => {
    commit((prev) => prev.filter((p) => !sel.has(p.id)));
    setSel(new Set());
  };
  const duplicateSel = () => {
    const ids: number[] = [];
    commit((prev) => {
      const next: PPage[] = [];
      for (const p of prev) {
        next.push(p);
        if (sel.has(p.id)) {
          const c = { ...p, id: ++pageUid, notes: p.notes.map((n) => ({ ...n, id: nid() })) };
          next.push(c);
          ids.push(c.id);
        }
      }
      return next;
    });
    setSel(new Set(ids));
  };
  const moveSel = (dir: -1 | 1) => {
    if (!selIdxList.length) return;
    commit((prev) => {
      const arr = [...prev];
      if (dir < 0) {
        for (const i of selIdxList) {
          if (i === 0 || sel.has(arr[i - 1].id)) continue;
          [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        }
      } else {
        for (const i of [...selIdxList].reverse()) {
          if (i === arr.length - 1 || sel.has(arr[i + 1].id)) continue;
          [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        }
      }
      return arr;
    });
  };
  const reverseAll = () => commit((prev) => [...prev].reverse());
  const addBlank = () => {
    const ref = focusPage ?? pages[0];
    const [w, h] = ref ? [ref.w, ref.h] : A4;
    const pg: PPage = { id: ++pageUid, src: { kind: 'blank' }, intrinsic: 0, rotate: 0, flipH: false, flipV: false, w, h, notes: [], watermark: false };
    const at = insertPos();
    commit((prev) => [...prev.slice(0, at), pg, ...prev.slice(at)]);
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
          const got = isPdfFile(f) ? await loadPdfPages(f) : await imagePages(f);
          if (got) added.push(...got);
        } catch { flash(t('pdfLoadError')); }
      }
      if (added.length) {
        const at = addAt ?? insertPos();
        commit((prev) => [...prev.slice(0, at), ...added, ...prev.slice(at)]);
        setSel(new Set(added.map((p) => p.id)));
      }
    } finally {
      setBusy(false);
      setAddAt(null);
    }
  };

  // ---- notes ----
  const addNoteAt = (nx: number, ny: number) => {
    if (!focusPage) return;
    const [ux, uy] = noteFromDisplay(focusPage, nx, ny);
    const n: PdfNote = { id: nid(), ux, uy, text: '' };
    patchPage(focusPage.id, (p) => ({ notes: [...p.notes, n] }));
    setActiveNote(n.id);
    setNoteMode(false);
  };
  const setNoteText = (id: string, text: string) => {
    if (!focusPage) return;
    patchPage(focusPage.id, (p) => ({ notes: p.notes.map((n) => (n.id === id ? { ...n, text } : n)) }), false);
  };
  const deleteNote = (id: string) => {
    if (!focusPage) return;
    patchPage(focusPage.id, (p) => ({ notes: p.notes.filter((n) => n.id !== id) }));
    setActiveNote(null);
  };
  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // outside note mode a click on the page zooms it to a full-screen lightbox
    if (!noteMode) { setActiveNote(null); setZoomed(true); return; }
    const r = e.currentTarget.getBoundingClientRect();
    addNoteAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  // ---- watermark ----
  const applyWm = (on: boolean, scope: 'all' | 'selected') =>
    commit((prev) => prev.map((p) => (scope === 'all' || sel.has(p.id) ? { ...p, watermark: on, thumb: undefined } : p)));

  // ---- draw on a page (non-destructive overlay via nested ImageEditor) ----
  const editPage = async () => {
    if (!focusPage) return;
    setBusy(true);
    try {
      const base = await renderDisplay(focusPage, { maxDim: EDIT_MAX, decorate: false });
      // the editor shows the page WITH its existing overlay so strokes compose visually
      const shown = document.createElement('canvas');
      shown.width = base.width;
      shown.height = base.height;
      const sctx = shown.getContext('2d')!;
      sctx.drawImage(base, 0, 0);
      if (focusPage.overlay) {
        const bmp = await createImageBitmap(focusPage.overlay);
        sctx.drawImage(userToDisplayCanvas(bmp, focusPage.intrinsic + focusPage.rotate, focusPage.flipH, focusPage.flipV), 0, 0, shown.width, shown.height);
        bmp.close();
      }
      const blob = await new Promise<Blob | null>((r) => shown.toBlob(r, 'image/png'));
      if (!blob) return;
      setEditing({ pageId: focusPage.id, file: new File([blob], `page-${focusIdx + 1}.png`, { type: 'image/png' }), base });
    } catch { flash(t('failed')); } finally {
      setBusy(false);
    }
  };
  // pseudo-Item for the ImageEditor — memoized so its init effect runs once (invariant 15)
  const editItem = useMemo<Item | null>(
    () => (editing ? { id: `pdfpage-${editing.pageId}`, file: editing.file, kind: 'image', target: 'png', quality: 1, status: 'ready', progress: 0 } : null),
    [editing]
  );
  const onPageEdited = async (_id: string, file: File) => {
    if (!editing) return;
    const { pageId, base } = editing;
    setEditing(null);
    const page = pagesRef.current.find((p) => p.id === pageId);
    if (!page) return;
    const bmp = await createImageBitmap(file);
    if (bmp.width !== base.width || bmp.height !== base.height) {
      // cropped/resized: geometry changed — the only honest result is a raster page
      bmp.close();
      const rotated = (page.intrinsic + page.rotate) % 180 !== 0;
      const [w, h] = rotated ? [page.h, page.w] : [page.w, page.h];
      patchPage(pageId, () => ({ src: { kind: 'image', blob: file }, intrinsic: 0, rotate: 0, flipH: false, flipV: false, overlay: undefined, w, h, thumb: undefined }));
      flash(t('pdfRasterized'));
      return;
    }
    // diff against the un-decorated render: unchanged pixels → transparent
    const edited = document.createElement('canvas');
    edited.width = bmp.width;
    edited.height = bmp.height;
    const ectx = edited.getContext('2d')!;
    ectx.drawImage(bmp, 0, 0);
    bmp.close();
    const a = ectx.getImageData(0, 0, edited.width, edited.height);
    const b = base.getContext('2d')!.getImageData(0, 0, base.width, base.height);
    const A = a.data;
    const B = b.data;
    let changed = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (A[i] === B[i] && A[i + 1] === B[i + 1] && A[i + 2] === B[i + 2] && A[i + 3] === B[i + 3]) A[i + 3] = 0;
      else changed++;
    }
    if (!changed) return;
    ectx.putImageData(a, 0, 0);
    const user = displayToUserCanvas(edited, page.intrinsic + page.rotate, page.flipH, page.flipV);
    const overlay = await new Promise<Blob | null>((r) => user.toBlob(r, 'image/png'));
    if (overlay) patchPage(pageId, () => ({ overlay, thumb: undefined }));
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
          commit((prev) => {
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
  /** plain bytes per source doc; docs qpdf can't decrypt fall back to rasterized pages */
  const toSpecs = async (list: PPage[]): Promise<PageSpec[]> => {
    const plain = new Map<string, ArrayBuffer | null>();
    for (const p of list) {
      if (p.src.kind !== 'pdf' || plain.has(p.src.doc)) continue;
      const d = docsRef.current.get(p.src.doc)!;
      try {
        plain.set(p.src.doc, await getPlainBytes(d.file, d.password, d.encrypted));
      } catch (e) {
        console.warn('[pdf decrypt → raster fallback]', e);
        plain.set(p.src.doc, null); // plan B for this document
        flash(t('pdfRasterFallback'));
      }
    }
    const specs: PageSpec[] = [];
    for (const p of list) {
      const common = { rotate: p.rotate, flipH: p.flipH, flipV: p.flipV, notes: p.notes, overlay: p.overlay, watermark: p.watermark };
      if (p.src.kind === 'pdf') {
        const bytes = plain.get(p.src.doc);
        if (bytes) { specs.push({ kind: 'pdf', bytes, index: p.src.index, ...common }); continue; }
        // rasterize: render the page as displayed (rotation+flips baked) → an upright image page
        const d = docsRef.current.get(p.src.doc)!;
        let c = await renderPage(d.proxy, p.src.index, { scale: 2, rotate: p.rotate });
        if (p.flipH || p.flipV) c = userToDisplayCanvas(c, 0, p.flipH, p.flipV);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
        const [w, h] = p.rotate % 180 ? [p.h, p.w] : [p.w, p.h];
        // decorations were anchored in the old user space — re-anchor into the new (display) space
        const notes = p.notes.map((n) => { const [nx, ny] = noteDisplay(p, n); return { ...n, ux: nx, uy: ny }; });
        let overlay = p.overlay;
        if (overlay) {
          const bmp = await createImageBitmap(overlay);
          const disp = userToDisplayCanvas(bmp, p.intrinsic + p.rotate, p.flipH, p.flipV);
          bmp.close();
          overlay = (await new Promise<Blob | null>((r) => disp.toBlob(r, 'image/png'))) ?? undefined;
        }
        specs.push({ kind: 'image', blob: blob!, width: w, height: h, rotate: 0, flipH: false, flipV: false, notes, overlay, watermark: p.watermark });
      } else if (p.src.kind === 'image') {
        specs.push({ kind: 'image', blob: p.src.blob, width: p.w, height: p.h, ...common });
      } else {
        specs.push({ kind: 'blank', width: p.w, height: p.h, ...common });
      }
    }
    return specs;
  };

  const save = async () => {
    const list = xo.scope === 'selected' && sel.size ? pages.filter((p) => sel.has(p.id)) : pages;
    if (!list.length) return;
    setExportOpen(false);
    setBusy(true);
    setProg(0);
    try {
      const specs = await toSpecs(list);
      const opts = {
        title: xo.title || undefined,
        author: xo.author || undefined,
        watermark: list.some((p) => p.watermark) ? wm : null,
        encrypt: xo.encrypt ? { user: xo.userPw, owner: xo.ownerPw } : null,
      };
      const base = item.file.name.replace(/\.pdf$/i, '');
      if (xo.split && !inline) {
        const entries: Record<string, Uint8Array> = {};
        for (let i = 0; i < specs.length; i++) {
          const blob = await buildPdf([specs[i]], opts);
          entries[`${base}_p${String(i + 1).padStart(3, '0')}.pdf`] = new Uint8Array(await blob.arrayBuffer());
          setProg((i + 1) / specs.length);
        }
        const zipped = zipSync(entries, { level: 0 });
        onSave(item.id, new File([zipped.slice()], `${base}_pages.zip`, { type: 'application/zip' }));
      } else {
        const blob = await buildPdf(specs, { ...opts, onProgress: setProg });
        onSave(item.id, new File([blob], inline ? item.file.name : `${base}_edited.pdf`, { type: 'application/pdf' }));
      }
    } catch (e) {
      console.error('[pdf export]', e);
      flash(t('failed'));
    } finally {
      setBusy(false);
    }
  };

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || pwAsk || exportOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') { if (zoomed) setZoomed(false); else if (noteMode) setNoteMode(false); else if (!inline) onClose?.(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); deleteSel(); }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(new Set(pages.map((p) => p.id))); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && focusIdx >= 0) {
        const n = Math.min(pages.length - 1, Math.max(0, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
        setSel(new Set([pages[n].id]));
        setAnchor(pages[n].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, pages, editing, pwAsk, exportOpen, noteMode, focusIdx, histVer, zoomed]);

  const nSel = sel.size;
  const Icon = ({ d }: { d: string }) => (
    <svg viewBox="0 0 24 24" width="14" height="14"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  const canUndo = histRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const anyEncrypted = [...docsRef.current.values()].some((d) => d.encrypted);

  const body = (
    <div className={inline ? 'ie-inline-wrap' : 'editor-overlay'} onClick={inline || busy ? undefined : onClose}>
      <div className={`editor editor-wide pdf-editor${inline ? ' ie-inline' : ''}`} role={inline ? undefined : 'dialog'} aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        {!inline && (
          <div className="ed-head">
            <span className="ed-title" title={item.file.name}>
              {anyEncrypted && <span className="pdf-lock" title={t('pdfUnlocked')}>🔓</span>}
              {item.file.name}
            </span>
            <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}

        <div className="ed-toolbar pdf-tools">
          <button className="btn btn-ghost btn-sm" disabled={busy || !loaded} onClick={() => pickFiles(null)} title={t('pdfAddFilesTip')}>
            <Icon d="M12 5v14M5 12h14" />{t('pdfAddFiles')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !loaded} onClick={addBlank}>
            <Icon d="M6 3h8l5 5v13H6zM14 3v5h5" />{t('pdfBlank')}
          </button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={!canUndo} onClick={undo} title={t('undo')}><Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></button>
          <button className="btn btn-ghost btn-sm" disabled={!canRedo} onClick={redo} title={t('redo')}><Icon d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => rotateSel(-90)} title={t('pdfRotL')}><Icon d="M4 10a8 8 0 1 1 2.3 7.7M4 4v6h6" /></button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => rotateSel(90)} title={t('pdfRotR')}><Icon d="M20 10a8 8 0 1 0-2.3 7.7M20 4v6h-6" /></button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => flipSel('h')} title={t('pdfFlipH')}><Icon d="M12 3v18M8 7 3 12l5 5V7zM16 7l5 5-5 5V7z" /></button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => flipSel('v')} title={t('pdfFlipV')}><Icon d="M3 12h18M7 8l5-5 5 5H7zM7 16l5 5 5-5H7z" /></button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => moveSel(-1)} title={t('pdfMoveL')}><Icon d="M15 6l-6 6 6 6" /></button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={() => moveSel(1)} title={t('pdfMoveR')}><Icon d="M9 6l6 6-6 6" /></button>
          <button className="btn btn-ghost btn-sm" disabled={busy || !nSel} onClick={duplicateSel} title={t('pdfDup')}><Icon d="M9 9h11v11H9zM4 15V4h11" /></button>
          <button className="btn btn-ghost btn-sm" disabled={busy || pages.length < 2} onClick={reverseAll} title={t('pdfReverse')}><Icon d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3-3m-3 3 3 3" /></button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={busy || nSel !== 1} onClick={() => void editPage()} title={t('pdfEditPageTip')}>
            <Icon d="M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3" />{t('pdfEditPage')}
          </button>
          <button className={`btn btn-ghost btn-sm${noteMode ? ' active' : ''}`} disabled={busy || nSel !== 1 || !previewOpen} onClick={() => setNoteMode((v) => !v)} title={t('pdfNoteTip')}>
            <Icon d="M5 4h14v11h-6l-4 4v-4H5z" />{t('pdfNote')}
          </button>
          <button className={`btn btn-ghost btn-sm${wmOpen ? ' active' : ''}`} disabled={busy || !loaded} onClick={() => setWmOpen((v) => !v)} title={t('pdfWatermarkTip')}>
            <Icon d="M4 20 20 4M7 4h13v13" />{t('pdfWatermark')}
          </button>
          <button className="btn btn-ghost btn-sm pdf-del" disabled={busy || !nSel} onClick={deleteSel} title={t('pdfDelete')}><Icon d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" /></button>
          <span className="opt-spacer" />
          <button className={`btn btn-ghost btn-sm pdf-preview-toggle${previewOpen ? ' active' : ''}`} onClick={() => setPreviewOpen((v) => !v)} title={t('pdfPreview')}>
            <Icon d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7zM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z" />
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!pages.length} onClick={() => setSel(new Set(pages.map((p) => p.id)))}>{t('pdfSelectAll')}</button>
          <button className="btn btn-ghost btn-sm" disabled={!nSel} onClick={() => setSel(new Set())}>{t('pdfSelectNone')}</button>
        </div>

        {wmOpen && (
          <div className="pdf-wm">
            <label className="pdf-wm-field pdf-wm-text">
              <span className="sp-label">{t('pdfWmText')}</span>
              <input className="ed-input" value={wm.text} disabled={!!wm.image} onChange={(e) => setWm({ ...wm, text: e.target.value })} />
            </label>
            <label className="pdf-wm-field">
              <span className="sp-label">{t('pdfWmOpacity')} <span className="sp-val">{Math.round(wm.opacity * 100)}%</span></span>
              <input type="range" min={0.05} max={1} step={0.01} value={wm.opacity} onChange={(e) => setWm({ ...wm, opacity: Number(e.target.value) })} />
            </label>
            <label className="pdf-wm-field">
              <span className="sp-label">{t('pdfWmAngle')} <span className="sp-val">{wm.angle}°</span></span>
              <input type="range" min={-90} max={90} step={1} value={wm.angle} onChange={(e) => setWm({ ...wm, angle: Number(e.target.value) })} />
            </label>
            <label className="pdf-wm-field">
              <span className="sp-label">{t('pdfWmSize')} <span className="sp-val">{Math.round(wm.scale * 100)}%</span></span>
              <input type="range" min={0.1} max={1} step={0.01} value={wm.scale} onChange={(e) => setWm({ ...wm, scale: Number(e.target.value) })} />
            </label>
            <div className="pdf-wm-field">
              <span className="sp-label">{t('pdfWmMode')}</span>
              <div className="ed-seg">
                <button className={wm.mode === 'center' ? 'active' : ''} onClick={() => setWm({ ...wm, mode: 'center' })}>{t('pdfWmCenter')}</button>
                <button className={wm.mode === 'tile' ? 'active' : ''} onClick={() => setWm({ ...wm, mode: 'tile' })}>{t('pdfWmTile')}</button>
              </div>
            </div>
            <div className="pdf-wm-field">
              <span className="sp-label">{t('pdfWmImage')}</span>
              <div className="pdf-wm-btns">
                <button className="btn btn-ghost btn-sm" onClick={() => wmFileRef.current?.click()}>{wm.image ? t('pdfWmImageReplace') : t('pdfWmImagePick')}</button>
                {wm.image && <button className="btn btn-ghost btn-sm" onClick={() => setWm({ ...wm, image: null })}>{t('pdfWmImageClear')}</button>}
              </div>
            </div>
            {!wm.image && (
              <div className="pdf-wm-field pdf-wm-color">
                <span className="sp-label">{t('pdfWmColor')}</span>
                <ColorPicker value={wm.color} onChange={(c) => setWm({ ...wm, color: c })} />
              </div>
            )}
            <div className="pdf-wm-apply">
              <button className="btn btn-accent btn-sm" disabled={!nSel} onClick={() => applyWm(true, 'selected')}>{t('pdfWmApplySel')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => applyWm(true, 'all')}>{t('pdfWmApplyAll')}</button>
              <button className="btn btn-ghost btn-sm" disabled={!pages.some((p) => p.watermark)} onClick={() => applyWm(false, 'all')}>{t('pdfWmRemove')}</button>
            </div>
          </div>
        )}

        <div
          className={`pdf-body${previewOpen ? ' with-preview' : ''}`}
          style={{ '--pdf-prev-w': `${prevSplit.size}px` } as CSSProperties}
        >
          <div className="pdf-grid" role="listbox" aria-multiselectable="true">
            {!loaded && !error && <p className="pdf-status"><span className="spinner" /> {t('pdfLoading')}</p>}
            {error && <p className="pdf-status danger">{t(error)}</p>}
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
                    {p.thumb ? <img src={p.thumb} alt="" draggable={false} /> : <span className="spinner" />}
                    {p.src.kind !== 'pdf' && <span className="pdf-badge">{p.src.kind === 'image' ? t('pdfBadgeImage') : t('pdfBadgeBlank')}</span>}
                    {(p.rotate !== 0 || p.flipH || p.flipV) && (
                      <span className="pdf-badge rot">{[p.rotate ? `${p.rotate}°` : '', p.flipH ? '↔' : '', p.flipV ? '↕' : ''].filter(Boolean).join(' ')}</span>
                    )}
                    {(p.notes.length > 0 || p.overlay || p.watermark) && (
                      <span className="pdf-badge deco" title={[p.notes.length ? `${p.notes.length} ${t('pdfNote')}` : '', p.overlay ? t('pdfEditPage') : '', p.watermark ? t('pdfWatermark') : ''].filter(Boolean).join(' · ')}>
                        {p.notes.length > 0 && '💬'}{p.overlay && '✎'}{p.watermark && '◈'}
                      </span>
                    )}
                  </div>
                  <div className="pdf-page-foot">
                    <button className={`pdf-check${sel.has(p.id) ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); togglePage(p.id); }} aria-label={t('pdfToggleSelect')}>
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

          <div className="split-gutter pdf-gutter" {...prevSplit.gutterProps} />
          <aside className="pdf-preview" aria-hidden={!previewOpen}>
          {previewOpen && (
            <>
              <div className="pdf-preview-bar">
                <button className="btn btn-ghost btn-sm" disabled={focusIdx <= 0} onClick={() => { const p = pages[focusIdx - 1]; setSel(new Set([p.id])); setAnchor(p.id); }} aria-label={t('pdfMoveL')}><Icon d="M15 6l-6 6 6 6" /></button>
                <span className="pdf-num">{focusIdx >= 0 ? `${focusIdx + 1} / ${pages.length}` : '—'}</span>
                <button className="btn btn-ghost btn-sm" disabled={focusIdx < 0 || focusIdx >= pages.length - 1} onClick={() => { const p = pages[focusIdx + 1]; setSel(new Set([p.id])); setAnchor(p.id); }} aria-label={t('pdfMoveR')}><Icon d="M9 6l6 6-6 6" /></button>
                {focusPage && <span className="ed-hint pdf-dims">{Math.round(focusPage.rotate % 180 ? focusPage.h : focusPage.w)} × {Math.round(focusPage.rotate % 180 ? focusPage.w : focusPage.h)} pt</span>}
              </div>
              <div className={`pdf-preview-stage${noteMode ? ' noting' : ''}`}>
                {preview && focusPage && preview.id === focusPage.id ? (
                  <div className={`pdf-preview-page${noteMode ? '' : ' zoomable'}`} style={{ aspectRatio: `${preview.w} / ${preview.h}` }} onClick={onPreviewClick} title={noteMode ? undefined : t('pdfZoom')}>
                    <img key={preview.url} src={preview.url} alt="" draggable={false} />
                    {focusPage.notes.map((n, k) => {
                      const [nx, ny] = noteDisplay(focusPage, n);
                      return (
                        <button
                          key={n.id}
                          className={`pdf-note-pin${activeNote === n.id ? ' active' : ''}`}
                          style={{ left: `${nx * 100}%`, top: `${ny * 100}%` }}
                          onClick={(e) => { e.stopPropagation(); setActiveNote(n.id); setNoteMode(false); }}
                          title={n.text || t('pdfNoteEmpty')}
                        >
                          {k + 1}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="pdf-status">{focusPage ? <span className="spinner" /> : t('pdfPreviewEmpty')}</p>
                )}
              </div>
              {focusPage && (focusPage.notes.length > 0 || noteMode) && (
                <div className="pdf-notes">
                  {noteMode && <p className="ed-hint">{t('pdfNotePlace')}</p>}
                  {focusPage.notes.map((n, k) => (
                    <div key={n.id} className={`pdf-note-row${activeNote === n.id ? ' active' : ''}`} onClick={() => setActiveNote(n.id)}>
                      <span className="pdf-note-idx">{k + 1}</span>
                      <textarea
                        className="ed-input"
                        rows={2}
                        value={n.text}
                        placeholder={t('pdfNoteEmpty')}
                        autoFocus={activeNote === n.id && !n.text}
                        onChange={(e) => setNoteText(n.id, e.target.value)}
                        onBlur={() => commit((prev) => prev)}
                      />
                      <button className="btn btn-ghost btn-sm pdf-del" onClick={() => deleteNote(n.id)} aria-label={t('remove')}>
                        <Icon d="M6 6l12 12M18 6L6 18" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          </aside>
        </div>

        {busy && prog > 0 && (
          <div className="fc-progress-row pdf-progress">
            <div className="fc-progress"><div className="fc-bar" style={{ width: `${Math.round(prog * 100)}%` }} /></div>
            <span className="fc-pct">{Math.round(prog * 100)}%</span>
          </div>
        )}

        <div className="ed-foot">
          <span className="ed-hint">
            {note || (busy ? t('processing') : t('pdfSummary', { n: String(pages.length), sel: String(nSel) }))}
            {!note && <span className="kbd-hints"> · {t('pdfDragHint')}</span>}
          </span>
          <div className="ed-foot-main">
            {!inline && <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>}
            <button className="btn btn-accent" onClick={() => setExportOpen(true)} disabled={busy || !loaded || !pages.length}>
              {busy ? t('processing') : inline ? t('pdfSaveAsset') : t('pdfSave')}
            </button>
          </div>
        </div>

        <input ref={fileRef} type="file" multiple hidden accept="application/pdf,.pdf,image/*"
          onChange={(e) => { void onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <input ref={wmFileRef} type="file" hidden accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setWm({ ...wm, image: f }); e.target.value = ''; }} />
      </div>
    </div>
  );

  const exportModal = exportOpen && (
    <Overlay onClick={() => setExportOpen(false)}>
      <div className="editor mini-modal pdf-export" onClick={(e) => e.stopPropagation()}>
        <p className="mx-label">{t('pdfExportTitle')}</p>
        <div className="pdf-x-row">
          <span className="sp-label">{t('pdfExportScope')}</span>
          <div className="ed-seg">
            <button className={xo.scope === 'all' ? 'active' : ''} onClick={() => setXo({ ...xo, scope: 'all' })}>{t('pdfScopeAll', { n: String(pages.length) })}</button>
            <button className={xo.scope === 'selected' ? 'active' : ''} disabled={!nSel} onClick={() => setXo({ ...xo, scope: 'selected' })}>{t('pdfScopeSel', { n: String(nSel) })}</button>
          </div>
        </div>
        {!inline && (
          <label className="sp-field sp-check"><input type="checkbox" checked={xo.split} onChange={(e) => setXo({ ...xo, split: e.target.checked })} /><span>{t('pdfSplit')}</span></label>
        )}
        <label className="pdf-x-row"><span className="sp-label">{t('tagTitle')}</span><input className="ed-input" value={xo.title} onChange={(e) => setXo({ ...xo, title: e.target.value })} /></label>
        <label className="pdf-x-row"><span className="sp-label">{t('pdfAuthor')}</span><input className="ed-input" value={xo.author} onChange={(e) => setXo({ ...xo, author: e.target.value })} /></label>
        <label className="sp-field sp-check"><input type="checkbox" checked={xo.encrypt} onChange={(e) => setXo({ ...xo, encrypt: e.target.checked })} /><span>{t('pdfEncrypt')}</span></label>
        {xo.encrypt && (
          <div className="pdf-x-pw">
            <label className="pdf-x-row"><span className="sp-label">{t('pdfUserPw')}</span><input className="ed-input" type="password" autoComplete="new-password" value={xo.userPw} onChange={(e) => setXo({ ...xo, userPw: e.target.value })} /></label>
            <label className="pdf-x-row"><span className="sp-label">{t('pdfOwnerPw')}</span><input className="ed-input" type="password" autoComplete="new-password" value={xo.ownerPw} onChange={(e) => setXo({ ...xo, ownerPw: e.target.value })} /></label>
            <p className="ed-hint">{t('pdfEncryptHint')}</p>
          </div>
        )}
        {anyEncrypted && !xo.encrypt && <p className="ed-hint">{t('pdfDecryptNote')}</p>}
        <div className="ed-foot">
          <span />
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={() => setExportOpen(false)}>{t('cancel')}</button>
            <button className="btn btn-accent" disabled={xo.encrypt && !xo.userPw && !xo.ownerPw} onClick={() => void save()}>{xo.split && !inline ? t('pdfExportZip') : inline ? t('pdfSaveAsset') : t('pdfSave')}</button>
          </div>
        </div>
      </div>
    </Overlay>
  );

  const extras = (
    <>
      {zoomed && preview && focusPage && preview.id === focusPage.id && (
        <div className="pdf-zoom" role="dialog" aria-label={t('pdfZoom')} onClick={() => setZoomed(false)}>
          <img src={preview.url} alt="" draggable={false} />
          <button className="theme-toggle pdf-zoom-close" onClick={() => setZoomed(false)} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
      )}
      {editItem && <ImageEditor item={editItem} onSave={(id, f) => void onPageEdited(id, f)} onClose={() => setEditing(null)} />}
      {exportModal}
      {pwAsk && (
        <PdfPasswordModal
          fileName={pwAsk.file.name}
          onSubmit={async (pw) => {
            try {
              const doc = await openPdf(await pwAsk.file.arrayBuffer(), pw);
              await closePdf(doc);
            } catch (e) {
              if (e instanceof PdfPasswordError) return false;
            }
            pwAsk.resolve(pw);
            setPwAsk(null);
            return true;
          }}
          onCancel={() => { pwAsk.resolve(null); setPwAsk(null); }}
        />
      )}
    </>
  );

  // the nested editors/modals sit OUTSIDE the overlay: they portal to body too, and React
  // would bubble their synthetic clicks into our backdrop onClose otherwise
  return inline ? <>{body}{extras}</> : createPortal(<>{body}{extras}</>, document.body);
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

async function drawImageTo(blob: Blob, width: number, maxDim?: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  let s = width ? width / bmp.width : 1;
  if (!width && maxDim) s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
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
