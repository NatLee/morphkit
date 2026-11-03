import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { DropZone } from '../src/components/DropZone';

afterEach(cleanup);

describe('DropZone hint', () => {
  // The hint still said "images / audio / video" long after PDFs and documents were added.
  for (const [lang, words] of [['en', ['PDF', 'documents']], ['zh', ['PDF', '文件']], ['ja', ['PDF', '文書']]] as const) {
    it(`mentions PDFs and documents in ${lang}`, () => {
      localStorage.setItem('morphkit-lang', lang);
      const { container } = render(<I18nProvider><DropZone onFiles={() => {}} /></I18nProvider>);
      const hint = container.querySelector('.dz-hint')?.textContent ?? '';
      for (const w of words) expect(hint).toContain(w);
      const accept = container.querySelector('input[type=file]')?.getAttribute('accept') ?? '';
      expect(accept).toContain('.pdf');
      expect(accept).toContain('.docx');
    });
  }
});
