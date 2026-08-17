import { useEffect, useRef, useState } from 'react';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { useI18n } from '../i18n';
import { DualRange } from './DualRange';
import type { Item } from '../types';

const FRAME_CAP = 240;
const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

interface Frame {
  bitmap: ImageBitmap;
  delay: number; // ms
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
  const playRef = useRef<number>(0);

  const [frameCount, setFrameCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [speed, setSpeed] = useState(1);
  const [reverse, setReverse] = useState(false);
  const [boomerang, setBoomerang] = useState(false);
  const [caption, setCaption] = useState('');
  const [captionSize, setCaptionSize] = useState(28);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ---- decode + compose frames (honouring disposal) ----
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
        out.push({ bitmap: await createImageBitmap(compose), delay: Math.max(fr.delay || 100, 20) });
        if (fr.disposalType === 2) {
          ctx.clearRect(fr.dims.left, fr.dims.top, fr.dims.width, fr.dims.height);
        } else if (fr.disposalType === 3 && before) {
          ctx.putImageData(before, 0, 0);
        }
        if (cancelled) return;
      }
      if (cancelled) return;
      framesRef.current = out;
      setFrameCount(out.length);
      setTruncated(raw.length > FRAME_CAP);
      setRange([0, out.length - 1]);
      const c = canvasRef.current!;
      c.width = w;
      c.height = h;
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
      framesRef.current.forEach((f) => f.bitmap.close());
      framesRef.current = [];
    };
  }, [item.file]);

  const drawCaption = (ctx: CanvasRenderingContext2D, w: number, h: number, scale = 1) => {
    if (!caption.trim()) return;
    const size = captionSize * scale;
    ctx.font = `700 ${size}px 'IBM Plex Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = Math.max(2, size / 9);
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    ctx.strokeText(caption, w / 2, h - size * 0.35);
    ctx.fillText(caption, w / 2, h - size * 0.35);
  };

  const playOrder = (): number[] => {
    const [s, e] = range;
    const idx = Array.from({ length: e - s + 1 }, (_, i) => s + i);
    if (reverse) idx.reverse();
    if (boomerang) return [...idx, ...idx.slice(1, -1).reverse()];
    return idx;
  };

  // ---- preview loop ----
  useEffect(() => {
    if (!loaded) return;
    let pos = 0;
    let timer = 0;
    const tick = () => {
      const frames = framesRef.current;
      if (!frames.length) return;
      const order = playOrder();
      const fi = order[pos % order.length];
      const f = frames[fi];
      if (!f) return;
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(f.bitmap, 0, 0);
      drawCaption(ctx, c.width, c.height);
      pos++;
      timer = window.setTimeout(tick, f.delay / speed);
      playRef.current = timer;
    };
    tick();
    return () => window.clearTimeout(playRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, range, speed, reverse, boomerang, caption, captionSize]);

  // ---- encode ----
  const save = async () => {
    if (busy || !loaded) return;
    setBusy(true);
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
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0)); // keep UI alive
      }
      enc.finish();
      const bytes = enc.bytes();
      const base = item.file.name.replace(/\.[^.]+$/, '');
      onSave(item.id, new File([bytes.slice()], `${base}_edited.gif`, { type: 'image/gif' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor-overlay" onClick={busy ? undefined : onClose}>
      <div className="editor" role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')} disabled={busy}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="ed-preview gif-preview">
          <canvas ref={canvasRef} />
        </div>

        {truncated && <div className="banner warn">{t('gifTooLong', { n: String(FRAME_CAP) })}</div>}

        <div className="ed-controls">
          <div className="ed-row">
            <span className="sp-label">
              {t('frames')}{' '}
              <span className="sp-val">#{range[0] + 1} – #{range[1] + 1} / {frameCount}</span>
            </span>
            <DualRange
              min={0}
              max={Math.max(frameCount - 1, 1)}
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
          </div>

          <div className="ed-grid">
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
