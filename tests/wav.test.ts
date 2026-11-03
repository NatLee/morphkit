import { describe, expect, it } from 'vitest';
import { audioBufferToWav } from '../src/lib/wav';

function fakeBuffer(channels: Float32Array[], sampleRate = 8000): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (i: number) => channels[i],
  } as unknown as AudioBuffer;
}

const bytesOf = (b: Blob) => b.arrayBuffer();

describe('audioBufferToWav', () => {
  it('writes a 16-bit PCM header and interleaved, clipped samples', async () => {
    const wav = audioBufferToWav(fakeBuffer([new Float32Array([0, 1, -1, 2]), new Float32Array([0.5, -0.5, 0, -2])]));
    const v = new DataView(await bytesOf(wav));
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(v.buffer, o, 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect([s(0), s(1), s(2), s(3)]).toEqual([0, 16383, 32767, -16384]);
    expect(s(6)).toBe(32767); // 2.0 clipped
    expect(s(7)).toBe(-32768); // -2.0 clipped
  });

  it('keeps at most two channels', async () => {
    const ch = new Float32Array([0.1]);
    const wav = audioBufferToWav(fakeBuffer([ch, ch, ch, ch, ch, ch]));
    expect(new DataView(await bytesOf(wav)).getUint16(22, true)).toBe(2);
  });
});
