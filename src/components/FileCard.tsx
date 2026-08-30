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
import { docTypeOf } from '../lib/formats';
import { PDF_ICON } from './FormatMatrix';

const KIND_ICONS: Record<Kind, string> = {
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 10 3.5-4.5 2.5 3 2-2.5L18 15H6zm2.5-7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  audio: 'M9 18a3 3 0 1 1-2-2.83V6l11-2v10a3 3 0 1 1-2-2.83V7.4l-7 1.27V18z',
  video: 'M4 6h11a1 1 0 0 1 1 1v2.5l4-2.5a.6.6 0 0 1 1 .5v9a.6.6 0 0 1-1 .5l-4-2.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  pdf: PDF_ICON,
  doc: 'M6 3h9l4 4v14H6zM15 3v4h4M8 12h8M8 15h8M8 18h5',
};

interface Props {
  item: Item;
  onTarget: (id: string, target: string) => void;
  onQuality: (id: string, q: number) => void;
  onConvert: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  /** send this file to Studio as a new typed project */
  onToProject: (id: string) => void;
  /** encrypted PDF: ask for its password */
  onUnlock: (id: string) => void;
  /** image with a QR code: open the QR tool on its payload */
  onQr: (text: string) => void;
}

const EDIT_ICONS = {
  media: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 7.5L20 19M8.5 16.5L20 5',
  image: 'M4 20l1-4L16 5l3 3L8 19l-4 1zM14.5 6.5l3 3',
  gif: 'M4 5h16v14H4zM4 9h16M8 5v14M16 5v14',
  pdf: 'M5 4h6v6H5zM13 4h6v6h-6zM5 14h6v6H5zM13 14h6v6h-6z',
  doc: 'M4 6h16M4 12h10M4 18h13',
  sheet: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M16 5v14',
};

