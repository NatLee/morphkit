import {
  AUDIO_OUTPUTS, DOC_OUTPUTS, EXTENSIONS, KINDS, PDF_TEXT_OUTPUTS, RASTER_OUTPUTS, SAME_FORMAT,
  docTypeOf, outputsFor, type DocType, type Kind,
} from './formats';
import { fieldsFor } from './settingFields';
import { filterTasks, TASKS, type Task } from './tasks';

/**
 * Everything the home page's format panel shows, worked out from the registries the converter
 * itself uses: which extensions open as which kind (`EXTENSIONS`), what each can become
 * (`outputsFor` / `DOC_OUTPUTS`), which settings change that conversion (`fieldsFor`) and which
 * "I want to…" jobs go with it (`TASKS`). Nothing here is a second list to keep in step: a new
 * format, output, setting or task shows up in the panel by itself.
 */

/** Documents split by what they are: each sub-type has its own outputs. */
export const DOC_TYPES: readonly DocType[] = Object.keys(DOC_OUTPUTS) as DocType[];

/** One way in: a kind (for documents, a sub-type), the formats that open as it, what it becomes. */
export interface FormatRow {
  kind: Kind;
  doc?: DocType;
  /** format names, other spellings of the same format merged (jpeg → jpg) */
  inputs: string[];
  outputs: readonly string[];
}

const formatName = (ext: string) => SAME_FORMAT[ext] ?? ext;
const unique = <T,>(list: readonly T[]) => [...new Set(list)];

/** The formats that open as a kind, or as one document sub-type. */
export function inputsOf(kind: Kind, doc?: DocType): string[] {
  const exts = kind === 'doc' && doc ? EXTENSIONS.doc.filter((e) => docTypeOf({ name: `x.${e}` }) === doc) : EXTENSIONS[kind];
  return unique(exts.map(formatName));
}

/** What a kind (a document sub-type) can become — the same lists the file cards offer. */
export function outputsOf(kind: Kind, doc?: DocType): readonly string[] {
  return kind === 'doc' ? DOC_OUTPUTS[doc ?? 'docx'] : outputsFor(kind);
}

/** Every row of the overview, in the app's kind order; documents one row per sub-type. */
export function formatRows(): FormatRow[] {
  return KINDS.flatMap(({ kind }): FormatRow[] =>
    kind === 'doc'
      ? DOC_TYPES.map((doc) => ({ kind, doc, inputs: inputsOf(kind, doc), outputs: outputsOf(kind, doc) }))
      : [{ kind, inputs: inputsOf(kind), outputs: outputsOf(kind) }]
  );
}

/** The overview's columns: every output, in the order the rows first name them. */
export function allOutputs(rows: readonly FormatRow[] = formatRows()): string[] {
  return unique(rows.flatMap((r) => r.outputs));
}

/**
 * What a conversion needs before it can run, mirroring runConvert's branches: audio and video go
 * through ffmpeg (a one-time engine download), image → text through OCR (asks first), PDF → text
 * reads the text layer and uses OCR only for scanned pages, document → PDF fetches the CJK font
 * pieces it uses. Everything else is done by the browser alone.
 */
export type Needs = 'browser' | 'engine' | 'ocr' | 'ocrScans' | 'fonts';
export function needsFor(kind: Kind, target: string): Needs {
  if (kind === 'audio' || kind === 'video') return 'engine';
  if (kind === 'image' && target === 'txt') return 'ocr';
  if (kind === 'pdf' && PDF_TEXT_OUTPUTS.has(target)) return 'ocrScans';
  if (kind === 'doc' && target === 'pdf') return 'fonts';
  return 'browser';
}

/**
 * The one-line description of a conversion: an i18n key. A few outputs mean something particular for
 * a kind (an image to text is OCR, a video to MP3 keeps only the sound, a PDF to PNG is one picture
 * per page); everything else is described by the output format alone (`fmt_<target>`).
 */
export function describeKey(kind: Kind, target: string): string {
  if (kind === 'video' && (AUDIO_OUTPUTS as readonly string[]).includes(target)) return 'fmtSoundOnly';
  if (kind === 'image' && target === 'txt') return 'fmtOcr';
  if (kind === 'image' && target === 'pdf') return 'fmtImagePdf';
  if (kind === 'pdf' && RASTER_OUTPUTS.has(target)) return 'fmtPdfPages';
  if (kind === 'pdf' && PDF_TEXT_OUTPUTS.has(target)) return 'fmtPdfText';
  if (kind === 'pdf' && target === 'pdf') return 'fmtPdfResave';
  if (kind === 'doc' && target === 'png') return 'fmtDocPages';
  if (kind === 'doc' && target === 'pdf') return 'fmtDocPdf';
  return `fmt_${target}`;
}

/** The settings that change this conversion (their label keys), as on a file card. */
export function optionsFor(kind: Kind, target: string): string[] {
  return fieldsFor(kind, target).map((f) => f.labelKey);
}

/** The "I want to…" jobs for a kind; with a target, only those that end in that format. */
export function tasksFor(kind: Kind, target?: string, doc?: DocType): Task[] {
  const outs = outputsOf(kind, doc);
  return TASKS.filter((t) => t.kind === kind && (target ? t.target === target : !t.target || outs.includes(t.target)));
}

/** A search hit: a format that opens, a format to convert to, or a job. */
export type FormatHit =
  | { type: 'input'; kind: Kind; doc?: DocType; format: string }
  | { type: 'output'; kind: Kind; doc?: DocType; format: string }
  | { type: 'task'; task: Task };

/**
 * The panel's search box. Typing an extension finds where it opens and what it converts to;
 * typing words finds jobs (by their shown name and description, `text`).
 */
export function searchFormats(query: string, text: (task: Task) => string): FormatHit[] {
  const q = query.trim().toLowerCase().replace(/^\./, '');
  if (!q) return [];
  const hits: FormatHit[] = [];
  const seenOut = new Set<string>();
  for (const row of formatRows()) {
    for (const format of row.inputs) if (format.includes(q) || EXTENSIONS[row.kind].some((e) => formatName(e) === format && e.includes(q))) hits.push({ type: 'input', kind: row.kind, doc: row.doc, format });
  }
  for (const row of formatRows()) {
    for (const format of row.outputs) {
      const key = `${row.kind}:${format}`;
      if (seenOut.has(key) || !(format.includes(q) || (format === 'jpeg' && 'jpg'.includes(q)))) continue;
      seenOut.add(key); // documents: one hit per kind and output, at the first sub-type that has it
      hits.push({ type: 'output', kind: row.kind, doc: row.doc, format });
    }
  }
  for (const task of filterTasks(query, 'all', text)) hits.push({ type: 'task', task });
  return hits;
}
