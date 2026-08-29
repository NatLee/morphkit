import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { DualRange } from './DualRange';
import type { Item, MediaEdit } from '../types';

interface Props {
  item: Item;
  onSave: (id: string, edit: MediaEdit | undefined) => void;
  onClose: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function fmtT(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const d = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

export function MediaEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const isVideo = item.kind === 'video';
  const mediaRef = useRef<HTMLVideoElement>(null);
  const audioPickRef = useRef<HTMLInputElement>(null);
  const url = useMemo(() => URL.createObjectURL(item.file), [item.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const [duration, setDuration] = useState(item.meta?.duration ?? 0);
  const [start, setStart] = useState(item.edit?.trimStart ?? 0);
  const [end, setEnd] = useState(item.edit?.trimEnd ?? item.meta?.duration ?? 0);
  const [volume, setVolume] = useState(item.edit?.volume ?? 1);
  const [speed, setSpeed] = useState(item.edit?.speed ?? 1);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(item.edit?.rotate ?? 0);
  const [mute, setMute] = useState(item.edit?.mute ?? false);
  const [audioTrack, setAudioTrack] = useState<File | null>(item.edit?.audioTrack ?? null);

  // Sideways rotation keeps the element's LAYOUT box, so a rotated landscape
  // video overflows the fixed-height stage. Scale it so the rotated bounding
  // box fits. duration is a dep so the fit re-runs once metadata (and thus
  // the element's aspect-driven size) arrives.
  const stageRef = useRef<HTMLDivElement>(null);
  const [rotScale, setRotScale] = useState(1);
  useLayoutEffect(() => {
    if (!isVideo) return;
    const fit = () => {
      const v = mediaRef.current;
      const stage = stageRef.current;
      if (!v || !stage || (rotate !== 90 && rotate !== 270)) { setRotScale(1); return; }
      const ew = v.offsetWidth;
      const eh = v.offsetHeight;
      if (!ew || !eh) return;
      setRotScale(Math.min(stage.clientWidth / eh, stage.clientHeight / ew));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [rotate, isVideo, duration]);

  // live preview: volume + speed + mute on the element
  useEffect(() => {
    const el = mediaRef.current;
    if (el) {
      el.volume = mute ? 0 : Math.min(1, volume);
      el.playbackRate = speed;
    }
  }, [volume, speed, mute]);

  const onLoaded = () => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    setDuration(el.duration);
    setEnd((prev) => (prev === 0 || prev > el.duration ? el.duration : prev));
  };

  // stop at trim end — no seek-back bounce (that caused visible shaking)
  const onTime = () => {
    const el = mediaRef.current;
    if (el && !el.paused && el.currentTime >= end - 0.02) el.pause();
  };

  /** Trim-handle drag scrubs the playhead so you see the exact cut frame. */
  const onTrimChange = (s: number, e: number) => {
    const el = mediaRef.current;
    if (el && !el.paused) el.pause();
    if (el) {
      if (Math.abs(s - start) > 0.001) el.currentTime = s;
      else if (Math.abs(e - end) > 0.001) el.currentTime = e;
    }
    setStart(Math.max(0, s));
    setEnd(duration > 0 ? Math.min(duration, e) : e);
  };

  const markStart = () => {
    const el = mediaRef.current;
    if (el) setStart(Math.min(el.currentTime, end - 0.1));
  };

  const markEnd = () => {
    const el = mediaRef.current;
    if (el) setEnd(Math.max(el.currentTime, start + 0.1));
  };

  const playFromStart = () => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = start;
    void el.play();
  };

  const reset = () => {
    setStart(0);
    setEnd(duration);
    setVolume(1);
    setSpeed(1);
    setRotate(0);
    setMute(false);
    setAudioTrack(null);
  };

  const save = () => {
    const edit: MediaEdit = {};
    if (start > 0.05) edit.trimStart = start;
    if (duration > 0 && end < duration - 0.05) edit.trimEnd = end;
    if (volume !== 1) edit.volume = volume;
    if (speed !== 1) edit.speed = speed;
    if (isVideo && rotate !== 0) edit.rotate = rotate;
    if (isVideo && mute && !audioTrack) edit.mute = true;
    if (isVideo && audioTrack) edit.audioTrack = audioTrack;
    onSave(item.id, Object.keys(edit).length ? edit : undefined);
  };

  return createPortal(
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor" role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div ref={stageRef} className={`ed-preview media-preview ${isVideo ? 'mp-video' : 'mp-audio'}`}>
          {isVideo ? (
            <video
              ref={mediaRef}
              src={url}
              controls
              playsInline
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTime}
              style={{ transform: rotate ? `rotate(${rotate}deg)${rotScale !== 1 ? ` scale(${rotScale})` : ''}` : undefined }}
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
          {/* ---- timeline ---- */}
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
              onChange={onTrimChange}
              format={fmtT}
            />
            <div className="ed-mark-btns">
              <button className="btn btn-ghost btn-sm" onClick={playFromStart}>▶ {fmtT(start)}</button>
              <button className="btn btn-ghost btn-sm" onClick={markStart}>{t('setStartHere')}</button>
              <button className="btn btn-ghost btn-sm" onClick={markEnd}>{t('setEndHere')}</button>
            </div>
          </div>

          {/* ---- video track ---- */}
          {isVideo && (
            <div className="track-sec">
              <p className="track-title">{t('videoTrackLabel')}</p>
              <div className="ed-grid">
                <label className="sp-field">
                  <span className="sp-label">{t('speed')}</span>
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    {SPEEDS.map((v) => (
                      <option key={v} value={v}>{v}×</option>
                    ))}
                  </select>
                </label>
                <div className="sp-field">
                  <span className="sp-label">{t('rotate')}</span>
                  <div className="ed-seg">
                    {([0, 90, 180, 270] as const).map((r) => (
                      <button key={r} className={rotate === r ? 'active' : ''} onClick={() => setRotate(r)}>
                        {r}°
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ---- audio track ---- */}
          <div className="track-sec">
            <p className="track-title">{t('audioTrackLabel')}</p>
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
                  disabled={mute && !audioTrack}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
              </label>

              {!isVideo && (
                <label className="sp-field">
                  <span className="sp-label">{t('speed')}</span>
                  <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                    {SPEEDS.map((v) => (
                      <option key={v} value={v}>{v}×</option>
                    ))}
                  </select>
                </label>
              )}

              {isVideo && (
                <>
                  <label className="sp-field sp-check">
                    <input
                      type="checkbox"
                      checked={mute && !audioTrack}
                      disabled={!!audioTrack}
                      onChange={(e) => setMute(e.target.checked)}
                    />
                    <span className="sp-label">{t('muteTrack')}</span>
                  </label>

                  <div className="sp-field">
                    <span className="sp-label">{t('replaceAudio')}</span>
                    <div className="replace-row">
                      <button className="btn btn-ghost btn-sm" onClick={() => audioPickRef.current?.click()}>
                        {audioTrack ? audioTrack.name : `${t('replaceAudio')}…`}
                      </button>
                      {audioTrack && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setAudioTrack(null)}>
                          × {t('clearLabel')}
                        </button>
                      )}
                    </div>
                    <input
                      ref={audioPickRef}
                      type="file"
                      accept="audio/*"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setAudioTrack(f); setMute(false); }
                        e.target.value = '';
                      }}
                    />
                  </div>
                </>
              )}
            </div>
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
    </div>,
    document.body
  );
}
