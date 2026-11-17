import { outputsFor, type Kind } from './formats';
import { effectiveSettings, withOption } from './settingFields';
import type { SqueezeLevel } from './pdfTools';
import type { Settings } from './settings';
import type { Item } from '../types';

/**
 * "I want to…": the jobs people come for, as one list. The home page shows all of it (search +
 * filter by file type) and every file card shows the ones marked `suggest` for its kind. A task
 * names nothing new — it is a preset over what the app already does:
 *   convert → an output format and/or per-file options (Item.target / Item.opts)
 *   editor  → opens the file's editor; for PDFs optionally straight at an export option
 *   batch   → works on the whole list (merge)
 *   tool    → a stand-alone tool (QR)
 * A new feature becomes discoverable by adding one entry here plus its two strings.
 */
export type TaskRun = 'convert' | 'editor' | 'batch' | 'tool';
/** The file kind a task is for; `other` = needs no file. */
export type TaskKind = Kind | 'other';
/** PDF editor export options a task can switch on (see PdfEditor `exportPreset`). */
export interface PdfExportPreset {
  numbers?: boolean;
  squeeze?: SqueezeLevel;
  encrypt?: boolean;
}

export interface Task {
  id: string;
  kind: TaskKind;
  run: TaskRun;
  /** convert: the output format it selects (absent = keep the file's own) */
  target?: string;
  /** convert: per-file options it sets */
  opts?: Partial<Settings>;
  /** editor (PDF): open the export dialog with this switched on */
  pdfExport?: PdfExportPreset;
  /** offered on file cards of this kind (at most CARD_SUGGESTIONS, in list order) */
  suggest?: boolean;
}

/** Suggestions one card shows: enough to be useful, few enough to stay on one line. */
export const CARD_SUGGESTIONS = 3;

/** Strings: `task_<id>` is the name, `task_<id>_d` the one-line description. */
export const TASKS: readonly Task[] = [
  // ---- images ----
  { id: 'ocr', kind: 'image', run: 'convert', target: 'txt', suggest: true },
  { id: 'img200', kind: 'image', run: 'convert', target: 'jpeg', opts: { imageTargetSize: 200e3 }, suggest: true },
  { id: 'ico', kind: 'image', run: 'convert', target: 'ico', suggest: true },
  { id: 'webp', kind: 'image', run: 'convert', target: 'webp' },
  { id: 'img2pdf', kind: 'image', run: 'convert', target: 'pdf' },
  { id: 'annotate', kind: 'image', run: 'editor' },
  // ---- audio ----
  { id: 'mp3', kind: 'audio', run: 'convert', target: 'mp3' },
  { id: 'loud', kind: 'audio', run: 'convert', opts: { audioLoudness: -16 }, suggest: true },
  { id: 'trim', kind: 'audio', run: 'editor', suggest: true },
  // ---- video ----
  { id: 'v2mp3', kind: 'video', run: 'convert', target: 'mp3', suggest: true },
  { id: 'v25', kind: 'video', run: 'convert', target: 'mp4', opts: { videoTargetSize: 25e6 }, suggest: true },
  { id: 'v2gif', kind: 'video', run: 'convert', target: 'gif', suggest: true },
  { id: 'vcut', kind: 'video', run: 'editor' },
  // ---- PDF ----
  { id: 'pnum', kind: 'pdf', run: 'editor', pdfExport: { numbers: true }, suggest: true },
  { id: 'psqueeze', kind: 'pdf', run: 'editor', pdfExport: { squeeze: 'light' }, suggest: true },
  { id: 'ptxt', kind: 'pdf', run: 'convert', target: 'txt', suggest: true },
  { id: 'pmerge', kind: 'pdf', run: 'batch' },
  { id: 'pimg', kind: 'pdf', run: 'convert', target: 'png' },
  { id: 'ppages', kind: 'pdf', run: 'editor' },
  { id: 'plock', kind: 'pdf', run: 'editor', pdfExport: { encrypt: true } },
  // ---- documents ----
  { id: 'd2pdf', kind: 'doc', run: 'convert', target: 'pdf' },
  { id: 'sheet2csv', kind: 'doc', run: 'convert', target: 'csv', suggest: true },
  // ---- tools ----
  { id: 'qr', kind: 'other', run: 'tool' },
];

export const taskById = (id: string | null | undefined): Task | undefined => TASKS.find((t) => t.id === id);

/** Can this task be done to this file? (same kind, and the output is one the file can become) */
export function taskFits(task: Task, kind: Kind, file: File): boolean {
  if (task.kind !== kind) return false;
  return !task.target || outputsFor(kind, file).includes(task.target);
}

/** The suggestions a file card shows. */
export function suggestionsFor(kind: Kind, file: File): Task[] {
  return TASKS.filter((t) => t.suggest && taskFits(t, kind, file)).slice(0, CARD_SUGGESTIONS);
}

/** Is this convert task what the file is set to do right now? (derived — no stored "chosen task") */
export function taskActive(task: Task, item: Pick<Item, 'target' | 'opts'>, defaults: Settings): boolean {
  if (task.run !== 'convert') return false;
  if (task.target && item.target !== task.target) return false;
  const eff = effectiveSettings(defaults, item.opts);
  return Object.entries(task.opts ?? {}).every(([k, v]) => eff[k as keyof Settings] === v);
}

/**
 * The target and options a file has after a convert task is applied. Applying an active task
 * again takes its options back out (the format stays: there is no "previous" one to return to).
 */
export function applyTask(task: Task, item: Pick<Item, 'target' | 'opts'>, defaults: Settings): Pick<Item, 'target' | 'opts'> {
  const undo = taskActive(task, item, defaults) && !!task.opts;
  let opts = item.opts;
  for (const [k, v] of Object.entries(task.opts ?? {})) {
    const key = k as keyof Settings;
    opts = withOption(defaults, opts, key, undo ? defaults[key] : v);
  }
  return { target: task.target ?? item.target, opts };
}

/** Tasks matching the home page's search box and kind filter. `text` = the task's shown strings. */
export function filterTasks(query: string, kind: TaskKind | 'all', text: (task: Task) => string): Task[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return TASKS.filter((t) => {
    if (kind !== 'all' && t.kind !== kind) return false;
    const hay = `${text(t)} ${t.target ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
