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

/**
 * Metadata handling.
 *
 * Tags: `-map_metadata 0` copies title/artist/album/… from the source. MP3 also
 * needs `-id3v2_version 3` because ID3v2.4 is poorly supported by Windows
 * Explorer and many players, plus `-write_id3v1 1` for legacy readers.
 *
 * Cover art: an embedded cover is a single-frame video stream. Copying it needs
 * an explicit stream map (otherwise `-vn` in the audio path drops it) and the
 * `attached_pic` disposition so players treat it as artwork, not video.
 * Containers that cannot carry artwork (WAV, OGG/Vorbis via this path) are
 * skipped — a stray mjpeg stream would make the file unplayable.
 */
const ART_CAPABLE = new Set(['mp3', 'm4a', 'flac']);

function metaOpts(target: string, s: Settings): string[] {
  if (!s.keepMetadata) return ['-map_metadata', '-1'];
  const a: string[] = ['-map_metadata', '0'];
  if (target === 'mp3') a.push('-id3v2_version', '3', '-write_id3v1', '1');
  return a;
}

/** Stream mapping + codec bits needed to carry a cover image through. */
function artOpts(target: string, s: Settings, hasArt: boolean): string[] {
  if (!s.keepCoverArt || !hasArt || !ART_CAPABLE.has(target)) return ['-vn'];
  return [
    '-map', '0:a', '-map', '0:v:0?',
    '-c:v', 'copy', '-disposition:v:0', 'attached_pic',
  ];
}

/**
 * Bitrate control. CBR pins `-b:a`; VBR gives the encoder a quality target
 * (`-q:a`) instead, so it spends bits where the material actually needs them.
 *
 * The scale is encoder-specific: libmp3lame runs 0 (best, ~245 kbps) … 9, while
 * libvorbis runs the other way round (0 … 10, higher = better), so the shared
 * `audioQuality` slider is mirrored for it. The native AAC encoder's VBR is
 * experimental and unreliable at low q, so m4a stays on CBR either way.
 */
function rateOpts(codec: 'mp3' | 'aac' | 'vorbis', s: Settings): string[] {
  const q = Math.min(Math.max(Math.round(s.audioQuality), 0), 9);
  // vorbis is quality-driven in both modes; CBR keeps the historical q5
  if (codec === 'vorbis') return ['-q:a', String(s.audioRateMode === 'vbr' ? 10 - q : 5)];
  if (codec === 'mp3' && s.audioRateMode === 'vbr') return ['-q:a', String(q)];
  return ['-b:a', s.audioBitrate];
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
  input2?: string,
  hasArt = false
): string[] {
  const trim = trimOpts(e);
  const t2 = trackMap(input2);
  const meta = metaOpts(target, s);
  // trimming re-times the stream, so a copied cover would desync the map
  const art = artOpts(target, s, hasArt && !trim.length);
  switch (target) {
    // ---- audio ----
    case 'mp3':
      return [...trim, '-i', input, ...art, '-c:a', 'libmp3lame', ...rateOpts('mp3', s), ...audioOpts(s), ...afChain(e), ...meta, output];
    case 'wav':
      return [...trim, '-i', input, '-vn', ...audioOpts(s), ...afChain(e), ...meta, output];
    case 'ogg':
      return [...trim, '-i', input, '-vn', '-c:a', 'libvorbis', ...rateOpts('vorbis', s), ...audioOpts(s), ...afChain(e), ...meta, output];
    case 'flac':
      return [...trim, '-i', input, ...art, '-c:a', 'flac', ...audioOpts(s), ...afChain(e), ...meta, output];
    case 'm4a':
      return [...trim, '-i', input, ...art, '-c:a', 'aac', ...rateOpts('aac', s), ...audioOpts(s), ...afChain(e), ...meta, output];
    // ---- video ----
    case 'mp4':
      return [...trim, '-i', input, ...t2.inputs, ...t2.map, '-c:v', 'libx264', '-preset', s.videoPreset, '-crf', String(s.videoCrf), '-pix_fmt', 'yuv420p', ...vfChain(s, e), ...fpsOpt(s), ...(input2 ? ['-c:a', 'aac', '-b:a', '128k', ...afChain(e)] : videoAudioTrack(s, e)), ...meta, output];
    case 'webm':
      return [...trim, '-i', input, ...t2.inputs, ...t2.map, '-c:v', 'libvpx', '-crf', String(Math.min(s.videoCrf + 7, 40)), '-b:v', '1M', ...vfChain(s, e), ...fpsOpt(s), ...(input2 ? ['-c:a', 'libvorbis', ...afChain(e)] : s.videoMute || e?.mute ? ['-an'] : ['-c:a', 'libvorbis', ...afChain(e)]), ...meta, output];
    case 'gif':
      // GIF carries no tags — copying metadata here only risks muxer warnings
      return [...trim, '-i', input, ...vfChain(s, e, [`fps=${s.gifFps}`, `scale=${s.gifWidth}:-2:flags=lanczos`]), '-loop', '0', output];
    default:
      return [...trim, '-i', input, ...meta, output];
  }
}

