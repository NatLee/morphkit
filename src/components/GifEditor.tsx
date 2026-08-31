import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { GIFEncoder } from 'gifenc';
import UPNG from 'upng-js';
import { decodeAnim, writeGifFrame } from '../lib/animImage';
import { extOf } from '../lib/formats';
import { useSplitter } from '../lib/useSplitter';
import { INLINE_SAVE_EVT } from '../lib/studioTypes';
import { useI18n } from '../i18n';
import { DualRange } from './DualRange';
import type { Item } from '../types';

/* ScreenToGif-inspired frame editor for GIF **and APNG**:
   film strip, per-frame ops, caption layers, dedupe, transparency flattening. */

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
let capId = 0;

interface Frame {
  bitmap: ImageBitmap;
  delay: number;
  thumb: string;
}

interface Cap {
  id: number;
  text: string;
  size: number;
  color: string;
  /** relative position 0..1 — draggable on the preview */
  x: number;
  y: number;
  /** 0-based inclusive frame range */
  from: number;
  to: number;
}

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose?: () => void;
  /** workspace mode: no overlay chrome, fills its container */
  inline?: boolean;
  /** frames to append to the strip (from GIF / image / video imports) */
  importFrames?: { img: ImageData; delay: number }[] | null;
  onImportDone?: () => void;
}

