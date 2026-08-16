import { useI18n } from '../i18n';
import type { Settings } from '../lib/settings';

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
        </label>

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
    </section>
  );
}
