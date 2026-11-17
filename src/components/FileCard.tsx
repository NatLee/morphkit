import { useState } from 'react';
import { useI18n } from '../i18n';
import { MoreMenu } from './MoreMenu';
import {
  formatBytes,
  outputsFor,
  LARGE_FILE_BYTES,
  HUGE_FILE_BYTES,
  type Kind,
} from '../lib/formats';
import { fmtDuration } from '../lib/metadata';
import { MIN_QUALITY } from '../lib/imageConvert';
import { extOf } from '../lib/formats';
import type { Item } from '../types';
import { docTypeOf, isTextDoc } from '../lib/formats';
import { KIND_ICONS } from '../lib/kindIcons';
import { SettingControl } from './SettingControl';
import { SizeCompare } from './SizeViz';
import { activeOverrides, effectiveSettings, fieldsFor, showValue, type SettingValue } from '../lib/settingFields';
import type { Settings } from '../lib/settings';
import { suggestionsFor, taskActive } from '../lib/tasks';


interface Props {
  item: Item;
  /** the defaults (settings drawer); the card shows what this file overrides */
  settings: Settings;
  onOption: (id: string, key: keyof Settings, value: SettingValue) => void;
  onResetOptions: (id: string) => void;
  /** one of the suggested tasks was picked (lib/tasks) */
  onTask: (id: string, taskId: string) => void;
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

export function FileCard({ item, settings, onOption, onResetOptions, onTask, onTarget, onQuality, onConvert, onRemove, onEdit, onToProject, onUnlock, onQr }: Props) {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);

  // this file's options: the settings that change its conversion, and the ones it overrides
  const fields = fieldsFor(item.kind, item.target);
  const eff = effectiveSettings(settings, item.opts);
  const overrides = activeOverrides(settings, item.opts, item.kind, item.target);
  // the jobs most often done with this kind of file
  const suggestions = suggestionsFor(item.kind, item.file);
  // the size target this conversion ran under, if any (drawn as a tick on the result bar)
  const sizeTarget = (fields.some((f) => f.key === 'imageTargetSize') && eff.imageTargetSize) || (fields.some((f) => f.key === 'videoTargetSize') && eff.videoTargetSize) || 0;
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
  const canProject = item.kind !== 'doc' || isTextDoc(item.file);
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

          {/* less-used actions: one menu instead of two more buttons in the row */}
          {(canProject || hasDetails) && (
            <MoreMenu
              label={t('more')}
              items={[
                ...(canProject ? [{ key: 'project', label: t('openAsProject'), hint: t('tipOpenAsProject'), disabled: busy, onSelect: () => onToProject(item.id) }] : []),
                ...(hasDetails ? [{ key: 'details', label: t(showDetails ? 'detailsHide' : 'details'), hint: t('detailsTip'), onSelect: () => setShowDetails((v) => !v) }] : []),
              ]}
            />
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

      {suggestions.length > 0 && (
        <div className="fc-tasks">
          <span className="fc-optrow-label">{t('tasksOften')}</span>
          {suggestions.map((task) => (
            <button
              key={task.id}
              className={`fc-task${taskActive(task, item, settings) ? ' active' : ''}`}
              aria-pressed={task.run === 'convert' ? taskActive(task, item, settings) : undefined}
              disabled={busy}
              title={t(`task_${task.id}_d`)}
              onClick={() => onTask(item.id, task.id)}
            >
              {t(`task_${task.id}`)}
            </button>
          ))}
        </div>
      )}

      {/* options of THIS file: what it overrides, and the controls to change them */}
      {fields.length > 0 && (
        <div className="fc-optrow">
          <span className="fc-optrow-label">{t('optionsLabel')}</span>
          {overrides.length === 0 ? (
            <span className="fc-opt-default">{t('optionsDefault')}</span>
          ) : (
            overrides.map((f) => (
              <span className="fc-opt-chip" key={f.key}>
                {t(f.labelKey)}：{showValue(f, eff[f.key], t)}
                <button disabled={busy} aria-label={t('optionReset', { name: t(f.labelKey) })} title={t('optionReset', { name: t(f.labelKey) })} onClick={() => onOption(item.id, f.key, settings[f.key])}>×</button>
              </span>
            ))
          )}
          <button className="fc-opt-toggle" aria-expanded={optsOpen} disabled={busy} onClick={() => setOptsOpen((v) => !v)}>
            {t(optsOpen ? 'optionsHide' : 'optionsAdjust')}
          </button>
          {overrides.length > 1 && (
            <button className="fc-opt-toggle" disabled={busy} onClick={() => onResetOptions(item.id)}>{t('optionsResetAll')}</button>
          )}
        </div>
      )}
      {optsOpen && fields.length > 0 && (
        <div className="fc-opts sp-grid">
          {fields.filter((f) => f.visible?.(eff) ?? true).map((f) => (
            <SettingControl key={f.key} field={f} settings={eff} onChange={(key, value) => onOption(item.id, key, value)} />
          ))}
        </div>
      )}

      {showQuality && (
        <div className="fc-quality">
          <span>{t('quality')}</span>
          <input
            type="range"
            min={MIN_QUALITY}
            max={1}
            step={0.01}
            value={item.quality}
            disabled={busy}
            onChange={(e) => onQuality(item.id, Number(e.target.value))}
          />
          <span className="fc-quality-val">{Math.round(item.quality * 100)}%</span>
        </div>
      )}

      {item.status === 'done' && item.outSize != null && !item.edited && (
        <SizeCompare before={item.file.size} after={item.outSize} target={sizeTarget} />
      )}

      {item.status === 'converting' && item.kind !== 'image' && (
        <div className="fc-progress-row">
          <div className="fc-progress">
            <div className="fc-bar" style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
          <span className="fc-pct">{Math.round(item.progress * 100)}%</span>
        </div>
      )}

      {item.status === 'error' && <p className="fc-error">{t(item.error ?? 'failed')}</p>}

      {huge && <p className="fc-warn danger">{t('warnHuge')}</p>}
      {large && <p className="fc-warn">{t('warnLarge', { size: formatBytes(item.file.size) })}</p>}
    </article>
  );
}
