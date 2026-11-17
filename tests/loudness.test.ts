import { describe, expect, it } from 'vitest';
import {
  buildArgs,
  loudnessProbeArgs,
  loudnormFor,
  parseLoudness,
  audioFormatInLog,
} from '../src/lib/ffmpegClient';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';

const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

// The tail of a real measurement run (ffmpeg 7.0.2, 10 s of quiet pink noise, I=-16), one log
// line per entry as ffmpeg.wasm delivers them.
const PROBE_LOG = [
  "Input #0, wav, from 'quiet.wav':",
  '  Duration: 00:00:10.00, bitrate: 1411 kb/s',
  '  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s',
  'Stream mapping:',
  '  Stream #0:0 -> #0:0 (pcm_s16le (native) -> pcm_s16le (native))',
  "Output #0, null, to 'pipe:':",
  '  Stream #0:0: Audio: pcm_s16le, 192000 Hz, stereo, s16, 6144 kb/s',
  '[Parsed_loudnorm_0 @ 0000018ca09bda80] ',
  '{',
  '\t"input_i" : "-47.17",',
  '\t"input_tp" : "-36.61",',
  '\t"input_lra" : "0.10",',
  '\t"input_thresh" : "-57.17",',
  '\t"output_i" : "-16.02",',
  '\t"output_tp" : "-5.45",',
  '\t"output_lra" : "0.10",',
  '\t"output_thresh" : "-26.02",',
  '\t"normalization_type" : "dynamic",',
  '\t"target_offset" : "0.02"',
  '}',
];
const MEASURE = { i: -47.17, tp: -36.61, lra: 0.1, thresh: -57.17, offset: 0.02 };

describe('loudness normalisation — measurement pass', () => {
  it('measures the same stretch the encode will use, and writes nothing', () => {
    const a = loudnessProbeArgs('in.mp3', -16, ['-ss', '2.000', '-t', '5.000']);
    expect(a.slice(0, 6)).toEqual(['-ss', '2.000', '-t', '5.000', '-i', 'in.mp3']);
    expect(a).toContain('-vn');
    expect(after(a, '-af')).toBe('loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json');
    expect(a.slice(-3)).toEqual(['-f', 'null', '-']);
  });

  it('reads the JSON block loudnorm prints', () => {
    expect(parseLoudness(PROBE_LOG)).toEqual(MEASURE);
  });

  it('leaves silence and logs without a block alone', () => {
    const silent = PROBE_LOG.map((l) => l.replace(/"input_(i|tp|thresh)" : "[-\d.]+"/, '"input_$1" : "-inf"'));
    expect(parseLoudness(silent)).toBeNull();
    expect(parseLoudness(PROBE_LOG.slice(0, 7))).toBeNull();
  });

  // loudnorm hands out 192 kHz without a channel layout; the source's own format goes back on
  it('reads the source format from the input banner, not the 192 kHz output line', () => {
    expect(audioFormatInLog(PROBE_LOG)).toEqual({ sampleRate: 44100, layout: 'stereo' });
    expect(audioFormatInLog(['  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, 5.1(side), fltp, 384 kb/s (default)']))
      .toEqual({ sampleRate: 48000, layout: '5.1(side)' });
    expect(audioFormatInLog(['  Stream #0:0: Audio: mp3, 22050 Hz, mono, fltp, 64 kb/s'])).toEqual({ sampleRate: 22050, layout: 'mono' });
  });

  it('gives up on layouts ffmpeg cannot name, and on files without sound', () => {
    expect(audioFormatInLog(['  Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 96000 Hz, 6 channels, s32, 13824 kb/s'])).toBeNull();
    expect(audioFormatInLog(['  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080, 30 fps'])).toBeNull();
  });
});

describe('loudness normalisation — encode pass', () => {
  const loud = loudnormFor(-16, MEASURE, { sampleRate: 44100, layout: 'stereo' });

  // Regression (found in the browser): ffmpeg 5.1's loudnorm drops the channel layout and the AAC
  // encoder then fails with "Cannot select channel layout" — the aformat step must stay.
  it('applies one linear gain from the measurement, then puts the source format back', () => {
    expect(loud).toBe(
      'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-47.17:measured_TP=-36.61:measured_LRA=0.1' +
      ':measured_thresh=-57.17:offset=0.02:linear=true' +
      ',aformat=sample_rates=44100:channel_layouts=stereo'
    );
  });

  it('falls back to 48 kHz stereo when the source format is unknown', () => {
    expect(loudnormFor(-23, MEASURE, null)).toMatch(/,aformat=sample_rates=48000:channel_layouts=stereo$/);
  });

  it('runs first in the audio chain, before the card’s own volume and speed', () => {
    const a = buildArgs('mp3', 'i', 'o.mp3', S(), { volume: 1.5, speed: 2 }, { loudnorm: loud });
    expect(after(a, '-af')).toBe(`${loud},volume=1.50,atempo=2`);
  });

  it('reaches every output that carries sound', () => {
    for (const target of ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'webm']) {
      expect(after(buildArgs(target, 'i', `o.${target}`, S(), undefined, { loudnorm: loud }), '-af')).toContain('loudnorm=');
    }
  });

  it('stays out of silent outputs', () => {
    expect(buildArgs('mp4', 'i', 'o.mp4', S({ videoMute: true }), undefined, { loudnorm: loud }).join(' ')).not.toContain('loudnorm');
    expect(buildArgs('gif', 'i', 'o.gif', S(), undefined, { loudnorm: loud }).join(' ')).not.toContain('loudnorm');
  });

  // -ar is an output option: ffmpeg resamples after the whole filter chain, so the setting still wins
  it('keeps the sample rate setting as an output option', () => {
    const a = buildArgs('mp3', 'i', 'o.mp3', S({ audioSampleRate: 22050 }), undefined, { loudnorm: loud });
    expect(after(a, '-ar')).toBe('22050');
    expect(after(a, '-af')).toContain('sample_rates=44100');
  });

  it('changes nothing when it is off', () => {
    expect(buildArgs('mp3', 'i', 'o.mp3', S())).not.toContain('-af');
  });
});
