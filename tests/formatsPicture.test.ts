import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_OUTPUTS, DOC_OUTPUTS, IMAGE_OUTPUTS, PDF_OUTPUTS, VIDEO_OUTPUTS, formatLabel,
} from '../src/lib/formats';

/**
 * The README's "what converts to what" picture is drawn from docs/images/formats.html, which can't
 * import TypeScript, so its OUT lists are written out by hand. This keeps them honest: add an output
 * to lib/formats.ts and this fails until the picture source (and then the picture) is updated.
 */
// npm test runs from the repo root (jsdom gives import.meta.url an http: scheme, so no URL tricks)
const html = readFileSync(join(process.cwd(), 'docs/images/formats.html'), 'utf8');
const rows = new Map(
  [...html.matchAll(/\['(\w+)', '#[0-9a-f]{6}', \[[^\]]*\], \[([^\]]*)\]\]/g)].map((m) => [
    m[1],
    m[2].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean),
  ])
);
const labels = (list: readonly string[]) => [...new Set(list.map(formatLabel))].sort();

describe('formats overview picture', () => {
  it('has a row for every kind', () => {
    expect([...rows.keys()]).toEqual(['image', 'audio', 'video', 'pdf', 'doc']);
  });

  it('shows exactly the outputs the app offers', () => {
    expect([...rows.get('image')!].sort()).toEqual(labels(IMAGE_OUTPUTS));
    expect([...rows.get('audio')!].sort()).toEqual(labels(AUDIO_OUTPUTS));
    expect([...rows.get('video')!].sort()).toEqual(labels(VIDEO_OUTPUTS));
    expect([...rows.get('pdf')!].sort()).toEqual(labels(PDF_OUTPUTS));
    expect([...rows.get('doc')!].sort()).toEqual(labels(Object.values(DOC_OUTPUTS).flat()));
  });
});
