import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useI18n } from '../i18n';
import {
  audioCtx,
  getCachedBuffer,
  mixDuration,
  peaks,
  playMix,
  renderMixWav,
  type PlayHandle,
} from '../lib/audioEngine';
import { uid, type Clip, type MixerDoc, type Track } from '../lib/studioTypes';

const ZOOMS = [40, 80, 160];

interface Props {
  doc: MixerDoc;
  onChange: (doc: MixerDoc) => void;
  onRecorded: (blob: Blob, atSec: number) => void;
  /** bumped when new buffers finish decoding — re-renders waveforms */
  bufVer: number;
  /** assetId → display name */
  names: Record<string, string>;
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const d = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

function ClipWave({ assetId, offset, duration, zoom, ver }: {
  assetId: string; offset: number; duration: number; zoom: number; ver: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = Math.max(2, Math.min(4000, Math.floor(duration * zoom)));
    c.width = w;
    c.height = 52;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, 52);
    const buf = getCachedBuffer(assetId);
    if (!buf) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c94f16';
    g.fillStyle = accent;
    g.globalAlpha = 0.75;
    const pk = peaks(buf, offset, duration, w);
    for (let x = 0; x < w; x++) {
      const h = Math.max(1.5, pk[x] * 46);
      g.fillRect(x, 26 - h / 2, 1, h);
    }
  }, [assetId, offset, duration, zoom, ver]);
  return <canvas ref={ref} className="clip-wave" />;
}

