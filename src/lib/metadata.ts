import exifr from 'exifr';
import type { Kind } from './formats';

export interface FileMeta {
  width?: number;
  height?: number;
  /** seconds */
  duration?: number;
  camera?: string;
  lens?: string;
  iso?: number;
  exposure?: string;
  aperture?: string;
  focal?: string;
  taken?: string;
  gps?: { lat: number; lon: number };
}

function fmtExposure(sec: number): string {
  return sec >= 1 ? `${sec}s` : `1/${Math.round(1 / sec)}s`;
}

async function imageMeta(file: File): Promise<FileMeta> {
  const meta: FileMeta = {};
  try {
    const bmp = await createImageBitmap(file);
    meta.width = bmp.width;
    meta.height = bmp.height;
    bmp.close();
  } catch { /* undecodable in this browser — skip dims */ }

  // EXIF / GPS (JPEG, TIFF, HEIC…) — mature fixed format, parsed by exifr
  try {
    const exif = await exifr.parse(file, { gps: true });
    if (exif) {
      const make = typeof exif.Make === 'string' ? exif.Make.trim() : '';
      const model = typeof exif.Model === 'string' ? exif.Model.trim() : '';
      if (make || model) {
        meta.camera = model.toLowerCase().startsWith(make.toLowerCase())
          ? model
          : `${make} ${model}`.trim();
      }
      if (typeof exif.LensModel === 'string') meta.lens = exif.LensModel;
      if (typeof exif.ISO === 'number') meta.iso = exif.ISO;
      if (typeof exif.ExposureTime === 'number') meta.exposure = fmtExposure(exif.ExposureTime);
      if (typeof exif.FNumber === 'number') meta.aperture = `f/${exif.FNumber}`;
      if (typeof exif.FocalLength === 'number') meta.focal = `${exif.FocalLength}mm`;
      if (exif.DateTimeOriginal instanceof Date) meta.taken = exif.DateTimeOriginal.toLocaleString();
      if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
        meta.gps = { lat: exif.latitude, lon: exif.longitude };
      }
    }
  } catch { /* no EXIF — fine */ }
  return meta;
}

function mediaMeta(file: File, kind: 'audio' | 'video'): Promise<FileMeta> {
  return new Promise((resolve) => {
    const meta: FileMeta = {};
    const el = document.createElement(kind) as HTMLVideoElement;
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) meta.duration = el.duration;
      if (kind === 'video' && el.videoWidth) {
        meta.width = el.videoWidth;
        meta.height = el.videoHeight;
      }
      done();
    };
    el.onerror = done;
    window.setTimeout(done, 4000);
    el.src = url;
  });
}

export function extractMeta(file: File, kind: Kind): Promise<FileMeta> {
  return kind === 'image' ? imageMeta(file) : mediaMeta(file, kind);
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
