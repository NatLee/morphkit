import type { Kind } from './lib/formats';
import type { FileMeta } from './lib/metadata';

export type Status = 'ready' | 'queued' | 'converting' | 'done' | 'error';

/** Conversion-time edits for audio/video, applied as ffmpeg options. */
export interface MediaEdit {
  /** seconds */
  trimStart?: number;
  /** seconds */
  trimEnd?: number;
  /** 1 = unchanged (0–2), applies to the audio track */
  volume?: number;
  /** 1 = unchanged (0.5–2) */
  speed?: number;
  /** degrees clockwise, video track only */
  rotate?: 0 | 90 | 180 | 270;
  /** video only: strip the audio track */
  mute?: boolean;
  /** video only: replace the audio track with this file (-map 0:v -map 1:a) */
  audioTrack?: File;
}

export interface Item {
  id: string;
  file: File;
  kind: Kind;
  target: string;
  quality: number;
  status: Status;
  progress: number;
  meta?: FileMeta;
  /** pending audio/video edit, applied on convert */
  edit?: MediaEdit;
  /** true when the source file was replaced by an editor (image / GIF) */
  edited?: boolean;
  outUrl?: string;
  outName?: string;
  outSize?: number;
}
