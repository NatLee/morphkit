import { describe, expect, it } from 'vitest';
import { htmlToText, markdownToHtml } from '../src/lib/docs';

describe('htmlToText', () => {
  // Regression: whitespace between block elements (marked, mammoth and the PPTX reader all
  // put "\n" between tags) turned into a space at the start of the next line.
  it('does not indent lines that follow a block element', async () => {
    const html = await markdownToHtml('# Title\n\nSome **bold** text.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n中文段落。\n');
    expect(htmlToText(html)).toBe('Title\n\nSome bold text.\n\n• one\n• two\n\na\tb\n1\t2\n\n中文段落。\n');
  });

  it('handles slide sections from presentations', () => {
    const html = '<section data-slide=""><p>Slide one</p>\n<p>Body</p></section>\n<hr data-page-break=""><section data-slide=""><p>Two</p></section>';
    expect(htmlToText(html)).toBe('Slide one\n\nBody\n\nTwo\n');
  });

  it('keeps line breaks and inline spacing inside a paragraph', () => {
    expect(htmlToText('<p>line 1<br>line 2 has <b>bold</b>  and   spaces</p>')).toBe('line 1\nline 2 has bold and spaces\n');
  });

  it('keeps preformatted text exactly', () => {
    expect(htmlToText('<p>code:</p>\n<pre>  indented\n    more</pre>')).toBe('code:\n\n  indented\n    more\n');
  });
});