/** Does this file carry an embedded cover image? (cheap sniff, no decode) */
async function sniffCoverArt(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
    const text = new TextDecoder('latin1').decode(head);
    // ID3v2 APIC frame (mp3), MP4 'covr' atom (m4a), FLAC PICTURE block marker
    if (text.includes('APIC')) return true;
    if (text.includes('covr')) return true;
    if (text.startsWith('fLaC') && text.includes('image/')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Video-project export: trim the video, optionally replace its audio with a
 * pre-rendered WAV mix (from the Studio timeline), encode to MP4.
 */
export async function muxVideo(
  video: File,
  audioWav: Blob | null,
  trimStart: number,
  trimEnd: number,
  settings: Settings,
  onProgress: (p: number) => void,
  onDownload?: DownloadProgress
): Promise<Blob> {
  const ff = await acquireEngine(onDownload);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const vName = `v_${stamp}.${extOf(video.name) || 'mp4'}`;
  const aName = `a_${stamp}.wav`;
  const outName = `out_${stamp}.mp4`;
  const trim: string[] = [];
  if (trimStart > 0.01) trim.push('-ss', trimStart.toFixed(3));
  if (trimEnd > trimStart + 0.01) trim.push('-t', (trimEnd - trimStart).toFixed(3));

  const handler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress(Math.min(1, Math.max(0, progress)));
  };

  try {
    await ff.writeFile(vName, await fetchFile(video));
    if (audioWav) await ff.writeFile(aName, new Uint8Array(await audioWav.arrayBuffer()));
    ff.on('progress', handler);
    const args = [
      ...trim, '-i', vName,
      ...(audioWav ? ['-i', aName, '-map', '0:v:0', '-map', '1:a:0', '-shortest'] : []),
      '-c:v', 'libx264', '-preset', settings.videoPreset, '-crf', String(settings.videoCrf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      ...(settings.keepMetadata ? ['-map_metadata', '0'] : ['-map_metadata', '-1']),
      outName,
    ];
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const data = await ff.readFile(outName);
    if (typeof data === 'string') throw new Error('unexpected output');
    return new Blob([data.slice()], { type: 'video/mp4' });
  } finally {
    ff.off('progress', handler);
    try { await ff.deleteFile(vName); } catch { /* ignore */ }
    if (audioWav) { try { await ff.deleteFile(aName); } catch { /* ignore */ } }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
    releaseEngine(ff);
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
    const hasArt = settings.keepCoverArt ? await sniffCoverArt(file) : false;
    ff.on('progress', handler);
    let code = await ff.exec(buildArgs(target, inName, outName, settings, edit, in2Name, hasArt));
    // cover-art mapping is best-effort: retry once without it rather than fail
    if (code !== 0 && hasArt) {
      code = await ff.exec(buildArgs(target, inName, outName, settings, edit, in2Name, false));
    }
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
