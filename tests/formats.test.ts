import { describe, expect, it } from 'vitest';
import {
  defaultTarget,
  detectKind,
  docOutputs,
  docTypeOf,
  extOf,
  formatBytes,
  isTextDoc,
  mimeFor,
  outputFileName,
  outputsFor,
} from '../src/lib/formats';

const file = (name: string, type = '') => new File(['x'], name, { type });

describe('detectKind', () => {
  it('trusts the MIME type first', () => {
    expect(detectKind(file('a.bin', 'image/png'))).toBe('image');
    expect(detectKind(file('a.bin', 'audio/mpeg'))).toBe('audio');
    expect(detectKind(file('a.bin', 'video/mp4'))).toBe('video');
    expect(detectKind(file('a.bin', 'application/pdf'))).toBe('pdf');
  });

  it('falls back to the extension when the browser reports no type', () => {
    expect(detectKind(file('photo.HEIC'))).toBeNull();
    expect(detectKind(file('song.flac'))).toBe('audio');
    expect(detectKind(file('clip.mkv'))).toBe('video');
    expect(detectKind(file('scan.pdf'))).toBe('pdf');
    expect(detectKind(file('icon.svg'))).toBe('image');
  });

  it('treats documents by extension even when the browser says text/plain', () => {
    expect(detectKind(file('notes.md', 'text/plain'))).toBe('doc');
    expect(detectKind(file('data.csv', 'text/plain'))).toBe('doc');
    expect(detectKind(file('report.docx'))).toBe('doc');
    expect(detectKind(file('deck.pptx'))).toBe('doc');
  });

  it('rejects unknown files', () => {
    expect(detectKind(file('archive.7z'))).toBeNull();
    expect(detectKind(file('noext'))).toBeNull();
  });
});

describe('document sub-types', () => {
  it('maps extensions to the right sub-type', () => {
    expect(docTypeOf(file('a.markdown'))).toBe('md');
    expect(docTypeOf(file('a.htm'))).toBe('html');
    expect(docTypeOf(file('a.tsv'))).toBe('sheet');
    expect(docTypeOf(file('a.ods'))).toBe('sheet');
    expect(docTypeOf(file('a.json'))).toBe('json');
    expect(docTypeOf(file('a.txt'))).toBe('text');
  });

  it('only text-ish documents can become Studio text projects', () => {
    expect(isTextDoc(file('a.md'))).toBe(true);
    expect(isTextDoc(file('a.json'))).toBe(true);
    expect(isTextDoc(file('a.docx'))).toBe(false);
    expect(isTextDoc(file('a.xlsx'))).toBe(false);
  });

  it('offers outputs that depend on the source', () => {
    expect(docOutputs(file('a.xlsx'))).toContain('csv');
    expect(docOutputs(file('a.xlsx'))).not.toContain('docx');
    expect(docOutputs(file('a.md'))).toContain('pptx');
    expect(outputsFor('doc', file('a.json'))[0]).toBe('csv');
  });
});

describe('defaultTarget', () => {
  it('never picks the format the file already has', () => {
    expect(defaultTarget('image', file('a.webp'))).toBe('png');
    expect(defaultTarget('image', file('a.png'))).toBe('webp');
    expect(defaultTarget('audio', file('a.mp3'))).toBe('wav');
    expect(defaultTarget('video', file('a.mp4'))).toBe('webm');
  });

  it('keeps animations animated', () => {
    expect(defaultTarget('image', file('a.gif'))).toBe('apng');
    expect(defaultTarget('image', file('a.apng'))).toBe('gif');
  });

  it('uses the first document output and PNG for PDFs', () => {
    expect(defaultTarget('doc', file('a.csv'))).toBe('xlsx');
    expect(defaultTarget('pdf', file('a.pdf'))).toBe('png');
  });
});

describe('naming helpers', () => {
  it('swaps the extension and writes jpeg as .jpg', () => {
    expect(outputFileName('holiday.photo.png', 'jpeg')).toBe('holiday.photo.jpg');
    expect(outputFileName('README', 'pdf')).toBe('README.pdf');
    expect(extOf('A.TAR.GZ')).toBe('gz');
  });

  it('knows the MIME type of every output', () => {
    for (const kind of ['image', 'audio', 'video', 'pdf'] as const) {
      for (const o of outputsFor(kind)) expect(mimeFor(o), o).not.toBe('application/octet-stream');
    }
  });

  it('formats sizes with readable units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
  });
});
