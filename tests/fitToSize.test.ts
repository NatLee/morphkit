import { describe, expect, it } from 'vitest';
import { AV_TARGETS, VIDEO_AUDIO_KBPS, buildArgs, mediaSeconds, videoKbpsFor } from '../src/lib/ffmpegClient';
import { MIN_QUALITY, fitToSize, type Encoder } from '../src/lib/imageConvert';
import { ConvertError } from '../src/lib/errors';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';

const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

/**
 * A stand-in for canvas encoding: size grows with quality and with the pixel count (scale²),
 * the way JPEG / WebP roughly behave. `full` is the size at quality 1, scale 1.
 */
function fakeEncoder(full: number) {
  const calls: Array<[number, number]> = [];
  const encode: Encoder = async (q, scale) => {
    calls.push([q, scale]);
    return new Blob([new Uint8Array(Math.round(full * q * scale * scale))]);
  };
  return { encode, calls };
}

describe('fitToSize (images)', () => {
  it('keeps the chosen quality when the file already fits', async () => {
    const { encode, calls } = fakeEncoder(1000);
    const b = await fitToSize(encode, 2000, 0.9);
    expect(b.size).toBe(900);
    expect(calls).toEqual([[0.9, 1]]);
  });

  it('lowers the quality just enough, without shrinking', async () => {
    // 1000 bytes at q=1 → the target 600 fits at q ≤ 0.6
    const { encode, calls } = fakeEncoder(1000);
    const b = await fitToSize(encode, 600, 0.9);
    expect(b.size).toBeLessThanOrEqual(600);
    expect(b.size).toBeGreaterThan(560); // within one search step (0.02 × 1000 bytes) of the limit
    expect(calls.every(([, s]) => s === 1)).toBe(true);
  });

  it('shrinks the image once the lowest quality is still too big', async () => {
    // at MIN_QUALITY the full-size file is 400 bytes; the target is 100
    const { encode, calls } = fakeEncoder(1000);
    const b = await fitToSize(encode, 100, 0.9);
    expect(b.size).toBeLessThanOrEqual(100);
    expect(Math.min(...calls.map(([, s]) => s))).toBeLessThan(1);
    expect(Math.min(...calls.map(([q]) => q))).toBe(MIN_QUALITY);
  });

  it('only shrinks formats without a quality setting (PNG)', async () => {
    const { encode, calls } = fakeEncoder(1000);
    const b = await fitToSize(encode, 300, 0.9, 0.9);
    expect(b.size).toBeLessThanOrEqual(300);
    expect(calls.every(([q]) => q === 0.9)).toBe(true);
  });

  it('gives up with fitTooSmall when nothing fits', async () => {
    // a file that never gets smaller, whatever the quality or size
    const stubborn: Encoder = async () => new Blob([new Uint8Array(500)]);
    await expect(fitToSize(stubborn, 100, 0.9)).rejects.toThrow(ConvertError);
    await expect(fitToSize(stubborn, 100, 0.9)).rejects.toMatchObject({ key: 'fitTooSmall' });
  });
});

describe('mediaSeconds', () => {
  it('is the whole file without edits', () => {
    expect(mediaSeconds(60)).toBe(60);
  });

  it('counts only the trimmed span, sped up or slowed down', () => {
    expect(mediaSeconds(60, { trimStart: 10, trimEnd: 40 })).toBe(30);
    expect(mediaSeconds(60, { trimStart: 10 })).toBe(50);
    expect(mediaSeconds(60, { trimStart: 10, trimEnd: 40, speed: 2 })).toBe(15);
    expect(mediaSeconds(60, { speed: 0.5 })).toBe(120);
  });
});

describe('videoKbpsFor', () => {
  it('splits the budget into sound and picture, with room for the container', () => {
    // 10 MB over 100 s = 800 kbps in total; 95% of that, minus 128 kbps of sound
    expect(videoKbpsFor(10_000_000, 100, VIDEO_AUDIO_KBPS)).toBe(632);
    // a muted video gets the whole budget
    expect(videoKbpsFor(10_000_000, 100, 0)).toBe(760);
  });

  it('refuses a target that leaves no room for a watchable picture', () => {
    // 1 MB for ten minutes is ~13 kbps in total
    expect(() => videoKbpsFor(1_000_000, 600, VIDEO_AUDIO_KBPS)).toThrow(ConvertError);
  });
});

describe('buildArgs with a size target', () => {
  it('swaps CRF for an average bitrate with a matching cap in MP4', () => {
    const a = buildArgs('mp4', 'i.mov', 'o.mp4', S(), undefined, { videoKbps: 632 });
    expect(a).not.toContain('-crf');
    expect(after(a, '-b:v')).toBe('632k');
    expect(after(a, '-maxrate')).toBe('632k');
    expect(after(a, '-bufsize')).toBe('1264k');
    expect(after(a, '-b:a')).toBe(`${VIDEO_AUDIO_KBPS}k`);
  });

  it('swaps CRF and the 1 Mbps cap for the bitrate in WebM', () => {
    const a = buildArgs('webm', 'i.mov', 'o.webm', S(), undefined, { videoKbps: 400 });
    expect(a).not.toContain('-crf');
    expect(a.filter((x) => x === '-b:v')).toHaveLength(1);
    expect(after(a, '-b:v')).toBe('400k');
  });

  it('leaves CRF in place without a target', () => {
    expect(after(buildArgs('webm', 'i', 'o.webm', S({ videoCrf: 23 })), '-crf')).toBe('30');
    expect(after(buildArgs('webm', 'i', 'o.webm', S()), '-b:v')).toBe('1M');
  });

  it('applies only to outputs with both picture and sound', () => {
    expect([...AV_TARGETS].sort()).toEqual(['mkv', 'mov', 'mp4', 'webm']);
    // GIF and audio outputs ignore a bitrate meant for video
    expect(buildArgs('gif', 'i', 'o.gif', S(), undefined, { videoKbps: 400 })).not.toContain('-b:v');
    expect(buildArgs('mp3', 'i', 'o.mp3', S(), undefined, { videoKbps: 400 })).not.toContain('-b:v');
  });
});
