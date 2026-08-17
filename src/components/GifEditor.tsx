import { useEffect, useRef, useState } from 'react';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { useI18n } from '../i18n';
import { DualRange } from './DualRange';
import type { Item } from '../types';

/* ScreenToGif-inspired: thumbnail film strip, frame stepping,
   per-frame delete/duplicate/delay — all in the browser. */

const FRAME_CAP = 240;
const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

interface Frame {
  bitmap: ImageBitmap;
  delay: number; // ms
  thumb: string; // dataURL
}

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose: () => void;
}

export function GifEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<Frame[]>([]);
  const bitmapsRef = useRef<Set<ImageBitmap>>(new Set());
  const timerRef = useRef(0);
  const posRef = useRef(0);

  const [ver, setVer] = useState(0); // bump when framesRef mutates
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [speed, setSpeed] = useState(1);
  const [reverse, setReverse] = useState(false);
  const [boomerang, setBoomerang] = useState(false);
  const [caption, setCaption] = useState('');
  const [captionSize, setCaptionSize] = useState(28);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ---- decode + compose (honouring disposal) + thumbnails ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const buf = await item.file.arrayBuffer();
      const gif = parseGIF(buf);
      const raw = decompressFrames(gif, true);
      const w = gif.lsd.width;
      const h = gif.lsd.height;
      const compose = document.createElement('canvas');
      compose.width = w;
      compose.height = h;
      const ctx = compose.getContext('2d')!;
      const patchCanvas = document.createElement('canvas');
      const pctx = patchCanvas.getContext('2d')!;
      const thumbCanvas = document.createElement('canvas');
      const th = 48;
      thumbCanvas.width = Math.max(1, Math.round((w / h) * th));
      thumbCanvas.height = th;
      const tctx = thumbCanvas.getContext('2d')!;
      const out: Frame[] = [];
      const cap = Math.min(raw.length, FRAME_CAP);
      for (let i = 0; i < cap; i++) {
        const fr = raw[i];
        patchCanvas.width = fr.dims.width;
        patchCanvas.height = fr.dims.height;
        pctx.putImageData(
          new ImageData(new Uint8ClampedArray(fr.patch), fr.dims.width, fr.dims.height),
          0,
          0
        );
        const before = fr.disposalType === 3 ? ctx.getImageData(0, 0, w, h) : null;
        ctx.drawImage(patchCanvas, fr.dims.left, fr.dims.top);
        const bitmap = await createImageBitmap(compose);
        tctx.clearRect(0, 0, thumbCanvas.width, th);
        tctx.drawImage(compose, 0, 0, thumbCanvas.width, th);
        out.push({ bitmap, delay: Math.max(fr.delay || 100, 20), thumb: thumbCanvas.toDataURL() });
        bitmapsRef.current.add(bitmap);
        if (fr.disposalType === 2) {
          ctx.clearRect(fr.dims.left, fr.dims.top, fr.dims.width, fr.dims.height);
        } else if (fr.disposalType === 3 && before) {
          ctx.putImageData(before, 0, 0);
        }
        if (cancelled) return;
      }
      if (cancelled) return;
      framesRef.current = out;
      setTruncated(raw.length > FRAME_CAP);
      setRange([0, out.length - 1]);
      const c = canvasRef.current!;
      c.width = w;
      c.height = h;
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

  const drawCaption = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (!caption.trim()) return;
    const size = captionSize;
    ctx.font = `700 ${size}px 'IBM Plex Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = Math.max(2, size / 9);
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    ctx.strokeText(caption, w / 2, h - size * 0.35);
    ctx.fillText(caption, w / 2, h - size * 0.35);
  };

  const drawFrame = (fi: number) => {
    const frames = framesRef.current;
    const f = frames[fi];
    const c = canvasRef.current;
    if (!f || !c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(f.bitmap, 0, 0);
    drawCaption(ctx, c.width, c.height);
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
  }, [loaded, playing, range, speed, reverse, boomerang, caption, captionSize, ver]);

  // redraw paused frame when caption changes
  useEffect(() => {
    if (loaded && !playing) drawFrame(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, caption, captionSize, playing, loaded, ver]);

  const selectFrame = (i: number) => {
    setPlaying(false);
    setCur(Math.min(Math.max(i, 0), framesRef.current.length - 1));
  };

  const step = (d: number) => {
    const n = framesRef.current.length;
    selectFrame((cur + d + n) % n);
  };

  const deleteFrame = () => {
    const frames = framesRef.current;
    if (frames.length <= 1) return;
    frames.splice(cur, 1);
    const n = frames.length;
    setRange(([s, e]) => [Math.min(s, n - 1), Math.min(e, n - 1)]);
    setCur((c) => Math.min(c, n - 1));
    setVer((v) => v + 1);
  };

  const duplicateFrame = () => {
    const frames = framesRef.current;
    const f = frames[cur];
    if (!f) return;
    frames.splice(cur + 1, 0, { ...f });
    setRange(([s, e]) => [s, e >= cur ? e + 1 : e]);
    setVer((v) => v + 1);
  };

  const setDelay = (ms: number, all = false) => {
    const frames = framesRef.current;
    const v = Math.min(Math.max(Math.round(ms), 20), 5000);
    if (all) frames.forEach((f) => { f.delay = v; });
    else if (frames[cur]) frames[cur].delay = v;
    setVer((x) => x + 1);
  };

  // ---- encode ----
  const save = async () => {
    if (busy || !loaded) return;
    setBusy(true);
    setPlaying(false);
    try {
      const frames = framesRef.current;
      const first = frames[0].bitmap;
      const w = first.width;
      const h = first.height;
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext('2d', { willReadFrequently: true })!;
      const enc = GIFEncoder();
      const order = playOrder();
      for (let i = 0; i < order.length; i++) {
        const f = frames[order[i]];
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(f.bitmap, 0, 0);
        drawCaption(ctx, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        enc.writeFrame(index, w, h, { palette, delay: Math.round(f.delay / speed) });
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      enc.finish();
      const bytes = enc.bytes();
      const base = item.file.name.replace(/\.[^.]+$/, '');
      onSave(item.id, new File([bytes.slice()], `${base}_edited.gif`, { type: 'image/gif' }));
    } finally {
      setBusy(false);
    }
  };

  const frames = framesRef.current;
  const n = frames.length;

  return (
    <div className="editor-overlay" onClick={busy ? undefined : onClose}>
      <div className="editor editor-wide" role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')} disabled={busy}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="ed-preview gif-preview">
          <canvas ref={canvasRef} />
        </div>

        {/* transport controls */}
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
          <button className="btn btn-ghost btn-sm" onClick={duplicateFrame} disabled={!loaded}>{t('dupFrame')}</button>
          <button className="btn btn-ghost btn-sm" onClick={deleteFrame} disabled={!loaded || n <= 1}>{t('delFrame')}</button>
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

        {/* film strip */}
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

        {truncated && <div className="banner warn">{t('gifTooLong', { n: String(FRAME_CAP) })}</div>}

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
              <span className="sp-label">{t('caption')}</span>
              <input
                type="text"
                className="ed-input"
                value={caption}
                placeholder={t('textPlaceholder')}
                onChange={(e) => setCaption(e.target.value)}
              />
            </label>

            <label className="sp-field">
              <span className="sp-label">
                {t('captionSize')} <span className="sp-val">{captionSize}px</span>
              </span>
              <input
                type="range"
                min={14}
                max={72}
                value={captionSize}
                onChange={(e) => setCaptionSize(Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="ed-foot">
          <span className="ed-hint">{busy ? t('processing') : ''}</span>
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={save} disabled={busy || !loaded}>
              {busy ? t('processing') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
