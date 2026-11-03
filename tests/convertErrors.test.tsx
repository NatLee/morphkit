import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { FileCard } from '../src/components/FileCard';
import { ConvertError } from '../src/lib/errors';
import { joinPageText } from '../src/lib/pdf';
import type { Item } from '../src/types';

afterEach(cleanup);

describe('PDF → text without a text layer', () => {
  // Regression: a scanned PDF "converted" to an empty TXT / Markdown / DOCX and looked like success.
  it('fails with the pdfNoText message when no page has text', () => {
    for (const pages of [[], [''], ['', '  \n ', '\t']]) {
      expect(() => joinPageText(pages)).toThrow(ConvertError);
      try { joinPageText(pages); } catch (e) { expect((e as ConvertError).key).toBe('pdfNoText'); }
    }
  });

  it('joins pages when at least one has text, keeping empty pages in place', () => {
    expect(joinPageText(['Page one', '', 'Page three'])).toBe('Page one\n\n\n\nPage three');
  });
});

describe('FileCard failure message', () => {
  const noop = () => {};
  const card = (item: Partial<Item>, lang: string) => {
    localStorage.setItem('morphkit-lang', lang);
    const it: Item = { id: 'f1', file: new File(['x'], 'scan.pdf'), kind: 'pdf', target: 'txt', quality: 0.9, status: 'error', progress: 0, ...item };
    const { container } = render(
      <I18nProvider>
        <FileCard item={it} onTarget={noop} onQuality={noop} onConvert={noop} onRemove={noop} onEdit={noop} onToProject={noop} onUnlock={noop} onQr={noop} />
      </I18nProvider>
    );
    return container.querySelector('.fc-error')?.textContent ?? '';
  };

  it('shows the message the conversion reported, in every language', () => {
    expect(card({ error: 'pdfNoText' }, 'en')).toMatch(/No text found.*PNG or JPG.*OCR/);
    expect(card({ error: 'pdfNoText' }, 'zh')).toMatch(/找不到文字.*PNG 或 JPG.*OCR/);
    expect(card({ error: 'pdfNoText' }, 'ja')).toMatch(/文字が見つかりません.*PNG か JPG.*OCR/);
  });

  it('falls back to the generic message for other failures', () => {
    expect(card({}, 'en')).toBe('Conversion failed');
  });
});
