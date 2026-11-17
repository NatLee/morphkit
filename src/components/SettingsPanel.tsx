import { useI18n } from '../i18n';
import { SETTING_FIELDS, SETTING_SECTIONS } from '../lib/settingFields';
import type { Settings } from '../lib/settings';
import { SettingControl } from './SettingControl';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

/**
 * The settings drawer: every setting, as the default for files added from now on. A file card
 * shows the ones that apply to it and can override them for that file (lib/settingFields).
 */
export function SettingsPanel({ settings, onChange }: Props) {
  const { t } = useI18n();
  return (
    <section className="settings-panel">
      <p className="sp-intro">{t('settingsIntro')}</p>
      {SETTING_SECTIONS.map((sec) => (
        <div className="sp-section" key={sec.id}>
          <h3 className="sp-sec-title">{sec.titleKey ? t(sec.titleKey) : sec.title}</h3>
          <div className="sp-grid">
            {SETTING_FIELDS.filter((f) => f.section === sec.id && (f.visible?.(settings) ?? true)).map((f) => (
              <SettingControl key={f.key} field={f} settings={settings} onChange={(key, value) => onChange({ ...settings, [key]: value })} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
