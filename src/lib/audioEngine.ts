import type { MixerDoc } from './studioTypes';
import { audioBufferToWav } from './wav';

/** Web Audio mixing engine: decode cache, live playback graph, offline render. */

let ctx: AudioContext | null = null;

export function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

const cache = new Map<string, AudioBuffer>();

export async function decodeAssetBuffer(id: string, blob: Blob): Promise<AudioBuffer> {
  const hit = cache.get(id);
  if (hit) return hit;
  const buf = await audioCtx().decodeAudioData(await blob.arrayBuffer());
  cache.set(id, buf);
  return buf;
}

export function getCachedBuffer(id: string): AudioBuffer | null {
  return cache.get(id) ?? null;
}

export function dropAssetBuffer(id: string): void {
  cache.delete(id);
}

export function mixDuration(doc: MixerDoc): number {
  let d = 0;
  for (const t of doc.tracks) for (const c of t.clips) d = Math.max(d, c.start + c.duration);
  return d;
}

/** Wire clips → gains → destination. Returns started sources (live ctx only). */
function buildGraph(
  target: BaseAudioContext,
  doc: MixerDoc,
  from: number
): AudioBufferSourceNode[] {
  const master = target.createGain();
  master.connect(target.destination);
  const anySolo = doc.tracks.some((t) => t.solo);
  const sources: AudioBufferSourceNode[] = [];
  for (const t of doc.tracks) {
    const audible = !t.muted && (!anySolo || t.solo);
    const tg = target.createGain();
    tg.gain.value = audible ? t.gain : 0;
    tg.connect(master);
    for (const c of t.clips) {
      const buf = cache.get(c.assetId);
      if (!buf) continue;
      if (c.start + c.duration <= from) continue;
      const src = target.createBufferSource();
      src.buffer = buf;
      const cg = target.createGain();
      cg.gain.value = c.gain;
      src.connect(cg);
      cg.connect(tg);
      const when = Math.max(0, c.start - from);
      const skip = Math.max(0, from - c.start);
      const dur = c.duration - skip;
      if (dur <= 0) continue;
      src.start(target.currentTime + when, c.offset + skip, dur);
      sources.push(src);
    }
  }
  return sources;
}

export interface PlayHandle {
  stop: () => void;
  /** AudioContext time when playback started */
  t0: number;
  /** mix position playback started from */
  from: number;
}

export function playMix(doc: MixerDoc, from: number): PlayHandle {
  const c = audioCtx();
  void c.resume();
  const sources = buildGraph(c, doc, from);
  const t0 = c.currentTime;
  return {
    t0,
    from,
    stop: () => {
      for (const s of sources) {
        try { s.stop(); } catch { /* already ended */ }
      }
    },
  };
}

/** Offline render of the whole mix → 16-bit WAV. */
export async function renderMixWav(doc: MixerDoc): Promise<Blob> {
  const dur = mixDuration(doc);
  if (dur <= 0) throw new Error('empty mix');
  const off = new OfflineAudioContext(2, Math.ceil(dur * 44100), 44100);
  buildGraph(off, doc, 0);
  const rendered = await off.startRendering();
  return audioBufferToWav(rendered);
}

/** Peak samples (0..1) for waveform drawing over a window of the buffer. */
export function peaks(
  buf: AudioBuffer,
  offset: number,
  duration: number,
  count: number
): Float32Array {
  const data = buf.getChannelData(0);
  const startI = Math.floor(offset * buf.sampleRate);
  const lenI = Math.min(Math.floor(duration * buf.sampleRate), data.length - startI);
  const out = new Float32Array(Math.max(count, 1));
  if (lenI <= 0) return out;
  const step = Math.max(1, Math.floor(lenI / count));
  for (let i = 0; i < count; i++) {
    let m = 0;
    const base = startI + i * step;
    for (let j = 0; j < step; j += 16) {
      const v = Math.abs(data[base + j] ?? 0);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}
