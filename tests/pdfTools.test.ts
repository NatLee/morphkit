import { describe, expect, it } from 'vitest';
import { decodePDFRawStream, PDFDocument, PDFRawStream } from 'pdf-lib';
import { buildPdf } from '../src/lib/pdf';
import {
  BLANK_INK_SHARE,
  DEFAULT_PAGE_NUMBERS,
  inkShare,
  pageNumberLabel,
  pageNumberSpot,
  type PageNumbers,
} from '../src/lib/pdfTools';

const PN = (p: Partial<PageNumbers> = {}): PageNumbers => ({ ...DEFAULT_PAGE_NUMBERS, ...p });

describe('pageNumberLabel', () => {
  it('numbers from the start value and fills in the last number', () => {
    expect(pageNumberLabel(0, 12, PN())).toBe('1');
    expect(pageNumberLabel(4, 12, PN({ format: '{n} / {total}' }))).toBe('5 / 12');
    expect(pageNumberLabel(0, 3, PN({ format: 'Page {n} of {total}', start: 7 }))).toBe('Page 7 of 9');
  });

  it('leaves the skipped pages out of both the numbering and the total', () => {
    const pn = PN({ format: '{n} / {total}', skip: 1 });
    expect(pageNumberLabel(0, 10, pn)).toBeNull();
    expect(pageNumberLabel(1, 10, pn)).toBe('1 / 9');
    expect(pageNumberLabel(9, 10, pn)).toBe('9 / 9');
  });
});

describe('pageNumberSpot', () => {
  // A4 595 × 842 pt, a 20 pt wide label at 10 pt: margin = 2.5 em = 25 pt
  it('keeps the label inside the margins on each side', () => {
    expect(pageNumberSpot('bc', 595, 842, 20, 10)).toEqual([(595 - 20) / 2 / 595, (842 - 25) / 842]);
    expect(pageNumberSpot('br', 595, 842, 20, 10)[0]).toBeCloseTo((595 - 25 - 20) / 595);
    expect(pageNumberSpot('tl', 595, 842, 20, 10)).toEqual([25 / 595, (25 + 7.2) / 842]);
  });
});

describe('inkShare', () => {
  const page = (w: number, h: number, paper: number, ink: number, inkPixels: number, alpha = 255) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = i < inkPixels ? ink : paper;
      px.set([v, v, v, alpha], i * 4);
    }
    return px;
  };

  it('sees an empty page — white, grey scan or transparent — as blank', () => {
    expect(inkShare(page(100, 100, 255, 0, 0))).toBe(0);
    // yellowed scan with faint speckles (30 steps darker than the paper is not ink)
    expect(inkShare(page(100, 100, 220, 190, 500))).toBe(0);
    expect(inkShare(page(10, 10, 0, 0, 0, 0))).toBe(0);
  });

  it('sees a page with a line of text as not blank', () => {
    // 300 × 424 render of A4 with ~1% dark pixels
    expect(inkShare(page(300, 424, 255, 30, 1272))).toBeGreaterThan(BLANK_INK_SHARE);
  });
});

/** Each page's content streams, decoded to text (pdf-lib writes them Flate-compressed). */
async function pageOps(bytes: ArrayBuffer): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const contents = p.node.Contents();
    const refs = contents && 'asArray' in contents ? (contents as { asArray(): unknown[] }).asArray() : [contents];
    return refs
      .map((r) => doc.context.lookup(r as never))
      .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
      .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
      .join('\n');
  });
}

/** Every text matrix (Tm) drawn on each page. */
async function textMatrices(bytes: ArrayBuffer): Promise<number[][][]> {
  return (await pageOps(bytes)).map((text) =>
    [...text.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/g)].map((m) => m.slice(1, 7).map(Number))
  );
}

describe('buildPdf page numbers', () => {
  const A4 = { kind: 'blank' as const, width: 595, height: 842, notes: [] };

  it('draws each number upright where the page is read, rotated pages included', async () => {
    const blob = await buildPdf(
      [{ ...A4, rotate: 0 }, { ...A4, rotate: 90 }, { ...A4, rotate: 180 }],
      { pageNumbers: PN({ pos: 'bc' }) }
    );
    const [p0, p90, p180] = await textMatrices(await blob.arrayBuffer());
    // upright page: no rotation, centred near the bottom edge (y = 25 pt margin)
    expect(p0[0].slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(p0[0][5]).toBeCloseTo(25, 0);
    // turned 90° clockwise on screen: text rotated 90° counter-clockwise in page space, and the
    // bottom of the screen is the page's RIGHT edge (turn paper clockwise: its right edge ends at the bottom)
    expect(p90[0].slice(0, 4).map((v) => Math.round(v) + 0)).toEqual([0, 1, -1, 0]);
    expect(p90[0][4]).toBeCloseTo(595 - 25, 0);
    // upside down: "bottom of the screen" is the top of the page
    expect(p180[0].slice(0, 4).map((v) => Math.round(v) + 0)).toEqual([-1, 0, 0, -1]);
    expect(p180[0][5]).toBeCloseTo(842 - 25, 0);
  });

  it('numbers a split export as part of the whole document', async () => {
    const blob = await buildPdf([{ ...A4, rotate: 0 }], {
      pageNumbers: PN({ format: '{n} / {total}' }), pageOffset: 3, pageCount: 5,
    });
    const [ops] = await pageOps(await blob.arrayBuffer());
    // Helvetica text is written as hex: "4 / 5"
    const hex = [...'4 / 5'].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');
    expect(ops).toContain(`<${hex}>`);
  });

  it('draws nothing when page numbers are off', async () => {
    const blob = await buildPdf([{ ...A4, rotate: 0 }]);
    expect((await textMatrices(await blob.arrayBuffer()))[0]).toEqual([]);
  });
});
