import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { strToU8, zipSync } from 'fflate';
import { I18nProvider } from '../src/i18n';
import { Studio } from '../src/components/Studio';
import { backupState, emptyMixer, TRASH_DAYS, trashDaysLeft, trashExpired, type AssetRec, type ProjectRec } from '../src/lib/studioTypes';
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

const DAY = 86_400_000;
const NOW = Date.now();
const rec = (p: Partial<ProjectRec>): ProjectRec => ({ id: 'p1', name: 'Episode 12', type: 'audio', createdAt: 1, updatedAt: 1000, mixer: emptyMixer(), ...p });
const lastPut = () => (idb.putProject as ReturnType<typeof vi.fn>).mock.lastCall![0] as ProjectRec;

beforeEach(() => {
  db.projects = [];
  db.assets = [];
  localStorage.clear();
  localStorage.setItem('morphkit-lang', 'en');
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const open = () => render(<I18nProvider><Studio /></I18nProvider>);

describe('trash rules', () => {
  it('counts the days a deleted project has left', () => {
    expect(trashDaysLeft(rec({ deletedAt: NOW }), NOW)).toBe(TRASH_DAYS);
    expect(trashDaysLeft(rec({ deletedAt: NOW - 3 * DAY }), NOW)).toBe(TRASH_DAYS - 3);
    expect(trashDaysLeft(rec({ deletedAt: NOW - 29.5 * DAY }), NOW)).toBe(1);
    expect(trashExpired(rec({ deletedAt: NOW - 29.5 * DAY }), NOW)).toBe(false);
    expect(trashExpired(rec({ deletedAt: NOW - TRASH_DAYS * DAY }), NOW)).toBe(true);
    expect(trashExpired(rec({}), NOW)).toBe(false);
  });

  it('calls a backup current only while nothing changed after it', () => {
    expect(backupState(rec({}))).toBe('never');
    expect(backupState(rec({ updatedAt: 1000, exportedAt: 1000 }))).toBe('fresh');
    expect(backupState(rec({ updatedAt: 2000, exportedAt: 1000 }))).toBe('stale');
  });
});

describe('trash on the Projects page', () => {
  it('keeps deleted projects out of the list, restorable from the trash', async () => {
    const user = userEvent.setup();
    db.projects = [rec({ id: 'live', name: 'Poster' }), rec({ id: 'gone', name: 'Old cut', deletedAt: NOW - 3 * DAY })];
    open();
    await screen.findByText('Poster');
    expect(screen.queryByText('Old cut')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Trash/ }));
    const row = screen.getByText('Old cut').closest('li') as HTMLElement;
    expect(row.textContent).toContain(`${TRASH_DAYS - 3} days left`);
    await user.click(within(row).getByRole('button', { name: 'Restore' }));
    expect(lastPut()).toMatchObject({ id: 'gone', name: 'Old cut' });
    expect(lastPut()).not.toHaveProperty('deletedAt');
    // back among the projects, and the empty trash section is gone
    await waitFor(() => expect(screen.getByText('Old cut').closest('.pj-card')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Trash/ })).toBeNull();
  });

  it('deletes for good only from the trash, after its own confirmation', async () => {
    const user = userEvent.setup();
    db.projects = [rec({ id: 'gone', name: 'Old cut', deletedAt: NOW - DAY })];
    open();
    await user.click(await screen.findByRole('button', { name: /Trash/ }));
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete for good?' }).textContent).toContain('“Old cut”');
    expect(idb.deleteProject).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete for good' }));
    expect(idb.deleteProject).toHaveBeenCalledWith('gone');
    await waitFor(() => expect(screen.queryByText('Old cut')).toBeNull());
  });

  it('empties itself of projects that waited the full time', async () => {
    db.projects = [
      rec({ id: 'due', name: 'Ancient', deletedAt: NOW - (TRASH_DAYS + 1) * DAY }),
      rec({ id: 'kept', name: 'Recent', deletedAt: NOW - DAY }),
    ];
    open();
    await screen.findByRole('button', { name: /Trash/ });
    expect(idb.deleteProject).toHaveBeenCalledTimes(1);
    expect(idb.deleteProject).toHaveBeenCalledWith('due');
  });
});

describe('backups', () => {
  it('says which projects exist only in this browser', async () => {
    db.projects = [
      rec({ id: 'a', name: 'Saved one', updatedAt: 1000, exportedAt: 1000 }),
      rec({ id: 'b', name: 'Edited since', updatedAt: 2000, exportedAt: 1000 }),
      rec({ id: 'c', name: 'Never saved' }),
    ];
    open();
    const card = async (name: string) => (await screen.findByText(name)).closest('.pj-card') as HTMLElement;
    expect((await card('Saved one')).textContent).toContain('Backed up');
    expect((await card('Edited since')).textContent).toContain('Changed since the backup');
    expect((await card('Never saved')).textContent).toContain('No backup yet');
    // the rail counts them and lists them on a click
    expect(screen.getByRole('button', { name: /^Not backed up/ }).textContent).toContain('2');
  });

  it('marks a project as backed up when it is exported, without counting that as an edit', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
    db.projects = [rec({ id: 'c', name: 'Never saved', updatedAt: 1000 })];
    open();
    const card = (await screen.findByText('Never saved')).closest('.pj-card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'More for “Never saved”' }));
    await user.click(screen.getByRole('menuitem', { name: /^Export project/ }));
    await waitFor(() => expect(card.textContent).toContain('Backed up'));
    // written through the project's debounced save (500 ms)
    await waitFor(() => expect(idb.putProject).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastPut()).toMatchObject({ id: 'c', updatedAt: 1000 });
    expect(lastPut().exportedAt).toBeGreaterThanOrEqual(1000);
  });

  // Regression: importing an exported image project dropped its layers and background colour —
  // the backup the page tells people to make did not bring their work back.
  it('restores everything an exported image project had', async () => {
    const user = userEvent.setup();
    const layers = [{ id: 'l1', name: 'Title', visible: true, opacity: 1, src: 'data:image/png;base64,AAAA' }];
    const zip = zipSync({
      'project.json': strToU8(JSON.stringify({
        name: 'Poster', type: 'image', mixer: emptyMixer(),
        imageDoc: { baseAssetId: 'old-asset', objects: [], layers, bg: '#102030' },
        assets: [{ id: 'old-asset', name: 'base.png', kind: 'image', addedAt: 5, type: 'image/png' }],
      })),
      'assets/old-asset': new Uint8Array([1, 2, 3]),
    });
    open();
    await screen.findByText(/^A project is work you finish/);
    await user.upload(document.querySelector('input[type=file][accept=".zip"]') as HTMLInputElement, new File([zip], 'Poster.morphkit.zip', { type: 'application/zip' }));
    await screen.findByText('Poster');
    const saved = lastPut();
    expect(saved.imageDoc?.layers).toEqual(layers);
    expect(saved.imageDoc?.bg).toBe('#102030');
    // the base asset got a new id, and the project points at it
    const newAsset = (idb.putAsset as ReturnType<typeof vi.fn>).mock.lastCall![0] as AssetRec;
    expect(newAsset.id).not.toBe('old-asset');
    expect(saved.imageDoc?.baseAssetId).toBe(newAsset.id);
  });
});
