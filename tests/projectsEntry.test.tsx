import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../src/i18n';
import { Studio } from '../src/components/Studio';
import { emptyMixer, type AssetRec, type ProjectRec } from '../src/lib/studioTypes';

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

describe('Projects page', () => {
  // The old page opened on an empty "New project" card: nothing said what a project is,
  // where it is kept, or how it differs from converting a file.
  it('explains what a project is on the first visit and offers six things to make', async () => {
    open();
    expect(await screen.findByText(/^A project is work you finish over several sittings/)).toBeTruthy();
    expect(screen.getByText(/kept in this browser/)).toBeTruthy();
    const uses = ['Cut a podcast episode', 'Make a poster, mark up a screenshot', 'Make a GIF sticker', 'Put new music on a video', 'Tidy and merge PDFs', 'Write notes or a document'];
    for (const u of uses) expect(screen.getByRole('button', { name: new RegExp(u) })).toBeTruthy();
    // nothing to sort yet
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
  });

  it('starts the matching project type from a use card', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: /Tidy and merge PDFs/ }));
    // inside the workspace: the type badge in the bar
    await waitFor(() => expect(document.querySelector('.st-bar .type-badge')?.textContent).toBe('PDF project'));
  });

  it('puts existing projects first and shrinks the facts to one line', async () => {
    db.projects = [project];
    db.assets = [asset];
    const counts: number[] = [];
    open((n) => counts.push(n));
    await screen.findByText('Episode 12');
    const note = document.querySelector('.pj-note') as HTMLElement;
    await waitFor(() => expect(note.textContent).toContain('1 projects · 2.0 KB'));
    await waitFor(() => expect(note.textContent).toContain('the browser allows about 2.00 GB'));
    expect(screen.queryByText(/^A project is work you finish/)).toBeNull();
    // the project list comes before the "start a new one" cards
    const card = screen.getByText('Episode 12');
    const firstUse = within(document.querySelector('.pj-uses') as HTMLElement).getAllByRole('button')[0];
    expect(card.compareDocumentPosition(firstUse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeTruthy();
    // the app's nav shows this number
    await waitFor(() => expect(counts[counts.length - 1]).toBe(1));
  });

  it('leaves the storage limit out when the browser does not report one', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    db.projects = [project];
    open();
    await screen.findByText('Episode 12');
    expect((document.querySelector('.pj-note') as HTMLElement).textContent).not.toContain('allows about');
  });
});