export function FileCard({ item, onTarget, onQuality, onConvert, onRemove, onEdit, onToProject, onUnlock, onQr }: Props) {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyResult = async () => {
    if (!item.outUrl) return;
    try {
      const blob = await fetch(item.outUrl).then((r) => r.blob());
      let png = blob;
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
        const converted = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
        if (!converted) return;
        png = converted;
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable for this type */ }
  };
  const busy = item.status === 'converting' || item.status === 'queued';
  const showQuality =
    (item.kind === 'image' || item.kind === 'pdf') && (item.target === 'jpeg' || item.target === 'webp');
  const huge = item.file.size > HUGE_FILE_BYTES;
  const large = !huge && item.file.size > LARGE_FILE_BYTES && item.kind !== 'image';
  const isGif = item.kind === 'image' && (extOf(item.file.name) === 'gif' || item.file.type === 'image/gif');
  const locked = item.kind === 'pdf' && !!item.meta?.encrypted && !item.pdfPassword;
  const editIcon = isGif ? EDIT_ICONS.gif : item.kind === 'image' ? EDIT_ICONS.image : item.kind === 'pdf' ? EDIT_ICONS.pdf : item.kind === 'doc' ? (docTypeOf(item.file) === 'sheet' ? EDIT_ICONS.sheet : EDIT_ICONS.doc) : EDIT_ICONS.media;
  const kindKey = item.kind === 'image' ? 'kindImage' : item.kind === 'audio' ? 'kindAudio' : item.kind === 'pdf' ? 'kindPdf' : item.kind === 'doc' ? 'kindDoc' : 'kindVideo';

  const editSummary: string[] = [];
  if (item.edit) {
    const e = item.edit;
    if (e.trimStart != null || e.trimEnd != null) {
      editSummary.push(`${fmtDuration(e.trimStart ?? 0)}–${e.trimEnd != null ? fmtDuration(e.trimEnd) : '…'}`);
    }
    if (e.speed) editSummary.push(`${e.speed}×`);
    if (e.volume != null) editSummary.push(`${Math.round(e.volume * 100)}%`);
    if (e.rotate) editSummary.push(`${e.rotate}°`);
    if (e.mute) editSummary.push(t('mutedChip'));
    if (e.audioTrack) editSummary.push(t('audioReplaced'));
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
    } else if (item.kind === 'doc') {
      if (m.pages != null) detailRows.push([t('docSlides'), String(m.pages)]);
      if (m.words != null) detailRows.push([t('docWords'), m.words.toLocaleString()]);
      if (m.chars != null) detailRows.push([t('docChars'), m.chars.toLocaleString()]);
      if (m.lines != null) detailRows.push([t('docLines'), m.lines.toLocaleString()]);
      if (m.sheets?.length) detailRows.push([t('docSheets'), m.sheets.join(', ')]);
      if (m.title) detailRows.push([t('tagTitle'), m.title]);
    } else if (item.kind === 'pdf') {
      if (m.pages != null) detailRows.push([t('pdfPages'), String(m.pages)]);
      if (m.width != null && m.height != null) detailRows.push([t('pdfPageSize'), `${m.width} × ${m.height} pt`]);
      if (m.aspect) detailRows.push([t('aspect'), m.aspect]);
      if (m.title) detailRows.push([t('tagTitle'), m.title]);
      if (m.author) detailRows.push([t('pdfAuthor'), m.author]);
    } else {
      if (m.duration != null) detailRows.push([t('duration'), fmtDuration(m.duration)]);
      if (m.aspect) detailRows.push([t('aspect'), m.aspect]);
      if (m.bitrate) detailRows.push([t('bitrate'), `~${m.bitrate}`]);
      if (m.title) detailRows.push([t('tagTitle'), m.title]);
      if (m.artist) detailRows.push([t('tagArtist'), m.artist]);
      if (m.album) detailRows.push([t('tagAlbum'), m.album]);
      if (m.hasCover) detailRows.push([t('tagCover'), '✓']);
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
            <span className="fc-kind">{t(kindKey)}</span>
            <span className="fc-size">{formatBytes(item.file.size)}</span>
            {item.kind === 'pdf' && m?.pages != null && (
              <span className="fc-size">{t('pdfPagesN', { n: String(m.pages) })}</span>
            )}
            {item.kind === 'doc' && m?.pages != null && (
              <span className="fc-size">{t('docSlidesN', { n: String(m.pages) })}</span>
            )}
            {item.kind === 'doc' && m?.words != null && (
              <span className="fc-size">{t('docWordsN', { n: m.words.toLocaleString() })}</span>
            )}
            {item.kind !== 'pdf' && m?.width != null && m?.height != null && (
              <span className="fc-size">{m.width}×{m.height}</span>
            )}
            {m?.duration != null && <span className="fc-size">{fmtDuration(m.duration)}</span>}
            {item.kind === 'pdf' && item.meta?.encrypted && (
              <span className={`fc-edited fc-lock${locked ? '' : ' open'}`}>{locked ? '🔒 ' : '🔓 '}{t(locked ? 'pdfEncrypted' : 'pdfUnlockedChip')}</span>
            )}
            {m?.qr && (
              <button className="fc-edited fc-qr" title={m.qr} onClick={() => onQr(m.qr as string)}>
                <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 18h2v2h-2z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
                {' '}QR · {m.qr.length > 28 ? m.qr.slice(0, 28) + '…' : m.qr}
              </button>
            )}
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
            onClick={() => (locked ? onUnlock(item.id) : onEdit(item.id))}
          >
            <svg viewBox="0 0 24 24" width="14" height="14"><path d={editIcon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {t('edit')}
          </button>
          {item.kind !== 'doc' && (
          <button
            className="btn btn-ghost btn-sm fc-to-studio"
            disabled={busy}
            onClick={() => onToProject(item.id)}
            title={t('tipOpenAsProject')}
          >
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 8h12v12H8zM4 16V4h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            {t('openAsProject')}
          </button>
          )}
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
              {outputsFor(item.kind, item.file).map((o) => (
                <option key={o} value={o}>{o.toUpperCase()}</option>
              ))}
            </select>
          </label>

          {/* phone replaces the select with a chip row — the native dropdown's
              popup covered the card's convert/quality controls (looked broken) */}
          <div className="fc-chips" role="radiogroup" aria-label={t('targetLabel')}>
            <span className="fc-chips-label">{t('targetLabel')}</span>
            {outputsFor(item.kind, item.file).map((o) => (
              <button
                key={o}
                className={`fc-chip${item.target === o ? ' active' : ''}`}
                disabled={busy}
                onClick={() => onTarget(item.id, o)}
              >
                {o.toUpperCase()}
              </button>
            ))}
          </div>

          {item.status === 'done' && item.outUrl ? (
            <a className="btn btn-accent" href={item.outUrl} download={item.outName}>
              {t('download')}
              {item.outSize != null && <span className="btn-sub">{formatBytes(item.outSize)}</span>}
            </a>
          ) : locked ? (
            <button className="btn btn-accent" disabled={busy} onClick={() => onUnlock(item.id)}>
              🔒 {t('pdfUnlock')}
            </button>
          ) : (
            <button
              className="btn btn-accent"
              disabled={busy}
              onClick={() => onConvert(item.id)}
            >
              {item.status === 'converting' ? t('converting') : item.status === 'queued' ? t('queued') : item.status === 'error' ? t('retry') : t('convert')}
            </button>
          )}

          {item.status === 'done' && item.outUrl && item.kind === 'image' && (
            <button
              className="btn btn-ghost fc-remove"
              onClick={() => void copyResult()}
              title={copied ? t('copied') : t('copyResult')}
              aria-label={t('copyResult')}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              )}
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
