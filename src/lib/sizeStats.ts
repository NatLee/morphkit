/**
 * Numbers behind the size pictures (SizeCompare, StackBar): how a result compares with its source,
 * and how a total splits into parts. Pure, so the pictures and the tests share one arithmetic.
 */

export interface SizeChange {
  /** result ÷ source (1 = same size) */
  ratio: number;
  /** whole percent smaller (positive) or larger (negative) than the source */
  savedPct: number;
  dir: 'smaller' | 'larger' | 'same';
}

/** A change under this share of the source reads as "same size" (rounding noise, re-saved files). */
const SAME_WITHIN = 0.005;

export function sizeChange(before: number, after: number): SizeChange | null {
  if (!(before > 0) || !(after >= 0)) return null;
  const ratio = after / before;
  const dir = Math.abs(ratio - 1) < SAME_WITHIN ? 'same' : ratio < 1 ? 'smaller' : 'larger';
  return { ratio, savedPct: Math.round((1 - ratio) * 100), dir };
}

/** Bar lengths (0–100) for a source and its result, and for a size target, on one shared scale. */
export function compareBars(before: number, after: number, target = 0): { before: number; after: number; target: number | null } {
  const full = Math.max(before, after, 1);
  const pct = (v: number) => (v / full) * 100;
  // a target beyond the longer bar would sit off the picture: it is then not drawn
  return { before: pct(before), after: pct(after), target: target > 0 && target <= full ? pct(target) : null };
}

export interface Segment {
  key: string;
  value: number;
}

/** Parts with their share of the total (0–100), empty ones dropped, in the order given. */
export function shares<T extends Segment>(segments: readonly T[]): (T & { pct: number })[] {
  const live = segments.filter((s) => s.value > 0);
  const total = live.reduce((sum, s) => sum + s.value, 0);
  return live.map((s) => ({ ...s, pct: (s.value / total) * 100 }));
}

/** Sum `value(item)` per `key(item)`, keeping the order of `keys` (kinds, project types). */
export function sumBy<T>(items: readonly T[], keys: readonly string[], key: (item: T) => string, value: (item: T) => number): Segment[] {
  const sums = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const it of items) sums.set(key(it), (sums.get(key(it)) ?? 0) + value(it));
  return [...sums].map(([k, v]) => ({ key: k, value: v }));
}

/**
 * Used ÷ quota as the number in "N%": one decimal under 10, and "<0.1" for real use too small to
 * round to anything — never "0", and never a figure larger than the truth.
 */
export function usedPct(used: number, quota: number): string {
  if (!(quota > 0) || !(used > 0)) return '0';
  const pct = (used / quota) * 100;
  if (pct < 0.1) return '<0.1';
  return String(pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct));
}
