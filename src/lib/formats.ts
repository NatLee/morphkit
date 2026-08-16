export type Kind = 'image' | 'audio' | 'video';

export const IMAGE_OUTPUTS = ['webp', 'png', 'jpeg'] as const;
export const AUDIO_OUTPUTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'] as const;
export const VIDEO_OUTPUTS = ['mp4', 'webm', 'gif', 'mp3'] as const;

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif', 'ico', 'svg'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'wma', 'aiff', 'amr'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', '3gp'];

/** Files above this size get a "may fail / be slow" warning (200 MB). */
export const LARGE_FILE_BYTES = 200 * 1024 * 1024;
/** In-browser wasm memory ceiling — beyond ~1.8 GB failure is near-certain. */
export const HUGE_FILE_BYTES = 1.8 * 1024 * 1024 * 1024;

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

export function detectKind(file: File): Kind | null {
  const t = file.type;
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  const ext = extOf(file.name);
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

export function outputsFor(kind: Kind): readonly string[] {
  if (kind === 'image') return IMAGE_OUTPUTS;
  if (kind === 'audio') return AUDIO_OUTPUTS;
  return VIDEO_OUTPUTS;
}

/** Pick a sensible default target that differs from the source format. */
export function defaultTarget(kind: Kind, file: File): string {
  const ext = extOf(file.name);
  const outs = outputsFor(kind);
  const preferred = kind === 'image' ? 'webp' : kind === 'audio' ? 'mp3' : 'mp4';
  const same = (o: string) => o === ext || (o === 'jpeg' && (ext === 'jpg' || ext === 'jpeg'));
  if (!same(preferred)) return preferred;
  return outs.find((o) => !same(o)) ?? preferred;
}

export function outputFileName(inputName: string, target: string): string {
  const base = inputName.replace(/\.[^.]+$/, '');
  const ext = target === 'jpeg' ? 'jpg' : target;
  return `${base}.${ext}`;
}

export function mimeFor(target: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'video/webm',
    gif: 'image/gif',
  };
  return map[target] ?? 'application/octet-stream';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
