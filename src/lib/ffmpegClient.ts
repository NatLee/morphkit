import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ConvertError } from './errors';
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

/**
 * Size cap as one ffmpeg scale filter: fit the frame inside maxW × maxH (0 = no limit on that
 * side), keep the aspect ratio, never enlarge, and round to even sizes (yuv420p encoders need them).
 * The single rule behind every "max" size setting (video height, GIF width); null = no cap.
 */
export function fitWithin(maxW: number, maxH: number): string | null {
  if (!(maxW > 0) && !(maxH > 0)) return null;
  const w = maxW > 0 ? `min(iw\\,${maxW})` : 'iw';
  const h = maxH > 0 ? `min(ih\\,${maxH})` : 'ih';
  return `scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;
}

/** Video filter chain: rotate + speed + extra filters + size cap (`maxW` from the caller, height from settings). */
function vfChain(s: Settings, e?: MediaEdit, extra: string[] = [], maxW = 0): string[] {
  const f: string[] = [];
  if (e?.rotate === 90) f.push('transpose=1');
  else if (e?.rotate === 180) f.push('hflip', 'vflip');
  else if (e?.rotate === 270) f.push('transpose=2');
  if (e?.speed && e.speed !== 1) f.push(`setpts=PTS/${e.speed}`);
  f.push(...extra);
  const fit = fitWithin(maxW, s.videoMaxH);
  if (fit) f.push(fit);
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

/** AAC bitrate of the sound in MP4 output; also what the size budget sets aside for sound. */
export const VIDEO_AUDIO_KBPS = 128;

function videoAudioTrack(s: Settings, e?: MediaEdit): string[] {
  return s.videoMute || e?.mute ? ['-an'] : ['-c:a', 'aac', '-b:a', `${VIDEO_AUDIO_KBPS}k`, ...afChain(e)];
}

/**
 * Video rate control. Normally quality-driven (CRF; WebM also caps at 1 Mbps). With `kbps` from
 * the size target it switches to an average bitrate — x264 also gets a matching max rate and a
 * two-second buffer so a busy scene cannot blow the budget.
 */
function videoRate(codec: 'x264' | 'vp8', s: Settings, kbps?: number): string[] {
  if (kbps) {
    return codec === 'x264'
      ? ['-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`]
      : ['-b:v', `${kbps}k`];
  }
  return codec === 'x264'
    ? ['-crf', String(s.videoCrf)]
    : ['-crf', String(Math.min(s.videoCrf + 7, 40)), '-b:v', '1M'];
}

/** Outputs with both a picture and a sound track (GIF has no sound, the audio formats no
    picture): the ones whose sound can be replaced and that the size target applies to. */
export const AV_TARGETS: ReadonlySet<string> = new Set(['mp4', 'webm']);
/** Share of the size budget given to the streams; the rest is room for the container. */
const SIZE_MARGIN = 0.95;
/** Below this the picture is mush — better to say the target cannot be met. */
const MIN_VIDEO_KBPS = 50;

/** How long the output runs: the trimmed span, sped up or slowed down. */
export function mediaSeconds(duration: number, e?: MediaEdit): number {
  const start = e?.trimStart ?? 0;
  const end = e?.trimEnd != null && e.trimEnd > start ? e.trimEnd : duration;
  return (end - start) / (e?.speed || 1);
}

/** Video bitrate (kbps) that lands `seconds` of video plus its sound under `maxBytes`. */
export function videoKbpsFor(maxBytes: number, seconds: number, audioKbps: number): number {
  const kbps = Math.floor((maxBytes * 8 * SIZE_MARGIN) / 1000 / seconds - audioKbps);
  if (!(kbps >= MIN_VIDEO_KBPS)) throw new ConvertError('fitTooSmall');
  return kbps;
}

/** Extra input + stream mapping when the audio track is replaced. */
function trackMap(input2?: string): { inputs: string[]; map: string[] } {
  if (!input2) return { inputs: [], map: [] };
  return { inputs: ['-i', input2], map: ['-map', '0:v:0', '-map', '1:a:0', '-shortest'] };
}

export interface BuildOpts {
  /** second input that replaces the video's sound */
  input2?: string;
  /** the source carries cover art (see `sniffCoverArt`) */
  hasArt?: boolean;
  /** average video bitrate from the size target (`videoKbpsFor`), in place of CRF */
  videoKbps?: number;
}

