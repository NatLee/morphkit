/** A clip on the mixer timeline, referencing an asset by id. */
export interface Clip {
  id: string;
  assetId: string;
  /** timeline position, seconds */
  start: number;
  /** trim offset inside the source asset, seconds */
  offset: number;
  /** seconds */
  duration: number;
  gain: number;
}

export interface Track {
  id: string;
  name: string;
  gain: number;
  muted: boolean;
  solo: boolean;
  clips: Clip[];
}

export interface MixerDoc {
  tracks: Track[];
}

export interface ProjectRec {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  mixer: MixerDoc;
}

export interface AssetRec {
  id: string;
  projectId: string;
  name: string;
  /** 'image' | 'audio' | 'video' */
  kind: string;
  blob: Blob;
  addedAt: number;
}

export const emptyMixer = (): MixerDoc => ({ tracks: [] });

export const uid = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
