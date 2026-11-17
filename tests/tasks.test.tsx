import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../src/i18n';
import { FileCard } from '../src/components/FileCard';
import { useI18n } from '../src/i18n';
import { outputsFor, type Kind } from '../src/lib/formats';
import { fieldsFor } from '../src/lib/settingFields';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { applyTask, CARD_SUGGESTIONS, filterTasks, formatTask, isFormatTask, suggestionsFor, taskActive, taskById, taskFits, taskName, TASKS } from '../src/lib/tasks';
import type { Item } from '../src/types';

/** One ordinary file per kind, as the app would see it. */
const SAMPLE: Record<Kind, File> = {
  image: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
  audio: new File(['x'], 'talk.wav', { type: 'audio/wav' }),
  video: new File(['x'], 'clip.mov', { type: 'video/quicktime' }),
  pdf: new File(['x'], 'scan.pdf', { type: 'application/pdf' }),
  doc: new File(['x'], 'notes.md', { type: 'text/markdown' }),
};
const SHEET = new File(['x'], 'table.xlsx');
const ids = (list: readonly { id: string }[]) => list.map((t) => t.id);
const task = (id: string) => taskById(id)!;

describe('task registry', () => {
  it('has unique ids', () => {
    expect(new Set(ids(TASKS)).size).toBe(TASKS.length);
  });

  // a task must be a preset over something the app really does
  it('only names outputs and options that exist for its kind of file', () => {
    for (const t of TASKS) {
      if (t.kind === 'other') { expect(t.run, t.id).toBe('tool'); continue; }
      const file = t.id === 'sheet2csv' ? SHEET : SAMPLE[t.kind];
      const outs = outputsFor(t.kind, file);
      if (t.target) expect(outs, t.id).toContain(t.target);
      const target = t.target ?? outs[0];
      const settable = fieldsFor(t.kind, target).map((f) => f.key);
      for (const key of Object.keys(t.opts ?? {})) expect(settable, `${t.id}.${key}`).toContain(key);
      if (t.pdfExport) expect(t.kind, t.id).toBe('pdf');
      if (t.run === 'convert') expect(!!(t.target || t.opts), t.id).toBe(true);
    }
  });

  it('has a name and a description in every language', () => {
    for (const lang of ['zh', 'en', 'ja']) {
      localStorage.setItem('morphkit-lang', lang);
      const { container, unmount } = render(<I18nProvider><Strings /></I18nProvider>);
      const rows = [...container.querySelectorAll('li')];
      expect(rows).toHaveLength(TASKS.length);
      // a missing string would render as its raw key
      for (const r of rows) expect(r.textContent, lang).not.toMatch(/task(Run)?_/);
      unmount();
    }
  });
});

describe('what a file card suggests', () => {
  it('offers the usual jobs for each kind, at most three', () => {
    expect(ids(suggestionsFor('pdf', SAMPLE.pdf))).toEqual(['pnum', 'psqueeze', 'ptxt']);
    expect(ids(suggestionsFor('video', SAMPLE.video))).toEqual(['v2mp3', 'v25', 'v2gif']);
    expect(ids(suggestionsFor('image', SAMPLE.image))).toEqual(['ocr', 'img200', 'ico']);
    expect(ids(suggestionsFor('audio', SAMPLE.audio))).toEqual(['loud', 'trim']);
    for (const k of Object.keys(SAMPLE) as Kind[]) expect(suggestionsFor(k, SAMPLE[k]).length).toBeLessThanOrEqual(CARD_SUGGESTIONS);
  });

  it('suggests CSV for a spreadsheet but not for a text document', () => {
    expect(ids(suggestionsFor('doc', SHEET))).toEqual(['sheet2csv']);
    expect(suggestionsFor('doc', SAMPLE.doc)).toEqual([]);
    expect(taskFits(task('sheet2csv'), 'doc', SAMPLE.doc)).toBe(false);
  });
});

