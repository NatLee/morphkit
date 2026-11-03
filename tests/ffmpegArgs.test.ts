import { describe, expect, it } from 'vitest';
import { buildArgs, fitWithin } from '../src/lib/ffmpegClient';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';

const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('buildArgs — audio', () => {
  it('encodes MP3 with ID3v2.3 tags and the CBR bitrate', () => {
    const a = buildArgs('mp3', 'in.wav', 'out.mp3', S());
    expect(after(a, '-c:a')).toBe('libmp3lame');
    expect(after(a, '-b:a')).toBe('192k');
    expect(after(a, '-map_metadata')).toBe('0');
    expect(after(a, '-id3v2_version')).toBe('3');
    expect(a[a.length - 1]).toBe('out.mp3');
  });

  it('switches MP3 to a quality target in VBR mode', () => {
    const a = buildArgs('mp3', 'in.wav', 'out.mp3', S({ audioRateMode: 'vbr', audioQuality: 2 }));
    expect(after(a, '-q:a')).toBe('2');
    expect(a).not.toContain('-b:a');
  });

  it('mirrors the quality scale for Vorbis (higher is better there)', () => {
    expect(after(buildArgs('ogg', 'i', 'o.ogg', S({ audioRateMode: 'vbr', audioQuality: 2 })), '-q:a')).toBe('8');
    expect(after(buildArgs('ogg', 'i', 'o.ogg', S()), '-q:a')).toBe('5');
  });

  it('keeps M4A on a fixed bitrate even in VBR mode', () => {
    expect(after(buildArgs('m4a', 'i', 'o.m4a', S({ audioRateMode: 'vbr' })), '-b:a')).toBe('192k');
  });

  it('strips tags when metadata is turned off', () => {
    expect(after(buildArgs('flac', 'i', 'o.flac', S({ keepMetadata: false })), '-map_metadata')).toBe('-1');
  });

  it('maps cover art only for formats that can hold it', () => {
    expect(buildArgs('mp3', 'i', 'o.mp3', S(), undefined, undefined, true)).toContain('attached_pic');
    for (const t of ['wav', 'ogg']) {
      expect(buildArgs(t, 'i', `o.${t}`, S(), undefined, undefined, true)).not.toContain('attached_pic');
    }
  });

  it('drops cover art when trimming, because the streams would desync', () => {
    expect(buildArgs('mp3', 'i', 'o.mp3', S(), { trimStart: 1 }, undefined, true)).not.toContain('attached_pic');
  });

  it('puts the trim before -i and applies volume + speed as audio filters', () => {
    const a = buildArgs('wav', 'in.mp3', 'o.wav', S(), { trimStart: 1.5, trimEnd: 4, volume: 0.5, speed: 1.25 });
    expect(a.slice(0, 5)).toEqual(['-ss', '1.500', '-t', '2.500', '-i']);
    expect(after(a, '-af')).toBe('volume=0.50,atempo=1.25');
  });

  it('passes sample rate and channel count through', () => {
    const a = buildArgs('wav', 'i', 'o.wav', S({ audioSampleRate: 48000, audioChannels: 1 }));
    expect(after(a, '-ar')).toBe('48000');
    expect(after(a, '-ac')).toBe('1');
  });
});

describe('buildArgs — video', () => {
  it('encodes MP4 with x264 at the chosen CRF and preset', () => {
    const a = buildArgs('mp4', 'in.mov', 'o.mp4', S({ videoCrf: 28, videoPreset: 'fast' }));
    expect(after(a, '-c:v')).toBe('libx264');
    expect(after(a, '-crf')).toBe('28');
    expect(after(a, '-preset')).toBe('fast');
    expect(after(a, '-pix_fmt')).toBe('yuv420p');
  });

  it('chains rotate, speed and the height cap into one -vf', () => {
    const a = buildArgs('mp4', 'i', 'o.mp4', S({ videoMaxH: 720 }), { rotate: 90, speed: 2 });
    expect(after(a, '-vf')).toBe(`transpose=1,setpts=PTS/2,${fitWithin(0, 720)}`);
    expect(buildArgs('mp4', 'i', 'o.mp4', S())).not.toContain('-vf'); // no cap, no filter
  });

  it('mutes when asked, and maps a replacement audio track', () => {
    expect(buildArgs('mp4', 'i', 'o.mp4', S(), { mute: true })).toContain('-an');
    const a = buildArgs('mp4', 'v.mp4', 'o.mp4', S(), undefined, 'a.wav');
    expect(a.join(' ')).toContain('-i v.mp4 -i a.wav -map 0:v:0 -map 1:a:0 -shortest');
  });

  it('builds GIFs at the GIF fps, capped at the GIF width, looping forever', () => {
    const a = buildArgs('gif', 'i.mp4', 'o.gif', S({ gifFps: 10, gifWidth: 360 }));
    expect(after(a, '-vf')).toBe(`fps=10,${fitWithin(360, 0)}`);
    expect(after(a, '-loop')).toBe('0');
    expect(a).not.toContain('-map_metadata');
  });

  it('applies the GIF width and the video height cap as one fit, not two scales', () => {
    const vf = after(buildArgs('gif', 'i.mp4', 'o.gif', S({ gifWidth: 480, videoMaxH: 240 })), '-vf');
    expect(vf.match(/scale=/g)).toHaveLength(1);
    expect(vf).toContain(fitWithin(480, 240) as string);
  });
});

describe('fitWithin', () => {
  // Regression: the GIF width was forced (scale=480:-2), so a 320 px clip came out 480 px wide.
  // Every cap is now min(original, limit), so small inputs keep their size.
  it('only ever shrinks, on each side that has a limit', () => {
    expect(fitWithin(480, 0)).toBe('scale=w=min(iw\\,480):h=ih:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos');
    expect(fitWithin(0, 720)).toBe('scale=w=iw:h=min(ih\\,720):force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos');
    expect(fitWithin(480, 270)).toContain('w=min(iw\\,480):h=min(ih\\,270)');
  });

  it('returns no filter when nothing is capped', () => {
    expect(fitWithin(0, 0)).toBeNull();
  });
});
