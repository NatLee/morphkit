import { useI18n } from '../i18n';
import type { SettingField, SettingValue } from '../lib/settingFields';
import type { Settings } from '../lib/settings';

interface Props {
  field: SettingField;
  /** the values to show: the defaults in the drawer, a file's effective settings on its card */
  settings: Settings;
  onChange: (key: keyof Settings, value: SettingValue) => void;
}

/** One setting as a form control, drawn from its description in lib/settingFields. */
export function SettingControl({ field, settings, onChange }: Props) {
  const { t } = useI18n();
  const value = settings[field.key];
  const disabled = field.disabled?.(settings) ?? false;
  const hint = field.hintKey && (field.hintWhen?.(settings) ?? true)
    ? <span className="sp-hint">{t(field.hintKey, field.hintVars)}</span>
    : null;
  const c = field.control;

  if (c.type === 'check') {
    return (
      <>
        <label className="sp-field sp-check">
          <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(field.key, e.target.checked)} />
          <span className="sp-label">{t(field.labelKey)}</span>
        </label>
        {hint}
      </>
    );
  }
  if (c.type === 'range') {
    return (
      <label className="sp-field">
        <span className="sp-label">
          {t(field.labelKey)} <span className="sp-val">{c.show(Number(value))}</span>
        </span>
        <input
          type="range"
          min={c.min}
          max={c.max}
          step={c.step}
          value={Number(value)}
          disabled={disabled}
          onChange={(e) => onChange(field.key, Number(e.target.value))}
        />
        {hint}
      </label>
    );
  }
  return (
    <label className="sp-field">
      <span className="sp-label">{t(field.labelKey)}</span>
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          // the option carries text; the choice keeps the value's real type (number or string)
          const picked = c.choices.find((x) => String(x.value) === e.target.value);
          if (picked) onChange(field.key, picked.value as SettingValue);
        }}
      >
        {c.choices.map((x) => (
          <option key={String(x.value)} value={String(x.value)}>{x.labelKey ? t(x.labelKey) : x.label}</option>
        ))}
      </select>
      {hint}
    </label>
  );
}
