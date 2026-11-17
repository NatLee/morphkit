import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../src/i18n';
import { Studio } from '../src/components/Studio';
import { emptyMixer, type AssetRec, type ProjectRec } from '../src/lib/studioTypes';
import * as idb from '../src/lib/idb';

// IndexedDB is not in jsdom: the page talks to this in-memory stand-in instead
const db = vi.hoisted(() => ({ projects: [] as unknown[], assets: [] as unknown[] }));
vi.mock('../src/lib/idb', () => ({
  listProjects: vi.fn(async () => db.projects),
  listAssets: vi.fn(async (id: string) => (db.assets as AssetRec[]).filter((a) => a.projectId === id)),
  deleteProject: vi.fn(async () => {}),
  deleteAsset: vi.fn(async () => {}),
  putProject: vi.fn(async () => {}),
  putAsset: vi.fn(async () => {}),
  createProjectWithAsset: vi.fn(),
}));

const project: ProjectRec = {
  id: 'p1', name: 'Episode 12', type: 'audio', createdAt: 1, updatedAt: 1, mixer: emptyMixer(),
};
const asset: AssetRec = {
  id: 'a1', projectId: 'p1', name: 'intro.wav', kind: 'audio',
  blob: new Blob([new Uint8Array(2048)], { type: 'audio/wav' }), addedAt: 1,
};

beforeEach(() => {
  db.projects = [];
  db.assets = [];
  localStorage.clear();
  localStorage.setItem('morphkit-lang', 'en');
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ quota: 2 * 1024 ** 3 }) } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const open = (onProjectCount?: (n: number) => void) =>
  render(
    <I18nProvider>
      <Studio onProjectCount={onProjectCount} />
    </I18nProvider>
  );

const rail = () => screen.getByRole('navigation', { name: 'Show projects' });

describe('Projects page', () => {
  // The old page opened on an empty "New project" card: nothing said what a project is,
  // where it is kept, or how it differs from converting a file.
  it('explains what a project is on the first visit and offers six things to make', async () => {
    open();
    expect(await screen.findByText(/^A project is work you finish over several sittings/)).toBeTruthy();
    expect(screen.getByText(/kept in this browser/)).toBeTruthy();
    const uses = ['Cut a podcast episode', 'Make a poster, mark up a screenshot', 'Make a GIF sticker', 'Put new music on a video', 'Tidy and merge PDFs', 'Write notes or a document'];
    for (const u of uses) expect(screen.getByRole('button', { name: new RegExp(u) })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Start from a file/ })).toBeTruthy();
    // nothing to sort yet, and no button: the ways to start are on the page
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
  });

  it('starts the matching project type from a use card', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Tidy and merge PDFs/ }));
    // inside the workspace: the type badge in the bar
    await waitFor(() => expect(document.querySelector('.st-bar .type-badge')?.textContent).toBe('PDF project'));
  });

  it('shows the facts beside the list: count, size, where it is kept and the share of the allowance', async () => {
    db.projects = [project];
    db.assets = [asset];
    const counts: number[] = [];
    open((n) => counts.push(n));
    await screen.findByText('Episode 12');
    const note = document.querySelector('.pj-note') as HTMLElement;
    await waitFor(() => expect(note.textContent).toContain('1 projects · 2.0 KB'));
    expect(note.textContent).toContain('Kept in this browser only');
    await waitFor(() => expect(document.querySelector('.pj-quota')?.textContent).toContain('2.0 KB in all, <0.1% of what the browser allows (about 2.00 GB)'));
    // the rail row of the type draws its share of the space
    const audioRow = within(rail()).getByRole('button', { name: /Audio project/ });
    await waitFor(() => expect(audioRow.textContent).toContain('2.0 KB'));
    expect(screen.queryByText(/^A project is work you finish/)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeTruthy();
    // the app's nav shows this number
    await waitFor(() => expect(counts[counts.length - 1]).toBe(1));
  });

  // The reported problem: "start a new project" came after the whole list, so with many
  // projects it sat several screens down (5.7 screens on a phone with 27 projects).
  it('offers "New project" above the list, however long the list is', async () => {
    const user = userEvent.setup();
    db.projects = Array.from({ length: 30 }, (_, i) => ({ ...project, id: `p${i}`, name: `Cut ${i}`, updatedAt: i }));
    open();
    await screen.findByText('Cut 29');
    const button = screen.getByRole('button', { name: 'New project' });
    const firstCard = document.querySelector('.pj-card') as HTMLElement;
    expect(button.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the six uses are not in the page any more: they open from the button
    expect(screen.queryByRole('button', { name: /Tidy and merge PDFs/ })).toBeNull();
    await user.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Start a new project: what do you want to make?' });
    await user.click(within(dialog).getByRole('button', { name: /Tidy and merge PDFs/ }));
    await waitFor(() => expect(document.querySelector('.st-bar .type-badge')?.textContent).toBe('PDF project'));
  });

  it('closes the new-project dialog with Escape', async () => {
    const user = userEvent.setup();
    db.projects = [project];
    open();
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('filters the list by type and by missing backups', async () => {
    const user = userEvent.setup();
    db.projects = [
      project,
      { ...project, id: 'p2', name: 'Trail guide', type: 'pdf', exportedAt: 5, updatedAt: 5 },
      { ...project, id: 'p3', name: 'Contract', type: 'pdf' },
    ];
    open();
    await screen.findByText('Trail guide');
    await user.click(within(rail()).getByRole('button', { name: /^PDF project/ }));
    expect(screen.queryByText('Episode 12')).toBeNull();
    expect(screen.getByText('Trail guide')).toBeTruthy();
    expect(screen.getByText('Contract')).toBeTruthy();
    await user.click(within(rail()).getByRole('button', { name: /^Not backed up/ }));
    expect(screen.getByText('Episode 12')).toBeTruthy();
    expect(screen.queryByText('Trail guide')).toBeNull();
    expect(within(rail()).getByRole('button', { name: /^Not backed up/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('starts a project from a file, picking the type from the file', async () => {
    const user = userEvent.setup();
    const made: ProjectRec = { id: 'n1', name: 'notes', type: 'text', createdAt: 2, updatedAt: 2, mixer: emptyMixer(), textAssetId: 'x' };
    (idb.createProjectWithAsset as ReturnType<typeof vi.fn>).mockResolvedValue(made);
    open();
    const input = (await screen.findByText(/^Start from a file/)).closest('.np')!.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File(['# Hi'], 'notes.md', { type: 'text/markdown' }));
    await waitFor(() => expect(idb.createProjectWithAsset).toHaveBeenCalledWith('notes.md', 'doc', expect.any(File), 'text'));
    // one file: straight into its workspace
    await waitFor(() => expect(document.querySelector('.st-bar .type-badge')?.textContent).toBe('Text project'));
  });

  it('says which files cannot start a project instead of dropping them silently', async () => {
    const user = userEvent.setup();
    open();
    const input = (await screen.findByText(/^Start from a file/)).closest('.np')!.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File(['a,b'], 'budget.xlsx'));
    expect(idb.createProjectWithAsset).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('budget.xlsx');
  });

  it('leaves the storage limit out when the browser does not report one', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    db.projects = [project];
    open();
    await screen.findByText('Episode 12');
    expect(document.querySelector('.pj-quota')).toBeNull();
  });
});
