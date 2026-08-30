export interface Settings {
  /** Parallel conversion workers (each spawns its own ffmpeg.wasm instance). */
  concurrency: number;
  /** Image: longest-edge cap in px. 0 = keep original size. */
  imageMaxDim: number;
  audioBitrate: '128k' | '192k' | '256k' | '320k';
  /** Audio: 'cbr' pins the bitrate, 'vbr' hands the encoder a quality target. */
  audioRateMode: 'cbr' | 'vbr';
  /** VBR quality on the LAME scale: 0 = best (~245 kbps) … 9 = smallest. */
  audioQuality: number;
  /** Audio: output sample rate in Hz. 0 = keep original. */
  audioSampleRate: number;
  /** Audio: 0 = keep original, 1 = mono, 2 = stereo. */
  audioChannels: 0 | 1 | 2;
  /** x264 CRF — lower is better quality, bigger file. */
  videoCrf: number;
  /** x264 encoder preset — slower compresses better. */
  videoPreset: 'veryfast' | 'fast' | 'medium';
  /** Video: max output height in px (keeps aspect). 0 = original. */
  videoMaxH: number;
  /** Video: max output frame rate. 0 = original. */
  videoFps: number;
  /** Video: strip the audio track. */
  videoMute: boolean;
  gifFps: number;
  gifWidth: number;
  /** copy title/artist/album… into the output (ffmpeg -map_metadata) */
  keepMetadata: boolean;
  /** documents → PDF: embed CJK fonts (selectable text; downloads subsets once) vs raster pages */
  docPdfText: boolean;
  /** carry embedded cover art across audio formats that support it */
  keepCoverArt: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  concurrency: 2,
  imageMaxDim: 0,
  audioBitrate: '192k',
  audioRateMode: 'cbr',
  audioQuality: 2,
  audioSampleRate: 0,
  audioChannels: 0,
  videoCrf: 23,
  videoPreset: 'veryfast',
  videoMaxH: 0,
  videoFps: 0,
  videoMute: false,
  gifFps: 12,
  gifWidth: 480,
  keepMetadata: true,
  docPdfText: true,
  keepCoverArt: true,
};

const KEY = 'morphkit-settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
