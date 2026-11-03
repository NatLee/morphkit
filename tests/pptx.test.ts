import { describe, expect, it } from 'vitest';
import { convertDoc, docToHtml, htmlToText } from '../src/lib/docs';

describe('PPTX round trip', () => {
  it('splits Markdown into slides on headings and reads them back in order', async () => {
    const md = new File(['# First\n\nHello **world**\n\n- a\n- b\n\n## Second\n\nMore text\n'], 'deck.md');
    const pptx = await convertDoc(md, 'pptx');
    const head = new Uint8Array(await pptx.blob.slice(0, 2).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe('PK'); // a zip container

    const html = await docToHtml(new File([pptx.blob], 'deck.pptx'));
    expect(html.match(/<section data-slide/g)?.length).toBe(2);
    const txt = htmlToText(html);
    expect(txt.indexOf('First')).toBeLessThan(txt.indexOf('Second'));
    expect(txt).toContain('Hello world');
    expect(txt).toContain('More text');
  }, 20_000);
});
