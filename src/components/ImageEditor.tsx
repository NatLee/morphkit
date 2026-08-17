import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useI18n } from '../i18n';
import type { Item } from '../types';

/* Graphite-inspired: non-destructive object model — every stroke, shape and
   text is an editable object in a layers list; the canvas re-renders
   base bitmap + objects on every change. */

type Tool = 'select' | 'pen' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'crop';
type ObjType = Exclude<Tool, 'select' | 'crop'>;

interface Pt { x: number; y: number }

interface Obj {
  id: number;
  type: ObjType;
  color: string;
  /** stroke width, or font size for text */
  size: number;
  visible: boolean;
  points?: Pt[];
  a?: Pt;
  b?: Pt;
  text?: string;
  pos?: Pt;
}

interface HistEntry { objects: Obj[]; baseBlob: Blob }

const MAX_DIM = 4096;
const HIST_CAP = 40;
let objId = 0;

const TOOL_ICONS: Record<Tool, string> = {
  select: 'M6 3l12 9-6 1 3 6-3 1.5L9 14l-3 4z',
  pen: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3',
  line: 'M5 19L19 5',
  rect: 'M5 6h14v12H5z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  arrow: 'M5 19L18 6M18 6v6M18 6h-6',
  text: 'M6 6h12M12 6v13',
  crop: 'M7 3v14h14M3 7h14v14',
};

function cloneObjs(objs: Obj[]): Obj[] {
  return objs.map((o) => ({
    ...o,
    points: o.points?.map((p) => ({ ...p })),
    a: o.a && { ...o.a },
    b: o.b && { ...o.b },
    pos: o.pos && { ...o.pos },
  }));
}

