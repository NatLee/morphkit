import type { Kind } from './lib/formats';
import type { FileMeta } from './lib/metadata';

export type Status = 'ready' | 'queued' | 'converting' | 'done' | 'error';

export interface Item {
  id: string;
  file: File;
  kind: Kind;
  target: string;
  quality: number;
  status: Status;
  progress: number;
  meta?: FileMeta;
  outUrl?: string;
  outName?: string;
  outSize?: number;
}
