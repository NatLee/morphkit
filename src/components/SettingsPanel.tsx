import { useI18n } from '../i18n';
import type { Settings } from '../lib/settings';
import { MIN_QUALITY } from '../lib/imageConvert';
import { OCR_LANGS, type OcrLangSetting } from '../lib/ocr';

/** LAME VBR presets and the average bitrate each typically lands on. */
const VBR_LEVELS: ReadonlyArray<[q: number, kbps: number]> = [
  [0, 245], [1, 225], [2, 190], [3, 175], [4, 165],
  [5, 130], [6, 115], [7, 100], [8, 85], [9, 65],
];

/**
 * Size-target choices, in decimal bytes on purpose: an upload limit of "500 KB" may mean 500,000
 * or 512,000 bytes, and a file under the decimal figure passes both readings.
 */
const IMAGE_TARGET_SIZES = [100e3, 200e3, 500e3, 1e6, 2e6, 5e6];
const VIDEO_TARGET_SIZES = [10e6, 25e6, 50e6, 100e6];
/** Loudness targets in LUFS, each named after where such files usually go. */
const LOUDNESS_TARGETS: ReadonlyArray<[lufs: number, labelKey: string]> = [
  [-14, 'loudnessStreaming'], [-16, 'loudnessPodcast'], [-23, 'loudnessBroadcast'],
];
const sizeLabel = (bytes: number) => (bytes >= 1e6 ? `${bytes / 1e6} MB` : `${bytes / 1e3} KB`);

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
  const { t } = useI18n();
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <section className="settings-panel">
      {/* ---- general ---- */}
      <div className="sp-section">
        <h3 className="sp-sec-title">{t('secGeneral')}</h3>
        <div className="sp-grid">
          <label className="sp-field">
            <span className="sp-label">{t('workers')}</span>
            <select
              value={settings.concurrency}
              onChange={(e) => set('concurrency', Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="sp-hint">{t('workersHint')}</span>
          </label>

          <label className="sp-field sp-check">
            <input
              type="checkbox"
              checked={settings.keepMetadata}
              onChange={(e) => set('keepMetadata', e.target.checked)}
            />
            <span className="sp-label">{t('keepMetadata')}</span>
          </label>
          <span className="sp-hint">{t('keepMetadataHint')}</span>

          <label className="sp-field sp-check">
            <input
              type="checkbox"
              checked={settings.keepCoverArt}
              disabled={!settings.keepMetadata}
              onChange={(e) => set('keepCoverArt', e.target.checked)}
            />
            <span className="sp-label">{t('keepCoverArt')}</span>
          </label>
          <span className="sp-hint">{t('keepCoverArtHint')}</span>
        </div>
      </div>

      {/* ---- image ---- */}
      <div className="sp-section">
        <h3 className="sp-sec-title">{t('kindImage')}</h3>
        <div className="sp-grid">
          <label className="sp-field">
            <span className="sp-label">
              {t('defaultQuality')} <span className="sp-val">{Math.round(settings.defaultQuality * 100)}%</span>
            </span>
            <input
              type="range"
              min={MIN_QUALITY}
              max={1}
              step={0.01}
              value={settings.defaultQuality}
              onChange={(e) => set('defaultQuality', Number(e.target.value))}
            />
            <span className="sp-hint">{t('defaultQualityHint')}</span>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('imageMaxDim')}</span>
            <select
              value={settings.imageMaxDim}
              onChange={(e) => set('imageMaxDim', Number(e.target.value))}
            >
              <option value={0}>{t('original')}</option>
              {[4096, 2048, 1024, 512].map((n) => (
                <option key={n} value={n}>{n}px</option>
              ))}
            </select>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('targetSize')}</span>
            <select
              value={settings.imageTargetSize}
              onChange={(e) => set('imageTargetSize', Number(e.target.value))}
            >
              <option value={0}>{t('targetSizeOff')}</option>
              {IMAGE_TARGET_SIZES.map((n) => (
                <option key={n} value={n}>{sizeLabel(n)}</option>
              ))}
            </select>
            <span className="sp-hint">{t('imageTargetSizeHint', { min: `${Math.round(MIN_QUALITY * 100)}%` })}</span>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('ocrLang')}</span>
            <select
              value={settings.ocrLang}
              onChange={(e) => set('ocrLang', e.target.value as OcrLangSetting)}
            >
              <option value="auto">{t('ocrLangAuto')}</option>
              {(Object.keys(OCR_LANGS) as (keyof typeof OCR_LANGS)[]).map((l) => (
                <option key={l} value={l}>{OCR_LANGS[l]}</option>
              ))}
            </select>
            <span className="sp-hint">{t('ocrLangHint')}</span>
          </label>
        </div>
      </div>

      {/* ---- audio ---- */}
      <div className="sp-section">
        <h3 className="sp-sec-title">{t('kindAudio')}</h3>
        <div className="sp-grid">
          <label className="sp-field">
            <span className="sp-label">{t('audioBitrate')}</span>
            <select
              value={settings.audioBitrate}
              onChange={(e) => set('audioBitrate', e.target.value as Settings['audioBitrate'])}
            >
              {(['128k', '192k', '256k', '320k'] as const).map((b) => (
                <option key={b} value={b}>{b.replace('k', ' kbps')}</option>
              ))}
            </select>
            {settings.audioRateMode === 'vbr' && (
              <span className="sp-hint">{t('audioBitrateVbrHint')}</span>
            )}
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('audioRateMode')}</span>
            <select
              value={settings.audioRateMode}
              onChange={(e) => set('audioRateMode', e.target.value as Settings['audioRateMode'])}
            >
              <option value="cbr">{t('audioCbr')}</option>
              <option value="vbr">{t('audioVbr')}</option>
            </select>
            <span className="sp-hint">{t('audioRateModeHint')}</span>
          </label>

          {settings.audioRateMode === 'vbr' && (
            <label className="sp-field">
              <span className="sp-label">{t('audioQuality')}</span>
              <select
                value={settings.audioQuality}
                onChange={(e) => set('audioQuality', Number(e.target.value))}
              >
                {VBR_LEVELS.map(([q, kbps]) => (
                  <option key={q} value={q}>V{q} ≈ {kbps} kbps</option>
                ))}
              </select>
              <span className="sp-hint">{t('audioQualityHint')}</span>
            </label>
          )}

          <label className="sp-field">
            <span className="sp-label">{t('audioSampleRate')}</span>
            <select
              value={settings.audioSampleRate}
              onChange={(e) => set('audioSampleRate', Number(e.target.value))}
            >
              <option value={0}>{t('original')}</option>
              {[44100, 48000].map((n) => (
                <option key={n} value={n}>{(n / 1000).toFixed(1)} kHz</option>
              ))}
            </select>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('audioChannels')}</span>
            <select
              value={settings.audioChannels}
              onChange={(e) => set('audioChannels', Number(e.target.value) as Settings['audioChannels'])}
            >
              <option value={0}>{t('original')}</option>
              <option value={2}>{t('stereo')}</option>
              <option value={1}>{t('mono')}</option>
            </select>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('audioLoudness')}</span>
            <select
              value={settings.audioLoudness}
              onChange={(e) => set('audioLoudness', Number(e.target.value))}
            >
              <option value={0}>{t('loudnessOff')}</option>
              {LOUDNESS_TARGETS.map(([lufs, key]) => (
                <option key={lufs} value={lufs}>{t(key)}</option>
              ))}
            </select>
            <span className="sp-hint">{t('audioLoudnessHint')}</span>
          </label>
        </div>
      </div>

      {/* ---- video ---- */}
      <div className="sp-section">
        <h3 className="sp-sec-title">{t('kindVideo')}</h3>
        <div className="sp-grid">
          <label className="sp-field">
            <span className="sp-label">
              {t('videoCrf')} <span className="sp-val">{settings.videoCrf}</span>
            </span>
            <input
              type="range"
              min={18}
              max={32}
              step={1}
              value={settings.videoCrf}
              disabled={settings.videoTargetSize > 0}
              onChange={(e) => set('videoCrf', Number(e.target.value))}
            />
            <span className="sp-hint">{t('videoCrfHint')}</span>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('targetSize')}</span>
            <select
              value={settings.videoTargetSize}
              onChange={(e) => set('videoTargetSize', Number(e.target.value))}
            >
              <option value={0}>{t('targetSizeOff')}</option>
              {VIDEO_TARGET_SIZES.map((n) => (
                <option key={n} value={n}>{sizeLabel(n)}</option>
              ))}
            </select>
            <span className="sp-hint">{t('videoTargetSizeHint')}</span>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('videoPreset')}</span>
            <select
              value={settings.videoPreset}
              onChange={(e) => set('videoPreset', e.target.value as Settings['videoPreset'])}
            >
              {(['veryfast', 'fast', 'medium'] as const).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <span className="sp-hint">{t('presetHint')}</span>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('videoRes')}</span>
            <select
              value={settings.videoMaxH}
              onChange={(e) => set('videoMaxH', Number(e.target.value))}
            >
              <option value={0}>{t('original')}</option>
              {[1080, 720, 480].map((n) => (
                <option key={n} value={n}>{n}p</option>
              ))}
            </select>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('videoFps')}</span>
            <select
              value={settings.videoFps}
              onChange={(e) => set('videoFps', Number(e.target.value))}
            >
              <option value={0}>{t('original')}</option>
              {[60, 30, 24].map((n) => (
                <option key={n} value={n}>{n} fps</option>
              ))}
            </select>
          </label>

          <label className="sp-field sp-check">
            <input
              type="checkbox"
              checked={settings.videoMute}
              onChange={(e) => set('videoMute', e.target.checked)}
            />
            <span className="sp-label">{t('videoMute')}</span>
          </label>
        </div>
      </div>

      {/* ---- gif ---- */}
      <div className="sp-section">
        <h3 className="sp-sec-title">PDF</h3>
        <div className="sp-grid">
          <label className="sp-field">
            <span className="sp-label">{t('pdfImageScale')}</span>
            <select
              value={settings.pdfImageScale}
              onChange={(e) => set('pdfImageScale', Number(e.target.value) as 1 | 2 | 3)}
            >
              <option value={1}>72 dpi</option>
              <option value={2}>144 dpi</option>
              <option value={3}>216 dpi</option>
            </select>
            <span className="sp-hint">{t('pdfImageScaleHint')}</span>
          </label>
        </div>
      </div>

      <div className="sp-section">
        <h3 className="sp-sec-title">{t('secDocs')}</h3>
        <div className="sp-grid">
          <label className="sp-field">
            <span className="sp-label">{t('docPageSizeLabel')}</span>
            <select
              value={settings.docPageSize}
              onChange={(e) => set('docPageSize', e.target.value as 'a4' | 'letter')}
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
            </select>
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('docFontSizeLabel')}</span>
            <select
              value={settings.docFontSize}
              onChange={(e) => set('docFontSize', Number(e.target.value))}
            >
              {[9, 10, 11, 12, 13, 14].map((n) => (
                <option key={n} value={n}>{n} pt</option>
              ))}
            </select>
          </label>
          <label className="sp-field sp-check">
            <input
              type="checkbox"
              checked={settings.docPdfText}
              onChange={(e) => set('docPdfText', e.target.checked)}
            />
            <span>{t('docPdfTextLabel')}</span>
            <span className="sp-hint">{t('docPdfTextHint')}</span>
          </label>
        </div>
      </div>

      {/* ---- gif ---- */}
      <div className="sp-section">
        <h3 className="sp-sec-title">GIF</h3>
        <div className="sp-grid">
          <label className="sp-field">
            <span className="sp-label">
              {t('gifFps')} <span className="sp-val">{settings.gifFps} fps</span>
            </span>
            <input
              type="range"
              min={5}
              max={24}
              step={1}
              value={settings.gifFps}
              onChange={(e) => set('gifFps', Number(e.target.value))}
            />
          </label>

          <label className="sp-field">
            <span className="sp-label">{t('gifWidth')}</span>
            <select
              value={settings.gifWidth}
              onChange={(e) => set('gifWidth', Number(e.target.value))}
            >
              {[240, 360, 480, 640, 720].map((w) => (
                <option key={w} value={w}>{w}px</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}
