export interface Settings {
  /** Parallel conversion workers (each spawns its own ffmpeg.wasm instance). */
  concurrency: number;
  audioBitrate: '128k' | '192k' | '256k' | '320k';
  /** x264/vpx CRF — lower is better quality, bigger file. */
  videoCrf: number;
  gifFps: number;
  gifWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  concurrency: 2,
  audioBitrate: '192k',
  videoCrf: 23,
  gifFps: 12,
  gifWidth: 480,
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