/** Exported for the unit tests — argument order (trim before -i, maps, codecs) matters. */
export function buildArgs(
  target: string,
  input: string,
  output: string,
  s: Settings,
  e?: MediaEdit,
  { input2, hasArt = false, videoKbps }: BuildOpts = {}
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
      return [...trim, '-i', input, ...t2.inputs, ...t2.map, '-c:v', 'libx264', '-preset', s.videoPreset, ...videoRate('x264', s, videoKbps), '-pix_fmt', 'yuv420p', ...vfChain(s, e), ...fpsOpt(s), ...(input2 ? ['-c:a', 'aac', '-b:a', `${VIDEO_AUDIO_KBPS}k`, ...afChain(e)] : videoAudioTrack(s, e)), ...meta, output];
    case 'webm':
      return [...trim, '-i', input, ...t2.inputs, ...t2.map, '-c:v', 'libvpx', ...videoRate('vp8', s, videoKbps), ...vfChain(s, e), ...fpsOpt(s), ...(input2 ? ['-c:a', 'libvorbis', ...afChain(e)] : s.videoMute || e?.mute ? ['-an'] : ['-c:a', 'libvorbis', ...afChain(e)]), ...meta, output];
    case 'gif':
      // GIF carries no tags — copying metadata here only risks muxer warnings
      return [...trim, '-i', input, ...vfChain(s, e, [`fps=${s.gifFps}`], s.gifWidth), '-loop', '0', output];
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

/**
 * Video-project helper: pull the audio track out of a video as 44.1 kHz stereo
 * WAV, honouring the project trim so the result aligns with mixer timeline 0
 * (= trimmed video start, invariant 16). Throws if there is no audio stream.
 */
export async function extractAudio(
  video: File,
  trimStart: number,
  trimEnd: number,
  onDownload?: DownloadProgress
): Promise<Blob> {
  const ff = await acquireEngine(onDownload);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inName = `v_${stamp}.${extOf(video.name) || 'mp4'}`;
  const outName = `a_${stamp}.wav`;
  const trim: string[] = [];
  if (trimStart > 0.01) trim.push('-ss', trimStart.toFixed(3));
  if (trimEnd > trimStart + 0.01) trim.push('-t', (trimEnd - trimStart).toFixed(3));
  try {
    await ff.writeFile(inName, await fetchFile(video));
    const code = await ff.exec([...trim, '-i', inName, '-vn', '-ac', '2', '-ar', '44100', outName]);
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const data = await ff.readFile(outName);
    // a header-only WAV means ffmpeg found no decodable audio
    if (typeof data === 'string' || data.length < 128) throw new Error('no audio stream');
    return new Blob([data.slice()], { type: 'audio/wav' });
  } finally {
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
    releaseEngine(ff);
  }
}

/** Size target for one conversion: the converter passes it; Studio's own conversions do not. */
export interface FitTarget {
  /** 0 = no target */
  maxBytes: number;
  /** source length in seconds, from the file's metadata */
  duration?: number;
}

/** Convert audio/video in the browser. Job progress callback receives 0..1. */
export async function convertMedia(
  file: File,
  target: string,
  settings: Settings,
  edit: MediaEdit | undefined,
  onProgress: (p: number) => void,
  onDownload?: DownloadProgress,
  fit?: FitTarget
): Promise<Blob> {
  // size target → average bitrate, worked out before the engine is taken
  const maxBytes = fit && fit.maxBytes > 0 && AV_TARGETS.has(target) ? fit.maxBytes : 0;
  let videoKbps: number | undefined;
  if (maxBytes) {
    if (!(fit!.duration! > 0)) throw new ConvertError('fitNoDuration');
    const audioKbps = settings.videoMute || edit?.mute ? 0 : VIDEO_AUDIO_KBPS;
    videoKbps = videoKbpsFor(maxBytes, mediaSeconds(fit!.duration!, edit), audioKbps);
  }

  const ff = await acquireEngine(onDownload);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inName = `in_${stamp}.${extOf(file.name) || 'bin'}`;
  const outName = `out_${stamp}.${target}`;
  const replaceAudio = edit?.audioTrack && AV_TARGETS.has(target);
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
    // every run writes the same output name; -y overwrites instead of asking (no stdin here)
    const run = async (kbps?: number) => {
      let code = await ff.exec(['-y', ...buildArgs(target, inName, outName, settings, edit, { input2: in2Name, hasArt, videoKbps: kbps })]);
      // cover-art mapping is best-effort: retry once without it rather than fail
      if (code !== 0 && hasArt) {
        code = await ff.exec(['-y', ...buildArgs(target, inName, outName, settings, edit, { input2: in2Name, videoKbps: kbps })]);
      }
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
      const data = await ff.readFile(outName);
      if (typeof data === 'string') throw new Error('unexpected output');
      return data;
    };
    let data = await run(videoKbps);
    if (videoKbps && data.length > maxBytes) {
      // one-pass rate control can overshoot: aim lower by the overshoot ratio, once
      const lower = Math.floor(videoKbps * (maxBytes / data.length) * SIZE_MARGIN);
      if (lower < MIN_VIDEO_KBPS) throw new ConvertError('fitTooSmall');
      data = await run(lower);
      if (data.length > maxBytes) throw new ConvertError('fitTooSmall');
    }
    return new Blob([data.slice()], { type: mimeFor(target) });
  } finally {
    ff.off('progress', handler);
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    if (in2Name) { try { await ff.deleteFile(in2Name); } catch { /* ignore */ } }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
    releaseEngine(ff);
  }
}
