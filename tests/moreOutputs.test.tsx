import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { outputsOf } from '../src/lib/formatMap';
import { ICO_SIZES, encodeIco, icoSizesFor } from '../src/lib/imageConvert';
import { buildArgs, noStreamInLog } from '../src/lib/ffmpegClient';
import {
  AUDIO_OUTPUTS, IMAGE_OUTPUTS, VIDEO_OUTPUTS, formatLabel, mimeFor, outputFileName, outputsFor,
} from '../src/lib/formats';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

afterEach(cleanup);

describe('ICO output', () => {
  it('is offered for images, as image/x-icon with an .ico name', () => {
    expect(IMAGE_OUTPUTS).toContain('ico');
    expect(mimeFor('ico')).toBe('image/x-icon');
    expect(outputFileName('logo.png', 'ico')).toBe('logo.ico');
  });

  it('stores every icon size up to the source size, never enlarging', () => {
    expect(icoSizesFor(4000, 3000)).toEqual([...ICO_SIZES]);
    expect(icoSizesFor(100, 40)).toEqual([16, 24, 32, 48, 64]);
    expect(icoSizesFor(256, 256)).toContain(256);
  });

  it('still makes the smallest icon from a tiny source', () => {
    expect(icoSizesFor(10, 10)).toEqual([16]);
  });

  it('writes the ICONDIR header, one entry per image and the PNG data after them', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6, 7, 8]);
    const ico = encodeIco([{ size: 16, png: a }, { size: 256, png: b }]);
    const dv = new DataView(ico.buffer);
    expect(dv.getUint16(0, true)).toBe(0); // reserved
    expect(dv.getUint16(2, true)).toBe(1); // 1 = icon
    expect(dv.getUint16(4, true)).toBe(2); // two images
    // entry 1: 16×16, 32 bpp, 3 bytes, data right after the 6 + 2×16 byte directory
    expect([ico[6], ico[7]]).toEqual([16, 16]);
    expect(dv.getUint16(6 + 6, true)).toBe(32);
    expect(dv.getUint32(6 + 8, true)).toBe(3);
    expect(dv.getUint32(6 + 12, true)).toBe(38);
    // entry 2: 256 is written as 0, and its data follows the first image
    expect([ico[22], ico[23]]).toEqual([0, 0]);
    expect(dv.getUint32(22 + 12, true)).toBe(41);
    expect([...ico.slice(38)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('video → audio', () => {
  it('offers every audio format for a video, not only MP3', () => {
    for (const a of AUDIO_OUTPUTS) expect(VIDEO_OUTPUTS).toContain(a);
    expect(outputsFor('video')).toEqual(VIDEO_OUTPUTS);
  });

  it('drops the picture for every audio target', () => {
    for (const a of AUDIO_OUTPUTS) {
      const args = buildArgs(a, 'clip.mp4', `o.${a}`, DEFAULT_SETTINGS);
      expect(args).toContain('-vn');
      expect(args).not.toContain('attached_pic');
    }
  });

  // Regression: a video without sound converted to MP3 only said "Conversion failed".
  it('recognises ffmpeg saying the output would have no stream', () => {
    expect(noStreamInLog(['Output file #0 does not contain any stream'])).toBe(true); // ffmpeg 5 (wasm core)
    expect(noStreamInLog(['[out#0/mp3 @ 0x1] Output file does not contain any stream'])).toBe(true); // ffmpeg 7
    expect(noStreamInLog(["Stream map '0:a' matches no streams."])).toBe(true);
    expect(noStreamInLog(['Conversion failed!', 'Invalid data found when processing input'])).toBe(false);
  });
});

describe('format overview', () => {
  // the home page's overview reads these lists (lib/formatMap), so a new output appears by itself there
  it('names the image and video outputs the registry has', () => {
    expect(outputsOf('image')).toEqual(IMAGE_OUTPUTS);
    expect(outputsOf('image')).toContain('ico');
    expect(outputsOf('video').map(formatLabel)).toEqual(['MP4', 'WEBM', 'MOV', 'MKV', 'GIF', 'MP3', 'WAV', 'OGG', 'FLAC', 'M4A']);
  });

  it('writes jpeg the familiar way', () => {
    expect(formatLabel('jpeg')).toBe('JPG');
    expect(formatLabel('webp')).toBe('WEBP');
  });
});
