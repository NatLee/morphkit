import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { useSplitter } from '../lib/useSplitter';
import { Overlay } from './Overlay';
import { ColorPicker } from './ColorPicker';
import type { Item } from '../types';

/* Raster layer model (Photoshop-style): a LAYER *is* the drawing surface.
   Every tool paints straight into the active layer's pixels — there are no
   sub-objects. Layers stack with opacity / blend mode / mask. */

type Tool =
  | 'pan' | 'move' | 'pen' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'crop'
  | 'wand' | 'rectsel' | 'lasso' | 'fill';
type FontFam = 'sans' | 'serif' | 'mono';
type Brush = 'pen' | 'marker' | 'highlight';

interface Pt { x: number; y: number }

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'soft-light', 'hard-light', 'difference', 'exclusion',
] as const;
export type Blend = typeof BLEND_MODES[number];

/** Persisted layer record — `src` holds the layer's pixels as a PNG dataURL. */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: Blend;
  /** alpha mask dataURL (opaque = visible); null = none */
  mask: string | null;
  maskEnabled: boolean;
  /** pixels; empty string = blank layer */
  src: string;
}

let layerSeq = 0;
const newLayerId = () => `L${Date.now().toString(36)}${(layerSeq++).toString(36)}`;

export const newLayer = (name: string): Layer => ({
  id: newLayerId(), name, visible: true, locked: false, opacity: 1, blend: 'normal',
  mask: null, maskEnabled: true, src: '',
});

const maskBmpCache = new Map<string, ImageBitmap>();

/** Desktop layers-panel width bounds (px) for the .ie-gutter splitter. */
const PANEL_MIN = 200;
const PANEL_MAX = 520;
const PANEL_DEF = 262;

/** Always-visible palette — no picker click needed for common colours. */
const SWATCHES = [
  '#000000', '#ffffff', '#8a8f98', '#38dfff', '#ffc23e',
  '#2f9e57', '#2f7fd1', '#7a4fd1', '#d13f6e', '#8a5a2b',
];

