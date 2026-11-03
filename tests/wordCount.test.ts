import { describe, expect, it } from 'vitest';
import { countWords } from '../src/lib/docs';
import { extractMeta } from '../src/lib/metadata';

describe('countWords', () => {
  it('counts Latin words by whitespace', () => {
    expect(countWords('Hello brave new world')).toBe(4);
    expect(countWords('  spaced\n\nout\ttext  ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  // Regression: whitespace splitting counted a whole Chinese or Japanese paragraph as one
  // word, so a 2,000-character article showed up as "3 字".
  it('counts every CJK character as one word, like word processors do', () => {
    expect(countWords('中文測試段落。')).toBe(6);
    expect(countWords('ひらがなとカタカナ、コーヒー')).toBe(13);
    expect(countWords('MorphKit 是一個轉檔工具')).toBe(8);
  });

  it('ignores Markdown punctuation that is not a word', () => {
    expect(countWords('# Title\n\n- one\n- two\n\n| a | b |\n|---|---|')).toBe(5);
  });
});

describe('document metadata', () => {
  it('reports the same word count in the file card as the editor shows', async () => {
    const md = '# 標題\n\nSome **bold** text 和中文。\n';
    const meta = await extractMeta(new File([md], 'note.md', { type: 'text/markdown' }), 'doc');
    expect(meta.words).toBe(countWords(md));
    expect(meta.words).toBe(8);
  });
});
