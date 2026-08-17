import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { extOf, mimeFor } from './formats';
import type { Settings } from './settings';
import type { MediaEdit } from '../types';

// Single-thread core: works everywhere (incl. GitHub Pages) — no COOP/COEP headers needed.
const CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
const WASM_FALLBACK_TOTAL = 32_000_000; // ~30.6 MB, used when Content-Length is missing

export type DownloadProgress = (received: number, total: number) => void;

/** Core downloaded once and shared (as blob URLs) by every pooled instance. */
let coreBlobs: Promise<{ coreURL: string; wasmURL: string }> | null = null;

function getCoreBlobs(onDownload?: DownloadProgress) {
  if (!coreBlobs) {
    coreBlobs = (async () => {
      const coreURL = await toBlobURL(`${CORE_URL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(
        `${CORE_URL}/ffmpeg-core.wasm`,
        'application/wasm',
        true,
        (e: { received: number; total: number; done: boolean }) => {
          onDownload?.(e.received, e.total > 0 ? e.total : WASM_FALLBACK_TOTAL);
        }
      );
      return { coreURL, wasmURL };
    })().catch((err) => {
      coreBlobs = null;
      throw err;
    });
  }
  return coreBlobs;
}

/**
 * Pool of ffmpeg instances so multiple files convert in parallel.
 * The app-level scheduler caps concurrent jobs, so the pool never grows
 * beyond the user's worker setting.
 */
const pool: { ff: FFmpeg; busy: boolean }[] = [];

export function isEngineReady(): boolean {
  return pool.some((p) => p.ff.loaded);
}

async function acquireEngine(onDownload?: DownloadProgress): Promise<FFmpeg> {
  const free = pool.find((p) => !p.busy && p.ff.loaded);
  if (free) {
    free.busy = true;
    return free.ff;
  }
  const { coreURL, wasmURL } = await getCoreBlobs(onDownload);
  const entry = { ff: new FFmpeg(), busy: true };
  pool.push(entry);
  try {
    await entry.ff.load({ coreURL, wasmURL });
  } catch (err) {
    pool.splice(pool.indexOf(entry), 1);
    throw err;
  }
  return entry.ff;
}

function releaseEngine(ff: FFmpeg): void {
  const entry = pool.find((p) => p.ff === ff);
  if (entry) entry.busy = false;
}

/** Shared audio-output options: sample rate + channel layout. */
function audioOpts(s: Settings): string[] {
  const a: string[] = [];
  if (s.audioSampleRate > 0) a.push('-ar', String(s.audioSampleRate));
  if (s.audioChannels > 0) a.push('-ac', String(s.audioChannels));
  return a;
}

/** Trim options — placed BEFORE -i for fast, re-encode-accurate seeking. */
function trimOpts(e?: MediaEdit): string[] {
  const a: string[] = [];
  const start = e?.trimStart ?? 0;
  if (start > 0) a.push('-ss', start.toFixed(3));
  if (e?.trimEnd != null && e.trimEnd > start) a.push('-t', (e.trimEnd - start).toFixed(3));
  return a;
}

/** Video filter chain: rotate + speed + resolution cap. */
function vfChain(s: Settings, e?: MediaEdit, extra: string[] = []): string[] {
  const f: string[] = [];
  if (e?.rotate === 90) f.push('transpose=1');
  else if (e?.rotate === 180) f.push('hflip', 'vflip');
  else if (e?.rotate === 270) f.push('transpose=2');
  if (e?.speed && e.speed !== 1) f.push(`setpts=PTS/${e.speed}`);
  f.push(...extra);
  if (s.videoMaxH > 0) f.push(`scale=-2:min(ih\\,${s.videoMaxH})`);
  return f.length ? ['-vf', f.join(',')] : [];
}

/** Audio filter chain: volume + tempo. */
function afChain(e?: MediaEdit): string[] {
  const f: string[] = [];
  if (e?.volume != null && e.volume !== 1) f.push(`volume=${e.volume.toFixed(2)}`);
  if (e?.speed && e.speed !== 1) f.push(`atempo=${e.speed}`);
  return f.length ? ['-af', f.join(',')] : [];
}

function fpsOpt(s: Settings): string[] {
  return s.videoFps > 0 ? ['-r', String(s.videoFps)] : [];
}

function videoAudioTrack(s: Settings, e?: MediaEdit): string[] {
  return s.videoMute || e?.mute ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k', ...afChain(e)];
}

/** Extra input + stream mapping when the audio track is replaced. */
function trackMap(input2?: string): { inputs: string[]; map: string[] } {
  if (!input2) return { inputs: [], map: [] };
  return { inputs: ['-i', input2], map: ['-map', '0:v:0', '-map', '1:a:0', '-shortest'] };
}

function buildArgs(
  target: string,
  input: string,
  output: string,
  s: Settings,
  e?: MediaEdit,
  input2?: string
): string[] {
  const trim = trimOpts(e);
  const t2 = trackMap(input2);
  switch (target) {
    // ---- audio ----
    case 'mp3':
      return [...trim, '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', s.audioBitrate, ...audioOpts(s), ...afChain(e), output];
    case 'wav':
      return [...trim, '-i', input, '-vn', ...audioOpts(s), ...afChain(e), output];
    case 'ogg':
      return [...trim, '-i', input, '-vn', '-c:a', 'libvorbis', '-q:a', '5', ...audioOpts(s), ...afChain(e), output];
    case 'flac':
      return [...trim, '-i', input, '-vn', '-c:a', 'flac', ...audioOpts(s), ...afChain(e), output];
    case 'm4a':
      return [...trim, '-i', input, '-vn', '-c:a', 'aac', '-b:a', s.audioBitrate, ...audioOpts(s), ...afChain(e), output];
    // ---- video ----
    case 'mp4':
      return [...trim, '-i', input, ...t2.inputs, ...t2.map, '-c:v', 'libx264', '-preset', s.videoPreset, '-crf', String(s.videoCrf), '-pix_fmt', 'yuv420p', ...vfChain(s, e), ...fpsOpt(s), ...(input2 ? ['-c:a', 'aac', '-b:a', '128k', ...afChain(e)] : videoAudioTrack(s, e)), output];
    case 'webm':
      return [...trim, '-i', input, ...t2.inputs, ...t2.map, '-c:v', 'libvpx', '-crf', String(Math.min(s.videoCrf + 7, 40)), '-b:v', '1M', ...vfChain(s, e), ...fpsOpt(s), ...(input2 ? ['-c:a', 'libvorbis', ...afChain(e)] : s.videoMute || e?.mute ? ['-an'] : ['-c:a', 'libvorbis', ...afChain(e)]), output];
    case 'gif':
      return [...trim, '-i', input, ...vfChain(s, e, [`fps=${s.gifFps}`, `scale=${s.gifWidth}:-2:flags=lanczos`]), '-loop', '0', output];
    default:
      return [...trim, '-i', input, output];
  }
}

/** Convert audio/video in the browser. Job progress callback receives 0..1. */
export async function convertMedia(
  file: File,
  target: string,
  settings: Settings,
  edit: MediaEdit | undefined,
  onProgress: (p: number) => void,
  onDownload?: DownloadProgress
): Promise<Blob> {
  const ff = await acquireEngine(onDownload);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inName = `in_${stamp}.${extOf(file.name) || 'bin'}`;
  const outName = `out_${stamp}.${target}`;
  const replaceAudio = edit?.audioTrack && (target === 'mp4' || target === 'webm');
  const in2Name = replaceAudio
    ? `in2_${stamp}.${extOf(edit!.audioTrack!.name) || 'bin'}`
    : undefined;

  const handler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress(Math.min(1, Math.max(0, progress)));
  };

  try {
    await ff.writeFile(inName, await fetchFile(file));
    if (in2Name) await ff.writeFile(in2Name, await fetchFile(edit!.audioTrack!));
    ff.on('progress', handler);
    const code = await ff.exec(buildArgs(target, inName, outName, settings, edit, in2Name));
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const data = await ff.readFile(outName);
    if (typeof data === 'string') throw new Error('unexpected output');
    return new Blob([data.slice()], { type: mimeFor(target) });
  } finally {
    ff.off('progress', handler);
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    if (in2Name) { try { await ff.deleteFile(in2Name); } catch { /* ignore */ } }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
    releaseEngine(ff);
  }
}
