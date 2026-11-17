import type { Lang } from '../i18n';
import { ConvertError } from './errors';

/**
 * Text recognition (OCR) with tesseract.js, imported lazily. Nothing is fetched until a file
 * actually needs reading, and the first download waits for the user's yes (`consent`).
 * tesseract.js fetches from its default locations: the worker and the SIMD LSTM core from the
 * tesseract.js / tesseract.js-core packages, the language data from @tesseract.js-data/<lang>/
 * 4.0.0_best_int — all on `OCR_HOST`. It keeps the language data in IndexedDB afterwards.
 */

/** The languages on offer, by Tesseract code, each named in its own language. */
export const OCR_LANGS = {
  eng: 'English',
  chi_tra: '繁體中文',
  chi_sim: '简体中文',
  jpn: '日本語',
  kor: '한국어',
} as const;
export type OcrLang = keyof typeof OCR_LANGS;
/** The setting: one language, or `auto` = the interface language. */
export type OcrLangSetting = 'auto' | OcrLang;

/** What `auto` reads for each interface language. */
const AUTO_LANG: Record<Lang, OcrLang> = { zh: 'chi_tra', en: 'eng', ja: 'jpn' };
/** Scripts written without spaces: Tesseract would put one between every character. */
const NO_SPACE_LANGS: ReadonlySet<OcrLang> = new Set(['chi_tra', 'chi_sim', 'jpn']);

/** Where every OCR download comes from (named in the consent dialog, cached by the service worker). */
export const OCR_HOST = 'cdn.jsdelivr.net';

/**
 * Download sizes in bytes, for the consent dialog: Content-Length on OCR_HOST, measured on
 * 2026-11-17 for tesseract.js 7.0.0 (tesseract-core-simd-lstm.wasm.js + worker.min.js) and the
 * 4.0.0_best_int language files. tests/ocr.test.ts fails when the installed version moves on.
 */
export const OCR_ENGINE_VERSION = '7.0.0';
const ENGINE_BYTES = 3_899_472 + 111_307;
const LANG_BYTES: Record<OcrLang, number> = {
  eng: 2_952_873,
  chi_tra: 1_656_239,
  chi_sim: 1_718_768,
  jpn: 2_030_256,
  kor: 1_572_336,
};

/** The languages one run reads: the chosen one, plus English (mixed text is the norm). */
export function ocrLangs(setting: OcrLangSetting, ui: Lang): OcrLang[] {
  const main = setting === 'auto' ? AUTO_LANG[ui] : setting;
  return main === 'eng' ? ['eng'] : [main, 'eng'];
}

/** Languages this browser has already downloaded (the engine comes with the first of them). */
const STORE = 'morphkit-ocr-langs';
function downloaded(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function remember(langs: readonly OcrLang[]) {
  try { localStorage.setItem(STORE, JSON.stringify([...new Set([...downloaded(), ...langs])])); } catch { /* ignore */ }
}

/** Bytes a first run with these languages downloads; 0 once they are in this browser. */
export function ocrDownloadBytes(langs: readonly OcrLang[]): number {
  const have = downloaded();
  const missing = langs.filter((l) => !have.has(l));
  if (!missing.length) return 0;
  return (have.size ? 0 : ENGINE_BYTES) + missing.reduce((sum, l) => sum + LANG_BYTES[l], 0);
}

/** Asked before the first download; resolve false to cancel the conversion. */
export type OcrConsent = (bytes: number, langs: readonly OcrLang[]) => Promise<boolean>;
/** Reads the text in one picture. */
export type OcrRead = (image: HTMLCanvasElement) => Promise<string>;

/**
 * Runs `fn` with a reader that starts Tesseract on its first call — so a run that never reads
 * (a PDF that has a text layer) downloads nothing. That first call asks `consent` when a download
 * is due (no → ConvertError('ocrDeclined')); the worker is closed when `fn` ends.
 */
export async function withOcr<T>(
  langs: readonly OcrLang[],
  consent: OcrConsent,
  fn: (read: OcrRead) => Promise<T>,
  /** 0–1 while a picture is being read (loading the engine reports nothing) */
  onReading?: (p: number) => void
): Promise<T> {
  type Worker = import('tesseract.js').Worker;
  // held in an object: the reader below assigns it, which narrowing in `finally` cannot see
  const engine: { worker: Promise<Worker> | null } = { worker: null };
  const start = async (): Promise<Worker> => {
    const bytes = ocrDownloadBytes(langs);
    if (bytes && !(await consent(bytes, langs))) throw new ConvertError('ocrDeclined');
    try {
      const { createWorker, OEM } = await import('tesseract.js');
      const w = await createWorker([...langs], OEM.LSTM_ONLY, {
        logger: (m) => { if (m.status === 'recognizing text') onReading?.(m.progress); },
      });
      if (langs.some((l) => NO_SPACE_LANGS.has(l))) await w.setParameters({ preserve_interword_spaces: '1' });
      remember(langs);
      return w;
    } catch {
      throw new ConvertError('ocrLoadFailed'); // offline, or the CDN refused
    }
  };
  try {
    return await fn(async (image) => {
      engine.worker ??= start();
      const w = await engine.worker;
      return (await w.recognize(image)).data.text;
    });
  } finally {
    if (engine.worker) await engine.worker.then((w) => w.terminate(), () => undefined);
  }
}

/**
 * Image → plain text. The picture is flattened onto white first: Tesseract reads a transparent
 * background as black, which swallows dark text. Nothing found → ConvertError('ocrNoText').
 */
export async function imageToText(
  file: File,
  langs: readonly OcrLang[],
  consent: OcrConsent,
  onProgress?: (p: number) => void
): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('decode');
  });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  try {
    const text = (await withOcr(langs, consent, (read) => read(canvas), onProgress)).trim();
    if (!text) throw new ConvertError('ocrNoText');
    return new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
  } finally {
    canvas.width = canvas.height = 0;
  }
}
