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

/** Project type is chosen at creation and never changes. */
export type ProjectType = 'audio' | 'image' | 'gif' | 'video' | 'pdf';

/** Image projects: persisted non-destructive object layers over a base asset. */
export interface ImageDoc {
  baseAssetId: string | null;
  /** legacy flat object list (pre-layers) — migrated on load */
  objects: unknown[];
  /** serialized ImageEditor layer stack */
  layers?: unknown[];
  /** bottom background layer colour; null = transparent */
  bg?: string | null;
}

/** Video projects: one video + a full audio mixer, aligned to the trimmed start. */
export interface VideoDoc {
  videoAssetId: string | null;
  trimStart: number;
  trimEnd: number;
  mixer: MixerDoc;
}

export interface ProjectRec {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** absent on legacy records — treat as 'audio' */
  type?: ProjectType;
  mixer: MixerDoc;
  imageDoc?: ImageDoc;
  videoDoc?: VideoDoc;
  gifAssetId?: string | null;
  /** pdf projects: the document being edited (PdfEditor writes back to this asset) */
  pdfAssetId?: string | null;
}

export interface AssetRec {
  id: string;
  projectId: string;
  name: string;
  /** 'image' | 'audio' | 'video' | 'pdf' */
  kind: string;
  blob: Blob;
  addedAt: number;
}

export const emptyMixer = (): MixerDoc => ({ tracks: [] });

export const emptyImageDoc = (): ImageDoc => ({ baseAssetId: null, objects: [] });

export const emptyVideoDoc = (): VideoDoc => ({
  videoAssetId: null,
  trimStart: 0,
  trimEnd: 0,
  mixer: emptyMixer(),
});

export const uid = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
