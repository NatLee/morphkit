import { useState } from 'react';
import { useI18n } from '../i18n';
import {
  formatBytes,
  outputsFor,
  LARGE_FILE_BYTES,
  HUGE_FILE_BYTES,
  type Kind,
} from '../lib/formats';
import { fmtDuration } from '../lib/metadata';
import { extOf } from '../lib/formats';
import type { Item } from '../types';

const KIND_ICONS: Record<Kind, string> = {
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 10 3.5-4.5 2.5 3 2-2.5L18 15H6zm2.5-7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  audio: 'M9 18a3 3 0 1 1-2-2.83V6l11-2v10a3 3 0 1 1-2-2.83V7.4l-7 1.27V18z',
  video: 'M4 6h11a1 1 0 0 1 1 1v2.5l4-2.5a.6.6 0 0 1 1 .5v9a.6.6 0 0 1-1 .5l-4-2.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
};

interface Props {
  item: Item;
  onTarget: (id: string, target: string) => void;
  onQuality: (id: string, q: number) => void;
  onConvert: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
}

const EDIT_ICONS = {
  media: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 7.5L20 19M8.5 16.5L20 5',
  image: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3',
  gif: 'M4 5h16v14H4zM4 9h16M8 5v14M16 5v14',
};

export function FileCard({ item, onTarget, onQuality, onConvert, onRemove, onEdit }: Props) {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  const busy = item.status === 'converting' || item.status === 'queued';
  const showQuality =
    item.kind === 'image' && (item.target === 'jpeg' || item.target === 'webp');
  const huge = item.file.size > HUGE_FILE_BYTES;
  const large = !huge && item.file.size > LARGE_FILE_BYTES && item.kind !== 'image';
  const isGif = item.kind === 'image' && (extOf(item.file.name) === 'gif' || item.file.type === 'image/gif');
  const editIcon = isGif ? EDIT_ICONS.gif : item.kind === 'image' ? EDIT_ICONS.image : EDIT_ICONS.media;

  const editSummary: string[] = [];
  if (item.edit) {
    const e = item.edit;
    if (e.trimStart != null || e.trimEnd != null) {
      editSummary.push(`${fmtDuration(e.trimStart ?? 0)}–${e.trimEnd != null ? fmtDuration(e.trimEnd) : '…'}`);
    }
    if (e.speed) editSummary.push(`${e.speed}×`);
    if (e.volume != null) editSummary.push(`${Math.round(e.volume * 100)}%`);
    if (e.rotate) editSummary.push(`${e.rotate}°`);
  }

  const m = item.meta;
  const hasDetails = !!m;
  const detailRows: [string, string][] = [];
  if (m) {
    // common file info
    if (m.mime) detailRows.push([t('fileType'), m.mime]);
    if (m.modified) detailRows.push([t('modified'), m.modified]);
    // per-kind info: images get pixel stats, audio/video get stream stats
    if (item.kind === 'image') {
      if (m.mp) detailRows.push([t('megapixels'), m.mp]);
      if (m.aspect) detailRows.push([t('aspect'), m.aspect]);
    } else {
      if (m.duration != null) detailRows.push([t('duration'), fmtDuration(m.duration)]);
      if (m.aspect) detailRows.push([t('aspect'), m.aspect]);
      if (m.bitrate) detailRows.push([t('bitrate'), `~${m.bitrate}`]);
    }
    // photo EXIF
    if (m.camera) detailRows.push([t('camera'), m.camera]);
    if (m.lens) detailRows.push([t('lens'), m.lens]);
    if (m.iso) detailRows.push([t('iso'), String(m.iso)]);
    if (m.exposure) detailRows.push([t('exposure'), m.exposure]);
    if (m.aperture) detailRows.push([t('aperture'), m.aperture]);
    if (m.focal) detailRows.push([t('focalLength'), m.focal]);
    if (m.taken) detailRows.push([t('taken'), m.taken]);
  }

  return (
    <article className={`file-card kind-${item.kind} status-${item.status}`}>
      <div className="fc-main">
        {m?.preview ? (
          <div className="fc-thumb" aria-hidden="true">
            <img src={m.preview} alt="" loading="lazy" draggable={false} />
          </div>
        ) : (
          <div className="fc-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d={KIND_ICONS[item.kind]} fill="currentColor" /></svg>
          </div>
        )}

        <div className="fc-meta">
          <p className="fc-name" title={item.file.name}>{item.file.name}</p>
          <p className="fc-info">
            <span className="fc-kind">{t(item.kind === 'image' ? 'kindImage' : item.kind === 'audio' ? 'kindAudio' : 'kindVideo')}</span>
            <span className="fc-size">{formatBytes(item.file.size)}</span>
            {m?.width != null && m?.height != null && (
              <span className="fc-size">{m.width}×{m.height}</span>
            )}
            {m?.duration != null && <span className="fc-size">{fmtDuration(m.duration)}</span>}
            {(editSummary.length > 0 || item.edited) && (
              <span className="fc-edited">
                {editSummary.length ? editSummary.join(' · ') : t('edited')}
              </span>
            )}
          </p>
        </div>

        <div className="fc-controls">
          <button
            className="btn btn-ghost btn-sm fc-edit"
            disabled={busy}
            onClick={() => onEdit(item.id)}
          >
            <svg viewBox="0 0 24 24" width="14" height="14"><path d={editIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {t('edit')}
          </button>
          {hasDetails && (
            <button
              className={`btn btn-ghost fc-detail-btn${showDetails ? ' active' : ''}`}
              onClick={() => setShowDetails((v) => !v)}
              aria-label={t('details')}
              title={t('details')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 11v5M12 7.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          )}

          <label className="fc-target">
            <span>{t('targetLabel')}</span>
            <select
              value={item.target}
              disabled={busy}
              onChange={(e) => onTarget(item.id, e.target.value)}
            >
              {outputsFor(item.kind).map((o) => (
                <option key={o} value={o}>{o.toUpperCase()}</option>
              ))}
            </select>
          </label>

          {item.status === 'done' && item.outUrl ? (
            <a className="btn btn-accent" href={item.outUrl} download={item.outName}>
              {t('download')}
              {item.outSize != null && <span className="btn-sub">{formatBytes(item.outSize)}</span>}
            </a>
          ) : (
            <button
              className="btn btn-accent"
              disabled={busy}
              onClick={() => onConvert(item.id)}
            >
              {item.status === 'converting' ? t('converting') : item.status === 'queued' ? t('queued') : item.status === 'error' ? t('retry') : t('convert')}
            </button>
          )}

          <button className="btn btn-ghost fc-remove" disabled={busy} onClick={() => onRemove(item.id)} aria-label={t('remove')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      {showDetails && hasDetails && (
        <dl className="fc-details">
          {detailRows.map(([k, v]) => (
            <div className="fc-detail-row" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          {m?.gps && (
            <div className="fc-detail-row">
              <dt>{t('location')}</dt>
              <dd>
                {m.gps.lat.toFixed(5)}, {m.gps.lon.toFixed(5)}{' '}
                <a
                  href={`https://www.google.com/maps?q=${m.gps.lat},${m.gps.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('openMap')} ↗
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}

      {showQuality && (
        <div className="fc-quality">
          <span>{t('quality')}</span>
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.01}
            value={item.quality}
            disabled={busy}
            onChange={(e) => onQuality(item.id, Number(e.target.value))}
          />
          <span className="fc-quality-val">{Math.round(item.quality * 100)}%</span>
        </div>
      )}

      {item.status === 'converting' && item.kind !== 'image' && (
        <div className="fc-progress-row">
          <div className="fc-progress">
            <div className="fc-bar" style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
          <span className="fc-pct">{Math.round(item.progress * 100)}%</span>
        </div>
      )}

      {item.status === 'error' && <p className="fc-error">{t('failed')}</p>}

      {huge && <p className="fc-warn danger">{t('warnHuge')}</p>}
      {large && <p className="fc-warn">{t('warnLarge', { size: formatBytes(item.file.size) })}</p>}
    </article>
  );
}