function bboxOf(o: Obj, ctx: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } {
  if (o.type === 'text' && o.pos) {
    ctx.font = `600 ${o.size}px 'IBM Plex Sans', sans-serif`;
    const m = ctx.measureText(o.text ?? '');
    return { x: o.pos.x, y: o.pos.y, w: m.width, h: o.size * 1.2 };
  }
  if (o.type === 'pen' && o.points?.length) {
    const xs = o.points.map((p) => p.x);
    const ys = o.points.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (o.a && o.b) {
    const x = Math.min(o.a.x, o.b.x);
    const y = Math.min(o.a.y, o.b.y);
    return { x, y, w: Math.abs(o.b.x - o.a.x), h: Math.abs(o.b.y - o.a.y) };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function drawObj(ctx: CanvasRenderingContext2D, o: Obj) {
  if (!o.visible) return;
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.type === 'text' && o.pos) {
    ctx.font = `600 ${o.size}px 'IBM Plex Sans', sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(o.text ?? '', o.pos.x, o.pos.y);
    return;
  }
  if (o.type === 'pen' && o.points?.length) {
    ctx.beginPath();
    ctx.moveTo(o.points[0].x, o.points[0].y);
    for (const p of o.points) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    return;
  }
  if (!o.a || !o.b) return;
  const { a, b } = o;
  ctx.beginPath();
  if (o.type === 'line' || o.type === 'arrow') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (o.type === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.max(12, o.size * 3.5);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45));
      ctx.stroke();
    }
  } else if (o.type === 'rect') {
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (o.type === 'ellipse') {
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function translateObj(o: Obj, dx: number, dy: number) {
  if (o.points) o.points.forEach((p) => { p.x += dx; p.y += dy; });
  if (o.a) { o.a.x += dx; o.a.y += dy; }
  if (o.b) { o.b.x += dx; o.b.y += dy; }
  if (o.pos) { o.pos.x += dx; o.pos.y += dy; }
}

function mapObj(o: Obj, fn: (p: Pt) => Pt): Obj {
  return {
    ...o,
    points: o.points?.map(fn),
    a: o.a && fn(o.a),
    b: o.b && fn(o.b),
    pos: o.pos && fn(o.pos),
  };
}

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose: () => void;
}

export function ImageEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<{ blob: Blob; bmp: ImageBitmap } | null>(null);
  const histRef = useRef<HistEntry[]>([]);
  const redoRef = useRef<HistEntry[]>([]);
  const dragRef = useRef<
    | { mode: 'draw'; id: number }
    | { mode: 'move'; id: number; last: Pt }
    | { mode: 'crop'; a: Pt }
    | null
  >(null);

  const [objects, setObjects] = useState<Obj[]>([]);
  const objectsRef = useRef<Obj[]>([]);
  useEffect(() => { objectsRef.current = objects; }, [objects]);

  const [sel, setSel] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#c94f16');
  const [size, setSize] = useState(4);
  const [fontSize, setFontSize] = useState(32);
  const [zoom, setZoom] = useState(1);
  const [baseVer, setBaseVer] = useState(0);
  const [histVer, setHistVer] = useState(0);
  const [cropSel, setCropSel] = useState<{ a: Pt; b: Pt } | null>(null);
  const [textEdit, setTextEdit] = useState<{ id?: number; pos: Pt; value: string } | null>(null);
  const [ready, setReady] = useState(false);

  const selObj = sel != null ? objects.find((o) => o.id === sel) ?? null : null;

  // ---- init ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bmp0 = await createImageBitmap(item.file);
      const longest = Math.max(bmp0.width, bmp0.height);
      const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp0.width * scale);
      c.height = Math.round(bmp0.height * scale);
      c.getContext('2d')!.drawImage(bmp0, 0, 0, c.width, c.height);
      bmp0.close();
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!blob || cancelled) return;
      const bmp = await createImageBitmap(blob);
      if (cancelled) { bmp.close(); return; }
      baseRef.current = { blob, bmp };
      // fit zoom
      const vp = viewportRef.current;
      if (vp) {
        const fit = Math.min(1, (vp.clientWidth - 28) / bmp.width, (window.innerHeight * 0.5) / bmp.height);
        setZoom(Math.max(0.05, fit));
      }
      setBaseVer((v) => v + 1);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [item.file]);

  // ---- render ----
  const render = useCallback(() => {
    const base = baseRef.current;
    const c = canvasRef.current;
    if (!base || !c) return;
    if (c.width !== base.bmp.width || c.height !== base.bmp.height) {
      c.width = base.bmp.width;
      c.height = base.bmp.height;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(base.bmp, 0, 0);
    for (const o of objectsRef.current) drawObj(ctx, o);
    // selection outline
    if (sel != null) {
      const o = objectsRef.current.find((x) => x.id === sel);
      if (o) {
        const bb = bboxOf(o, ctx);
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = '#c94f16';
        ctx.lineWidth = Math.max(1.5, 1.5 / zoom);
        ctx.strokeRect(bb.x - 6, bb.y - 6, bb.w + 12, bb.h + 12);
        ctx.restore();
      }
    }
    // crop marquee
    if (cropSel) {
      const { a, b } = cropSel;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.clearRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.drawImage(base.bmp,
        Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y),
        Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (const o of objectsRef.current) drawObj(ctx, o);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.restore();
    }
  }, [sel, cropSel, zoom]);

  useEffect(() => { render(); }, [objects, baseVer, render]);

  // ---- history ----
  const pushHist = () => {
    if (!baseRef.current) return;
    histRef.current.push({ objects: cloneObjs(objectsRef.current), baseBlob: baseRef.current.blob });
    if (histRef.current.length > HIST_CAP) histRef.current.shift();
    redoRef.current = [];
    setHistVer((v) => v + 1);
  };

  const applyHist = async (e: HistEntry) => {
    if (baseRef.current && e.baseBlob !== baseRef.current.blob) {
      const bmp = await createImageBitmap(e.baseBlob);
      baseRef.current.bmp.close();
      baseRef.current = { blob: e.baseBlob, bmp };
      setBaseVer((v) => v + 1);
    }
    setObjects(e.objects);
    setSel(null);
    setCropSel(null);
  };

  const undo = async () => {
    const e = histRef.current.pop();
    if (!e || !baseRef.current) return;
    redoRef.current.push({ objects: cloneObjs(objectsRef.current), baseBlob: baseRef.current.blob });
    await applyHist(e);
    setHistVer((v) => v + 1);
  };

  const redo = async () => {
    const e = redoRef.current.pop();
    if (!e || !baseRef.current) return;
    histRef.current.push({ objects: cloneObjs(objectsRef.current), baseBlob: baseRef.current.blob });
    await applyHist(e);
    setHistVer((v) => v + 1);
  };

  // ---- pointer ----
  const toPt = (e: PointerEvent): Pt => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const hitTest = (p: Pt): Obj | null => {
    const ctx = canvasRef.current!.getContext('2d')!;
    const list = objectsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      if (!o.visible) continue;
      const bb = bboxOf(o, ctx);
      const pad = Math.max(8, o.size);
      if (p.x >= bb.x - pad && p.x <= bb.x + bb.w + pad && p.y >= bb.y - pad && p.y <= bb.y + bb.h + pad) return o;
    }
    return null;
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    const p = toPt(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (tool === 'select') {
      const hit = hitTest(p);
      if (hit) {
        setSel(hit.id);
        pushHist();
        dragRef.current = { mode: 'move', id: hit.id, last: p };
      } else {
        setSel(null);
      }
      return;
    }
    if (tool === 'crop') {
      dragRef.current = { mode: 'crop', a: p };
      setCropSel(null);
      return;
    }
    if (tool === 'text') {
      setTextEdit({ pos: p, value: '' });
      return;
    }
    // draw a new object
    pushHist();
    const id = ++objId;
    const base: Obj = { id, type: tool, color, size, visible: true };
    const obj: Obj = tool === 'pen' ? { ...base, points: [p] } : { ...base, a: p, b: p };
    setObjects((prev) => [...prev, obj]);
    dragRef.current = { mode: 'draw', id };
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toPt(e);
    if (d.mode === 'crop') {
      setCropSel({ a: d.a, b: p });
      return;
    }
    if (d.mode === 'move') {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      d.last = p;
      setObjects((prev) => prev.map((o) => {
        if (o.id !== d.id) return o;
        const copy = cloneObjs([o])[0];
        translateObj(copy, dx, dy);
        return copy;
      }));
      return;
    }
    // draw
    setObjects((prev) => prev.map((o) => {
      if (o.id !== d.id) return o;
      if (o.type === 'pen') return { ...o, points: [...(o.points ?? []), p] };
      return { ...o, b: p };
    }));
  };

  const onUp = () => { dragRef.current = null; };

  const onDblClick = (e: PointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return;
    const hit = hitTest(toPt(e));
    if (hit?.type === 'text' && hit.pos) {
      setSel(hit.id);
      setTextEdit({ id: hit.id, pos: hit.pos, value: hit.text ?? '' });
    }
  };

  // delete key removes selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textEdit) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel != null) {
        pushHist();
        setObjects((prev) => prev.filter((o) => o.id !== sel));
        setSel(null);
      }
      if (e.key === 'Escape') { setCropSel(null); setSel(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, textEdit]);

  const commitText = () => {
    if (!textEdit) return;
    const v = textEdit.value.trim();
    pushHist();
    if (textEdit.id != null) {
      setObjects((prev) => v
        ? prev.map((o) => (o.id === textEdit.id ? { ...o, text: v } : o))
        : prev.filter((o) => o.id !== textEdit.id));
    } else if (v) {
      setObjects((prev) => [...prev, {
        id: ++objId, type: 'text', color, size: fontSize, visible: true, text: v, pos: textEdit.pos,
      }]);
    }
    setTextEdit(null);
  };

  // ---- geometry (bakes into base, transforms objects) ----
  const applyCrop = async () => {
    if (!cropSel || !baseRef.current) return;
    pushHist();
    const { a, b } = cropSel;
    const x = Math.round(Math.min(a.x, b.x));
    const y = Math.round(Math.min(a.y, b.y));
    const w = Math.max(1, Math.round(Math.abs(b.x - a.x)));
    const h = Math.max(1, Math.round(Math.abs(b.y - a.y)));
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d')!.drawImage(baseRef.current.bmp, x, y, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => tmp.toBlob(r, 'image/png'));
    if (!blob) return;
    const bmp = await createImageBitmap(blob);
    baseRef.current.bmp.close();
    baseRef.current = { blob, bmp };
    setObjects((prev) => prev.map((o) => mapObj(o, (p) => ({ x: p.x - x, y: p.y - y }))));
    setCropSel(null);
    setBaseVer((v) => v + 1);
  };

  const transform = async (kind: 'rot' | 'flip') => {
    if (!baseRef.current) return;
    pushHist();
    const src = baseRef.current.bmp;
    const W = src.width;
    const H = src.height;
    const tmp = document.createElement('canvas');
    const ctx = tmp.getContext('2d')!;
    if (kind === 'rot') {
      tmp.width = H;
      tmp.height = W;
      ctx.translate(H, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      tmp.width = W;
      tmp.height = H;
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(src, 0, 0);
    const blob = await new Promise<Blob | null>((r) => tmp.toBlob(r, 'image/png'));
    if (!blob) return;
    const bmp = await createImageBitmap(blob);
    baseRef.current.bmp.close();
    baseRef.current = { blob, bmp };
    setObjects((prev) => prev.map((o) => mapObj(o, kind === 'rot'
      ? (p) => ({ x: H - p.y, y: p.x })
      : (p) => ({ x: W - p.x, y: p.y }))));
    setCropSel(null);
    setBaseVer((v) => v + 1);
  };

  // ---- layers ops ----
  const layerMove = (id: number, dir: 1 | -1) => {
    pushHist();
    setObjects((prev) => {
      const i = prev.findIndex((o) => o.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const layerToggle = (id: number) => {
    pushHist();
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, visible: !o.visible } : o)));
  };

  const layerDelete = (id: number) => {
    pushHist();
    setObjects((prev) => prev.filter((o) => o.id !== id));
    if (sel === id) setSel(null);
  };

  const updateSel = (patch: Partial<Obj>) => {
    if (sel == null) return;
    setObjects((prev) => prev.map((o) => (o.id === sel ? { ...o, ...patch } : o)));
  };

  // ---- save ----
  const save = () => {
    const base = baseRef.current;
    if (!base) return;
    const out = document.createElement('canvas');
    out.width = base.bmp.width;
    out.height = base.bmp.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(base.bmp, 0, 0);
    for (const o of objectsRef.current) drawObj(ctx, o);
    out.toBlob((b) => {
      if (!b) return;
      const baseName = item.file.name.replace(/\.[^.]+$/, '');
      onSave(item.id, new File([b], `${baseName}_edited.png`, { type: 'image/png' }));
    }, 'image/png');
  };

  const cssScale = () => {
    const c = canvasRef.current;
    if (!c || !c.width) return 1;
    return (c.getBoundingClientRect().width || 1) / c.width;
  };

  void histVer;
  const w = baseRef.current?.bmp.width ?? 0;

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor editor-wide" role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="ed-toolbar">
          {(Object.keys(TOOL_ICONS) as Tool[]).map((tl) => (
            <button
              key={tl}
              className={`tool-btn${tool === tl ? ' active' : ''}`}
              onClick={() => { setTool(tl); setCropSel(null); }}
              title={t(`tool_${tl}`)}
            >
              <svg viewBox="0 0 24 24"><path d={TOOL_ICONS[tl]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ))}
          <span className="tb-sep" />
          <button className="tool-btn" onClick={() => transform('rot')} title={t('rotate')}>
            <svg viewBox="0 0 24 24"><path d="M20 8a8 8 0 1 0 2 6M20 3v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn" onClick={() => transform('flip')} title={t('flipH')}>
            <svg viewBox="0 0 24 24"><path d="M12 3v18M8 7L4 12l4 5M16 7l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="tb-sep" />
          <button className="tool-btn" onClick={undo} disabled={histRef.current.length === 0} title={t('undo')}>
            <svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn" onClick={redo} disabled={redoRef.current.length === 0} title={t('redo')}>
            <svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="tb-sep" />
          {/* contextual properties: edit selection, or set defaults for new objects */}
          <input
            type="color"
            className="tb-color"
            value={selObj?.color ?? color}
            onChange={(e) => { if (selObj) { pushHist(); updateSel({ color: e.target.value }); } else setColor(e.target.value); }}
            title={t('colorLabel')}
          />
          <label className="tb-slider" title={selObj?.type === 'text' || tool === 'text' ? t('fontSizeLabel') : t('strokeW')}>
            <input
              type="range"
              min={1}
              max={selObj?.type === 'text' || tool === 'text' ? 120 : 24}
              value={selObj ? selObj.size : tool === 'text' ? fontSize : size}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (selObj) updateSel({ size: v });
                else if (tool === 'text') setFontSize(v);
                else setSize(v);
              }}
            />
          </label>
          {cropSel && (
            <button className="btn btn-accent btn-sm" onClick={applyCrop}>{t('applyCrop')}</button>
          )}
          <span className="tb-sep" />
          <div className="zoom-ctrl">
            <button className="tool-btn" onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))} title="−">−</button>
            <span className="zoom-val">{Math.round(zoom * 100)}%</span>
            <button className="tool-btn" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} title="+">+</button>
            <button
              className="tool-btn zoom-fit"
              title={t('zoomFit')}
              onClick={() => {
                const vp = viewportRef.current;
                const bmp = baseRef.current?.bmp;
                if (vp && bmp) setZoom(Math.max(0.05, Math.min(1, (vp.clientWidth - 28) / bmp.width, (window.innerHeight * 0.5) / bmp.height)));
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        <div className="ie-layout">
          <div className="ie-viewport" ref={viewportRef}>
            <div className="ie-inner" style={{ width: w * zoom || undefined }}>
              <canvas
                ref={canvasRef}
                className="ie-canvas2"
                style={{ width: w * zoom || undefined, cursor: tool === 'select' ? 'default' : 'crosshair' }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onDoubleClick={onDblClick as never}
              />
              {textEdit && (
                <input
                  className="ie-textinput"
                  autoFocus
                  value={textEdit.value}
                  placeholder={t('textPlaceholder')}
                  style={{
                    left: textEdit.pos.x * cssScale(),
                    top: textEdit.pos.y * cssScale(),
                    fontSize: Math.max(12, (textEdit.id != null ? selObj?.size ?? fontSize : fontSize) * cssScale()),
                    color: selObj?.color ?? color,
                  }}
                  onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextEdit(null); }}
                  onBlur={commitText}
                />
              )}
            </div>
          </div>

          <aside className="layers-panel">
            <p className="mx-label">{t('layers')}</p>
            {objects.length === 0 && <p className="ed-hint">—</p>}
            {[...objects].reverse().map((o) => (
              <div
                key={o.id}
                className={`layer-item${sel === o.id ? ' active' : ''}`}
                onClick={() => { setSel(o.id); setTool('select'); }}
              >
                <button
                  className="layer-eye"
                  onClick={(e) => { e.stopPropagation(); layerToggle(o.id); }}
                  title={o.visible ? '👁' : '·'}
                >
                  {o.visible ? (
                    <svg viewBox="0 0 24 24" width="13" height="13"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 4l16 16M2 12s4-7 10-7c1.8 0 3.4.6 4.8 1.4M22 12s-4 7-10 7c-1.8 0-3.4-.6-4.8-1.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  )}
                </button>
                <span className="layer-swatch" style={{ background: o.color }} />
                <span className="layer-name">
                  {o.type === 'text' ? (o.text ?? '').slice(0, 10) || t('tool_text') : t(`tool_${o.type}`)}
                </span>
                <span className="layer-btns">
                  <button onClick={(e) => { e.stopPropagation(); layerMove(o.id, 1); }} title={t('moveUp')}>↑</button>
                  <button onClick={(e) => { e.stopPropagation(); layerMove(o.id, -1); }} title={t('moveDown')}>↓</button>
                  <button onClick={(e) => { e.stopPropagation(); layerDelete(o.id); }} title={t('remove')}>×</button>
                </span>
              </div>
            ))}
          </aside>
        </div>

        <div className="ed-foot">
          <span className="ed-hint">{t('imageEditorHint2')}</span>
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={save} disabled={!ready}>{t('save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
