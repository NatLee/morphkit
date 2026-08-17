import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { fmtDuration } from '../lib/metadata';
import { DualRange } from './DualRange';
import type { Item, MediaEdit } from '../types';

interface Props {
  item: Item;
  onSave: (id: string, edit: MediaEdit | undefined) => void;
  onClose: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function fmtT(sec: number): string {
  return `${fmtDuration(sec)}.${Math.floor((sec % 1) * 10)}`;
}

export function MediaEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const isVideo = item.kind === 'video';
  const mediaRef = useRef<HTMLVideoElement>(null);
  const url = useMemo(() => URL.createObjectURL(item.file), [item.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const [duration, setDuration] = useState(item.meta?.duration ?? 0);
  const [start, setStart] = useState(item.edit?.trimStart ?? 0);
  const [end, setEnd] = useState(item.edit?.trimEnd ?? item.meta?.duration ?? 0);
  const [volume, setVolume] = useState(item.edit?.volume ?? 1);
  const [speed, setSpeed] = useState(item.edit?.speed ?? 1);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(item.edit?.rotate ?? 0);

  // live preview: volume + speed on the element; loop inside trim range
  useEffect(() => {
    const el = mediaRef.current;
    if (el) {
      el.volume = Math.min(1, volume);
      el.playbackRate = speed;
    }
  }, [volume, speed]);

  const onLoaded = () => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    setDuration(el.duration);
    setEnd((prev) => (prev === 0 || prev > el.duration ? el.duration : prev));
  };

  const onTime = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.currentTime > end + 0.05 && !el.paused) {
      el.pause();
      el.currentTime = start;
    }
  };

  const markStart = () => {
    const el = mediaRef.current;
    if (el) setStart(Math.min(el.currentTime, end - 0.1));
  };

  const markEnd = () => {
    const el = mediaRef.current;
    if (el) setEnd(Math.max(el.currentTime, start + 0.1));
  };

  const reset = () => {
    setStart(0);
    setEnd(duration);
    setVolume(1);
    setSpeed(1);
    setRotate(0);
  };

  const save = () => {
    const edit: MediaEdit = {};
    if (start > 0.05) edit.trimStart = start;
    if (duration > 0 && end < duration - 0.05) edit.trimEnd = end;
    if (volume !== 1) edit.volume = volume;
    if (speed !== 1) edit.speed = speed;
    if (isVideo && rotate !== 0) edit.rotate = rotate;
    onSave(item.id, Object.keys(edit).length ? edit : undefined);
  };

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor" role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="ed-preview">
          {isVideo ? (
            <video
              ref={mediaRef}
              src={url}
              controls
              playsInline
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTime}
              style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined }}
            />
          ) : (
            <audio
              ref={mediaRef as never}
              src={url}
              controls
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTime}
            />
          )}
        </div>

        <div className="ed-controls">
          <div className="ed-row">
            <span className="sp-label">
              {t('trim')} <span className="sp-val">{fmtT(start)} – {fmtT(end)}</span>
            </span>
            <DualRange
              min={0}
              max={Math.max(duration, 0.1)}
              start={start}
              end={end}
              gap={0.1}
              onChange={(s, e) => { setStart(Math.max(0, s)); setEnd(Math.min(duration || e, e)); }}
              format={fmtT}
            />
            <div className="ed-mark-btns">
              <button className="btn btn-ghost btn-sm" onClick={markStart}>{t('setStartHere')}</button>
              <button className="btn btn-ghost btn-sm" onClick={markEnd}>{t('setEndHere')}</button>
            </div>
          </div>

          <div className="ed-grid">
            <label className="sp-field">
              <span className="sp-label">
                {t('volume')} <span className="sp-val">{Math.round(volume * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </label>

            <label className="sp-field">
              <span className="sp-label">{t('speed')}</span>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>{v}×</option>
                ))}
              </select>
            </label>

            {isVideo && (
              <div className="sp-field">
                <span className="sp-label">{t('rotate')}</span>
                <div className="ed-seg">
                  {([0, 90, 180, 270] as const).map((r) => (
                    <button
                      key={r}
                      className={rotate === r ? 'active' : ''}
                      onClick={() => setRotate(r)}
                    >
                      {r}°
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="ed-foot">
          <button className="btn btn-ghost" onClick={reset}>{t('reset')}</button>
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={save}>{t('save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