export function Mixer({ doc, onChange, onRecorded, bufVer, names }: Props) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(80);
  const [sel, setSel] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleRef = useRef<PlayHandle | null>(null);
  const rafRef = useRef(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const dragRef = useRef<{
    mode: 'move' | 'l' | 'r';
    trackId: string;
    clipId: string;
    startX: number;
    orig: Clip;
  } | null>(null);
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const dur = Math.max(mixDuration(doc), 8);
  const laneW = Math.ceil((dur + 4) * zoom);

  // ---- doc ops ----
  const patchTrack = (id: string, p: Partial<Track>) =>
    onChange({ tracks: doc.tracks.map((tr) => (tr.id === id ? { ...tr, ...p } : tr)) });

  const removeTrack = (id: string) =>
    onChange({ tracks: doc.tracks.filter((tr) => tr.id !== id) });

  const addTrack = () =>
    onChange({
      tracks: [...doc.tracks, {
        id: uid(), name: t('trackName', { n: String(doc.tracks.length + 1) }),
        gain: 1, muted: false, solo: false, clips: [],
      }],
    });

  const patchClip = (trackId: string, clipId: string, p: Partial<Clip>) =>
    onChange({
      tracks: doc.tracks.map((tr) =>
        tr.id !== trackId
          ? tr
          : { ...tr, clips: tr.clips.map((c) => (c.id === clipId ? { ...c, ...p } : c)) }
      ),
    });

  const removeClip = (clipId: string) =>
    onChange({
      tracks: doc.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.id !== clipId) })),
    });

  const splitSelected = () => {
    if (!sel) return;
    for (const tr of doc.tracks) {
      const c = tr.clips.find((x) => x.id === sel);
      if (!c) continue;
      const at = playPos;
      if (at <= c.start + 0.05 || at >= c.start + c.duration - 0.05) return;
      const cut = at - c.start;
      const left: Clip = { ...c, duration: cut };
      const right: Clip = {
        ...c, id: uid(), start: at, offset: c.offset + cut, duration: c.duration - cut,
      };
      onChange({
        tracks: doc.tracks.map((x) =>
          x.id !== tr.id ? x : { ...x, clips: [...x.clips.filter((y) => y.id !== c.id), left, right] }
        ),
      });
      setSel(left.id);
      return;
    }
  };

  // ---- playback ----
  const stop = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    window.cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  };

  const togglePlay = () => {
    if (playing) { stop(); return; }
    const total = mixDuration(docRef.current);
    if (total <= 0) return;
    const from = playPos >= total - 0.05 ? 0 : playPos;
    const h = playMix(docRef.current, from);
    handleRef.current = h;
    setPlaying(true);
    const tick = () => {
      const pos = h.from + (audioCtx().currentTime - h.t0);
      if (pos >= mixDuration(docRef.current)) {
        setPlayPos(0);
        stop();
        return;
      }
      setPlayPos(pos);
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- recording ----
  const toggleRecord = async () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const at = playPos;
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((tk) => tk.stop());
        setRecording(false);
        onRecorded(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), at);
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setErr(t('micDenied'));
      window.setTimeout(() => setErr(''), 4000);
    }
  };

  // ---- export ----
  const exportWav = async () => {
    if (busy || mixDuration(doc) <= 0) return;
    setBusy(true);
    try {
      const blob = await renderMixWav(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mix.wav';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } finally {
      setBusy(false);
    }
  };

  // ---- clip dragging ----
  const clipDown = (mode: 'move' | 'l' | 'r', trackId: string, c: Clip) =>
    (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      setSel(c.id);
      dragRef.current = { mode, trackId, clipId: c.id, startX: e.clientX, orig: { ...c } };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

  const clipMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const buf = getCachedBuffer(d.orig.assetId);
    const srcDur = buf?.duration ?? d.orig.offset + d.orig.duration;
    if (d.mode === 'move') {
      patchClip(d.trackId, d.clipId, { start: Math.max(0, d.orig.start + dx) });
    } else if (d.mode === 'l') {
      const shift = Math.max(-d.orig.offset, Math.min(dx, d.orig.duration - 0.1));
      patchClip(d.trackId, d.clipId, {
        start: d.orig.start + shift,
        offset: d.orig.offset + shift,
        duration: d.orig.duration - shift,
      });
    } else {
      patchClip(d.trackId, d.clipId, {
        duration: Math.max(0.1, Math.min(d.orig.duration + dx, srcDur - d.orig.offset)),
      });
    }
  };

  const clipUp = () => { dragRef.current = null; };

  // Delete key removes selected clip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        removeClip(sel);
        setSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, doc]);

  const seekFromRuler = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (playing) stop();
    setPlayPos(Math.max(0, (e.clientX - rect.left) / zoom));
  };

  const ticks = Array.from({ length: Math.ceil(dur + 4) }, (_, i) => i);

  return (
    <div className="mixer">
      {/* transport */}
      <div className="gif-transport">
        <button className="tool-btn play-btn" onClick={togglePlay} title={playing ? t('pause') : t('play')}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="15" height="15"><path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
          )}
        </button>
        <button
          className={`tool-btn rec-btn${recording ? ' recording' : ''}`}
          onClick={() => void toggleRecord()}
          title={recording ? t('stopBtn') : t('recordBtn')}
        >
          <svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="6" fill="currentColor" /></svg>
        </button>
        <span className="gif-pos">{fmtClock(playPos)}</span>
        <span className="tb-sep" />
        <button className="btn btn-ghost btn-sm" onClick={addTrack}>{t('addTrack')} +</button>
        <button className="btn btn-ghost btn-sm" onClick={splitSelected} disabled={!sel}>{t('split')}</button>
        <select className="tb-select" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {ZOOMS.map((z) => <option key={z} value={z}>{z} px/s</option>)}
        </select>
        <span className="opt-spacer" />
        <button className="btn btn-accent btn-sm" onClick={() => void exportWav()} disabled={busy || mixDuration(doc) <= 0}>
          {busy ? t('processing') : t('exportWav')}
        </button>
      </div>

      {err && <div className="banner danger">{err}</div>}

      {/* timeline */}
      <div className="tl-scroll">
        <div className="tl-inner" style={{ width: laneW + 172 }}>
          {/* ruler */}
          <div className="tl-row">
            <div className="trk-head tl-corner" />
            <div className="tl-ruler" style={{ width: laneW }} onPointerDown={seekFromRuler}>
              {ticks.map((s) => (
                <span key={s} className={`tick${s % 5 === 0 ? ' major' : ''}`} style={{ left: s * zoom }}>
                  {s % 5 === 0 ? `${s}s` : ''}
                </span>
              ))}
            </div>
          </div>

          <div className="tl-body">
            {doc.tracks.map((tr) => (
              <div className="tl-row" key={tr.id}>
                <div className="trk-head">
                  <input
                    className="trk-name"
                    value={tr.name}
                    onChange={(e) => patchTrack(tr.id, { name: e.target.value })}
                  />
                  <div className="trk-btns">
                    <button
                      className={tr.muted ? 'active' : ''}
                      onClick={() => patchTrack(tr.id, { muted: !tr.muted })}
                      title="Mute"
                    >M</button>
                    <button
                      className={tr.solo ? 'active' : ''}
                      onClick={() => patchTrack(tr.id, { solo: !tr.solo })}
                      title="Solo"
                    >S</button>
                    <button onClick={() => removeTrack(tr.id)} title={t('remove')}>×</button>
                  </div>
                  <input
                    type="range"
                    className="trk-gain"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={tr.gain}
                    onChange={(e) => patchTrack(tr.id, { gain: Number(e.target.value) })}
                  />
                </div>
                <div className="lane" style={{ width: laneW }}>
                  {tr.clips.map((c) => (
                    <div
                      key={c.id}
                      className={`clip${sel === c.id ? ' sel' : ''}`}
                      style={{ left: c.start * zoom, width: Math.max(6, c.duration * zoom) }}
                      onPointerDown={clipDown('move', tr.id, c)}
                      onPointerMove={clipMove}
                      onPointerUp={clipUp}
                    >
                      <ClipWave assetId={c.assetId} offset={c.offset} duration={c.duration} zoom={zoom} ver={bufVer} />
                      <span className="clip-name">{names[c.assetId] ?? ''}</span>
                      <div className="clip-edge l" onPointerDown={clipDown('l', tr.id, c)} onPointerMove={clipMove} onPointerUp={clipUp} />
                      <div className="clip-edge r" onPointerDown={clipDown('r', tr.id, c)} onPointerMove={clipMove} onPointerUp={clipUp} />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {doc.tracks.length === 0 && (
              <p className="mix-empty">{t('emptyMix')}</p>
            )}

            {/* playhead */}
            <div className="playhead" style={{ left: 172 + playPos * zoom }} />
          </div>
        </div>
      </div>
    </div>
  );
}