export function GifEditor({ item, onSave, onClose, inline, importFrames, onImportDone }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<Frame[]>([]);
  const bitmapsRef = useRef<Set<ImageBitmap>>(new Set());
  const timerRef = useRef(0);
  const posRef = useRef(0);

  const srcIsApng = extOf(item.file.name) === 'apng' || item.file.type === 'image/apng';

  const [ver, setVer] = useState(0);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [speed, setSpeed] = useState(1);
  const [reverse, setReverse] = useState(false);
  const [boomerang, setBoomerang] = useState(false);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [outFmt, setOutFmt] = useState<'gif' | 'apng'>(srcIsApng ? 'apng' : 'gif');
  const [flatten, setFlatten] = useState(false);
  void outFmt;
  const [matte, setMatte] = useState('#ffffff');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // draggable preview height (caps canvas max-height via --gif-ph)
  const prevSplit = useSplitter('morphkit-gifph', Math.round(window.innerHeight * 0.4), 120, 700, { axis: 'y' });
  const dragCapRef = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const flattenActive = flatten;

  // ---- decode via shared pipeline (GIF / APNG / static) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const anim = await decodeAnim(item.file);
      if (cancelled) return;
      const th = 48;
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = Math.max(1, Math.round((anim.width / anim.height) * th));
      thumbCanvas.height = th;
      const tctx = thumbCanvas.getContext('2d')!;
      const out: Frame[] = [];
      for (const f of anim.frames) {
        const bitmap = await createImageBitmap(f.img);
        tctx.clearRect(0, 0, thumbCanvas.width, th);
        tctx.drawImage(bitmap, 0, 0, thumbCanvas.width, th);
        out.push({ bitmap, delay: f.delay, thumb: thumbCanvas.toDataURL() });
        bitmapsRef.current.add(bitmap);
        if (cancelled) return;
      }
      framesRef.current = out;
      setRange([0, out.length - 1]);
      const c = canvasRef.current!;
      c.width = anim.width;
      c.height = anim.height;
      setLoaded(true);
      setVer((v) => v + 1);
    })();
    return () => {
      cancelled = true;
      bitmapsRef.current.forEach((b) => b.close());
      bitmapsRef.current.clear();
      framesRef.current = [];
    };
  }, [item.file]);

  // append imported frames (scaled to this GIF's canvas size)
  useEffect(() => {
    if (!importFrames?.length || !loaded) return;
    void (async () => {
      try {
        const frames = framesRef.current;
        const room = 300 - frames.length;
        const take = importFrames.slice(0, Math.max(0, room));
        if (!take.length) return;
        const w0 = frames[0]?.bitmap.width ?? take[0].img.width;
        const h0 = frames[0]?.bitmap.height ?? take[0].img.height;
        const scale = document.createElement('canvas');
        scale.width = w0;
        scale.height = h0;
        const sctx = scale.getContext('2d')!;
        const th = 48;
        const tc = document.createElement('canvas');
        tc.width = Math.max(1, Math.round((w0 / h0) * th));
        tc.height = th;
        const tctx = tc.getContext('2d')!;
        const wasAtEnd = range[1] === frames.length - 1;
        for (const f of take) {
          const src = await createImageBitmap(f.img);
          sctx.clearRect(0, 0, w0, h0);
          // contain-fit imported content inside the gif canvas
          const s = Math.min(w0 / src.width, h0 / src.height);
          const dw = src.width * s;
          const dh = src.height * s;
          sctx.drawImage(src, (w0 - dw) / 2, (h0 - dh) / 2, dw, dh);
          src.close();
          const bitmap = await createImageBitmap(scale);
          tctx.clearRect(0, 0, tc.width, th);
          tctx.drawImage(scale, 0, 0, tc.width, th);
          frames.push({ bitmap, delay: Math.max(f.delay, 20), thumb: tc.toDataURL() });
          bitmapsRef.current.add(bitmap);
        }
        if (wasAtEnd) setRange(([s]) => [s, framesRef.current.length - 1]);
        setVer((v) => v + 1);
      } finally {
        onImportDone?.();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importFrames, loaded]);

  const drawCaptions = (ctx: CanvasRenderingContext2D, w: number, h: number, fi: number) => {
    for (const cap of caps) {
      if (!cap.text.trim() || fi < cap.from || fi > cap.to) continue;
      ctx.font = `700 ${cap.size}px 'IBM Plex Sans', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, cap.size / 9);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000';
      ctx.fillStyle = cap.color;
      ctx.strokeText(cap.text, cap.x * w, cap.y * h);
      ctx.fillText(cap.text, cap.x * w, cap.y * h);
    }
  };

  // ---- caption dragging on the preview canvas ----
  const toCanvasPt = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  };

  const capAt = (px: number, py: number): Cap | null => {
    const c = canvasRef.current;
    if (!c) return null;
    const ctx = c.getContext('2d')!;
    for (let i = caps.length - 1; i >= 0; i--) {
      const cap = caps[i];
      if (!cap.text.trim()) continue;
      ctx.font = `700 ${cap.size}px 'IBM Plex Sans', sans-serif`;
      const tw = ctx.measureText(cap.text).width;
      const cx = cap.x * c.width;
      const cy = cap.y * c.height;
      if (Math.abs(px - cx) <= tw / 2 + 10 && Math.abs(py - cy) <= cap.size * 0.7 + 10) return cap;
    }
    return null;
  };

  const onCanvasDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = toCanvasPt(e);
    const cap = capAt(p.x, p.y);
    if (!cap) return;
    setPlaying(false);
    const c = canvasRef.current!;
    dragCapRef.current = { id: cap.id, dx: p.x - cap.x * c.width, dy: p.y - cap.y * c.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onCanvasMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = dragCapRef.current;
    if (!d) return;
    const c = canvasRef.current!;
    const p = toCanvasPt(e);
    patchCap(d.id, {
      x: Math.min(1, Math.max(0, (p.x - d.dx) / c.width)),
      y: Math.min(1, Math.max(0, (p.y - d.dy) / c.height)),
    });
  };

  const onCanvasUp = () => { dragCapRef.current = null; };

  const drawFrame = (fi: number) => {
    const f = framesRef.current[fi];
    const c = canvasRef.current;
    if (!f || !c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (flattenActive) {
      ctx.fillStyle = matte;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(f.bitmap, 0, 0);
    drawCaptions(ctx, c.width, c.height, fi);
  };

  const playOrder = (): number[] => {
    const n = framesRef.current.length;
    const s = Math.min(range[0], n - 1);
    const e = Math.min(range[1], n - 1);
    const idx = Array.from({ length: Math.max(e - s + 1, 1) }, (_, i) => s + i);
    if (reverse) idx.reverse();
    if (boomerang && idx.length > 2) return [...idx, ...idx.slice(1, -1).reverse()];
    return idx;
  };

  // ---- playback ----
  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(timerRef.current);
    if (!playing) {
      drawFrame(cur);
      return;
    }
    const tick = () => {
      const order = playOrder();
      const fi = order[posRef.current % order.length];
      const f = framesRef.current[fi];
      if (!f) return;
      drawFrame(fi);
      setCur(fi);
      posRef.current++;
      timerRef.current = window.setTimeout(tick, f.delay / speed);
    };
    tick();
    return () => window.clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, playing, range, speed, reverse, boomerang, caps, flattenActive, matte, ver]);

  useEffect(() => {
    if (loaded && !playing) drawFrame(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, caps, flattenActive, matte, playing, loaded, ver]);

  const selectFrame = (i: number) => {
    setPlaying(false);
    setCur(Math.min(Math.max(i, 0), framesRef.current.length - 1));
  };

  const step = (d: number) => {
    const n = framesRef.current.length;
    selectFrame((cur + d + n) % n);
  };

  const clampAfterMutate = () => {
    const n = framesRef.current.length;
    setRange(([s, e]) => [Math.min(s, n - 1), Math.min(e, n - 1)]);
    setCur((c) => Math.min(c, n - 1));
    setVer((v) => v + 1);
  };

  const deleteFrame = () => {
    if (framesRef.current.length <= 1) return;
    framesRef.current.splice(cur, 1);
    clampAfterMutate();
  };

  const duplicateFrame = () => {
    const f = framesRef.current[cur];
    if (!f) return;
    framesRef.current.splice(cur + 1, 0, { ...f });
    setRange(([s, e]) => [s, e >= cur ? e + 1 : e]);
    setVer((v) => v + 1);
  };

  const moveFrame = (d: -1 | 1) => {
    const frames = framesRef.current;
    const j = cur + d;
    if (j < 0 || j >= frames.length) return;
    [frames[cur], frames[j]] = [frames[j], frames[cur]];
    setCur(j);
    setVer((v) => v + 1);
  };

  /** Merge consecutive visually-identical frames (delays are summed). */
  const dedupe = () => {
    const frames = framesRef.current;
    if (frames.length < 2) return;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const sig = (f: Frame) => {
      ctx.clearRect(0, 0, 32, 32);
      ctx.drawImage(f.bitmap, 0, 0, 32, 32);
      return ctx.getImageData(0, 0, 32, 32).data;
    };
    const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) {
        diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (diff > a.length) return false;
      }
      return diff / (a.length / 4) < 6;
    };
    let removed = 0;
    let prev = sig(frames[0]);
    for (let i = 1; i < frames.length;) {
      const s = sig(frames[i]);
      if (same(prev, s)) {
        frames[i - 1].delay += frames[i].delay;
        frames.splice(i, 1);
        removed++;
      } else {
        prev = s;
        i++;
      }
    }
    clampAfterMutate();
    setNote(t('dedupeDone', { n: String(removed) }));
    window.setTimeout(() => setNote(''), 4000);
  };

  const setDelay = (ms: number, all = false) => {
    const frames = framesRef.current;
    const v = Math.min(Math.max(Math.round(ms), 20), 5000);
    if (all) frames.forEach((f) => { f.delay = v; });
    else if (frames[cur]) frames[cur].delay = v;
    setVer((x) => x + 1);
  };

  // ---- captions ----
  const addCap = () => {
    setCaps((prev) => [...prev, {
      id: ++capId, text: '', size: 28, color: '#ffffff', x: 0.5, y: 0.88, from: range[0], to: range[1],
    }]);
  };

  const patchCap = (id: number, p: Partial<Cap>) =>
    setCaps((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const removeCap = (id: number) => setCaps((prev) => prev.filter((c) => c.id !== id));

  // ---- encode ----
  // Studio's top-bar save button (focus mode) triggers inline saves via a window event
  const inlineSaveRef = useRef<() => void>(() => {});
  inlineSaveRef.current = () => { void save(); };
  useEffect(() => {
    if (!inline) return;
    const h = () => inlineSaveRef.current();
    window.addEventListener(INLINE_SAVE_EVT, h);
    return () => window.removeEventListener(INLINE_SAVE_EVT, h);
  }, [inline]);

  const save = async () => {
    if (busy || !loaded) return;
    setBusy(true);
    setPlaying(false);
    try {
      const frames = framesRef.current;
      const w = frames[0].bitmap.width;
      const h = frames[0].bitmap.height;
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext('2d', { willReadFrequently: true })!;
      const order = playOrder();
      const base = item.file.name.replace(/\.[^.]+$/, '');

      const renderFrame = (fi: number) => {
        ctx.clearRect(0, 0, w, h);
        if (flattenActive) {
          ctx.fillStyle = matte;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(frames[fi].bitmap, 0, 0);
        drawCaptions(ctx, w, h, fi);
        return ctx.getImageData(0, 0, w, h);
      };

      if (outFmt === 'gif') {
        const enc = GIFEncoder();
        for (let i = 0; i < order.length; i++) {
          const img = renderFrame(order[i]);
          writeGifFrame(enc, img.data, w, h, Math.round(frames[order[i]].delay / speed), !flattenActive);
          if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
        }
        enc.finish();
        onSave(item.id, new File([enc.bytes().slice()], `${base}_edited.gif`, { type: 'image/gif' }));
      } else {
        const bufs: ArrayBuffer[] = [];
        const delays: number[] = [];
        for (let i = 0; i < order.length; i++) {
          const img = renderFrame(order[i]);
          bufs.push(img.data.slice().buffer);
          delays.push(Math.round(frames[order[i]].delay / speed));
          if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
        }
        const out = UPNG.encode(bufs, w, h, 0, delays);
        onSave(item.id, new File([out], `${base}_edited.apng`, { type: 'image/apng' }));
      }
    } finally {
      setBusy(false);
    }
  };

  const frames = framesRef.current;
  const n = frames.length;

  const body = (
    <div
      className={inline ? 'ie-inline-wrap' : 'editor-overlay'}
      onClick={inline || busy ? undefined : onClose}
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
            <button className="theme-toggle" onClick={onClose} aria-label={t('close')} disabled={busy}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}

        <div className="ed-preview gif-preview" style={{ '--gif-ph': `${prevSplit.size}px` } as CSSProperties}>
          <canvas
            ref={canvasRef}
            onPointerDown={onCanvasDown}
            onPointerMove={onCanvasMove}
            onPointerUp={onCanvasUp}
            style={{ touchAction: caps.length ? 'none' : 'auto', cursor: caps.length ? 'move' : 'default' }}
          />
        </div>

        <div className="split-gutter h" role="separator" aria-orientation="horizontal" {...prevSplit.gutterProps} />

        <div className="gif-transport">
          <button className="tool-btn" onClick={() => step(-1)} title={t('prevFrame')} disabled={!loaded}>
            <svg viewBox="0 0 24 24" width="15" height="15"><path d="M17 5v14L8 12zM6 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="tool-btn play-btn" onClick={() => setPlaying((p) => !p)} title={playing ? t('pause') : t('play')} disabled={!loaded}>
            {playing ? (
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
            )}
          </button>
          <button className="tool-btn" onClick={() => step(1)} title={t('nextFrame')} disabled={!loaded}>
            <svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 5v14l9-7zM18 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="gif-pos">#{cur + 1} / {n}</span>
          <span className="tb-sep" />
          <button className="tool-btn" onClick={() => moveFrame(-1)} disabled={!loaded || cur === 0} title={t('moveLeft')}>←</button>
          <button className="tool-btn" onClick={() => moveFrame(1)} disabled={!loaded || cur >= n - 1} title={t('moveRight')}>→</button>
          <button className="btn btn-ghost btn-sm" onClick={duplicateFrame} disabled={!loaded}>{t('dupFrame')}</button>
          <button className="btn btn-ghost btn-sm" onClick={deleteFrame} disabled={!loaded || n <= 1}>{t('delFrame')}</button>
          <button className="btn btn-ghost btn-sm" onClick={dedupe} disabled={!loaded || n < 2}>{t('dedupe')}</button>
          <label className="gif-delay">
            <span>{t('frameDelay')}</span>
            <input
              type="number"
              min={20}
              max={5000}
              step={10}
              value={frames[cur]?.delay ?? 100}
              onChange={(e) => setDelay(Number(e.target.value))}
              disabled={!loaded}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => setDelay(frames[cur]?.delay ?? 100, true)} disabled={!loaded}>
              {t('applyAll')}
            </button>
          </label>
        </div>

        <div className="strip">
          {frames.map((f, i) => (
            <button
              key={i}
              className={`thumb${i === cur ? ' active' : ''}${i < range[0] || i > range[1] ? ' dim' : ''}`}
              onClick={() => selectFrame(i)}
              title={`#${i + 1} · ${f.delay}ms`}
            >
              <img src={f.thumb} alt={`#${i + 1}`} draggable={false} />
              <span>{i + 1}</span>
            </button>
          ))}
        </div>

        {note && <div className="banner info">{note}</div>}

        <div className="ed-controls">
          <div className="ed-row">
            <span className="sp-label">
              {t('frames')}{' '}
              <span className="sp-val">#{range[0] + 1} – #{range[1] + 1} / {n}</span>
            </span>
            <DualRange
              min={0}
              max={Math.max(n - 1, 1)}
              start={range[0]}
              end={range[1]}
              gap={1}
              onChange={(s, e) => setRange([Math.round(s), Math.round(e)])}
            />
          </div>

          <div className="ed-grid">
            <label className="sp-field">
              <span className="sp-label">{t('speed')}</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>{v}×</option>
                ))}
              </select>
            </label>

            <label className="sp-field sp-check">
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              <span className="sp-label">{t('reverseLabel')}</span>
            </label>

            <label className="sp-field sp-check">
              <input type="checkbox" checked={boomerang} onChange={(e) => setBoomerang(e.target.checked)} />
              <span className="sp-label">{t('boomerang')}</span>
            </label>

            <label className="sp-field">
              <span className="sp-label">{t('outFormat')}</span>
              <select value={outFmt} onChange={(e) => setOutFmt(e.target.value as 'gif' | 'apng')}>
                <option value="gif">GIF</option>
                <option value="apng">APNG</option>
              </select>
            </label>

            <label className="sp-field sp-check">
              <input
                type="checkbox"
                checked={flattenActive}
                onChange={(e) => setFlatten(e.target.checked)}
              />
              <span className="sp-label">{t('flatten')}</span>
            </label>

            {flattenActive && (
              <label className="sp-field">
                <span className="sp-label">{t('matteColor')}</span>
                <input type="color" className="tb-color" value={matte} onChange={(e) => setMatte(e.target.value)} />
              </label>
            )}
          </div>

          {/* caption layers */}
          <div className="ed-row cap-panel">
            <span className="sp-label">
              {t('captions')}
              <button className="btn btn-ghost btn-sm" onClick={addCap}>{t('addCaption')} +</button>
            </span>
            {caps.length > 0 && <span className="ed-hint">{t('capDragHint')}</span>}
            {caps.map((cap) => (
              <div className="cap-row" key={cap.id}>
                <input
                  type="text"
                  className="ed-input cap-text"
                  value={cap.text}
                  placeholder={t('textPlaceholder')}
                  onChange={(e) => patchCap(cap.id, { text: e.target.value })}
                />
                <input
                  type="number"
                  className="num-sm"
                  min={10}
                  max={96}
                  value={cap.size}
                  title={t('captionSize')}
                  onChange={(e) => patchCap(cap.id, { size: Number(e.target.value) })}
                />
                <input
                  type="color"
                  className="tb-color"
                  value={cap.color}
                  onChange={(e) => patchCap(cap.id, { color: e.target.value })}
                />
                <input
                  type="number"
                  className="num-sm"
                  min={1}
                  max={n}
                  value={cap.from + 1}
                  title={t('fromF')}
                  onChange={(e) => patchCap(cap.id, { from: Math.min(Number(e.target.value) - 1, cap.to) })}
                />
                <span className="cap-dash">–</span>
                <input
                  type="number"
                  className="num-sm"
                  min={1}
                  max={n}
                  value={cap.to + 1}
                  title={t('toF')}
                  onChange={(e) => patchCap(cap.id, { to: Math.max(Number(e.target.value) - 1, cap.from) })}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => removeCap(cap.id)} aria-label={t('remove')}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div className="ed-foot">
          <span className="ed-hint">{busy ? t('processing') : ''}</span>
          <div className="ed-foot-main">
            {!inline && <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>}
            <button className="btn btn-accent" onClick={save} disabled={busy || !loaded}>
              {busy ? t('processing') : inline ? t('exportToAssets') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return inline ? body : createPortal(body, document.body);
}
