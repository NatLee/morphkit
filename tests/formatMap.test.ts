import { describe, expect, it } from 'vitest';
import { detectKind, docTypeOf, DOC_OUTPUTS, EXTENSIONS, outputsFor, SAME_FORMAT, type Kind } from '../src/lib/formats';
import {
  allOutputs, DOC_TYPES, describeKey, formatRows, inputsOf, needsFor, optionsFor, searchFormats, tasksFor,
} from '../src/lib/formatMap';
import { fieldsFor } from '../src/lib/settingFields';
import { TASKS } from '../src/lib/tasks';

const rows = formatRows();
const fmt = (ext: string) => SAME_FORMAT[ext] ?? ext;

// The home page used to show a hand-written list of 28 input formats while the app accepted 42:
// the map is now worked out from the registries, so it cannot drift from them again.
describe('the format map', () => {
  it('lists every extension the file pickers accept, each format once, where it really opens', () => {
    const accepted = new Set(Object.values(EXTENSIONS).flat().map(fmt));
    const listed = rows.flatMap((r) => r.inputs);
    expect(new Set(listed)).toEqual(accepted);
    expect(listed).toHaveLength(accepted.size); // no format in two rows
    for (const r of rows) {
      for (const f of r.inputs) {
        expect(detectKind(new File([''], `x.${f}`)), f).toBe(r.kind);
        if (r.doc) expect(docTypeOf({ name: `x.${f}` }), f).toBe(r.doc);
      }
    }
  });

  it('offers the same outputs as the file cards', () => {
    for (const r of rows) {
      expect(r.outputs, `${r.kind} ${r.doc ?? ''}`).toEqual(r.kind === 'doc' ? DOC_OUTPUTS[r.doc!] : outputsFor(r.kind));
    }
    expect(rows.filter((r) => r.kind === 'doc').map((r) => r.doc)).toEqual(DOC_TYPES);
    const cols = allOutputs(rows);
    expect(new Set(cols).size).toBe(cols.length);
    expect(new Set(cols)).toEqual(new Set(rows.flatMap((r) => r.outputs)));
  });

  it('shows the settings a file card would show for that conversion', () => {
    for (const r of rows) for (const o of r.outputs) expect(optionsFor(r.kind, o)).toEqual(fieldsFor(r.kind, o).map((f) => f.labelKey));
    expect(optionsFor('video', 'gif')).toEqual(expect.arrayContaining(['gifFps', 'gifWidth']));
    expect(optionsFor('image', 'txt')).toEqual(['ocrLang']);
    expect(optionsFor('image', 'ico')).toEqual([]);
  });

  it('says what a conversion needs before it can run', () => {
    expect(needsFor('audio', 'mp3')).toBe('engine');
    expect(needsFor('video', 'gif')).toBe('engine');
    expect(needsFor('image', 'txt')).toBe('ocr');
    expect(needsFor('pdf', 'docx')).toBe('ocrScans');
    expect(needsFor('pdf', 'png')).toBe('browser');
    expect(needsFor('doc', 'pdf')).toBe('fonts');
    expect(needsFor('image', 'webp')).toBe('browser');
  });

  it('describes a conversion by what it does for that kind of file', () => {
    expect(describeKey('video', 'mp3')).toBe('fmtSoundOnly');
    expect(describeKey('audio', 'mp3')).toBe('fmt_mp3');
    expect(describeKey('image', 'txt')).toBe('fmtOcr');
    expect(describeKey('pdf', 'txt')).toBe('fmtPdfText');
    expect(describeKey('pdf', 'jpeg')).toBe('fmtPdfPages');
    expect(describeKey('doc', 'png')).toBe('fmtDocPages');
  });

  it('lists the jobs that fit a kind, a document sub-type and an output', () => {
    expect(tasksFor('doc', undefined, 'sheet').map((t) => t.id)).toContain('sheet2csv');
    expect(tasksFor('doc', undefined, 'md').map((t) => t.id)).not.toContain('sheet2csv');
    expect(tasksFor('video', 'mp4').map((t) => t.id)).toEqual(['v25']);
    // every job of a kind shows somewhere in its rows
    for (const k of ['image', 'audio', 'video', 'pdf'] as Kind[]) {
      expect(tasksFor(k).map((t) => t.id)).toEqual(TASKS.filter((t) => t.kind === k).map((t) => t.id));
    }
  });
});

describe('searching formats and jobs', () => {
  const text = (t: { id: string }) => ({ pnum: 'Add page numbers to a PDF' }[t.id] ?? t.id);

  it('finds where an extension opens, under its usual name too', () => {
    expect(searchFormats('wmv', text)).toContainEqual({ type: 'input', kind: 'video', format: 'wmv' });
    expect(searchFormats('.jpeg', text)).toContainEqual({ type: 'input', kind: 'image', format: 'jpg' });
    expect(searchFormats('xls', text)).toContainEqual({ type: 'input', kind: 'doc', doc: 'sheet', format: 'xls' });
  });

  it('finds every kind that converts to a format, and the jobs', () => {
    const mp3 = searchFormats('mp3', text);
    expect(mp3).toContainEqual({ type: 'output', kind: 'audio', format: 'mp3' });
    expect(mp3).toContainEqual({ type: 'output', kind: 'video', format: 'mp3' });
    expect(searchFormats('page numbers', text)).toContainEqual(expect.objectContaining({ type: 'task', task: expect.objectContaining({ id: 'pnum' }) }));
    expect(searchFormats('   ', text)).toEqual([]);
  });

  it('shows a document output once, at the first sub-type that has it', () => {
    const csv = searchFormats('csv', text).filter((h) => h.type === 'output');
    expect(csv).toEqual([{ type: 'output', kind: 'doc', doc: 'sheet', format: 'csv' }]);
    expect(inputsOf('doc', 'sheet')).toEqual(['csv', 'tsv', 'xlsx', 'xls', 'ods']);
  });
});
