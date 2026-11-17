import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../src/i18n';
import { Studio } from '../src/components/Studio';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { emptyMixer, type AssetRec, type ProjectRec } from '../src/lib/studioTypes';
import * as idb from '../src/lib/idb';

// IndexedDB is not in jsdom: Studio talks to this in-memory stand-in instead
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
  id: 'p1', name: 'Podcast cut', type: 'text', createdAt: 1, updatedAt: 1,
  mixer: emptyMixer(), textAssetId: null,
};
// an audio file: no thumbnail is built for it, so no object URLs are needed (jsdom has none)
const asset: AssetRec = {
  id: 'a1', projectId: 'p1', name: 'intro.wav', kind: 'audio',
  blob: new Blob([new Uint8Array(2048)], { type: 'audio/wav' }), addedAt: 1,
};

beforeEach(() => {
  db.projects = [project];
  db.assets = [asset];
  localStorage.clear();
  localStorage.setItem('morphkit-lang', 'en');
  // Studio checks the phone layout query on entry
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openStudio() {
  render(
    <I18nProvider>
      <Studio />
    </I18nProvider>
  );
}

describe('Projects are deleted only after a confirmation', () => {
  // Regression: the × on a project card and "Delete project" deleted at once, with no way back.
  it('asks before deleting a project from the launcher, keeps it on cancel, and can restore it', async () => {
    const user = userEvent.setup();
    openStudio();
    await screen.findByText('Podcast cut');
    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this project?' });
    // the message says what goes with it (1 file, 2.0 KB from the launcher stats)
    await waitFor(() => expect(dialog.textContent).toContain('1 files (2.0 KB)'));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(idb.deleteProject).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(idb.deleteProject).not.toHaveBeenCalled();
    expect(screen.getByText('Podcast cut')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));
    // into the trash, files kept: nothing is deleted from IndexedDB yet
    expect(idb.deleteProject).not.toHaveBeenCalled();
    expect(idb.putProject).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1', deletedAt: expect.any(Number) }));
    await waitFor(() => expect(screen.queryByText('Podcast cut')).toBeNull());
    // the toast puts it straight back
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Podcast cut')).toBeTruthy();
    expect((idb.putProject as ReturnType<typeof vi.fn>).mock.lastCall![0]).not.toHaveProperty('deletedAt');
  });

  it('asks before deleting the open project, then returns to the launcher', async () => {
    const user = userEvent.setup();
    openStudio();
    await user.click(await screen.findByText('Podcast cut'));
    // renaming queues a debounced save (500 ms) that is still pending at the delete
    await user.type(await screen.findByDisplayValue('Podcast cut'), '!');
    await user.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('“Podcast cut!”');
    expect(idb.putProject).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Move to trash' }));
    await screen.findByText(/^A project is work you finish over several sittings/);
    await new Promise((r) => setTimeout(r, 700));
    // Regression: the pending debounced save used to fire after the delete and write the project
    // back as a live one. Exactly one write happens — the trashed record, with the unsaved rename.
    expect(idb.putProject).toHaveBeenCalledTimes(1);
    expect(idb.putProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Podcast cut!', deletedAt: expect.any(Number) }));
    expect(idb.deleteProject).not.toHaveBeenCalled();
  });

  it('asks before removing a file from a project', async () => {
    const user = userEvent.setup();
    openStudio();
    await user.click(await screen.findByText('Podcast cut'));
    await screen.findByText('intro.wav');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('alertdialog', { name: 'Remove this file?' }).textContent).toContain('“intro.wav” (2.0 KB)');
    expect(idb.deleteAsset).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(idb.deleteAsset).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(screen.queryByText('intro.wav')).toBeNull());
  });
});

describe('ConfirmDialog', () => {
  it('a click on the backdrop cancels; only the danger button confirms', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    localStorage.setItem('morphkit-lang', 'en');
    render(
      <I18nProvider>
        <ConfirmDialog title="Delete?" message="Gone for good." confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />
      </I18nProvider>
    );
    await user.click(screen.getByText('Gone for good.'));
    expect(onCancel).not.toHaveBeenCalled();
    await user.click(document.querySelector('.editor-overlay')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
