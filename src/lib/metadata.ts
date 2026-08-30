import exifr from 'exifr';
import { extOf, type Kind } from './formats';

export interface FileMeta {
  width?: number;
  height?: number;
  /** seconds */
  duration?: number;
  /** e.g. "image/png" */
  mime?: string;
  /** file last-modified, localized */
  modified?: string;
  /** e.g. "12.2 MP" (images) */
  mp?: string;
  /** e.g. "16:9" */
  aspect?: string;
  /** e.g. "1,320 kbps" (audio/video, estimated from size) */
  bitrate?: string;
  /** thumbnail — object URL for images (GIFs stay animated), dataURL frame-grab for video */
  preview?: string;
  /** audio tags (ID3 / MP4) */
  title?: string;
  artist?: string;
  album?: string;
  hasCover?: boolean;
  camera?: string;
  lens?: string;
  iso?: number;
  exposure?: string;
  aperture?: string;
  focal?: string;
  taken?: string;
  gps?: { lat: number; lon: number };
  /** PDF: page count + document author (title reuses `title`) */
  pages?: number;
  author?: string;
}

function fmtExposure(sec: number): string {
  return sec >= 1 ? `${sec}s` : `1/${Math.round(1 / sec)}s`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectOf(w: number, h: number): string {
  const g = gcd(w, h);
  const a = w / g;
  const b = h / g;
  if (a > 40 || b > 40) return `${(w / h).toFixed(2)}:1`;
  return `${a}:${b}`;
}

function commonMeta(file: File): FileMeta {
  return {
    mime: file.type || extOf(file.name).toUpperCase(),
    modified: new Date(file.lastModified).toLocaleString(),
  };
}

async function imageMeta(file: File): Promise<FileMeta> {
  const meta = commonMeta(file);
  meta.preview = URL.createObjectURL(file);
  try {
    const bmp = await createImageBitmap(file);
    meta.width = bmp.width;
    meta.height = bmp.height;
    meta.mp = `${(bmp.width * bmp.height / 1e6).toFixed(1)} MP`;
    meta.aspect = aspectOf(bmp.width, bmp.height);
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

/**
 * Minimal tag sniffer for the details panel: ID3v2 text frames (mp3) and the
 * MP4 `ilst` atoms (m4a). Full parsing is ffmpeg's job — this is display only.
 */
async function readAudioTags(file: File): Promise<Partial<FileMeta>> {
  try {
    const head = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
    const s = new TextDecoder('latin1').decode(head);
    const out: Partial<FileMeta> = {};
    out.hasCover = s.includes('APIC') || s.includes('covr') || (s.startsWith('fLaC') && s.includes('image/'));

    const clean = (v: string) => v.replace(/[\x00-\x1f]/g, '').trim();
    // ID3v2: frame id + 4-byte size + 2-byte flags, text frames start with an encoding byte
    const id3 = (frame: string): string | undefined => {
      const i = s.indexOf(frame);
      if (i < 0 || i + 10 > s.length) return undefined;
      const size = (head[i + 4] << 21) | (head[i + 5] << 14) | (head[i + 6] << 7) | head[i + 7];
      if (size <= 1 || size > 400) return undefined;
      const raw = head.slice(i + 11, i + 10 + size);
      const enc = head[i + 10];
      const text = enc === 1 || enc === 2
        ? new TextDecoder('utf-16').decode(raw)
        : new TextDecoder('utf-8').decode(raw);
      const v = clean(text);
      return v || undefined;
    };
    // MP4: ©nam / ©ART / ©alb → data atom, payload starts 16 bytes in
    const mp4 = (atom: string): string | undefined => {
      const i = s.indexOf(atom);
      if (i < 0) return undefined;
      const j = s.indexOf('data', i);
      if (j < 0 || j - i > 40) return undefined;
      const size = (head[j - 4] << 24) | (head[j - 3] << 16) | (head[j - 2] << 8) | head[j - 1];
      if (size <= 16 || size > 400) return undefined;
      const v = clean(new TextDecoder('utf-8').decode(head.slice(j + 12, j - 4 + size)));
      return v || undefined;
    };

    out.title = id3('TIT2') ?? mp4('©nam');
    out.artist = id3('TPE1') ?? mp4('©ART');
    out.album = id3('TALB') ?? mp4('©alb');
    return out;
  } catch {
    return {};
  }
}

function mediaMeta(file: File, kind: 'audio' | 'video'): Promise<FileMeta> {
  return new Promise((resolve) => {
    const meta = commonMeta(file);
    const el = document.createElement(kind) as HTMLVideoElement;
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    el.preload = kind === 'video' ? 'auto' : 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        meta.duration = el.duration;
        meta.bitrate = `${Math.round(file.size * 8 / el.duration / 1000).toLocaleString()} kbps`;
      }
      if (kind === 'video' && el.videoWidth) {
        meta.width = el.videoWidth;
        meta.height = el.videoHeight;
        meta.aspect = aspectOf(el.videoWidth, el.videoHeight);
        // grab a frame near the start for the list thumbnail
        el.currentTime = Math.min(0.5, (el.duration || 1) * 0.1);
      } else {
        done();
      }
    };
    el.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        const scale = 180 / el.videoWidth;
        c.width = 180;
        c.height = Math.max(1, Math.round(el.videoHeight * scale));
        c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
        meta.preview = c.toDataURL('image/jpeg', 0.72);
      } catch { /* tainted or unsupported — no thumbnail */ }
      done();
    };
    el.onerror = done;
    window.setTimeout(done, 5000);
    el.src = url;
  });
}

/** PDF: page count, first-page size (points), Title/Author, 180px JPEG thumb of page 1. */
async function pdfMeta(file: File): Promise<FileMeta> {
  const meta = commonMeta(file);
  meta.mime = 'application/pdf';
  try {
    const { openPdf, closePdf, pdfInfo, renderPage } = await import('./pdf');
    const doc = await openPdf(await file.arrayBuffer());
    const info = await pdfInfo(doc);
    meta.pages = info.pages;
    meta.width = Math.round(info.width);
    meta.height = Math.round(info.height);
    meta.aspect = aspectOf(meta.width, meta.height);
    meta.title = info.title;
    meta.author = info.author;
    const c = await renderPage(doc, 0, { width: 180 });
    meta.preview = c.toDataURL('image/jpeg', 0.82);
    c.width = c.height = 0;
    await closePdf(doc);
  } catch { /* corrupt / encrypted — card shows the generic icon */ }
  return meta;
}

export async function extractMeta(file: File, kind: Kind): Promise<FileMeta> {
  if (kind === 'image') return imageMeta(file);
  if (kind === 'pdf') return pdfMeta(file);
  const meta = await mediaMeta(file, kind);
  if (kind === 'audio') Object.assign(meta, await readAudioTags(file));
  return meta;
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
