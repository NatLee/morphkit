import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvertError } from '../src/lib/errors';
import { OCR_ENGINE_VERSION, ocrDownloadBytes, ocrLangs, withOcr } from '../src/lib/ocr';

// a stand-in engine: tests must never download the real one
const engine = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(async () => ({ data: { text: 'Hello 世界\n' } })),
  setParameters: vi.fn(async () => ({})),
  terminate: vi.fn(async () => ({})),
}));
vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: engine.createWorker,
}));

const STORE = 'morphkit-ocr-langs';
const canvas = () => document.createElement('canvas');

beforeEach(() => {
  localStorage.clear();
  engine.createWorker.mockImplementation(async () => ({
    recognize: engine.recognize,
    setParameters: engine.setParameters,
    terminate: engine.terminate,
  }));
});
afterEach(() => vi.clearAllMocks());

describe('ocrLangs', () => {
  it('follows the interface language on auto, and always reads English too', () => {
    expect(ocrLangs('auto', 'zh')).toEqual(['chi_tra', 'eng']);
    expect(ocrLangs('auto', 'ja')).toEqual(['jpn', 'eng']);
    expect(ocrLangs('auto', 'en')).toEqual(['eng']);
    expect(ocrLangs('kor', 'en')).toEqual(['kor', 'eng']);
  });
});

describe('ocrDownloadBytes', () => {
  // sizes: Content-Length on jsdelivr, measured 2026-11-17 (see LANG_BYTES / ENGINE_BYTES in lib/ocr)
  it('counts the engine and every language on the first run', () => {
    expect(ocrDownloadBytes(['chi_tra', 'eng'])).toBe(3_899_472 + 111_307 + 1_656_239 + 2_952_873);
  });

  it('counts only the new language once the engine is here, and nothing after that', () => {
    localStorage.setItem(STORE, JSON.stringify(['eng']));
    expect(ocrDownloadBytes(['jpn', 'eng'])).toBe(2_030_256);
    localStorage.setItem(STORE, JSON.stringify(['jpn', 'eng']));
    expect(ocrDownloadBytes(['jpn', 'eng'])).toBe(0);
  });

  it('treats a damaged record as nothing downloaded', () => {
    localStorage.setItem(STORE, '{oops');
    expect(ocrDownloadBytes(['eng'])).toBe(3_899_472 + 111_307 + 2_952_873);
  });

  // the sizes above and the download URLs belong to one tesseract.js release
  it('was measured for the installed tesseract.js', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/tesseract.js/package.json'), 'utf8'));
    expect(pkg.version).toBe(OCR_ENGINE_VERSION);
  });
});

describe('withOcr', () => {
  it('downloads nothing and asks nothing when no page needs reading', async () => {
    const consent = vi.fn(async () => true);
    expect(await withOcr(['eng'], consent, async () => 'text layer only')).toBe('text layer only');
    expect(consent).not.toHaveBeenCalled();
    expect(engine.createWorker).not.toHaveBeenCalled();
  });

  it('asks once, loads once, reads every page and closes the engine', async () => {
    const consent = vi.fn(async () => true);
    const bytes = ocrDownloadBytes(['chi_tra', 'eng']);
    const pages = await withOcr(['chi_tra', 'eng'], consent, async (read) => [await read(canvas()), await read(canvas())]);
    expect(pages).toEqual(['Hello 世界\n', 'Hello 世界\n']);
    expect(consent).toHaveBeenCalledTimes(1);
    expect(consent).toHaveBeenCalledWith(bytes, ['chi_tra', 'eng']);
    expect(engine.createWorker).toHaveBeenCalledTimes(1);
    expect(engine.terminate).toHaveBeenCalledTimes(1);
    // Chinese is written without spaces: Tesseract must not invent one between every character
    expect(engine.setParameters).toHaveBeenCalledWith({ preserve_interword_spaces: '1' });
    // remembered: the next run does not ask again
    expect(ocrDownloadBytes(['chi_tra', 'eng'])).toBe(0);
  });

  it('does not ask again once the data is in this browser', async () => {
    localStorage.setItem(STORE, JSON.stringify(['eng']));
    const consent = vi.fn(async () => true);
    await withOcr(['eng'], consent, (read) => read(canvas()));
    expect(consent).not.toHaveBeenCalled();
    expect(engine.setParameters).not.toHaveBeenCalled();
  });

  it('stops with ocrDeclined when the user says no, before any download', async () => {
    const err = await withOcr(['eng'], async () => false, (read) => read(canvas())).catch((e) => e);
    expect(err).toBeInstanceOf(ConvertError);
    expect((err as ConvertError).key).toBe('ocrDeclined');
    expect(engine.createWorker).not.toHaveBeenCalled();
    expect(ocrDownloadBytes(['eng'])).toBeGreaterThan(0);
  });

  it('reports ocrLoadFailed when the engine cannot be fetched', async () => {
    engine.createWorker.mockRejectedValueOnce(new Error('network'));
    const err = await withOcr(['eng'], async () => true, (read) => read(canvas())).catch((e) => e);
    expect((err as ConvertError).key).toBe('ocrLoadFailed');
    expect(ocrDownloadBytes(['eng'])).toBeGreaterThan(0);
  });
});
