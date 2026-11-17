import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { FileCard } from '../src/components/FileCard';
import { Meter, SizeCompare, StackBar } from '../src/components/SizeViz';
import { compareBars, shares, sizeChange, sumBy, usedPct } from '../src/lib/sizeStats';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import type { Item } from '../src/types';

describe('size arithmetic', () => {
  it('says how much smaller or larger a result is', () => {
    expect(sizeChange(1000, 250)).toEqual({ ratio: 0.25, savedPct: 75, dir: 'smaller' });
    expect(sizeChange(1000, 1300)).toMatchObject({ savedPct: -30, dir: 'larger' });
    // a re-saved file a few bytes off is not "0% smaller"
    expect(sizeChange(100_000, 100_300)?.dir).toBe('same');
    expect(sizeChange(0, 10)).toBeNull();
  });

  it('draws source, result and target on one scale', () => {
    expect(compareBars(1000, 250)).toEqual({ before: 100, after: 25, target: null });
    // the result is the longer bar when it grew
    expect(compareBars(500, 1000)).toEqual({ before: 50, after: 100, target: null });
    expect(compareBars(1000, 190, 200).target).toBe(20);
    // a 25 MB target on a 3 MB clip would sit far off the picture: not drawn
    expect(compareBars(3e6, 2e6, 25e6).target).toBeNull();
  });

  it('splits a total into shares and drops the empty parts', () => {
    const parts = shares([{ key: 'a', value: 300 }, { key: 'b', value: 0 }, { key: 'c', value: 100 }]);
    expect(parts.map((p) => [p.key, p.pct])).toEqual([['a', 75], ['c', 25]]);
    expect(shares([{ key: 'a', value: 0 }])).toEqual([]);
  });

  it('sums per group in the order of the groups', () => {
    const files = [{ k: 'video', n: 5 }, { k: 'image', n: 2 }, { k: 'video', n: 1 }];
    expect(sumBy(files, ['image', 'audio', 'video'], (f) => f.k, (f) => f.n)).toEqual([
      { key: 'image', value: 2 }, { key: 'audio', value: 0 }, { key: 'video', value: 6 },
    ]);
  });

  it('never rounds real use down to 0%', () => {
    expect(usedPct(64e6, 10e9)).toBe('0.6');
    // 3.5 MB of 10 GB is 0.035%: "<0.1", not a rounded-up 0.1
    expect(usedPct(3.5e6, 10e9)).toBe('<0.1');
    expect(usedPct(4.2e9, 10e9)).toBe('42');
    expect(usedPct(0, 10e9)).toBe('0');
  });
});

describe('size pictures', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('morphkit-lang', 'en'); });
  afterEach(cleanup);
  const wrap = (node: React.ReactNode) => render(<I18nProvider>{node}</I18nProvider>);

  it('compares a result with its source in words and in bar lengths', () => {
    const { container } = wrap(<SizeCompare before={1_048_576} after={262_144} target={524_288} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Original 1.0 MB, Result 256.0 KB: 75% smaller');
    expect((container.querySelector('.sc-after') as HTMLElement).style.width).toBe('25%');
    expect((container.querySelector('.sc-target') as HTMLElement).style.left).toBe('50%');
    expect(container.textContent).toContain('target 512.0 KB');
  });

  it('marks a result that grew', () => {
    const { container } = wrap(<SizeCompare before={1000} after={2000} />);
    expect(container.querySelector('.sc-larger')).toBeTruthy();
    expect(container.textContent).toContain('100% larger');
  });

  it('gives a stacked bar a legend with the numbers, and skips empty parts', () => {
    const { container } = wrap(
      <StackBar label="By type" segments={[
        { key: 'image', label: 'Image', color: 'green', value: 3 * 1024 },
        { key: 'audio', label: 'Audio', color: 'blue', value: 0 },
        { key: 'trash', label: 'Trash', color: 'grey', value: 1024, muted: true },
      ]} />
    );
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('By type: Image 3.0 KB, Trash 1.0 KB');
    const bars = [...container.querySelectorAll('.stack-bar span')] as HTMLElement[];
    expect(bars.map((b) => b.style.width)).toEqual(['75%', '25%']);
    expect(bars[1].className).toBe('muted');
    expect(container.querySelector('.stack-legend')?.textContent).not.toContain('Audio');
  });

  it('draws nothing for an empty total', () => {
    const { container } = wrap(<StackBar label="x" segments={[{ key: 'a', label: 'A', color: 'red', value: 0 }]} />);
    expect(container.querySelector('.stack')).toBeNull();
  });

  it('clamps a meter to its range', () => {
    const { container } = wrap(<><Meter value={3} max={30} label="3 days left" /><Meter value={50} max={30} label="over" /></>);
    const fills = [...container.querySelectorAll('.meter span')] as HTMLElement[];
    expect(fills.map((f) => f.style.width)).toEqual(['10%', '100%']);
  });
});

describe('file card result', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('morphkit-lang', 'en'); });
  afterEach(cleanup);
  const noop = () => {};
  const card = (item: Partial<Item>) => {
    const it: Item = { id: 'f1', file: new File([new Uint8Array(4000)], 'photo.png', { type: 'image/png' }), kind: 'image', target: 'jpeg', quality: 0.9, status: 'done', progress: 1, outUrl: 'blob:x', outName: 'photo.jpg', outSize: 1000, ...item };
    return render(
      <I18nProvider>
        <FileCard item={it} settings={DEFAULT_SETTINGS} onOption={noop} onResetOptions={noop} onTask={noop} onTarget={noop} onQuality={noop} onConvert={noop} onRemove={noop} onEdit={noop} onToProject={noop} onUnlock={noop} onQr={noop} />
      </I18nProvider>
    ).container;
  };

  it('shows the comparison once a conversion is done, with the file’s own size target', () => {
    const c = card({ opts: { imageTargetSize: 2000 } });
    expect(c.querySelector('.size-compare')?.getAttribute('aria-label')).toContain('75% smaller');
    expect((c.querySelector('.sc-target') as HTMLElement).style.left).toBe('50%');
  });

  it('shows none before the conversion, or for a file saved from an editor', () => {
    expect(card({ status: 'ready', outSize: undefined, outUrl: undefined }).querySelector('.size-compare')).toBeNull();
    expect(card({ edited: true }).querySelector('.size-compare')).toBeNull();
  });
});
