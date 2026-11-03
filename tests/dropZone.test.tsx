import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { DropZone } from '../src/components/DropZone';
import { ACCEPT, detectKind } from '../src/lib/formats';

afterEach(cleanup);

describe('DropZone hint', () => {
  // The hint still said "images / audio / video" long after PDFs and documents were added.
  for (const [lang, words] of [['en', ['PDF', 'documents']], ['zh', ['PDF', '文件']], ['ja', ['PDF', '文書']]] as const) {
    it(`mentions PDFs and documents in ${lang}`, () => {
      localStorage.setItem('morphkit-lang', lang);
      const { container } = render(<I18nProvider><DropZone onFiles={() => {}} /></I18nProvider>);
      const hint = container.querySelector('.dz-hint')?.textContent ?? '';
      for (const w of words) expect(hint).toContain(w);
    });
  }
});

describe('file picker accept list', () => {
  // The accept list used to be typed out by hand in DropZone and again in Studio, and both
  // missed extensions detectKind understands (.apng, .mkv, .flac, …).
  it('uses the list derived from formats.ts', () => {
    const { container } = render(<I18nProvider><DropZone onFiles={() => {}} /></I18nProvider>);
    expect(container.querySelector('input[type=file]')?.getAttribute('accept')).toBe(ACCEPT);
  });

  it('lists every extension detectKind recognises, and only those', () => {
    const exts = ACCEPT.split(',').filter((a) => a.startsWith('.'));
    for (const e of exts) expect(detectKind(new File([''], `x${e}`)), e).not.toBeNull();
    for (const e of ['.apng', '.mkv', '.flac', '.pdf', '.docx', '.pptx', '.tsv', '.json']) expect(exts).toContain(e);
  });
});