describe('applying a task', () => {
  const fresh = { target: 'webm', opts: undefined };

  it('sets the format and the options, and reads back as active', () => {
    const after = applyTask(task('v25'), fresh, DEFAULT_SETTINGS);
    expect(after).toEqual({ target: 'mp4', opts: { videoTargetSize: 25e6 } });
    expect(taskActive(task('v25'), after, DEFAULT_SETTINGS)).toBe(true);
    expect(taskActive(task('v25'), fresh, DEFAULT_SETTINGS)).toBe(false);
    // same format, but a different size target: not this task
    expect(taskActive(task('v25'), { target: 'mp4', opts: { videoTargetSize: 50e6 } }, DEFAULT_SETTINGS)).toBe(false);
  });

  it('takes its options back out when applied again, and keeps the format', () => {
    const on = applyTask(task('v25'), fresh, DEFAULT_SETTINGS);
    expect(applyTask(task('v25'), on, DEFAULT_SETTINGS)).toEqual({ target: 'mp4', opts: undefined });
  });

  it('leaves the format alone when the task is only an option', () => {
    const after = applyTask(task('loud'), { target: 'flac', opts: { audioChannels: 1 } }, DEFAULT_SETTINGS);
    expect(after).toEqual({ target: 'flac', opts: { audioChannels: 1, audioLoudness: -16 } });
  });

  it('counts as active when the default already has the same value', () => {
    expect(taskActive(task('loud'), { target: 'mp3' }, { ...DEFAULT_SETTINGS, audioLoudness: -16 })).toBe(true);
  });
});

describe('home task list', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('morphkit-lang', 'en'); });
  afterEach(cleanup);
  const text = (t: { id: string }) => ({ pnum: 'Add page numbers to a PDF', v2mp3: 'Video to MP3', mp3: 'Convert to MP3' }[t.id] ?? t.id);

  it('filters by words, by output format and by file kind', () => {
    expect(ids(filterTasks('page numbers', 'all', text))).toEqual(['pnum']);
    // "mp3" finds both the audio and the video job
    expect(ids(filterTasks('mp3', 'all', text))).toEqual(['mp3', 'v2mp3']);
    expect(ids(filterTasks('mp3', 'video', text))).toEqual(['v2mp3']);
    expect(filterTasks('', 'pdf', text).every((t) => t.kind === 'pdf')).toBe(true);
    expect(filterTasks('nothing like this', 'all', text)).toEqual([]);
  });

});

describe('format picks ("convert to …" on the home page)', () => {
  it('are convert tasks with only a target, found again from their id', () => {
    const pick = formatTask('video', 'mp3');
    expect(pick).toEqual({ id: 'to-video-mp3', kind: 'video', run: 'convert', target: 'mp3' });
    expect(taskById('to-video-mp3')).toEqual(pick);
    expect(isFormatTask(pick)).toBe(true);
    expect(isFormatTask(task('v2mp3'))).toBe(false);
    expect(taskById('to-nothing-mp3')).toBeUndefined();
  });

  it('fit only the files that can become that format', () => {
    expect(taskFits(formatTask('doc', 'csv'), 'doc', SHEET)).toBe(true);
    expect(taskFits(formatTask('doc', 'csv'), 'doc', SAMPLE.doc)).toBe(false); // markdown has no CSV output
    expect(applyTask(formatTask('image', 'ico'), { target: 'webp', opts: undefined }, DEFAULT_SETTINGS)).toEqual({ target: 'ico', opts: undefined });
  });

  it('are named by their format', () => {
    const t = (key: string, vars?: Record<string, string>) => (key === 'taskToFormat' ? `Convert to ${vars!.fmt}` : key);
    expect(taskName(formatTask('image', 'jpeg'), t)).toBe('Convert to JPG');
    expect(taskName(task('pnum'), t)).toBe('task_pnum');
  });
});

describe('file card suggestions', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('morphkit-lang', 'en'); });
  afterEach(cleanup);
  const noop = () => {};

  it('shows them as chips, marks the one in effect and reports a click', async () => {
    const user = userEvent.setup();
    const onTask = vi.fn();
    const item: Item = { id: 'f1', file: SAMPLE.video, kind: 'video', target: 'mp4', opts: { videoTargetSize: 25e6 }, quality: 0.9, status: 'ready', progress: 0 };
    render(
      <I18nProvider>
        <FileCard item={item} settings={DEFAULT_SETTINGS} onOption={noop} onResetOptions={noop} onTask={onTask} onTarget={noop} onQuality={noop} onConvert={noop} onRemove={noop} onEdit={noop} onToProject={noop} onUnlock={noop} onQr={noop} />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: 'Shrink a video under 25 MB' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Video to MP3' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Video to GIF' }));
    expect(onTask).toHaveBeenCalledWith('f1', 'v2gif');
  });
});

/** Every task's two strings, as the app shows them. */
function Strings() {
  const { t } = useI18n();
  return <ul>{TASKS.map((x) => <li key={x.id}>{t(`task_${x.id}`)} · {t(`task_${x.id}_d`)} · {t(`taskRun_${x.run}`)}</li>)}</ul>;
}
