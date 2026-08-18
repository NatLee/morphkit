import { useI18n } from '../i18n';
import type { Settings } from '../lib/settings';

/** LAME VBR presets and the average bitrate each typically lands on. */
const VBR_LEVELS: ReadonlyArray<[q: number, kbps: number]> = [
  [0, 245], [1, 225], [2, 190], [3, 175], [4, 165],
  [5, 130], [6, 115], [7, 100], [8, 85], [9, 65],
];

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
              onChange={(e) => set('videoCrf', Number(e.target.value))}
            />
            <span className="sp-hint">{t('videoCrfHint')}</span>
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
