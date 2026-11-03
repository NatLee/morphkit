import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { convertDoc, docSave, docToHtml, htmlToBlocks, htmlToMarkdown, rowsToMarkdown, sanitizeHtml } from '../src/lib/docs';

const file = (name: string, body: string, type = '') => new File([body], name, { type });
const text = async (r: { blob: Blob }) => r.blob.text();

describe('sanitizeHtml', () => {
  it('drops scripts, event handlers and javascript: links but keeps structure', () => {
    const out = sanitizeHtml('<h1 onclick="x()">Hi</h1><script>alert(1)</script><a href="javascript:alert(1)">a</a><img src="file:///etc/passwd"><p data-page-break>ok</p>');
    expect(out).toContain('<h1>Hi</h1>');
    expect(out).not.toMatch(/script|onclick|javascript:|passwd/);
    expect(out).toContain('data-page-break');
  });

  it('keeps data: images and http(s) images', () => {
    const out = sanitizeHtml('<img src="data:image/png;base64,AAA"><img src="https://example.com/a.png">');
    expect(out).toContain('data:image/png');
    expect(out).toContain('https://example.com/a.png');
  });
});

describe('Markdown and HTML conversions', () => {
  const md = file('note.md', '# Title\n\nSome **bold** text.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');

  it('wraps HTML output in a standalone document titled after the file', async () => {
    const html = await text(await convertDoc(md, 'html'));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>note</title>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<table>');
  });

  it('round-trips Markdown with lists and tables intact', async () => {
    const out = await text(await convertDoc(md, 'md'));
    expect(out).toContain('# Title');
    expect(out).toContain('**bold**');
    expect(out).toMatch(/-\s+one/);
    expect(out).toContain('| a | b |');
  });

  it('turns HTML into Markdown', async () => {
    const out = await text(await convertDoc(file('page.html', '<h2>Sub</h2><p>Para <em>it</em></p><ul><li>x</li></ul>'), 'md'));
    expect(out).toBe('## Sub\n\nPara _it_\n\n-   x\n');
  });

  it('gives Word-style tables without a header row one, so they survive as Markdown', async () => {
    const out = await htmlToMarkdown('<table><tr><td><p>k</p></td><td><p>v</p></td></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(out).toContain('| k | v |');
    expect(out).toContain('| 1 | 2 |');
  });

  it('keeps plain text paragraphs and line breaks', async () => {
    const html = await docToHtml(file('a.txt', 'line 1\nline 2\n\npara 2'));
    expect(html).toBe('<p>line 1<br>line 2</p>\n<p>para 2</p>');
  });

  it('flattens HTML into layout blocks (headings, bullets, tables, page breaks)', () => {
    const blocks = htmlToBlocks('<h1>T</h1><ul><li>a</li></ul><table><tr><th>h</th></tr><tr><td>1</td></tr></table><hr data-page-break=""><ol><li>n</li></ol>');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'para', 'table', 'pagebreak', 'para']);
    expect(blocks[1]).toMatchObject({ bullet: '•', indent: 1 });
    expect(blocks[2]).toMatchObject({ header: true, rows: [['h'], ['1']] });
    expect(blocks[4]).toMatchObject({ bullet: '1.' });
  });

  it('rejects a target the documents pipeline does not know', async () => {
    await expect(convertDoc(md, 'mp3')).rejects.toThrow(/unsupported/);
  });
});

describe('spreadsheet and JSON conversions', () => {
  const csv = file('table.csv', 'name,qty\napple,3\nbanana,12\n', 'text/csv');

  it('CSV → JSON uses the header row as keys', async () => {
    expect(JSON.parse(await text(await convertDoc(csv, 'json')))).toEqual([{ name: 'apple', qty: 3 }, { name: 'banana', qty: 12 }]);
  });

  it('CSV → Markdown table', async () => {
    expect(await text(await convertDoc(csv, 'md'))).toBe('| name | qty |\n| --- | --- |\n| apple | 3 |\n| banana | 12 |\n');
  });

  it('JSON array of objects → CSV', async () => {
    const json = file('data.json', '[{"a":1,"b":"x"},{"a":2,"c":true}]');
    expect(await text(await convertDoc(json, 'csv'))).toBe('a,b,c\n1,x,\n2,,TRUE');
  });

  it('CSV → XLSX → CSV keeps the data', async () => {
    const xlsx = await convertDoc(csv, 'xlsx');
    const back = await convertDoc(new File([xlsx.blob], 'table.xlsx'), 'csv');
    expect(back.multi).toBe(false);
    expect(await text(back)).toBe('name,qty\napple,3\nbanana,12');
  });

  it('a workbook with several sheets becomes a ZIP of CSVs', async () => {
    const X = await import('xlsx');
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['k'], [1]]), 'One');
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['k'], [2]]), 'Q1 <draft>');
    const bytes = X.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const r = await convertDoc(new File([bytes], 'book.xlsx'), 'csv');
    expect(r.multi).toBe(true);
    const zip = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['book_One.csv', 'book_Q1 _draft_.csv']);
    expect(strFromU8(zip['book_One.csv'])).toBe('k\n1');
  });

  it('escapes pipes in Markdown tables', () => {
    expect(rowsToMarkdown([['a|b'], ['line\nbreak']])).toBe('| a\\|b |\n| --- |\n| line break |\n');
  });
});

describe('docSave', () => {
  it('saves plain text back verbatim and keeps the name', async () => {
    const out = await docSave(file('a.txt', 'old', 'text/plain'), 'md', '# not really markdown\n');
    expect(out.name).toBe('a.txt');
    expect(await out.text()).toBe('# not really markdown\n');
  });
});
