import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

// Regression: after a few dozen audio/video conversions in one visit, the browser build of ffmpeg
// can trap ("RuntimeError: memory access out of bounds"). The pool kept the dead instance, so that
// conversion AND every later one failed at once with "Conversion failed" until the page reloaded.

/** What the fake engine does on each exec, in order: run fine, trap (instance dies) or exit with 1. */
const h = vi.hoisted(() => ({ plan: [] as Array<'ok' | 'trap' | 'exit1'>, made: [] as Array<{ terminated: boolean; execs: number }> }));

vi.mock('@ffmpeg/util', () => ({
  fetchFile: async () => new Uint8Array([0]),
  toBlobURL: async (url: string) => `blob:${url}`,
}));
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    loaded = false;
    terminated = false;
    execs = 0;
    dead = false;
    files = new Map<string, Uint8Array>();
    constructor() { h.made.push(this); }
    async load() { this.loaded = true; }
    on() {}
    off() {}
    private alive() { if (this.dead) throw new Error('RuntimeError: memory access out of bounds'); }
    async writeFile(name: string, data: Uint8Array) { this.alive(); this.files.set(name, data); }
    async exec(args: string[]) {
      this.alive();
      this.execs++;
      const step = h.plan.shift() ?? 'ok';
      if (step === 'trap') { this.dead = true; throw new Error('RuntimeError: memory access out of bounds'); }
      if (step === 'exit1') return 1;
      this.files.set(args[args.length - 1], new Uint8Array([1, 2, 3]));
      return 0;
    }
    async readFile(name: string) { this.alive(); return this.files.get(name)!; }
    async deleteFile(name: string) { this.alive(); this.files.delete(name); }
    terminate() { this.terminated = true; this.loaded = false; }
  },
}));

const wav = () => new File([new Uint8Array(64)], 'take.wav', { type: 'audio/wav' });
const settings = { ...DEFAULT_SETTINGS, audioLoudness: 0, keepCoverArt: false };

beforeEach(() => {
  h.plan = [];
  h.made = [];
  vi.resetModules(); // a fresh engine pool per test
});

describe('ffmpeg engine pool', () => {
  it('throws a broken instance away and finishes the job on a fresh one', async () => {
    const { convertMedia } = await import('../src/lib/ffmpegClient');
    h.plan = ['trap'];
    const out = await convertMedia(wav(), 'mp3', settings, undefined, () => {});
    expect(out.size).toBe(3);
    expect(h.made).toHaveLength(2);
    expect(h.made[0].terminated).toBe(true);
    // the next job runs on the healthy instance, not on the dead one
    await convertMedia(wav(), 'ogg', settings, undefined, () => {});
    expect(h.made).toHaveLength(2);
    expect(h.made[1].execs).toBe(2);
  });

  it('keeps the instance when ffmpeg only rejected the input', async () => {
    const { convertMedia } = await import('../src/lib/ffmpegClient');
    h.plan = ['exit1'];
    await expect(convertMedia(wav(), 'mp3', settings, undefined, () => {})).rejects.toThrow('ffmpeg exited with 1');
    expect(h.made[0].terminated).toBe(false);
    await convertMedia(wav(), 'mp3', settings, undefined, () => {});
    expect(h.made).toHaveLength(1);
  });

  it('tries a fresh instance only once, then reports the failure', async () => {
    const { convertMedia } = await import('../src/lib/ffmpegClient');
    h.plan = ['trap', 'trap'];
    await expect(convertMedia(wav(), 'mp3', settings, undefined, () => {})).rejects.toThrow('memory access out of bounds');
    expect(h.made.map((e) => e.terminated)).toEqual([true, true]);
    // nothing broken stays in the pool: the next file gets a working engine
    await convertMedia(wav(), 'mp3', settings, undefined, () => {});
    expect(h.made).toHaveLength(3);
  });

  it('tells an engine fault from an ordinary failure', async () => {
    const { isEngineFault } = await import('../src/lib/ffmpegClient');
    expect(isEngineFault(new Error('RuntimeError: memory access out of bounds'))).toBe(true);
    expect(isEngineFault(Object.assign(new Error('unreachable'), { name: 'RuntimeError' }))).toBe(true);
    expect(isEngineFault(new Error('Aborted(OOM)'))).toBe(true);
    expect(isEngineFault(new Error('ffmpeg exited with 1'))).toBe(false);
    expect(isEngineFault(new Error('no audio stream'))).toBe(false);
  });
});
