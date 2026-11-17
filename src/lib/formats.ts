export type Kind = 'image' | 'audio' | 'video' | 'pdf' | 'doc';
/** Every kind, in the order the app lists them, with its name (i18n key) and signal colour (CSS token). */
export const KINDS: ReadonlyArray<{ kind: Kind; nameKey: string; color: string }> = [
  { kind: 'image', nameKey: 'kindImage', color: 'var(--paint-green)' },
  { kind: 'audio', nameKey: 'kindAudio', color: 'var(--paint-blue)' },
  { kind: 'video', nameKey: 'kindVideo', color: 'var(--paint-red)' },
  { kind: 'pdf', nameKey: 'kindPdf', color: 'var(--paint-violet)' },
  { kind: 'doc', nameKey: 'kindDoc', color: 'var(--accent)' },
];

/** `ico` = a multi-size icon (favicon), see `convertToIco`; `txt` = the text in the picture (OCR, lib/ocr). */
export const IMAGE_OUTPUTS = ['webp', 'png', 'jpeg', 'apng', 'gif', 'pdf', 'ico', 'txt'] as const;
/** Image outputs that take seconds, not milliseconds: they wait for a worker slot like media jobs. */
export const SLOW_IMAGE_OUTPUTS: ReadonlySet<string> = new Set(['pdf', 'txt']);
export const AUDIO_OUTPUTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a'] as const;
/** A video can become any audio format: the sound track goes through the same ffmpeg branches. */
export const VIDEO_OUTPUTS = ['mp4', 'webm', 'gif', ...AUDIO_OUTPUTS] as const;
/** The outputs drawn on a canvas — the ones a pixel cap, a size target or a render scale can change. */
export const RASTER_OUTPUTS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp']);
/** PDF outputs made from the page text (read by OCR where a page has none). */
export const PDF_TEXT_OUTPUTS: ReadonlySet<string> = new Set(['txt', 'docx', 'md', 'html']);
/** PDF: rasterize pages (multi-page → ZIP), extract text, or re-save (after editing). */
export const PDF_OUTPUTS = ['png', 'jpeg', 'webp', 'txt', 'docx', 'md', 'html', 'pdf'] as const;

/** Documents: outputs depend on the SOURCE format — see `docOutputs`. */
export const DOC_TEXT_EXT = ['docx', 'pptx', 'txt', 'md', 'markdown', 'html', 'htm'] as const;
export const DOC_SHEET_EXT = ['csv', 'tsv', 'xlsx', 'xls', 'ods'] as const;
const DOC_EXT: readonly string[] = [...DOC_TEXT_EXT, ...DOC_SHEET_EXT, 'json'];
const DOC_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/plain', 'text/markdown', 'text/html', 'text/csv', 'text/tab-separated-values', 'application/json',
]);

/** Normalised document sub-type used by lib/docs.ts. */
export type DocType = 'docx' | 'pptx' | 'text' | 'md' | 'html' | 'sheet' | 'json';
export function docTypeOf(file: File): DocType {
  const ext = extOf(file.name);
  if (ext === 'docx') return 'docx';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'json') return 'json';
  if ((DOC_SHEET_EXT as readonly string[]).includes(ext)) return 'sheet';
  return 'text';
}
/** documents that edit as text/markdown — the only ones Studio text projects accept */
export function isTextDoc(file: File): boolean {
  const t = docTypeOf(file);
  return t === 'md' || t === 'text' || t === 'html' || t === 'json';
}

/** Output list per document sub-type; the first entry is the default target. */
export const DOC_OUTPUTS: Readonly<Record<DocType, readonly string[]>> = {
  docx: ['pdf', 'html', 'md', 'txt', 'pptx', 'png'],
  pptx: ['pdf', 'docx', 'md', 'html', 'txt', 'png'],
  md: ['pdf', 'html', 'docx', 'pptx', 'txt', 'png'],
  html: ['pdf', 'md', 'docx', 'pptx', 'txt', 'png'],
  sheet: ['xlsx', 'csv', 'json', 'html', 'md', 'pdf'],
  json: ['csv', 'xlsx', 'md', 'html', 'pdf'],
  text: ['pdf', 'docx', 'md', 'html', 'pptx', 'png'],
};

/** Output list for a document, by its sub-type. */
export function docOutputs(file: File): readonly string[] {
  return DOC_OUTPUTS[docTypeOf(file)];
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'apng', 'avif', 'ico', 'svg'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'wma', 'aiff', 'amr'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', '3gp'];
const PDF_EXT = ['pdf'];

/** `accept` for every file picker that feeds `detectKind`: the MIME families it trusts plus every
    extension it recognises, so the picker never hides a file the app could open. */
export const ACCEPT = ['image/*', 'audio/*', 'video/*', 'application/pdf',
  ...[...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT, ...PDF_EXT, ...DOC_EXT].map((e) => `.${e}`)].join(',');

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
  if (t === 'application/pdf') return 'pdf';
  const ext = extOf(file.name);
  if (PDF_EXT.includes(ext)) return 'pdf';
  // documents: extension first (browsers often report text/plain for .md/.csv), then MIME
  if (DOC_EXT.includes(ext)) return 'doc';
  if (DOC_MIME.has(t) && ext) return 'doc';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

/** `file` is required for documents (their outputs depend on the source sub-type). */
export function outputsFor(kind: Kind, file?: File): readonly string[] {
  if (kind === 'image') return IMAGE_OUTPUTS;
  if (kind === 'audio') return AUDIO_OUTPUTS;
  if (kind === 'pdf') return PDF_OUTPUTS;
  if (kind === 'doc') return file ? docOutputs(file) : ['pdf'];
  return VIDEO_OUTPUTS;
}

/** Pick a sensible default target that differs from the source format. */
export function defaultTarget(kind: Kind, file: File): string {
  const ext = extOf(file.name);
  const outs = outputsFor(kind, file);
  if (kind === 'doc') return outs[0];
  // animated sources default to the animation-preserving twin format
  if (kind === 'image' && ext === 'gif') return 'apng';
  if (kind === 'image' && ext === 'apng') return 'gif';
  const preferred =
    kind === 'image' ? 'webp' : kind === 'audio' ? 'mp3' : kind === 'pdf' ? 'png' : 'mp4';
  // (doc handled above)
  const same = (o: string) => o === ext || (o === 'jpeg' && (ext === 'jpg' || ext === 'jpeg'));
  if (!same(preferred)) return preferred;
  return outs.find((o) => !same(o)) ?? preferred;
}

/** How a format is written for people: upper case, and jpeg as the familiar JPG. */
export function formatLabel(format: string): string {
  return format === 'jpeg' ? 'JPG' : format.toUpperCase();
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
    apng: 'image/apng',
    ico: 'image/x-icon',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'video/webm',
    gif: 'image/gif',
    pdf: 'application/pdf',
    txt: 'text/plain',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    json: 'application/json',
    md: 'text/markdown',
    html: 'text/html',
  };
  return map[target] ?? 'application/octet-stream';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
