import type { CSSProperties, ReactNode } from 'react';
import { useI18n } from '../i18n';
import { formatBytes } from '../lib/formats';
import { compareBars, shares, sizeChange, type Segment } from '../lib/sizeStats';

/** Source vs result as two bars on one scale, with the difference in words; a size target is a tick. */
export function SizeCompare({ before, after, target = 0 }: { before: number; after: number; target?: number }) {
  const { t } = useI18n();
  const change = sizeChange(before, after);
  if (!change) return null;
  const bars = compareBars(before, after, target);
  const verdict =
    change.dir === 'same' ? t('sizeSame')
    : change.dir === 'smaller' ? t('sizeSmaller', { pct: String(change.savedPct) })
    : t('sizeLarger', { pct: String(-change.savedPct) });
  return (
    <div className={`size-compare sc-${change.dir}`} role="img" aria-label={`${t('sizeOriginal')} ${formatBytes(before)}, ${t('sizeResult')} ${formatBytes(after)}: ${verdict}`}>
      <span className="sc-label">{t('sizeOriginal')}</span>
      <span className="sc-track"><span className="sc-bar sc-before" style={{ width: `${bars.before}%` }} /></span>
      <span className="sc-num">{formatBytes(before)}</span>
      <span className="sc-label">{t('sizeResult')}</span>
      <span className="sc-track">
        <span className="sc-bar sc-after" style={{ width: `${bars.after}%` }} />
        {bars.target != null && <span className="sc-target" style={{ left: `${bars.target}%` }} title={t('sizeTarget', { size: formatBytes(target) })} />}
      </span>
      <span className="sc-num">
        {formatBytes(after)} <b>{verdict}</b>
        {bars.target != null && <i>{t('sizeTarget', { size: formatBytes(target) })}</i>}
      </span>
    </div>
  );
}

export interface StackSegment extends Segment {
  label: string;
  /** a CSS colour (a design token) */
  color: string;
  /** drawn hatched: space that is held but not in use (the trash) */
  muted?: boolean;
}

/** One total split into coloured parts, with a legend that carries the numbers. */
export function StackBar({ segments, label, children }: { segments: readonly StackSegment[]; label: string; children?: ReactNode }) {
  const parts = shares(segments);
  if (!parts.length) return null;
  return (
    <div className="stack">
      <div className="stack-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${formatBytes(p.value)}`).join(', ')}`}>
        {parts.map((p) => (
          <span key={p.key} className={p.muted ? 'muted' : ''} style={{ width: `${p.pct}%`, '--c': p.color } as CSSProperties} title={`${p.label} · ${formatBytes(p.value)}`} />
        ))}
      </div>
      <ul className="stack-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i className={p.muted ? 'muted' : ''} style={{ '--c': p.color } as CSSProperties} />
            {p.label} <b>{formatBytes(p.value)}</b>
          </li>
        ))}
        {children}
      </ul>
    </div>
  );
}

/**
 * A single quantity against its limit (project size against the largest, days left in the trash).
 * `color` (a CSS colour token) paints the bar in what it measures, e.g. a project type on the rail.
 */
export function Meter({ value, max, tone = 'accent', color, label }: { value: number; max: number; tone?: 'accent' | 'warn'; color?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span className={`meter mt-${tone}`} role="img" aria-label={label} title={label} style={color ? ({ '--meter-c': color } as CSSProperties) : undefined}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