export const FONT_MAP: Record<FontFam, string> = {
  sans: "'IBM Plex Sans', 'Noto Sans TC', 'Microsoft JhengHei', 'Yu Gothic', sans-serif",
  serif: "'Instrument Serif', 'Noto Serif TC', 'Yu Mincho', serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

function lumOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return 0;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

const MAX_DIM = 4096;
const HIST_CAP = 14;

const TOOL_ICONS: Record<Tool, string> = {
  pan: 'M12 2v20M2 12h20M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5M2 12l2.5-2.5M2 12l2.5 2.5M22 12l-2.5-2.5M22 12l-2.5 2.5',
  move: 'M6 3l12 9-6 1 3 6-3 1.5L9 14l-3 4z',
  pen: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3',
  eraser: 'M4 16l8-8 5 5-8 8zM7.5 12.5l5 5M5 22h15',
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

interface HistEntry {
  meta: Layer[];
  /** layer id → pixels dataURL */
  pixels: Record<string, string>;
  baseBlob: Blob;
}

/** Thumbnail of a layer's pixels for the panel row. */
function LayerThumb({ src, ratio }: { src: string; ratio: number }) {
  const h = Math.max(10, Math.round(36 / (ratio || 1)));
  return (
    <span className="lp-thumb" style={{ height: h }}>
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

interface Props {
  item: Item;
  onSave?: (id: string, file: File) => void;
  onClose?: () => void;
  inline?: boolean;
  initialLayers?: Layer[];
  onLayersChange?: (layers: Layer[]) => void;
  bg?: string | null;
  onBgChange?: (c: string | null) => void;
  onBaseChange?: (blob: Blob) => void;
  importBlob?: Blob | null;
  onImportDone?: () => void;
}

export function ImageEditor({
  item, onSave, onClose, inline, initialLayers, onLayersChange,
  bg, onBgChange, onBaseChange, importBlob, onImportDone,
}: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<{ blob: Blob; bmp: ImageBitmap } | null>(null);
  const histRef = useRef<HistEntry[]>([]);
  const redoRef = useRef<HistEntry[]>([]);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null); // live shape preview
  /** runtime pixels per layer */
  const pixRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  /** base already baked into a layer by the eraser (see promoteBase) */
  const basePromotedRef = useRef(false);
  /** transparent stand-in base at the current dims, kept ready for promoteBase */
  const blankBaseRef = useRef<{ blob: Blob; bmp: ImageBitmap } | null>(null);

  const dragRef = useRef<
    // layerId pins the stroke to a layer created mid-gesture (eraser base promotion),
    // whose id has not reached React state yet
    | { mode: 'paint'; last: Pt; layerId?: string }
    | { mode: 'shape'; a: Pt }
    | { mode: 'movepx'; last: Pt }
    | { mode: 'crop'; a: Pt }
    | { mode: 'rectsel'; a: Pt }
    | { mode: 'lasso' }
    | { mode: 'pan'; sx: number; sy: number; sl: number; st: number }
    | null
  >(null);

  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const layersRef = useRef<Layer[]>([]);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  const activeLayer = layers.find((l) => l.id === activeId) ?? null;

  const [tool, setTool] = useState<Tool>('pan');
  const [color, setColor] = useState('#38dfff');
  const [size, setSize] = useState(4);
  const [fontSize, setFontSize] = useState(32);
  const [fontFam, setFontFam] = useState<FontFam>('sans');
  const [bold, setBold] = useState(false);
  const [outlineOn, setOutlineOn] = useState(false);
  const [wandTol, setWandTol] = useState(30);
  const [brushType, setBrushType] = useState<Brush>('pen');
  const [zoom, setZoom] = useState(1);
  const [baseVer, setBaseVer] = useState(0);
  const [pixVer, setPixVer] = useState(0);
  const [histVer, setHistVer] = useState(0);
  const [selVer, setSelVer] = useState(0);
  const [cropSel, setCropSel] = useState<{ a: Pt; b: Pt } | null>(null);
  const [selDraft, setSelDraft] = useState<{ a: Pt; b: Pt } | null>(null);
  const [lassoPts, setLassoPts] = useState<Pt[] | null>(null);
  const [textEdit, setTextEdit] = useState<{ pos: Pt; value: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [panning, setPanning] = useState(false);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState<string>(bg ?? '#ffffff');
  const [bgOn, setBgOn] = useState<boolean>(bg != null);
  const [resizeOpen, setResizeOpen] = useState(false);
  // mobile bottom-sheet state for the layers panel (desktop ignores it — CSS)
  const [panelOpen, setPanelOpen] = useState(false);
  // desktop layers-panel width, draggable via the .ie-gutter splitter (persisted)
  const { size: panelW, gutterProps } = useSplitter('morphkit-iepw', PANEL_DEF, PANEL_MIN, PANEL_MAX, { invert: true });
  const [rzMode, setRzMode] = useState<'pct' | 'abs'>('pct');
  const [rzPct, setRzPct] = useState(50);
  const [rzW, setRzW] = useState(0);
  const [rzH, setRzH] = useState(0);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const tintRef = useRef<HTMLCanvasElement | null>(null);
  const maskBBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const antsRef = useRef(0);

  const W = () => baseRef.current?.bmp.width ?? 0;
  const H = () => baseRef.current?.bmp.height ?? 0;

  // ---- layer pixel helpers ----
  const layerCanvas = (id: string): HTMLCanvasElement => {
    let c = pixRef.current.get(id);
    if (!c) {
      c = document.createElement('canvas');
      c.width = W() || 1;
      c.height = H() || 1;
      pixRef.current.set(id, c);
    }
    if (c.width !== W() && W()) {
      // canvas size changed under us — grow while keeping content
      const old = c;
      const n = document.createElement('canvas');
      n.width = W();
      n.height = H();
      n.getContext('2d')!.drawImage(old, 0, 0);
      pixRef.current.set(id, n);
      c = n;
    }
    return c;
  };

  const activeCtx = (): CanvasRenderingContext2D | null => {
    if (!activeLayer || activeLayer.locked) return null;
    return layerCanvas(activeLayer.id).getContext('2d');
  };

  /** Persist the active layer's pixels back into state (debounced by caller). */
  const commitPixels = (id: string) => {
    const c = pixRef.current.get(id);
    if (!c) return;
    const src = c.toDataURL('image/png');
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, src } : l)));
    setPixVer((v) => v + 1);
  };

  const applyBg = (colour: string, on: boolean) => {
    setBgColor(colour);
    setBgOn(on);
    onBgChange?.(on ? colour : null);
  };

  const patchLayer = (id: string, p: Partial<Layer>) =>
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...p } : l)));

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
      basePromotedRef.current = false;

      const restored = initialLayers?.length ? initialLayers : [newLayer('Layer 1')];
      pixRef.current.clear();
      for (const l of restored) {
        const lc = document.createElement('canvas');
        lc.width = bmp.width;
        lc.height = bmp.height;
        if (l.src) {
          try {
            const b = await (await fetch(l.src)).blob();
            const lb = await createImageBitmap(b);
            lc.getContext('2d')!.drawImage(lb, 0, 0);
            lb.close();
          } catch { /* unreadable layer */ }
        }
        pixRef.current.set(l.id, lc);
      }
      if (cancelled) return;
      setLayers(restored);
      setActiveId(restored[restored.length - 1].id);

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

  useEffect(() => {
    if (ready) onLayersChange?.(layersRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, ready]);

  const firstBaseRef = useRef(true);
  useEffect(() => {
    if (!ready || !baseRef.current) return;
    if (firstBaseRef.current) { firstBaseRef.current = false; return; }
    onBaseChange?.(baseRef.current.blob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseVer, ready]);

  /* Keep a transparent base of the current size on hand so the eraser can
     promote the base synchronously mid-gesture (see promoteBase). */
  useEffect(() => {
    if (!ready) return;
    const w = W();
    const h = H();
    if (!w || !h) return;
    const have = blankBaseRef.current;
    if (have && have.bmp.width === w && have.bmp.height === h) return;
    let stale = false;
    void (async () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (!blob || stale) return;
      const bmp = await createImageBitmap(blob);
      if (stale) { bmp.close(); return; }
      blankBaseRef.current?.bmp.close();
      blankBaseRef.current = { blob, bmp };
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, baseVer]);

  // decode masks
  useEffect(() => {
    let stale = false;
    void (async () => {
      let got = false;
      for (const l of layers) {
        if (l.mask && !maskBmpCache.has(l.mask)) {
          try {
            const b = await (await fetch(l.mask)).blob();
            const bmp = await createImageBitmap(b);
            if (stale) { bmp.close(); return; }
            maskBmpCache.set(l.mask, bmp);
            got = true;
          } catch { /* bad mask */ }
        }
      }
      if (got && !stale) setSelVer((v) => v + 1);
    })();
    return () => { stale = true; };
  }, [layers]);

  // ---- rendering ----
  const paintLayers = (ctx: CanvasRenderingContext2D, w: number, h: number, withPreview: boolean) => {
    let scratch = scratchRef.current;
    if (!scratch) { scratch = document.createElement('canvas'); scratchRef.current = scratch; }
    if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
    const sctx = scratch.getContext('2d')!;

    for (const l of layersRef.current) {
      if (!l.visible || l.opacity <= 0) continue;
      const lc = pixRef.current.get(l.id);
      if (!lc) continue;
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(lc, 0, 0);
      // live shape preview belongs to the active layer
      if (withPreview && previewRef.current && l.id === activeId) {
        sctx.drawImage(previewRef.current, 0, 0);
      }
      if (l.mask && l.maskEnabled) {
        const mb = maskBmpCache.get(l.mask);
        if (mb) {
          sctx.save();
          sctx.globalCompositeOperation = 'destination-in';
          sctx.drawImage(mb, 0, 0, w, h);
          sctx.restore();
        }
      }
      ctx.save();
      ctx.globalAlpha = l.opacity;
      if (l.blend !== 'normal') ctx.globalCompositeOperation = l.blend as GlobalCompositeOperation;
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
    }
  };

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
    paintLayers(ctx, c.width, c.height, true);

    const drawAnts = (path: () => void) => {
      ctx.save();
      const lw = Math.max(1.25, 1.5 / zoom);
      const dash = Math.max(4, 6 / zoom);
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); path(); ctx.stroke();
      ctx.setLineDash([dash, dash]);
      ctx.lineDashOffset = -antsRef.current * dash * 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.beginPath(); path(); ctx.stroke();
      ctx.restore();
    };

    if (tintRef.current) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.drawImage(tintRef.current, 0, 0);
      ctx.restore();
      const bb = maskBBoxRef.current;
      if (bb) drawAnts(() => ctx.rect(bb.x, bb.y, bb.w, bb.h));
    }
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
    if (cropSel) {
      const { a, b } = cropSel;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w2 = Math.abs(b.x - a.x);
      const h2 = Math.abs(b.y - a.y);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.clearRect(x, y, w2, h2);
      ctx.drawImage(base.bmp, x, y, w2, h2, x, y, w2, h2);
      ctx.restore();
      drawAnts(() => ctx.rect(x, y, w2, h2));
    }
  }, [zoom, bgColor, bgOn, selDraft, lassoPts, cropSel, activeId]);

  useEffect(() => { render(); }, [layers, baseVer, pixVer, selVer, render]);

  // marching-ants loop
  useEffect(() => {
    const active = !!maskRef.current || !!selDraft || !!(lassoPts && lassoPts.length > 1) || !!cropSel;
    if (!active) return;
    let raf = 0;
    const loop = () => {
      antsRef.current = (performance.now() / 400) % 1;
      render();
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [selVer, selDraft, lassoPts, cropSel, render]);

  // wheel zoom anchored at the cursor
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

  // ---- history (pixels + metadata) ----
  const snapshot = (): HistEntry | null => {
    if (!baseRef.current) return null;
    const pixels: Record<string, string> = {};
    for (const l of layersRef.current) {
      const c = pixRef.current.get(l.id);
      if (c) pixels[l.id] = c.toDataURL('image/png');
    }
    return { meta: layersRef.current.map((l) => ({ ...l })), pixels, baseBlob: baseRef.current.blob };
  };

  const pushHist = () => {
    const s = snapshot();
    if (!s) return;
    histRef.current.push(s);
    if (histRef.current.length > HIST_CAP) histRef.current.shift();
    redoRef.current = [];
    setHistVer((v) => v + 1);
  };

  const applyHist = async (e: HistEntry) => {
    if (baseRef.current && e.baseBlob !== baseRef.current.blob) {
      const bmp = await createImageBitmap(e.baseBlob);
      baseRef.current.bmp.close();
      baseRef.current = { blob: e.baseBlob, bmp };
      // this may restore a base the eraser had baked away — let it promote again
      basePromotedRef.current = false;
      setBaseVer((v) => v + 1);
    }
    pixRef.current.clear();
    for (const l of e.meta) {
      const c = document.createElement('canvas');
      c.width = W() || 1;
      c.height = H() || 1;
      const src = e.pixels[l.id];
      if (src) {
        try {
          const b = await (await fetch(src)).blob();
          const bmp = await createImageBitmap(b);
          c.getContext('2d')!.drawImage(bmp, 0, 0);
          bmp.close();
        } catch { /* ignore */ }
      }
      pixRef.current.set(l.id, c);
    }
    setLayers(e.meta);
    if (!e.meta.some((l) => l.id === activeId)) setActiveId(e.meta[e.meta.length - 1]?.id ?? '');
    setCropSel(null);
    deselect();
    setPixVer((v) => v + 1);
  };

  const undo = async () => {
    const e = histRef.current.pop();
    if (!e) return;
    const cur = snapshot();
    if (cur) redoRef.current.push(cur);
    await applyHist(e);
    setHistVer((v) => v + 1);
  };

  const redo = async () => {
    const e = redoRef.current.pop();
    if (!e) return;
    const cur = snapshot();
    if (cur) histRef.current.push(cur);
    await applyHist(e);
    setHistVer((v) => v + 1);
  };

  // ---- selection helpers ----
  const buildTint = () => {
    const m = maskRef.current;
    if (!m) { tintRef.current = null; return; }
    const c = document.createElement('canvas');
    c.width = m.width;
    c.height = m.height;
    const g = c.getContext('2d')!;
    g.drawImage(m, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#38dfff';
    g.fillRect(0, 0, c.width, c.height);
    tintRef.current = c;
  };

  const deselect = () => {
    maskRef.current = null;
    tintRef.current = null;
    maskBBoxRef.current = null;
    setSelVer((v) => v + 1);
  };

  // ---- painting ----
  const strokeStyleFor = (ctx: CanvasRenderingContext2D, erase = false) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (erase) {
      // punch alpha out of the layer instead of adding paint — brush styles don't apply
      ctx.globalCompositeOperation = 'destination-out';
      return;
    }
    if (brushType === 'marker') { ctx.globalAlpha = 0.7; ctx.lineWidth = size * 1.8; }
    else if (brushType === 'highlight') { ctx.globalAlpha = 0.32; ctx.lineWidth = size * 3; ctx.lineCap = 'butt'; }
  };

  /** Cheap "are these pixels fully transparent?" probe (downscaled alpha sample). */
  const looksBlank = (src: CanvasImageSource | null | undefined): boolean => {
    if (!src) return true;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, 0, 0, 256, 256);
    const d = g.getImageData(0, 0, 256, 256).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
    return true;
  };

  /**
   * The base image is immutable and composited UNDER every layer, so a
   * destination-out stroke could never reach it — erasing an untouched photo
   * would look broken. On the first eraser stroke we promote the base into a
   * real bottom layer and swap in the pre-built transparent base, after which
   * erasing behaves like any raster editor. Returns the canvas to stroke into
   * (the caller is mid-gesture, so it cannot wait for React state).
   * Synchronous by design: an async base swap could land after an undo.
   */
  const promoteBase = (): { id: string; canvas: HTMLCanvasElement } | null => {
    const base = baseRef.current;
    const blank = blankBaseRef.current;
    if (!base || !blank) return null;
    basePromotedRef.current = true;
    const c = document.createElement('canvas');
    c.width = W();
    c.height = H();
    c.getContext('2d')!.drawImage(base.bmp, 0, 0);
    const l = newLayer(t('baseLayerName'));
    pixRef.current.set(l.id, c);
    // index 0 = bottom of the stack; src is filled in by commitPixels at gesture end
    setLayers((prev) => [l, ...prev]);
    setActiveId(l.id);
    // history holds the old blob, so the bitmap can go; blobs are never closed
    base.bmp.close();
    baseRef.current = blank;
    blankBaseRef.current = null; // consumed — the effect below builds the next one
    setBaseVer((v) => v + 1);
    return { id: l.id, canvas: c };
  };

  const drawShape = (ctx: CanvasRenderingContext2D, a: Pt, b: Pt, kind: Tool) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (kind === 'line' || kind === 'arrow') {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (kind === 'arrow') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = Math.max(12, size * 3.5);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45));
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45));
        ctx.stroke();
      }
    } else if (kind === 'rect') {
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (kind === 'ellipse') {
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  const preview = (): CanvasRenderingContext2D | null => {
    let p = previewRef.current;
    if (!p) { p = document.createElement('canvas'); previewRef.current = p; }
    if (p.width !== W() || p.height !== H()) { p.width = W(); p.height = H(); }
    return p.getContext('2d');
  };

  const clearPreview = () => {
    const p = previewRef.current;
    if (p) p.getContext('2d')!.clearRect(0, 0, p.width, p.height);
  };

  // ---- composite (for export / sampling) ----
  const composite = (): HTMLCanvasElement | null => {
    const base = baseRef.current;
    if (!base) return null;
    const out = document.createElement('canvas');
    out.width = base.bmp.width;
    out.height = base.bmp.height;
    const ctx = out.getContext('2d', { willReadFrequently: true })!;
    if (bgOn) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(base.bmp, 0, 0);
    paintLayers(ctx, out.width, out.height, false);
    return out;
  };

  /** Flood from p over the composited view; apply(i4) marks matched pixels. */
  const floodRegion = (p: Pt, apply: (i4: number) => void): boolean => {
    const c = composite();
    if (!c) return false;
    const w = c.width;
    const h = c.height;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    const sx = Math.min(w - 1, Math.max(0, Math.round(p.x)));
    const sy = Math.min(h - 1, Math.max(0, Math.round(p.y)));
    const si = (sy * w + sx) * 4;
    const r0 = d[si];
    const g0 = d[si + 1];
    const b0 = d[si + 2];
    const tol = wandTol * 4.4;
    const visited = new Uint8Array(w * h);
    const stack = [sy * w + sx];
    visited[sy * w + sx] = 1;
    let any = false;
    while (stack.length) {
      const idx = stack.pop()!;
      const i4 = idx * 4;
      const dr = d[i4] - r0;
      const dg = d[i4 + 1] - g0;
      const db = d[i4 + 2] - b0;
      if (Math.sqrt(dr * dr + dg * dg + db * db) > tol) continue;
      apply(i4);
      any = true;
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x > 0 && !visited[idx - 1]) { visited[idx - 1] = 1; stack.push(idx - 1); }
      if (x < w - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && !visited[idx - w]) { visited[idx - w] = 1; stack.push(idx - w); }
      if (y < h - 1 && !visited[idx + w]) { visited[idx + w] = 1; stack.push(idx + w); }
    }
    return any;
  };

  /** Paint bucket — fills the clicked region INTO the active layer. */
  const bucketFill = (p: Pt) => {
    const ctx = activeCtx();
    if (!ctx || !activeLayer) return;
    pushHist();
    const w = W();
    const h = H();
    const n = parseInt(color.slice(1), 16);
    const fr = (n >> 16) & 255;
    const fg = (n >> 8) & 255;
    const fb = n & 255;
    const patch = ctx.createImageData(w, h);
    const ok = floodRegion(p, (i4) => {
      patch.data[i4] = fr;
      patch.data[i4 + 1] = fg;
      patch.data[i4 + 2] = fb;
      patch.data[i4 + 3] = 255;
    });
    if (!ok) return;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d')!.putImageData(patch, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    commitPixels(activeLayer.id);
  };

  const wandSelect = (p: Pt) => {
    const w = W();
    const h = H();
    if (!w) return;
    const m = document.createElement('canvas');
    m.width = w;
    m.height = h;
    const mctx = m.getContext('2d')!;
    const mimg = mctx.createImageData(w, h);
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const ok = floodRegion(p, (i4) => {
      mimg.data[i4] = 255; mimg.data[i4 + 1] = 255; mimg.data[i4 + 2] = 255; mimg.data[i4 + 3] = 255;
      const idx = i4 / 4;
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    if (!ok || maxX < 0) return;
    mctx.putImageData(mimg, 0, 0);
    maskRef.current = m;
    maskBBoxRef.current = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    buildTint();
    setSelVer((v) => v + 1);
  };

  const commitRectSel = (a: Pt, b: Pt) => {
    const m = document.createElement('canvas');
    m.width = W();
    m.height = H();
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
    const m = document.createElement('canvas');
    m.width = W();
    m.height = H();
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

  /** Fill or erase the selection — both happen inside the active layer. */
  const applyToSelection = (mode: 'fill' | 'clear') => {
    const ctx = activeCtx();
    const m = maskRef.current;
    if (!ctx || !m || !activeLayer) return;
    pushHist();
    ctx.save();
    if (mode === 'clear') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(m, 0, 0);
    } else {
      const tinted = document.createElement('canvas');
      tinted.width = m.width;
      tinted.height = m.height;
      const tg = tinted.getContext('2d')!;
      tg.drawImage(m, 0, 0);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = color;
      tg.fillRect(0, 0, tinted.width, tinted.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tinted, 0, 0);
    }
    ctx.restore();
    commitPixels(activeLayer.id);
    deselect();
  };

  // ---- geometry (base + every layer) ----
  const swapBase = async (c: HTMLCanvasElement) => {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob || !baseRef.current) return;
    const bmp = await createImageBitmap(blob);
    baseRef.current.bmp.close();
    baseRef.current = { blob, bmp };
    setBaseVer((v) => v + 1);
  };

  /** Apply a canvas transform to every layer's pixels. */
  const transformLayers = (nw: number, nh: number, draw: (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement) => void) => {
    for (const l of layersRef.current) {
      const src = pixRef.current.get(l.id);
      if (!src) continue;
      const n = document.createElement('canvas');
      n.width = nw;
      n.height = nh;
      const g = n.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      draw(g, src);
      pixRef.current.set(l.id, n);
    }
    setLayers((prev) => prev.map((l) => {
      const c = pixRef.current.get(l.id);
      return c ? { ...l, src: c.toDataURL('image/png') } : l;
    }));
    setPixVer((v) => v + 1);
  };

  const applyCrop = async () => {
    if (!cropSel || !baseRef.current) return;
    pushHist();
    const { a, b } = cropSel;
    const x = Math.round(Math.min(a.x, b.x));
    const y = Math.round(Math.min(a.y, b.y));
    const w2 = Math.max(1, Math.round(Math.abs(b.x - a.x)));
    const h2 = Math.max(1, Math.round(Math.abs(b.y - a.y)));
    const tmp = document.createElement('canvas');
    tmp.width = w2;
    tmp.height = h2;
    tmp.getContext('2d')!.drawImage(baseRef.current.bmp, x, y, w2, h2, 0, 0, w2, h2);
    transformLayers(w2, h2, (g, src) => g.drawImage(src, x, y, w2, h2, 0, 0, w2, h2));
    await swapBase(tmp);
    setCropSel(null);
  };

  const transform = async (kind: 'rot' | 'flip') => {
    if (!baseRef.current) return;
    pushHist();
    const src = baseRef.current.bmp;
    const w0 = src.width;
    const h0 = src.height;
    const nw = kind === 'rot' ? h0 : w0;
    const nh = kind === 'rot' ? w0 : h0;
    const tmp = document.createElement('canvas');
    tmp.width = nw;
    tmp.height = nh;
    const ctx = tmp.getContext('2d')!;
    const setup = (g: CanvasRenderingContext2D) => {
      if (kind === 'rot') { g.translate(h0, 0); g.rotate(Math.PI / 2); }
      else { g.translate(w0, 0); g.scale(-1, 1); }
    };
    setup(ctx);
    ctx.drawImage(src, 0, 0);
    transformLayers(nw, nh, (g, s) => { setup(g); g.drawImage(s, 0, 0); });
    await swapBase(tmp);
    setCropSel(null);
  };

  const applyResize = async (nwIn: number, nhIn: number) => {
    const base = baseRef.current;
    if (!base) return;
    const nw = Math.min(4096, Math.max(8, Math.round(nwIn)));
    const nh = Math.min(4096, Math.max(8, Math.round(nhIn)));
    pushHist();
    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base.bmp, 0, 0, nw, nh);
    transformLayers(nw, nh, (g, s) => g.drawImage(s, 0, 0, nw, nh));
    await swapBase(c);
    deselect();
    setResizeOpen(false);
  };

  // ---- layer ops ----
  const addLayer = () => {
    pushHist();
    const l = newLayer(`Layer ${layers.length + 1}`);
    const c = document.createElement('canvas');
    c.width = W() || 1;
    c.height = H() || 1;
    pixRef.current.set(l.id, c);
    setLayers((prev) => [...prev, l]);
    setActiveId(l.id);
  };

  const duplicateLayer = (id: string) => {
    pushHist();
    const src = pixRef.current.get(id);
    const meta = layersRef.current.find((l) => l.id === id);
    if (!src || !meta) return;
    const copy: Layer = { ...meta, id: newLayerId(), name: `${meta.name} copy` };
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    pixRef.current.set(copy.id, c);
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
    setActiveId(copy.id);
  };

  /** Layers can be deleted down to zero — the panel just locks up. */
  const deleteLayer = (id: string) => {
    pushHist();
    pixRef.current.delete(id);
    setLayers((prev) => {
      const next = prev.filter((l) => l.id !== id);
      if (!next.some((l) => l.id === activeId)) {
        setActiveId(next[next.length - 1]?.id ?? '');
      }
      return next;
    });
  };

  const moveLayer = (id: string, dir: 1 | -1) => {
    pushHist();
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  /** Flatten a layer onto the one below it. */
  const mergeDown = (id: string) => {
    const stack = layersRef.current;
    const i = stack.findIndex((l) => l.id === id);
    if (i <= 0) return;
    pushHist();
    const upper = stack[i];
    const lower = stack[i - 1];
    const uc = pixRef.current.get(upper.id);
    const lc = pixRef.current.get(lower.id);
    if (!uc || !lc) return;
    const g = lc.getContext('2d')!;
    g.save();
    g.globalAlpha = upper.opacity;
    if (upper.blend !== 'normal') g.globalCompositeOperation = upper.blend as GlobalCompositeOperation;
    // bake the upper layer's mask before merging
    if (upper.mask && upper.maskEnabled) {
      const mb = maskBmpCache.get(upper.mask);
      if (mb) {
        const masked = document.createElement('canvas');
        masked.width = uc.width;
        masked.height = uc.height;
        const mg = masked.getContext('2d')!;
        mg.drawImage(uc, 0, 0);
        mg.globalCompositeOperation = 'destination-in';
        mg.drawImage(mb, 0, 0, masked.width, masked.height);
        g.drawImage(masked, 0, 0);
      } else g.drawImage(uc, 0, 0);
    } else {
      g.drawImage(uc, 0, 0);
    }
    g.restore();
    pixRef.current.delete(upper.id);
    setLayers((prev) => prev
      .filter((l) => l.id !== upper.id)
      .map((l) => (l.id === lower.id ? { ...l, src: lc.toDataURL('image/png') } : l)));
    setActiveId(lower.id);
    setPixVer((v) => v + 1);
  };

  const maskFromSelection = () => {
    const m = maskRef.current;
    if (!m || !activeLayer) return;
    pushHist();
    patchLayer(activeLayer.id, { mask: m.toDataURL('image/png'), maskEnabled: true });
    deselect();
  };

  const invertMask = () => {
    if (!activeLayer?.mask) return;
    const bmp = maskBmpCache.get(activeLayer.mask);
    if (!bmp) return;
    pushHist();
    const c = document.createElement('canvas');
    c.width = W();
    c.height = H();
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    patchLayer(activeLayer.id, { mask: c.toDataURL('image/png') });
  };

  const clearMask = () => {
    if (!activeLayer) return;
    pushHist();
    patchLayer(activeLayer.id, { mask: null });
  };

  // ---- imports ----
  const importImageBlob = async (blob: Blob) => {
    if (!ready || !baseRef.current) return;
    const bmp = await createImageBitmap(blob);
    pushHist();
    const l = newLayer(`Image ${layers.length + 1}`);
    const c = document.createElement('canvas');
    c.width = W();
    c.height = H();
    const g = c.getContext('2d')!;
    const s = Math.min(1, (W() * 0.8) / bmp.width, (H() * 0.8) / bmp.height);
    const dw = bmp.width * s;
    const dh = bmp.height * s;
    g.drawImage(bmp, (W() - dw) / 2, (H() - dh) / 2, dw, dh);
    bmp.close();
    pixRef.current.set(l.id, c);
    setLayers((prev) => [...prev, { ...l, src: c.toDataURL('image/png') }]);
    setActiveId(l.id);
    setPixVer((v) => v + 1);
  };

  useEffect(() => {
    if (!importBlob || !ready) return;
    void importImageBlob(importBlob).finally(() => onImportDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importBlob, ready]);

  // ---- pointer ----
  const toPt = (e: PointerEvent): Pt => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
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
    e.preventDefault();
    if (tool === 'pan' || e.button === 1) { startPan(e); return; }
    const p = toPt(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (tool === 'wand') { wandSelect(p); return; }
    if (tool === 'rectsel') { dragRef.current = { mode: 'rectsel', a: p }; setSelDraft(null); return; }
    if (tool === 'lasso') { dragRef.current = { mode: 'lasso' }; setLassoPts([p]); return; }
    if (tool === 'crop') { dragRef.current = { mode: 'crop', a: p }; setCropSel(null); return; }
    if (tool === 'fill') { bucketFill(p); return; }
    if (tool === 'move') {
      if (!activeLayer?.locked) { pushHist(); dragRef.current = { mode: 'movepx', last: p }; }
      return;
    }
    if (tool === 'text') { setTextEdit({ pos: p, value: '' }); return; }

    const ctx = activeCtx();
    if (!ctx) return; // locked layer
    pushHist();
    if (tool === 'pen' || tool === 'eraser') {
      /* Erasing a layer that has nothing on it means the user is aiming at the
         image below, so promote the base into a layer first (same undo step).
         A layer WITH pixels erases its own pixels, like any raster editor. */
      const needsBase =
        tool === 'eraser' &&
        !basePromotedRef.current &&
        looksBlank(pixRef.current.get(activeLayer!.id)) &&
        !looksBlank(baseRef.current?.bmp);
      const promoted = needsBase ? promoteBase() : null;
      const target = promoted ? promoted.canvas.getContext('2d')! : ctx;
      target.save();
      strokeStyleFor(target, tool === 'eraser');
      target.beginPath();
      target.moveTo(p.x, p.y);
      dragRef.current = { mode: 'paint', last: p, layerId: promoted?.id };
    } else {
      dragRef.current = { mode: 'shape', a: p };
    }
  };

  /** Ctx a paint gesture strokes into — a mid-gesture layer wins over state. */
  const paintCtx = (layerId?: string): CanvasRenderingContext2D | null => {
    if (!layerId) return activeCtx();
    return pixRef.current.get(layerId)?.getContext('2d') ?? null;
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (c) {
      const p0 = toPt(e);
      setCursor({
        x: Math.min(c.width, Math.max(0, Math.round(p0.x))),
        y: Math.min(c.height, Math.max(0, Math.round(p0.y))),
      });
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
    if (d.mode === 'rectsel') { setSelDraft({ a: d.a, b: p }); return; }
    if (d.mode === 'lasso') { setLassoPts((prev) => (prev ? [...prev, p] : [p])); return; }
    if (d.mode === 'crop') { setCropSel({ a: d.a, b: p }); return; }
    if (d.mode === 'paint') {
      const ctx = paintCtx(d.layerId);
      if (!ctx) return;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      d.last = p;
      setPixVer((v) => v + 1);
      return;
    }
    if (d.mode === 'shape') {
      const pctx = preview();
      if (!pctx) return;
      pctx.clearRect(0, 0, W(), H());
      drawShape(pctx, d.a, p, tool);
      setPixVer((v) => v + 1);
      return;
    }
    if (d.mode === 'movepx') {
      const src = activeLayer && pixRef.current.get(activeLayer.id);
      if (!src) return;
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      d.last = p;
      const tmp = document.createElement('canvas');
      tmp.width = src.width;
      tmp.height = src.height;
      tmp.getContext('2d')!.drawImage(src, dx, dy);
      const g = src.getContext('2d')!;
      g.clearRect(0, 0, src.width, src.height);
      g.drawImage(tmp, 0, 0);
      setPixVer((v) => v + 1);
    }
  };

  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.mode === 'pan') { setPanning(false); return; }
    if (d.mode === 'rectsel') {
      const p = toPt(e);
      if (Math.abs(p.x - d.a.x) > 3 && Math.abs(p.y - d.a.y) > 3) commitRectSel(d.a, p);
      else deselect();
      setSelDraft(null);
      return;
    }
    if (d.mode === 'lasso') {
      if (lassoPts) commitLasso(lassoPts);
      setLassoPts(null);
      return;
    }
    if (d.mode === 'crop') return;
    if (d.mode === 'paint') {
      const id = d.layerId ?? activeLayer?.id;
      if (!id) return;
      paintCtx(d.layerId)?.restore();
      commitPixels(id);
      return;
    }
    if (!activeLayer) return;
    if (d.mode === 'shape') {
      const ctx = activeCtx();
      if (ctx) drawShape(ctx, d.a, toPt(e), tool);
      clearPreview();
      commitPixels(activeLayer.id);
      return;
    }
    if (d.mode === 'movepx') commitPixels(activeLayer.id);
  };

  const commitText = () => {
    if (!textEdit) { return; }
    const v = textEdit.value.trim();
    const ctx = activeCtx();
    if (v && ctx && activeLayer) {
      pushHist();
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.font = `${bold ? 800 : 600} ${fontSize}px ${FONT_MAP[fontFam]}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      if (outlineOn) {
        ctx.lineWidth = Math.max(2, fontSize / 10);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = lumOf(color) > 0.55 ? '#000000' : '#ffffff';
        ctx.strokeText(v, textEdit.pos.x, textEdit.pos.y);
      }
      ctx.fillText(v, textEdit.pos.x, textEdit.pos.y);
      ctx.restore();
      commitPixels(activeLayer.id);
    }
    setTextEdit(null);
  };

  // ---- clipboard & keys ----
  const copyCanvas = async () => {
    const out = composite();
    if (!out) return;
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textEdit) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void copyCanvas();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (maskRef.current) {
          e.preventDefault();
          applyToSelection('clear');
        }
        return;
      }
      if (e.key === 'Escape') { setCropSel(null); deselect(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEdit, selVer, color, activeId]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (textEdit) return;
      for (const it of Array.from(e.clipboardData?.items ?? [])) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); void importImageBlob(f); return; }
        }
      }
      const txt = e.clipboardData?.getData('text');
      if (txt?.trim()) {
        e.preventDefault();
        setTextEdit({ pos: { x: W() / 2, y: H() / 2 }, value: txt.trim() });
        setTool('text');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textEdit, ready, activeId]);

  // ---- save ----
  const save = () => {
    const out = composite();
    if (!out) return;
    out.toBlob((b) => {
      if (!b) return;
      const baseName = item.file.name.replace(/\.[^.]+$/, '');
      const file = new File([b], `${baseName}_edited.png`, { type: 'image/png' });
      if (onSave) onSave(item.id, file);
      else {
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
  const w = W();
  const h = H();
  const ratio = w && h ? w / h : 1;
  const isTextish = tool === 'text';

  const body = (
    <div className={inline ? 'ie-inline-wrap' : 'editor-overlay'} onClick={inline ? undefined : onClose}>
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
                if (!['pan', 'move', 'wand', 'rectsel', 'lasso'].includes(tl)) deselect();
              }}
              title={t(`tool_${tl}`)}
            >
              <svg viewBox="0 0 24 24"><path d={TOOL_ICONS[tl]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          ))}
          <span className="tb-sep" />
          <button className="tool-btn" onClick={() => void transform('rot')} title={t('rotate')}>
            <svg viewBox="0 0 24 24"><path d="M20 8a8 8 0 1 0 2 6M20 3v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn" onClick={() => void transform('flip')} title={t('flipH')}>
            <svg viewBox="0 0 24 24"><path d="M12 3v18M8 7L4 12l4 5M16 7l4 5-4 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            className="tool-btn"
            onClick={() => { setRzW(w); setRzH(h); setResizeOpen(true); }}
            title={t('resizeCanvas')}
          >
            <svg viewBox="0 0 24 24"><path d="M4 20L20 4M4 20v-5m0 5h5M20 4v5m0-5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="tb-sep" />
          <button className="tool-btn" onClick={() => void undo()} disabled={histRef.current.length === 0} title={t('undo')}>
            <svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn" onClick={() => void redo()} disabled={redoRef.current.length === 0} title={t('redo')}>
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

        {/* options bar — fixed height, canvas never shifts */}
        <div className="ed-options">
          <span className="opt-tool">{t(`tool_${tool}`)}</span>
          <span className="swatches">
            {SWATCHES.map((s) => (
              <button
                key={s}
                className={`swatch${color.toLowerCase() === s ? ' active' : ''}`}
                style={{ background: s }}
                onClick={() => setColor(s)}
                title={s}
                aria-label={s}
              />
            ))}
          </span>
          <label className="tb-slider" title={isTextish ? t('fontSizeLabel') : t('strokeW')}>
            <input
              type="range"
              min={1}
              max={isTextish ? 120 : 40}
              value={isTextish ? fontSize : size}
              onChange={(e) => (isTextish ? setFontSize(Number(e.target.value)) : setSize(Number(e.target.value)))}
            />
            <span className="zoom-val">{isTextish ? fontSize : size}</span>
          </label>

          {tool === 'pen' && (
            <select className="tb-select" value={brushType} onChange={(e) => setBrushType(e.target.value as Brush)} title={t('brush')}>
              <option value="pen">{t('brushPen')}</option>
              <option value="marker">{t('brushMarker')}</option>
              <option value="highlight">{t('brushHighlight')}</option>
            </select>
          )}

          {isTextish && (
            <>
              <select className="tb-select" value={fontFam} onChange={(e) => setFontFam(e.target.value as FontFam)} title={t('fontFamily')}>
                <option value="sans">{t('fontSans')}</option>
                <option value="serif">{t('fontSerif')}</option>
                <option value="mono">{t('fontMono')}</option>
              </select>
              <button className={`tool-btn${bold ? ' active' : ''}`} onClick={() => setBold((b) => !b)} title={t('bold')}><strong>B</strong></button>
              <button className={`tool-btn${outlineOn ? ' active' : ''}`} onClick={() => setOutlineOn((o) => !o)} title={t('outline')}>
                <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" /></svg>
              </button>
            </>
          )}

          {(tool === 'wand' || tool === 'fill') && (
            <label className="tb-slider" title={t('tolerance')}>
              <input type="range" min={5} max={90} value={wandTol} onChange={(e) => setWandTol(Number(e.target.value))} />
              <span className="zoom-val">{wandTol}</span>
            </label>
          )}

          {cropSel && <button className="btn btn-accent btn-sm" onClick={() => void applyCrop()}>{t('applyCrop')}</button>}
          {maskRef.current && (
            <>
              <button className="btn btn-accent btn-sm" onClick={() => applyToSelection('fill')}>{t('fillSel')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => applyToSelection('clear')}>{t('clearSel')}</button>
              <button className="btn btn-ghost btn-sm" onClick={deselect}>{t('deselect')}</button>
            </>
          )}

          <span className="opt-spacer" />
          <div className="zoom-ctrl">
            <button className="tool-btn" onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))} title="−">−</button>
            <span className="zoom-val">{Math.round(zoom * 100)}%</span>
            <button className="tool-btn" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} title="+">+</button>
            <button
              className="tool-btn"
              title={t('zoomFit')}
              onClick={() => {
                const vp = viewportRef.current;
                if (vp && w) setZoom(Math.max(0.05, Math.min(1, (vp.clientWidth - 28) / w, (window.innerHeight * 0.5) / h)));
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>

        <div className="ie-layout" style={{ '--ie-panel-w': `${panelW}px` } as CSSProperties}>
          <div className="ie-vpwrap">
            <div className="ie-viewport" ref={viewportRef}>
              <div className="ie-inner" style={{ width: w * zoom || undefined }}>
                <canvas
                  ref={canvasRef}
                  className="ie-canvas2"
                  style={{
                    width: w * zoom || undefined,
                    cursor: panning ? 'grabbing' : tool === 'pan' ? 'grab' : tool === 'move' ? 'move' : 'crosshair',
                  }}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerLeave={() => setCursor(null)}
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
                      fontSize: Math.max(12, fontSize * cssScale()),
                      color,
                      fontFamily: FONT_MAP[fontFam],
                      fontWeight: bold ? 800 : 600,
                    }}
                    onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextEdit(null); }}
                    onBlur={commitText}
                  />
                )}
              </div>
            </div>
            {/* mobile-only FAB: opens the layers bottom sheet (hidden ≥721px via CSS) */}
            <button
              type="button"
              className={`lp-fab${panelOpen ? ' on' : ''}`}
              aria-label={t('layers')}
              onClick={() => setPanelOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path d="M12 3l9 5-9 5-9-5 9-5zM4.5 12.5L12 16.7l7.5-4.2M4.5 16.5L12 20.7l7.5-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="zoom-float">
              {w}×{h}px
              <span className="zf-sep">·</span>
              {cursor ? `${cursor.x}, ${cursor.y}` : '–, –'}
              <span className="zf-sep">·</span>
              {Math.round(zoom * 100)}%
            </span>
          </div>

          {/* draggable splitter: resize the layers panel (desktop only; dblclick resets) */}
          <div
            className="ie-gutter"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('layers')}
            {...gutterProps}
          />

          {/* tap-to-dismiss scrim behind the mobile layers sheet */}
          {panelOpen && <div className="lp-scrim" onClick={() => setPanelOpen(false)} />}

          <aside className={`layers-panel${panelOpen ? ' open' : ''}`}>
            {/* inline colour picker — always available, synced with the swatches */}
            <div className="lp-colour">
              <span className="mx-label">{t('colorLabel')}</span>
              <ColorPicker value={color} onChange={setColor} />
            </div>

            <div className="lp-head">
              <span className="mx-label">{t('layers')}</span>
              <span className="lp-head-btns">
                <button onClick={addLayer} title={t('addLayer')}>＋</button>
                <button onClick={() => activeLayer && duplicateLayer(activeLayer.id)} title={t('dupLayer')}>⧉</button>
                <button onClick={() => activeLayer && mergeDown(activeLayer.id)} disabled={!activeLayer} title={t('mergeDown')}>⤓</button>
                <button onClick={() => activeLayer && deleteLayer(activeLayer.id)} disabled={!activeLayer} title={t('remove')}>×</button>
              </span>
            </div>

            {!activeLayer && (
              <p className="st-empty lp-locked">{t('noLayerHint')}</p>
            )}

            {activeLayer && (
              <div className="lp-props">
                <label className="lp-row">
                  <span>{t('opacity')}</span>
                  <input
                    type="range" min={0} max={1} step={0.02}
                    value={activeLayer.opacity}
                    onChange={(e) => patchLayer(activeLayer.id, { opacity: Number(e.target.value) })}
                  />
                  <span className="zoom-val">{Math.round(activeLayer.opacity * 100)}%</span>
                </label>
                <label className="lp-row">
                  <span>{t('blendMode')}</span>
                  <select
                    className="tb-select lp-blend"
                    value={activeLayer.blend}
                    onChange={(e) => patchLayer(activeLayer.id, { blend: e.target.value as Blend })}
                  >
                    {BLEND_MODES.map((b) => <option key={b} value={b}>{b === 'normal' ? t('blendNormal') : b}</option>)}
                  </select>
                </label>
                <div className="lp-row lp-mask">
                  <span>{t('maskLabel')}</span>
                  {activeLayer.mask ? (
                    <span className="lp-mask-btns">
                      <button
                        className={activeLayer.maskEnabled ? 'active' : ''}
                        onClick={() => patchLayer(activeLayer.id, { maskEnabled: !activeLayer.maskEnabled })}
                        title={t('toggleMask')}
                      >◑</button>
                      <button onClick={invertMask} title={t('invertMask')}>⇄</button>
                      <button onClick={clearMask} title={t('clearMask')}>×</button>
                    </span>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={maskFromSelection} disabled={!maskRef.current}>
                      {t('maskFromSel')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {[...layers].reverse().map((l) => (
              <div
                key={l.id}
                className={`lp-layer${l.id === activeId ? ' active' : ''}`}
                onClick={() => setActiveId(l.id)}
                onDoubleClick={() => setRenaming(l.id)}
              >
                <div className="lp-layer-head">
                  <button
                    className="layer-eye"
                    onClick={(e) => { e.stopPropagation(); pushHist(); patchLayer(l.id, { visible: !l.visible }); }}
                    title={l.visible ? t('hideLayer') : t('showLayer')}
                  >
                    {l.visible ? (
                      <svg viewBox="0 0 24 24" width="14" height="14"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 4l16 16M2 12s4-7 10-7c1.8 0 3.4.6 4.8 1.4M22 12s-4 7-10 7c-1.8 0-3.4-.6-4.8-1.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                    )}
                  </button>

                  <LayerThumb src={l.src} ratio={ratio} />

                  {renaming === l.id ? (
                    <input
                      className="lp-name"
                      autoFocus
                      value={l.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patchLayer(l.id, { name: e.target.value })}
                      onBlur={() => setRenaming(null)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null); }}
                    />
                  ) : (
                    <span className="lp-title">
                      <span className="lp-title-row">
                        {l.name}
                        {l.mask && <span className="lp-badge" title={t('maskLabel')}>M</span>}
                        {l.locked && (
                          <span className="lp-badge lock" title={t('lockLayer')}>
                            <svg viewBox="0 0 24 24" width="9" height="9"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>
                          </span>
                        )}
                        {l.opacity < 1 && <span className="lp-badge dim">{Math.round(l.opacity * 100)}%</span>}
                      </span>
                    </span>
                  )}

                  <span className="lp-actions">
                    <button
                      onClick={(e) => { e.stopPropagation(); patchLayer(l.id, { locked: !l.locked }); }}
                      title={l.locked ? t('unlockLayer') : t('lockLayer')}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12">
                        {l.locked
                          ? <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          : <path d="M7 10V7a5 5 0 0 1 9.5-2M5 10h14v10H5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />}
                      </svg>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 1); }} title={t('moveUp')}>↑</button>
                    <button onClick={(e) => { e.stopPropagation(); moveLayer(l.id, -1); }} title={t('moveDown')}>↓</button>
                  </span>
                </div>
              </div>
            ))}

            {/* background: permanent bottom layer */}
            <div className="lp-layer layer-bg-row" title={t('bgLayer')}>
              <div className="lp-layer-head">
                <button className="layer-eye" onClick={() => applyBg(bgColor, !bgOn)} title={t(bgOn ? 'transparentBg' : 'bgLayer')}>
                  {bgOn ? (
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 4l16 16M2 12s4-7 10-7c1.8 0 3.4.6 4.8 1.4M22 12s-4 7-10 7c-1.8 0-3.4-.6-4.8-1.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  )}
                </button>
                <input type="color" className="layer-bg-swatch" value={bgColor} onChange={(e) => applyBg(e.target.value, true)} title={t('bgLayer')} />
                <span className={`lp-title-row${bgOn ? '' : ' layer-off'}`}>{t('bgLayerName')}</span>
              </div>
            </div>
          </aside>
        </div>

        <div className="ed-foot">
          <span className="kbd-hints">
            <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
            <span><kbd>Ctrl</kbd>+<kbd>C</kbd> {t('kbdCopyImg')}</span>
            <span><kbd>Del</kbd> {t('kbdClearSel')}</span>
          </span>
          <div className="ed-foot-main">
            {!inline && <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>}
            <button className="btn btn-accent" onClick={save} disabled={!ready}>
              {inline ? t('exportToAssets') : t('save')}
            </button>
          </div>
        </div>

        {resizeOpen && (
          <Overlay onClick={() => setResizeOpen(false)}>
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
                <div className="size-row">
                  <label className="size-field">
                    <span>W</span>
                    <input type="number" min={8} max={4096} value={rzW} onChange={(e) => setRzW(Number(e.target.value))} />
                  </label>
                  <button className="tool-btn" title={t('swapSides')} onClick={() => { const w0 = rzW; setRzW(rzH); setRzH(w0); }}>⇄</button>
                  <label className="size-field">
                    <span>H</span>
                    <input type="number" min={8} max={4096} value={rzH} onChange={(e) => setRzH(Number(e.target.value))} />
                  </label>
                </div>
              )}
              <div className="ed-foot-main">
                <button className="btn btn-ghost" onClick={() => setResizeOpen(false)}>{t('cancel')}</button>
                <button
                  className="btn btn-accent"
                  onClick={() => {
                    if (rzMode === 'pct') void applyResize(w * rzPct / 100, h * rzPct / 100);
                    else void applyResize(rzW, rzH);
                  }}
                >
                  {t('applyLabel')}
                </button>
              </div>
            </div>
          </Overlay>
        )}
      </div>
    </div>
  );

  return inline ? body : createPortal(body, document.body);
}
