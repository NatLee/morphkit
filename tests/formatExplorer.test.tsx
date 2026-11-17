import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../src/i18n';
import { FormatExplorer } from '../src/components/FormatExplorer';
import { formatRows } from '../src/lib/formatMap';
import { formatTask, TASKS } from '../src/lib/tasks';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('morphkit-lang', 'en');
});
afterEach(cleanup);

const open = (chosen: string | null = null, onPick = vi.fn()) => {
  render(<I18nProvider><FormatExplorer chosen={chosen} onPick={onPick} /></I18nProvider>);
  return onPick;
};
const kinds = () => within(screen.getByRole('group', { name: 'Kind of file' }));

describe('"I have a ___ file and want to…"', () => {
  it('shows a kind: what opens as it, its jobs, what it becomes and what that lets you adjust', async () => {
    const user = userEvent.setup();
    const onPick = open();
    await user.click(kinds().getByRole('button', { name: 'Video' }));
    expect(document.querySelector('.fx-ins')!.textContent).toContain('WMV');
    expect(screen.getByRole('button', { name: /Video to GIF/ })).toBeTruthy();
    const outs = within(screen.getByRole('group', { name: 'Converts to' }));
    await user.click(outs.getByRole('button', { name: /^GIF/ }));
    const detail = document.querySelector('.fx-detail') as HTMLElement;
    expect(detail.textContent).toContain('Video → GIF');
    expect(detail.textContent).toContain('GIF frame rate');
    // "set it up" is a convert preset for the files dropped next
    await user.click(within(detail).getByRole('button', { name: 'Set it up, then drop a Video file' }));
    expect(onPick).toHaveBeenCalledWith(formatTask('video', 'gif'));
  });

  it('says when a format is the one waiting for files, and offers to cancel it', () => {
    localStorage.setItem('mk-fx-kind', 'audio');
    open(formatTask('audio', 'mp3').id);
    expect(screen.getByRole('button', { name: 'Set to MP3: click to cancel' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('splits documents by what they are', async () => {
    const user = userEvent.setup();
    open();
    await user.click(kinds().getByRole('button', { name: 'Document' }));
    await user.click(screen.getByRole('button', { name: 'Spreadsheet' }));
    expect(document.querySelector('.fx-ins')!.textContent).toContain('ODS');
    expect(screen.getByRole('button', { name: /Excel to CSV/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(screen.queryByRole('button', { name: /Excel to CSV/ })).toBeNull();
  });

  it('finds an extension and shows where it opens', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByRole('searchbox'), 'wmv');
    await user.click(screen.getByRole('button', { name: /WMV · Video/ }));
    expect(kinds().getByRole('button', { name: 'Video' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.fx-ins .chip.hit')!.textContent).toBe('WMV');
    await user.type(screen.getByRole('searchbox'), 'zebra');
    expect(screen.getByText(/^Nothing for “zebra”/)).toBeTruthy();
  });

  it('draws every conversion in the overview, and a cell opens its details', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'All formats' }));
    const cells = screen.getByRole('table').querySelectorAll('td button');
    expect(cells).toHaveLength(formatRows().reduce((n, r) => n + r.outputs.length, 0));
    await user.click(screen.getByRole('button', { name: 'PDF → TXT' }));
    expect(document.querySelector('.fx-detail h4')!.textContent).toBe('PDF → TXT');
  });

  it('names every job and every conversion in each language (no raw keys)', async () => {
    for (const lang of ['zh', 'en', 'ja']) {
      localStorage.setItem('morphkit-lang', lang);
      const user = userEvent.setup();
      open();
      const seen = new Set<string>();
      for (const k of [...document.querySelectorAll('.fx-kinds button')] as HTMLElement[]) {
        await user.click(k);
        const subs = document.querySelectorAll('.fx-subs button');
        for (const s of subs.length ? [...subs] : [null]) {
          if (s) await user.click(s as HTMLElement);
          document.querySelectorAll('.fx-task').forEach((b) => seen.add((b as HTMLElement).textContent!));
          const text = document.querySelector('.fx')!.textContent!;
          expect(text, lang).not.toMatch(/\b(task_|fmt_|fmt[A-Z]|needs_|docSub_|fx[A-Z]|taskRun_)\w*/);
        }
      }
      // every job of a file kind is reachable from its kind (QR sits in the footer)
      expect(seen.size, lang).toBe(TASKS.filter((t) => t.kind !== 'other').length);
      cleanup();
    }
  });
});
