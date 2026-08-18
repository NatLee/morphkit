import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { DualRange } from './DualRange';

/** Extract frames from a video: one frame (image projects) or a clip (GIF projects). */

const MAX_FRAMES = 120;
const MAX_W = 960;

interface Props {
  blob: Blob;
  mode: 'single' | 'range';
  onDone: (frames: { img: ImageData; delay: number }[]) => void;
  onClose: () => void;
}

function fmtT(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}.${Math.floor((sec % 1) * 10)}`;
}

export function FramePicker({ blob, mode, onDone, onClose }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [pos, setPos] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [fps, setFps] = useState(8);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);

  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const onLoaded = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    setDuration(el.duration);
    setRange([0, Math.min(el.duration, 3)]);
  };

  const seekTo = (tSec: number) =>
    new Promise<void>((resolve) => {
      const el = videoRef.current;
      if (!el) { resolve(); return; }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('seeked', finish);
        resolve();
      };
      el.addEventListener('seeked', finish);
      window.setTimeout(finish, 1500);
      el.currentTime = Math.min(Math.max(tSec, 0), duration || tSec);
    });

  const grab = (): ImageData | null => {
    const el = videoRef.current;
    if (!el || !el.videoWidth) return null;
    const s = Math.min(1, MAX_W / el.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(el.videoWidth * s));
    c.height = Math.max(1, Math.round(el.videoHeight * s));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(el, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  };

  const capture = async () => {
    if (busy) return;
    setBusy(true);
    setProg(0);
    try {
      videoRef.current?.pause();
      if (mode === 'single') {
        await seekTo(pos);
        const img = grab();
        if (img) onDone([{ img, delay: 100 }]);
      } else {
        const [s, e] = range;
        const step = 1 / fps;
        const n = Math.min(MAX_FRAMES, Math.max(1, Math.floor((e - s) * fps) + 1));
        const out: { img: ImageData; delay: number }[] = [];
        for (let i = 0; i < n; i++) {
          await seekTo(s + i * step);
          const img = grab();
          if (img) out.push({ img, delay: Math.round(1000 / fps) });
          setProg((i + 1) / n);
        }
        if (out.length) onDone(out);
      }
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="editor-overlay" onClick={busy ? undefined : onClose}>
      <div className="editor mini-modal frame-modal" onClick={(e) => e.stopPropagation()}>
        <p className="mx-label">{mode === 'single' ? t('pickFrameTitle') : t('pickClipTitle')}</p>

        <div className="ed-preview mp-video fp-preview">
          <video ref={videoRef} src={url} controls playsInline onLoadedMetadata={onLoaded} />
        </div>

        {mode === 'single' ? (
          <label className="sp-field">
            <span className="sp-label">
              {t('timePos')} <span className="sp-val">{fmtT(pos)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.05}
              value={pos}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPos(v);
                const el = videoRef.current;
                if (el) el.currentTime = v;
              }}
            />
          </label>
        ) : (
          <>
            <div className="ed-row">
              <span className="sp-label">
                {t('trim')} <span className="sp-val">{fmtT(range[0])} – {fmtT(range[1])}</span>
              </span>
              <DualRange
                min={0}
                max={Math.max(duration, 0.1)}
                start={range[0]}
                end={range[1]}
                gap={0.1}
                onChange={(s, e) => {
                  const el = videoRef.current;
                  if (el) {
                    if (Math.abs(s - range[0]) > 0.001) el.currentTime = s;
                    else if (Math.abs(e - range[1]) > 0.001) el.currentTime = e;
                  }
                  setRange([Math.max(0, s), Math.min(duration || e, e)]);
                }}
                format={fmtT}
              />
            </div>
            <label className="sp-field">
              <span className="sp-label">FPS</span>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {[4, 6, 8, 10, 12].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          </>
        )}

        {busy && (
          <div className="fc-progress">
            <div className="fc-bar" style={{ width: `${Math.round(prog * 100)}%` }} />
          </div>
        )}

        <div className="ed-foot-main">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>
          <button className="btn btn-accent" onClick={() => void capture()} disabled={busy || duration <= 0}>
            {busy ? t('processing') : t('captureLabel')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
