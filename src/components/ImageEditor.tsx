import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useI18n } from '../i18n';
import type { Item } from '../types';

type Tool = 'pen' | 'line' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'crop';

interface Pt { x: number; y: number }

const MAX_DIM = 4096;
const UNDO_CAP = 10;

const TOOL_ICONS: Record<Tool, string> = {
  pen: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3',
  line: 'M5 19L19 5',
  rect: 'M5 6h14v12H5z',
  ellipse: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  arrow: 'M5 19L18 6M18 6v6M18 6h-6',
  text: 'M6 6h12M12 6v13',
  crop: 'M7 3v14h14M3 7h14v14',
};

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose: () => void;
}

export function ImageEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<Pt | null>(null);
  const undoRef = useRef<Blob[]>([]);
  const redoRef = useRef<Blob[]>([]);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#c94f16');
  const [stroke, setStroke] = useState(4);
  const [fontSize, setFontSize] = useState(32);
  const [cropSel, setCropSel] = useState<{ a: Pt; b: Pt } | null>(null);
  const [textPos, setTextPos] = useState<Pt | null>(null);
  const [textVal, setTextVal] = useState('');
  const [histVer, setHistVer] = useState(0); // re-render for undo/redo buttons
  const [ready, setReady] = useState(false);

  // load source image into the canvas
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bmp = await createImageBitmap(item.file);
      if (cancelled) return;
      const longest = Math.max(bmp.width, bmp.height);
      const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
      const c = canvasRef.current!;
      const o = overlayRef.current!;
      c.width = o.width = Math.round(bmp.width * scale);
      c.height = o.height = Math.round(bmp.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [item.file]);

  const snapshot = () =>
    new Promise<void>((resolve) => {
      canvasRef.current!.toBlob((b) => {
        if (b) {
          undoRef.current.push(b);
          if (undoRef.current.length > UNDO_CAP) undoRef.current.shift();
          redoRef.current = [];
          setHistVer((v) => v + 1);
        }
        resolve();
      }, 'image/png');
    });

  const restore = async (blob: Blob) => {
    const bmp = await createImageBitmap(blob);
    const c = canvasRef.current!;
    const o = overlayRef.current!;
    c.width = o.width = bmp.width;
    c.height = o.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
  };

  const undo = async () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    const cur = await new Promise<Blob | null>((r) => canvasRef.current!.toBlob(r, 'image/png'));
    if (cur) redoRef.current.push(cur);
    await restore(prev);
    setCropSel(null);
    setHistVer((v) => v + 1);
  };

  const redo = async () => {
    const next = redoRef.current.pop();
    if (!next) return;
    const cur = await new Promise<Blob | null>((r) => canvasRef.current!.toBlob(r, 'image/png'));
    if (cur) undoRef.current.push(cur);
    await restore(next);
    setHistVer((v) => v + 1);
  };

  const toCanvasPt = (e: PointerEvent): Pt => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const drawShape = (ctx: CanvasRenderingContext2D, a: Pt, b: Pt, shape: Tool) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = stroke;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (shape === 'line' || shape === 'arrow') {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (shape === 'arrow') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = Math.max(12, stroke * 3.5);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45));
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45));
        ctx.stroke();
      }
    } else if (shape === 'rect') {
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (shape === 'ellipse') {
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const clearOverlay = () => {
    const o = overlayRef.current!;
    o.getContext('2d')!.clearRect(0, 0, o.width, o.height);
  };

  const onDown = async (e: PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    const p = toCanvasPt(e);
    if (tool === 'text') {
      setTextPos(p);
      setTextVal('');
      return;
    }
    startRef.current = p;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'pen') {
      await snapshot();
      const ctx = canvasRef.current!.getContext('2d')!;
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const a = startRef.current;
    if (!a) return;
    const p = toCanvasPt(e);
    if (tool === 'pen') {
      const ctx = canvasRef.current!.getContext('2d')!;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      return;
    }
    const octx = overlayRef.current!.getContext('2d')!;
    clearOverlay();
    if (tool === 'crop') {
      octx.save();
      octx.fillStyle = 'rgba(0,0,0,0.45)';
      octx.fillRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);
      octx.clearRect(Math.min(a.x, p.x), Math.min(a.y, p.y), Math.abs(p.x - a.x), Math.abs(p.y - a.y));
      octx.restore();
      octx.setLineDash([8, 6]);
      octx.strokeStyle = '#fff';
      octx.lineWidth = 1.5;
      octx.strokeRect(Math.min(a.x, p.x), Math.min(a.y, p.y), Math.abs(p.x - a.x), Math.abs(p.y - a.y));
      octx.setLineDash([]);
    } else {
      drawShape(octx, a, p, tool);
    }
  };

  const onUp = async (e: PointerEvent<HTMLCanvasElement>) => {
    const a = startRef.current;
    startRef.current = null;
    if (!a) return;
    const p = toCanvasPt(e);
    if (tool === 'pen') return; // already drawn
    if (tool === 'crop') {
      if (Math.abs(p.x - a.x) > 4 && Math.abs(p.y - a.y) > 4) setCropSel({ a, b: p });
      return;
    }
    clearOverlay();
    await snapshot();
    drawShape(canvasRef.current!.getContext('2d')!, a, p, tool);
  };

  const applyCrop = async () => {
    if (!cropSel) return;
    await snapshot();
    const { a, b } = cropSel;
    const x = Math.round(Math.min(a.x, b.x));
    const y = Math.round(Math.min(a.y, b.y));
    const w = Math.round(Math.abs(b.x - a.x));
    const h = Math.round(Math.abs(b.y - a.y));
    const c = canvasRef.current!;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, w, h);
    c.width = overlayRef.current!.width = w;
    c.height = overlayRef.current!.height = h;
    c.getContext('2d')!.drawImage(tmp, 0, 0);
    clearOverlay();
    setCropSel(null);
  };

  const transform = async (kind: 'rot' | 'flip') => {
    await snapshot();
    const c = canvasRef.current!;
    const tmp = document.createElement('canvas');
    const tctx = tmp.getContext('2d')!;
    if (kind === 'rot') {
      tmp.width = c.height;
      tmp.height = c.width;
      tctx.translate(tmp.width, 0);
      tctx.rotate(Math.PI / 2);
    } else {
      tmp.width = c.width;
      tmp.height = c.height;
      tctx.translate(tmp.width, 0);
      tctx.scale(-1, 1);
    }
    tctx.drawImage(c, 0, 0);
    c.width = overlayRef.current!.width = tmp.width;
    c.height = overlayRef.current!.height = tmp.height;
    c.getContext('2d')!.drawImage(tmp, 0, 0);
    setCropSel(null);
  };

  const commitText = async () => {
    if (!textPos || !textVal.trim()) {
      setTextPos(null);
      return;
    }
    await snapshot();
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = `600 ${fontSize}px 'IBM Plex Sans', sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(textVal, textPos.x, textPos.y);
    setTextPos(null);
    setTextVal('');
  };

  const save = () => {
    canvasRef.current!.toBlob((b) => {
      if (!b) return;
      const base = item.file.name.replace(/\.[^.]+$/, '');
      onSave(item.id, new File([b], `${base}_edited.png`, { type: 'image/png' }));
    }, 'image/png');
  };

  // scale factor for the floating text input
  const cssScale = () => {
    const c = canvasRef.current;
    if (!c) return 1;
    return c.getBoundingClientRect().width / c.width;
  };

  void histVer;

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
              onClick={() => { setTool(tl); setCropSel(null); clearOverlay(); }}
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
          <button className="tool-btn" onClick={undo} disabled={undoRef.current.length === 0} title={t('undo')}>
            <svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn" onClick={redo} disabled={redoRef.current.length === 0} title={t('redo')}>
            <svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="tb-sep" />
          <input
            type="color"
            className="tb-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title={t('colorLabel')}
          />
          <label className="tb-slider" title={t('strokeW')}>
            <input type="range" min={1} max={24} value={stroke} onChange={(e) => setStroke(Number(e.target.value))} />
          </label>
          {tool === 'text' && (
            <label className="tb-slider" title={t('fontSizeLabel')}>
              <input type="range" min={14} max={120} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
            </label>
          )}
          {cropSel && (
            <button className="btn btn-accent btn-sm" onClick={applyCrop}>{t('applyCrop')}</button>
          )}
        </div>

        <div className="ie-stage" ref={stageRef}>
          <canvas ref={canvasRef} className="ie-canvas" />
          <canvas
            ref={overlayRef}
            className="ie-overlay"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          />
          {textPos && (
            <input
              className="ie-textinput"
              autoFocus
              value={textVal}
              placeholder={t('textPlaceholder')}
              style={{
                left: textPos.x * cssScale(),
                top: textPos.y * cssScale(),
                fontSize: Math.max(12, fontSize * cssScale()),
                color,
              }}
              onChange={(e) => setTextVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void commitText(); if (e.key === 'Escape') setTextPos(null); }}
              onBlur={() => void commitText()}
            />
          )}
        </div>

        <div className="ed-foot">
          <span className="ed-hint">{t('imageEditorHint')}</span>
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={save} disabled={!ready}>{t('save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
