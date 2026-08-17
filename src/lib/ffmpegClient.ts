import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { extOf, mimeFor } from './formats';
import type { Settings } from './settings';

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

/** Shared video-output filters: resolution cap + fps cap. */
function videoOpts(s: Settings): string[] {
  const a: string[] = [];
  if (s.videoMaxH > 0) a.push('-vf', `scale=-2:min(ih\\,${s.videoMaxH})`);
  if (s.videoFps > 0) a.push('-r', String(s.videoFps));
  return a;
}

function videoAudioTrack(s: Settings): string[] {
  return s.videoMute ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k'];
}

function buildArgs(target: string, input: string, output: string, s: Settings): string[] {
  switch (target) {
    // ---- audio ----
    case 'mp3':
      return ['-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', s.audioBitrate, ...audioOpts(s), output];
    case 'wav':
      return ['-i', input, '-vn', ...audioOpts(s), output];
    case 'ogg':
      return ['-i', input, '-vn', '-c:a', 'libvorbis', '-q:a', '5', ...audioOpts(s), output];
    case 'flac':
      return ['-i', input, '-vn', '-c:a', 'flac', ...audioOpts(s), output];
    case 'm4a':
      return ['-i', input, '-vn', '-c:a', 'aac', '-b:a', s.audioBitrate, ...audioOpts(s), output];
    // ---- video ----
    case 'mp4':
      return ['-i', input, '-c:v', 'libx264', '-preset', s.videoPreset, '-crf', String(s.videoCrf), '-pix_fmt', 'yuv420p', ...videoOpts(s), ...videoAudioTrack(s), output];
    case 'webm':
      return ['-i', input, '-c:v', 'libvpx', '-crf', String(Math.min(s.videoCrf + 7, 40)), '-b:v', '1M', ...videoOpts(s), ...(s.videoMute ? ['-an'] : ['-c:a', 'libvorbis']), output];
    case 'gif':
      return ['-i', input, '-vf', `fps=${s.gifFps},scale=${s.gifWidth}:-2:flags=lanczos`, '-loop', '0', output];
    default:
      return ['-i', input, output];
  }
}

/** Convert audio/video in the browser. Job progress callback receives 0..1. */
export async function convertMedia(
  file: File,
  target: string,
  settings: Settings,
  onProgress: (p: number) => void,
  onDownload?: DownloadProgress
): Promise<Blob> {
  const ff = await acquireEngine(onDownload);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inName = `in_${stamp}.${extOf(file.name) || 'bin'}`;
  const outName = `out_${stamp}.${target}`;

  const handler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress(Math.min(1, Math.max(0, progress)));
  };

  try {
    await ff.writeFile(inName, await fetchFile(file));
    ff.on('progress', handler);
    const code = await ff.exec(buildArgs(target, inName, outName, settings));
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const data = await ff.readFile(outName);
    if (typeof data === 'string') throw new Error('unexpected output');
    return new Blob([data.slice()], { type: mimeFor(target) });
  } finally {
    ff.off('progress', handler);
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
    releaseEngine(ff);
  }
}
