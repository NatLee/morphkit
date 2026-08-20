import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { Mixer } from './Mixer';
import { DualRange } from './DualRange';
import { InfoTip } from './InfoTip';
import { mixDuration, renderMixWav } from '../lib/audioEngine';
import { extractAudio, muxVideo } from '../lib/ffmpegClient';
import { loadSettings } from '../lib/settings';
import type { AssetRec, VideoDoc } from '../lib/studioTypes';

/* Video project (openreel-style): preview + trim on top,
   multi-track audio timeline below, ffmpeg mux on export. */

interface Props {
  videoAsset: AssetRec | null;
  /** pickable video assets when none is selected yet */
  candidates: AssetRec[];
  doc: VideoDoc;
  onDoc: (fn: (d: VideoDoc) => VideoDoc) => void;
  onRecorded: (blob: Blob, atSec: number) => void;
  /** trimmed video audio extracted as WAV — Studio turns it into an asset + track */
  onAudioExtracted: (wav: Blob, srcName: string) => Promise<void>;
  bufVer: number;
  names: Record<string, string>;
  activeTrackId: string | null;
  onActiveTrack: (id: string) => void;
  projectName: string;
}

function fmtT(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}.${Math.floor((sec % 1) * 10)}`;
}

export function VideoWorkspace({
  videoAsset, candidates, doc, onDoc, onRecorded, onAudioExtracted, bufVer, names, activeTrackId, onActiveTrack, projectName,
}: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [note, setNote] = useState('');

  const url = useMemo(
    () => (videoAsset ? URL.createObjectURL(videoAsset.blob) : ''),
    [videoAsset?.id, videoAsset?.blob]  // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const onLoaded = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    setDuration(el.duration);
    if (doc.trimEnd === 0) onDoc((d) => ({ ...d, trimEnd: el.duration }));
  };

  const onTrim = (s: number, e: number) => {
    const el = videoRef.current;
    if (el) {
      if (Math.abs(s - doc.trimStart) > 0.001) el.currentTime = s;
      else if (Math.abs(e - doc.trimEnd) > 0.001) el.currentTime = e;
    }
    onDoc((d) => ({ ...d, trimStart: Math.max(0, s), trimEnd: Math.min(duration || e, e) }));
  };

  const exportMp4 = async () => {
    if (!videoAsset || busy) return;
    setBusy(true);
    setProg(0);
    try {
      const hasAudio = mixDuration(doc.mixer) > 0;
      const wav = hasAudio ? await renderMixWav(doc.mixer) : null;
      const blob = await muxVideo(
        new File([videoAsset.blob], videoAsset.name, { type: videoAsset.blob.type }),
        wav,
        doc.trimStart,
        doc.trimEnd,
        loadSettings(),
        setProg
      );
      const dl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dl;
      a.download = `${projectName.replace(/[\\/:*?"<>|]/g, '_') || 'video'}.mp4`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(dl), 10000);
    } catch { /* export failed — engine banner covers most cases */ }
    finally {
      setBusy(false);
    }
  };

  /** Separate the video's own audio into an editable mixer track. */
  const extract = async () => {
    if (!videoAsset || busy) return;
    setBusy(true);
    setNote('');
    try {
      const wav = await extractAudio(
        new File([videoAsset.blob], videoAsset.name, { type: videoAsset.blob.type }),
        doc.trimStart,
        doc.trimEnd || duration
      );
      await onAudioExtracted(wav, videoAsset.name);
    } catch {
      setNote(t('extractNoAudio'));
      window.setTimeout(() => setNote(''), 4000);
    } finally {
      setBusy(false);
    }
  };

  // blank-start friendly: the workspace always renders; the preview slot
  // doubles as an inline video picker until one is chosen
  return (
    <div className="vw">
      <div className="vw-top">
        <div className="vw-preview">
          {videoAsset ? (
            <video ref={videoRef} src={url} controls playsInline onLoadedMetadata={onLoaded} />
          ) : (
            <div className="vw-pick">
              <p className="mx-label">{t('pickVideo')}</p>
              <div className="picker-list">
                {candidates.map((a) => (
                  <button
                    key={a.id}
                    className="btn btn-ghost btn-sm"
                    onClick={() => onDoc((d) => ({ ...d, videoAssetId: a.id }))}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              {candidates.length === 0 && <p className="st-empty">{t('noneOfKind')}</p>}
            </div>
          )}
        </div>
        <div className="vw-side">
          <span className="sp-label">
            {t('trim')} <InfoTip text={t('tipVideoWs')} />
          </span>
          <span className="sp-val">{fmtT(doc.trimStart)} – {fmtT(doc.trimEnd || duration)}</span>
          <DualRange
            min={0}
            max={Math.max(duration, 0.1)}
            start={doc.trimStart}
            end={doc.trimEnd || duration}
            gap={0.1}
            onChange={onTrim}
            format={fmtT}
          />
          <div className="vw-extract">
            <button className="btn btn-ghost" onClick={() => void extract()} disabled={busy || !videoAsset}>
              {t('extractAudio')}
            </button>
            <InfoTip text={t('tipExtract')} />
          </div>
          {note && <p className="vw-note">{note}</p>}
          <button className="btn btn-accent" onClick={() => void exportMp4()} disabled={busy}>
            {busy ? `${t('processing')} ${Math.round(prog * 100)}%` : t('exportMp4')}
          </button>
          {busy && (
            <div className="fc-progress">
              <div className="fc-bar" style={{ width: `${Math.round(prog * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      <Mixer
        doc={doc.mixer}
        onChange={(m) => onDoc((d) => ({ ...d, mixer: m }))}
        onRecorded={onRecorded}
        bufVer={bufVer}
        names={names}
        activeTrackId={activeTrackId}
        onActiveTrack={onActiveTrack}
      />
    </div>
  );
}
