import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useI18n } from '../i18n';
import type { Item } from '../types';

/* Graphite-inspired: non-destructive object model — every stroke, shape and
   text is an editable object in a layers list; the canvas re-renders
   base bitmap + objects on every change. */

type Tool =
  | 'pan' | 'select' | 'pen' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'crop'
  | 'wand' | 'rectsel' | 'lasso' | 'fill';
type ObjType = Exclude<Tool, 'pan' | 'select' | 'crop' | 'wand' | 'rectsel' | 'lasso' | 'fill'>;
type FontFam = 'sans' | 'serif' | 'mono';
type Brush = 'pen' | 'marker' | 'highlight';

interface Pt { x: number; y: number }

export interface Obj {
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
  font?: FontFam;
  weight?: number;
  outline?: boolean;
  brush?: Brush;
}

export const FONT_MAP: Record<FontFam, string> = {
  sans: "'IBM Plex Sans', 'Noto Sans TC', 'Microsoft JhengHei', 'Yu Gothic', sans-serif",
  serif: "'Instrument Serif', 'Noto Serif TC', 'Yu Mincho', serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

function fontOf(o: Obj): string {
  return `${o.weight ?? 600} ${o.size}px ${FONT_MAP[o.font ?? 'sans']}`;
}

/** Perceived luminance 0..1 of a #rrggbb colour. */
function lumOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return 0;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

interface HistEntry { objects: Obj[]; baseBlob: Blob }

const MAX_DIM = 4096;
const HIST_CAP = 40;
let objId = 0;

const TOOL_ICONS: Record<Tool, string> = {
  pan: 'M12 2v20M2 12h20M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5M2 12l2.5-2.5M2 12l2.5 2.5M22 12l-2.5-2.5M22 12l-2.5 2.5',
  select: 'M6 3l12 9-6 1 3 6-3 1.5L9 14l-3 4z',
  pen: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3',
  line: 'M5 19L19 5',
  rect: 'M5 6h14v12H5z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  arrow: 'M5 19L18 6M18 6v6M18 6h-6',
  text: 'M6 6h12M12 6v13',
  crop: 'M7 3v14h14M3 7h14v14',
  wand: 'M5 19L14 10m2.5-2.5L19 5M13 3l.8 2.2M21 11l-2.2-.8M15.5 14.5l1.8 1.3M8.5 6.2L9.8 8',
  rectsel: 'M5 5h3M11 5h3M19 5v3M19 11v3M19 19h-3M11 19H8M5 19v-3M5 11V8',
  lasso: 'M12 4c4.5 0 8 1.9 8 4.5S16.5 13 12 13c-2 0-3.8-.4-5.2-1M6.8 12C5 13 4.2 14.6 5 16c.7 1.2 2.6 1.2 3.6.2M8 17c0 1.6-.8 3-2.5 3',
  fill: 'M8 3l9 9-6.5 6.5L4 12zM4 12h11M19 15c1 1.4 1.6 2.6 1 3.6-.6 1-2 1-2.8 0-.6-.9-.2-2.3 1.8-3.6z',
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
    ctx.font = fontOf(o);
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
    ctx.font = fontOf(o);
    ctx.textBaseline = 'top';
    if (o.outline) {
      ctx.lineWidth = Math.max(2, o.size / 10);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = lumOf(o.color) > 0.55 ? '#000000' : '#ffffff';
      ctx.strokeText(o.text ?? '', o.pos.x, o.pos.y);
    }
    ctx.fillText(o.text ?? '', o.pos.x, o.pos.y);
    return;
  }
  if (o.type === 'pen' && o.points?.length) {
    ctx.save();
    if (o.brush === 'marker') {
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = o.size * 1.8;
    } else if (o.brush === 'highlight') {
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = o.size * 3;
      ctx.lineCap = 'butt';
    }
    ctx.beginPath();
    ctx.moveTo(o.points[0].x, o.points[0].y);
    for (const p of o.points) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
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
  onSave?: (id: string, file: File) => void;
  onClose?: () => void;
  /** workspace mode: no overlay chrome, fills its container */
  inline?: boolean;
  /** persisted non-destructive layers (image projects) */
  initialObjects?: Obj[];
  /** reported on every change so the project can persist layers */
  onObjectsChange?: (objects: Obj[]) => void;
  /** bottom background layer colour (null = transparent) */
  bg?: string | null;
  onBgChange?: (c: string | null) => void;
}

export function ImageEditor({ item, onSave, onClose, inline, initialObjects, onObjectsChange, bg, onBgChange }: Props) {
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
    | { mode: 'rectsel'; a: Pt }
    | { mode: 'lasso' }
    | { mode: 'pan'; sx: number; sy: number; sl: number; st: number }
    | null
  >(null);
  const [panning, setPanning] = useState(false);
  const [cursor, setCursor] = useState<Pt | null>(null);

  const [objects, setObjects] = useState<Obj[]>([]);
  const objectsRef = useRef<Obj[]>([]);
  useEffect(() => { objectsRef.current = objects; }, [objects]);

  const [sel, setSel] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('pan');
  const [color, setColor] = useState('#c94f16');
  const [size, setSize] = useState(4);
  const [fontSize, setFontSize] = useState(32);
  const [fontFam, setFontFam] = useState<FontFam>('sans');
  const [bold, setBold] = useState(false);
  const [outlineOn, setOutlineOn] = useState(false);
  const [wandTol, setWandTol] = useState(30);
  const [brushType, setBrushType] = useState<Brush>('pen');
  const [zoom, setZoom] = useState(1);
  const [baseVer, setBaseVer] = useState(0);
  const [histVer, setHistVer] = useState(0);
  const [cropSel, setCropSel] = useState<{ a: Pt; b: Pt } | null>(null);
  const [textEdit, setTextEdit] = useState<{ id?: number; pos: Pt; value: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  // background is a permanent bottom "layer": colour + visibility
  const [bgColor, setBgColor] = useState<string>(bg ?? '#ffffff');
  const [bgOn, setBgOn] = useState<boolean>(bg != null);
  const [selVer, setSelVer] = useState(0);
  const [selDraft, setSelDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [lassoPts, setLassoPts] = useState<Pt[] | null>(null);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [rzMode, setRzMode] = useState<'pct' | 'abs'>('pct');
  const [rzPct, setRzPct] = useState(50);
  const [rzW, setRzW] = useState(0);
  const [rzH, setRzH] = useState(0);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const tintRef = useRef<HTMLCanvasElement | null>(null);
  const maskBBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const antsRef = useRef(0);

  const applyBg = (color: string, on: boolean) => {
    setBgColor(color);
    setBgOn(on);
    onBgChange?.(on ? color : null);
  };

  const buildTint = () => {
    const m = maskRef.current;
    if (!m) { tintRef.current = null; return; }
    const c = document.createElement('canvas');
    c.width = m.width;
    c.height = m.height;
    const g = c.getContext('2d')!;
    g.drawImage(m, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#c94f16';
    g.fillRect(0, 0, c.width, c.height);
    tintRef.current = c;
  };

  const deselect = () => {
    maskRef.current = null;
    tintRef.current = null;
    maskBBoxRef.current = null;
    setSelVer((v) => v + 1);
  };

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
      // restore persisted layers (image projects) and avoid id collisions
      if (initialObjects?.length) {
        objId = Math.max(objId, ...initialObjects.map((o) => o.id));
        setObjects(cloneObjs(initialObjects));
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.file]);

  // report layer changes for project persistence
  useEffect(() => {
    if (ready) onObjectsChange?.(objectsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, ready]);

  // wheel over the canvas = zoom (anchored at the cursor), never scroll
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom((z) => {
        const nz = Math.min(6, Math.max(0.05, z * factor));
        const rect = vp.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const cx = px + vp.scrollLeft;
        const cy = py + vp.scrollTop;
        const s = nz / z;
        window.requestAnimationFrame(() => {
          vp.scrollLeft = cx * s - px;
          vp.scrollTop = cy * s - py;
        });
        return nz;
      });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

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
    if (bgOn) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(base.bmp, 0, 0);
    for (const o of objectsRef.current) drawObj(ctx, o);

    // "marching ants": white underlay + animated black dashes — readable on any
    // image content, and the motion makes clear it's UI, not pixels
    const drawAnts = (path: () => void) => {
      ctx.save();
      const lw = Math.max(1.25, 1.5 / zoom);
      const dash = Math.max(4, 6 / zoom);
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      path();
      ctx.stroke();
      ctx.setLineDash([dash, dash]);
      ctx.lineDashOffset = -antsRef.current * dash * 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.beginPath();
      path();
      ctx.stroke();
      ctx.restore();
    };

    // selection tint + boundary ants
    if (tintRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.drawImage(tintRef.current, 0, 0);
      ctx.restore();
      const bb = maskBBoxRef.current;
      if (bb) drawAnts(() => ctx.rect(bb.x, bb.y, bb.w, bb.h));
    }
    // marquee / lasso drafts
    if (selDraft) {
      drawAnts(() => ctx.rect(
        Math.min(selDraft.a.x, selDraft.b.x), Math.min(selDraft.a.y, selDraft.b.y),
        Math.abs(selDraft.b.x - selDraft.a.x), Math.abs(selDraft.b.y - selDraft.a.y)
      ));
    }
    if (lassoPts && lassoPts.length > 1) {
      drawAnts(() => {
        ctx.moveTo(lassoPts[0].x, lassoPts[0].y);
        for (const p of lassoPts) ctx.lineTo(p.x, p.y);
      });
    }
    // selected-object outline
    if (sel != null) {
      const o = objectsRef.current.find((x) => x.id === sel);
      if (o) {
        const bb = bboxOf(o, ctx);
        drawAnts(() => ctx.rect(bb.x - 6, bb.y - 6, bb.w + 12, bb.h + 12));
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
  }, [sel, cropSel, zoom, bgColor, bgOn, selDraft, lassoPts, selVer]);

  // belt & braces: every visual input is an explicit dep so no repaint is missed
  useEffect(() => { render(); }, [objects, baseVer, bgColor, bgOn, selVer, selDraft, lassoPts, sel, cropSel, zoom, render]);

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

  const startPan = (e: PointerEvent<HTMLCanvasElement>) => {
    const vp = viewportRef.current;
    if (!vp) return;
    dragRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    // stop the canvas from stealing focus — this kept blurring the text input
    e.preventDefault();
    // pan tool, or middle mouse button with any tool
    if (tool === 'pan' || e.button === 1) {
      startPan(e);
      return;
    }
    const p = toPt(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (tool === 'wand') {
      wandSelect(p);
      return;
    }
    if (tool === 'fill') {
      void bucketFill(p);
      return;
    }
    if (tool === 'rectsel') {
      dragRef.current = { mode: 'rectsel', a: p };
      setSelDraft(null);
      return;
    }
    if (tool === 'lasso') {
      dragRef.current = { mode: 'lasso' };
      setLassoPts([p]);
      return;
    }
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
    const obj: Obj = tool === 'pen'
      ? { ...base, points: [p], brush: brushType }
      : { ...base, a: p, b: p };
    setObjects((prev) => [...prev, obj]);
    dragRef.current = { mode: 'draw', id };
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    // live cursor readout (canvas pixel coords)
    {
      const c = canvasRef.current;
      if (c) {
        const p0 = toPt(e);
        setCursor({
          x: Math.min(c.width, Math.max(0, Math.round(p0.x))),
          y: Math.min(c.height, Math.max(0, Math.round(p0.y))),
        });
      }
    }
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'pan') {
      const vp = viewportRef.current;
      if (vp) {
        vp.scrollLeft = d.sl - (e.clientX - d.sx);
        vp.scrollTop = d.st - (e.clientY - d.sy);
      }
      return;
    }
    const p = toPt(e);
    if (d.mode === 'rectsel') {
      setSelDraft({ a: d.a, b: p });
      return;
    }
    if (d.mode === 'lasso') {
      setLassoPts((prev) => (prev ? [...prev, p] : [p]));
      return;
    }
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

  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.mode === 'pan') {
      setPanning(false);
      return;
    }
    if (d?.mode === 'rectsel') {
      const p = toPt(e);
      if (Math.abs(p.x - d.a.x) > 3 && Math.abs(p.y - d.a.y) > 3) commitRectSel(d.a, p);
      else deselect(); // plain click clears the previous selection
      setSelDraft(null);
      return;
    }
    if (d?.mode === 'lasso') {
      if (lassoPts) commitLasso(lassoPts);
      else deselect();
      setLassoPts(null);
    }
  };

  const onDblClick = (e: PointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return;
    const hit = hitTest(toPt(e));
    if (hit?.type === 'text' && hit.pos) {
      setSel(hit.id);
      setTextEdit({ id: hit.id, pos: hit.pos, value: hit.text ?? '' });
    }
  };

  /** Composite base + objects into a fresh canvas (used by save & copy). */
  const composite = (): HTMLCanvasElement | null => {
    const base = baseRef.current;
    if (!base) return null;
    const out = document.createElement('canvas');
    out.width = base.bmp.width;
    out.height = base.bmp.height;
    const ctx = out.getContext('2d')!;
    if (bgOn) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(base.bmp, 0, 0);
    for (const o of objectsRef.current) drawObj(ctx, o);
    return out;
  };

  const copyCanvas = async () => {
    const out = composite();
    if (!out) return;
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard write not permitted */ }
  };

  // keyboard: Delete removes selection, Ctrl+C copies the composited image
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textEdit) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void copyCanvas();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel != null) {
        pushHist();
        setObjects((prev) => prev.filter((o) => o.id !== sel));
        setSel(null);
      }
      if (e.key === 'Escape') { setCropSel(null); setSel(null); deselect(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, textEdit]);

  // Ctrl+V: pasted text becomes a text object at the canvas centre
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (textEdit) return;
      const txt = e.clipboardData?.getData('text');
      if (!txt?.trim()) return;
      e.preventDefault();
      pushHist();
      const c = canvasRef.current;
      setObjects((prev) => [...prev, {
        id: ++objId, type: 'text', color, size: fontSize, visible: true,
        text: txt.trim(), pos: { x: (c?.width ?? 200) / 2, y: (c?.height ?? 200) / 2 },
        font: fontFam, weight: bold ? 800 : 600, outline: outlineOn,
      }]);
      setTool('select');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEdit, color, fontSize, fontFam, bold, outlineOn]);

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
        font: fontFam, weight: bold ? 800 : 600, outline: outlineOn,
      }]);
    }
    setTextEdit(null);
  };

  /** Flood over the base from p; visits similar-colour pixels and calls apply(i4). */
  const floodRegion = (p: Pt, apply: (data: Uint8ClampedArray, i4: number) => void): ImageData | null => {
    const base = baseRef.current;
    if (!base) return null;
    const W = base.bmp.width;
    const H = base.bmp.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(base.bmp, 0, 0);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const sx = Math.min(W - 1, Math.max(0, Math.round(p.x)));
    const sy = Math.min(H - 1, Math.max(0, Math.round(p.y)));
    const si = (sy * W + sx) * 4;
    const r0 = d[si];
    const g0 = d[si + 1];
    const b0 = d[si + 2];
    const tol = wandTol * 4.4;
    const visited = new Uint8Array(W * H);
    const stack = [sy * W + sx];
    visited[sy * W + sx] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      const i4 = idx * 4;
      const dr = d[i4] - r0;
      const dg = d[i4 + 1] - g0;
      const db = d[i4 + 2] - b0;
      if (Math.sqrt(dr * dr + dg * dg + db * db) > tol) continue;
      apply(d, i4);
      const x = idx % W;
      const y = (idx / W) | 0;
      if (x > 0 && !visited[idx - 1]) { visited[idx - 1] = 1; stack.push(idx - 1); }
      if (x < W - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && !visited[idx - W]) { visited[idx - W] = 1; stack.push(idx - W); }
      if (y < H - 1 && !visited[idx + W]) { visited[idx + W] = 1; stack.push(idx + W); }
    }
    return img;
  };

  const swapBase = async (c: HTMLCanvasElement) => {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob || !baseRef.current) return;
    const bmp = await createImageBitmap(blob);
    baseRef.current.bmp.close();
    baseRef.current = { blob, bmp };
    setBaseVer((v) => v + 1);
  };

  /** Paint-bucket: flood-fill the clicked region with the current colour. */
  const bucketFill = async (p: Pt) => {
    const base = baseRef.current;
    if (!base) return;
    pushHist();
    const n = parseInt(color.slice(1), 16);
    const fr = (n >> 16) & 255;
    const fg = (n >> 8) & 255;
    const fb = n & 255;
    const img = floodRegion(p, (d, i4) => { d[i4] = fr; d[i4 + 1] = fg; d[i4 + 2] = fb; d[i4 + 3] = 255; });
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = base.bmp.width;
    c.height = base.bmp.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    await swapBase(c);
  };

  const ensureMask = (): HTMLCanvasElement => {
    const base = baseRef.current!;
    const m = document.createElement('canvas');
    m.width = base.bmp.width;
    m.height = base.bmp.height;
    return m;
  };

  /** Magic wand: flood → selection mask (tracks the bounding box for the ants). */
  const wandSelect = (p: Pt) => {
    const base = baseRef.current;
    if (!base) return;
    const m = ensureMask();
    const mctx = m.getContext('2d')!;
    const mimg = mctx.createImageData(m.width, m.height);
    const W = m.width;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const img = floodRegion(p, (_d, i4) => {
      mimg.data[i4] = 255; mimg.data[i4 + 1] = 255; mimg.data[i4 + 2] = 255; mimg.data[i4 + 3] = 255;
      const idx = i4 / 4;
      const x = idx % W;
      const y = (idx / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    if (!img || maxX < 0) return;
    mctx.putImageData(mimg, 0, 0);
    maskRef.current = m;
    maskBBoxRef.current = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    buildTint();
    setSelVer((v) => v + 1);
  };

  const commitRectSel = (a: Pt, b: Pt) => {
    const m = ensureMask();
    const g = m.getContext('2d')!;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w2 = Math.abs(b.x - a.x);
    const h2 = Math.abs(b.y - a.y);
    g.fillStyle = '#fff';
    g.fillRect(x, y, w2, h2);
    maskRef.current = m;
    maskBBoxRef.current = { x, y, w: w2, h: h2 };
    buildTint();
    setSelVer((v) => v + 1);
  };

  const commitLasso = (pts: Pt[]) => {
    if (pts.length < 3) { deselect(); return; }
    const m = ensureMask();
    const g = m.getContext('2d')!;
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) g.lineTo(p.x, p.y);
    g.closePath();
    g.fill();
    maskRef.current = m;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    maskBBoxRef.current = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    buildTint();
    setSelVer((v) => v + 1);
  };

  // marching-ants animation loop — only runs while something is selected
  useEffect(() => {
    const active = !!maskRef.current || !!selDraft || !!(lassoPts && lassoPts.length > 1) || sel != null;
    if (!active) return;
    let raf = 0;
    const loop = () => {
      antsRef.current = (performance.now() / 400) % 1;
      render();
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selVer, selDraft, lassoPts, sel, render]);

  /** Fill or erase the selected region on the base. */
  const applyToSelection = async (mode: 'fill' | 'clear') => {
    const base = baseRef.current;
    const m = maskRef.current;
    if (!base || !m) return;
    pushHist();
    const c = document.createElement('canvas');
    c.width = base.bmp.width;
    c.height = base.bmp.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base.bmp, 0, 0);
    if (mode === 'clear') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(m, 0, 0);
    } else {
      const tmp = document.createElement('canvas');
      tmp.width = c.width;
      tmp.height = c.height;
      const tg = tmp.getContext('2d')!;
      tg.drawImage(m, 0, 0);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = color;
      tg.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(tmp, 0, 0);
    }
    await swapBase(c);
    deselect();
  };

  /** Resample the whole canvas (base + object coordinates). */
  const applyResize = async (nw: number, nh: number) => {
    const base = baseRef.current;
    if (!base) return;
    const w = Math.min(4096, Math.max(8, Math.round(nw)));
    const h = Math.min(4096, Math.max(8, Math.round(nh)));
    pushHist();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base.bmp, 0, 0, w, h);
    const sx = w / base.bmp.width;
    const sy = h / base.bmp.height;
    setObjects((prev) => prev.map((o) => ({
      ...mapObj(o, (p) => ({ x: p.x * sx, y: p.y * sy })),
      size: Math.max(1, o.size * (sx + sy) / 2),
    })));
    await swapBase(c);
    deselect();
    setResizeOpen(false);
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
    const out = composite();
    if (!out) return;
    out.toBlob((b) => {
      if (!b) return;
      const baseName = item.file.name.replace(/\.[^.]+$/, '');
      const file = new File([b], `${baseName}_edited.png`, { type: 'image/png' });
      if (onSave) {
        onSave(item.id, file);
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    }, 'image/png');
  };

  const cssScale = () => {
    const c = canvasRef.current;
    if (!c || !c.width) return 1;
    return (c.getBoundingClientRect().width || 1) / c.width;
  };

  void histVer;
  void selVer;
  const w = baseRef.current?.bmp.width ?? 0;

  return (
    <div
      className={inline ? 'ie-inline-wrap' : 'editor-overlay'}
      onClick={inline ? undefined : onClose}
    >
      <div
        className={`editor editor-wide${inline ? ' ie-inline' : ''}`}
        role={inline ? undefined : 'dialog'}
        aria-label={t('edit')}
        onClick={(e) => e.stopPropagation()}
      >
        {!inline && (
          <div className="ed-head">
            <span className="ed-title" title={item.file.name}>{item.file.name}</span>
            <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}

        <div className="ed-toolbar">
          {(Object.keys(TOOL_ICONS) as Tool[]).map((tl) => (
            <button
              key={tl}
              className={`tool-btn${tool === tl ? ' active' : ''}`}
              onClick={() => {
                setTool(tl);
                setCropSel(null);
                // switching to a drawing tool dismisses the selection
                if (!['pan', 'select', 'wand', 'rectsel', 'lasso'].includes(tl)) deselect();
              }}
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
          <button
            className="tool-btn"
            onClick={() => {
              const b = baseRef.current;
              if (b) { setRzW(b.bmp.width); setRzH(b.bmp.height); }
              setResizeOpen(true);
            }}
            title={t('resizeCanvas')}
          >
            <svg viewBox="0 0 24 24"><path d="M4 20L20 4M4 20v-5m0 5h5M20 4v5m0-5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="tb-sep" />
          <button className="tool-btn" onClick={undo} disabled={histRef.current.length === 0} title={t('undo')}>
            <svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn" onClick={redo} disabled={redoRef.current.length === 0} title={t('redo')}>
            <svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn" onClick={() => void copyCanvas()} title={copied ? t('copied') : `${t('copyResult')} (Ctrl+C)`}>
            {copied ? (
              <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            )}
          </button>
        </div>

        {/* options bar — always rendered at a fixed height so the canvas never shifts */}
        <div className="ed-options">
          <span className="opt-tool">{t(`tool_${tool}`)}</span>
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
          {(tool === 'pen' || selObj?.type === 'pen') && (
            <select
              className="tb-select"
              value={selObj?.type === 'pen' ? selObj.brush ?? 'pen' : brushType}
              onChange={(e) => {
                const v = e.target.value as Brush;
                if (selObj?.type === 'pen') { pushHist(); updateSel({ brush: v }); }
                else setBrushType(v);
              }}
              title={t('brush')}
            >
              <option value="pen">{t('brushPen')}</option>
              <option value="marker">{t('brushMarker')}</option>
              <option value="highlight">{t('brushHighlight')}</option>
            </select>
          )}
          {(tool === 'text' || selObj?.type === 'text') && (
            <>
              <select
                className="tb-select"
                value={selObj?.type === 'text' ? selObj.font ?? 'sans' : fontFam}
                onChange={(e) => {
                  const v = e.target.value as FontFam;
                  if (selObj?.type === 'text') { pushHist(); updateSel({ font: v }); }
                  else setFontFam(v);
                }}
                title={t('fontFamily')}
              >
                <option value="sans">{t('fontSans')}</option>
                <option value="serif">{t('fontSerif')}</option>
                <option value="mono">{t('fontMono')}</option>
              </select>
              <button
                className={`tool-btn${(selObj?.type === 'text' ? selObj.weight === 800 : bold) ? ' active' : ''}`}
                title={t('bold')}
                onClick={() => {
                  if (selObj?.type === 'text') { pushHist(); updateSel({ weight: selObj.weight === 800 ? 600 : 800 }); }
                  else setBold((b) => !b);
                }}
              >
                <strong>B</strong>
              </button>
              <button
                className={`tool-btn${(selObj?.type === 'text' ? !!selObj.outline : outlineOn) ? ' active' : ''}`}
                title={t('outline')}
                onClick={() => {
                  if (selObj?.type === 'text') { pushHist(); updateSel({ outline: !selObj.outline }); }
                  else setOutlineOn((o) => !o);
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" /></svg>
              </button>
            </>
          )}
          {tool === 'wand' && (
            <label className="tb-slider" title={t('tolerance')}>
              <input type="range" min={5} max={90} value={wandTol} onChange={(e) => setWandTol(Number(e.target.value))} />
              <span className="zoom-val">{wandTol}</span>
            </label>
          )}
          {cropSel && (
            <button className="btn btn-accent btn-sm" onClick={applyCrop}>{t('applyCrop')}</button>
          )}
          {maskRef.current && (
            <>
              <button className="btn btn-accent btn-sm" onClick={() => void applyToSelection('fill')}>{t('fillSel')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => void applyToSelection('clear')}>{t('clearSel')}</button>
              <button className="btn btn-ghost btn-sm" onClick={deselect}>{t('deselect')}</button>
            </>
          )}
          <span className="opt-spacer" />
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
          <div className="ie-vpwrap">
          <div className="ie-viewport" ref={viewportRef}>
            <div className="ie-inner" style={{ width: w * zoom || undefined }}>
              <canvas
                ref={canvasRef}
                className="ie-canvas2"
                style={{
                  width: w * zoom || undefined,
                  cursor: panning ? 'grabbing' : tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair',
                }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={() => setCursor(null)}
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
                    color: textEdit.id != null ? selObj?.color ?? color : color,
                    fontFamily: FONT_MAP[textEdit.id != null ? (selObj?.font ?? 'sans') : fontFam],
                    fontWeight: (textEdit.id != null ? selObj?.weight === 800 : bold) ? 800 : 600,
                  }}
                  onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextEdit(null); }}
                  onBlur={commitText}
                />
              )}
            </div>
          </div>
          <span className="zoom-float">
            {w}×{baseRef.current?.bmp.height ?? 0}px
            <span className="zf-sep">·</span>
            {cursor ? `${cursor.x}, ${cursor.y}` : '–, –'}
            <span className="zf-sep">·</span>
            {Math.round(zoom * 100)}%
          </span>
          </div>

          <aside className="layers-panel">
            <p className="mx-label">{t('layers')}</p>
            {objects.length === 0 && <p className="ed-hint">—</p>}
            {[...objects].reverse().map((o) => (
              <div
                key={o.id}
                className={`layer-item${sel === o.id ? ' active' : ''}`}
                ref={(el) => { if (sel === o.id && el) el.scrollIntoView({ block: 'nearest' }); }}
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

            {/* background: a permanent layer pinned to the very bottom */}
            <div className="layer-item layer-bg" title={t('bgLayer')}>
              <button
                className="layer-eye"
                onClick={() => applyBg(bgColor, !bgOn)}
                title={t(bgOn ? 'transparentBg' : 'bgLayer')}
              >
                {bgOn ? (
                  <svg viewBox="0 0 24 24" width="13" height="13"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 4l16 16M2 12s4-7 10-7c1.8 0 3.4.6 4.8 1.4M22 12s-4 7-10 7c-1.8 0-3.4-.6-4.8-1.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                )}
              </button>
              <input
                type="color"
                className="layer-bg-swatch"
                value={bgColor}
                onChange={(e) => applyBg(e.target.value, true)}
                title={t('bgLayer')}
              />
              <span className={`layer-name${bgOn ? '' : ' layer-off'}`}>{t('bgLayerName')}</span>
              {!bgOn && <span className="asset-size">{t('transparentBg')}</span>}
            </div>
          </aside>
        </div>

        <div className="ed-foot">
          <span className="kbd-hints">
            <span><kbd>Ctrl</kbd>+<kbd>C</kbd> {t('kbdCopyImg')}</span>
            <span><kbd>Ctrl</kbd>+<kbd>V</kbd> {t('kbdPasteText')}</span>
            <span><kbd>Del</kbd> {t('kbdDelete')}</span>
          </span>
          <div className="ed-foot-main">
            {!inline && <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>}
            <button className="btn btn-accent" onClick={save} disabled={!ready}>
              {inline ? t('exportToAssets') : t('save')}
            </button>
          </div>
        </div>

        {resizeOpen && (
          <div className="editor-overlay" onClick={() => setResizeOpen(false)}>
            <div className="editor mini-modal" onClick={(e) => e.stopPropagation()}>
              <p className="mx-label">{t('resizeCanvas')}</p>
              <div className="ed-seg">
                <button className={rzMode === 'pct' ? 'active' : ''} onClick={() => setRzMode('pct')}>{t('percentMode')}</button>
                <button className={rzMode === 'abs' ? 'active' : ''} onClick={() => setRzMode('abs')}>{t('absMode')}</button>
              </div>
              {rzMode === 'pct' ? (
                <label className="sp-field">
                  <span className="sp-label">% <span className="sp-val">{rzPct}%</span></span>
                  <input type="range" min={10} max={200} value={rzPct} onChange={(e) => setRzPct(Number(e.target.value))} />
                </label>
              ) : (
                <div className="rz-grid">
                  <input type="number" className="num-sm" min={8} max={4096} value={rzW} onChange={(e) => setRzW(Number(e.target.value))} />
                  <span className="cap-dash">×</span>
                  <input type="number" className="num-sm" min={8} max={4096} value={rzH} onChange={(e) => setRzH(Number(e.target.value))} />
                </div>
              )}
              <div className="ed-foot-main">
                <button className="btn btn-ghost" onClick={() => setResizeOpen(false)}>{t('cancel')}</button>
                <button
                  className="btn btn-accent"
                  onClick={() => {
                    const b = baseRef.current;
                    if (!b) return;
                    if (rzMode === 'pct') void applyResize(b.bmp.width * rzPct / 100, b.bmp.height * rzPct / 100);
                    else void applyResize(rzW, rzH);
                  }}
                >
                  {t('applyLabel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
