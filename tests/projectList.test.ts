import { describe, expect, it } from 'vitest';
import { filterCounts, liveFilter, matchesFilter, projectTypeFor } from '../src/lib/projectList';
import { emptyMixer, type ProjectRec } from '../src/lib/studioTypes';

const rec = (p: Partial<ProjectRec>): ProjectRec => ({ id: 'p', name: 'P', type: 'audio', createdAt: 1, updatedAt: 1000, mixer: emptyMixer(), ...p });
const list = [
  rec({ id: 'a', type: 'audio' }),
  rec({ id: 'b', type: 'pdf', exportedAt: 1000 }), // backed up
  rec({ id: 'c', type: 'pdf', updatedAt: 2000, exportedAt: 1000 }), // changed since
  rec({ id: 'd', type: undefined }), // legacy record = audio
];

describe('project filters', () => {
  it('puts a project under its type, and under "not backed up" unless its backup is current', () => {
    expect(list.filter((p) => matchesFilter(p, 'pdf')).map((p) => p.id)).toEqual(['b', 'c']);
    expect(list.filter((p) => matchesFilter(p, 'audio')).map((p) => p.id)).toEqual(['a', 'd']);
    expect(list.filter((p) => matchesFilter(p, 'unsaved')).map((p) => p.id)).toEqual(['a', 'c', 'd']);
    expect(list.filter((p) => matchesFilter(p, 'all'))).toHaveLength(4);
    expect(list.filter((p) => matchesFilter(p, 'trash'))).toHaveLength(0);
  });

  it('counts what each filter holds', () => {
    expect(filterCounts(list, 3)).toMatchObject({ all: 4, audio: 2, pdf: 2, image: 0, unsaved: 3, trash: 3 });
  });

  it('falls back to everything when the chosen filter has emptied out', () => {
    expect(liveFilter('pdf', list, 0)).toBe('pdf');
    expect(liveFilter('video', list, 0)).toBe('all');
    expect(liveFilter('trash', list, 2)).toBe('trash');
    expect(liveFilter('trash', list, 0)).toBe('all');
    expect(liveFilter('unsaved', [rec({ exportedAt: 1000 })], 0)).toBe('all');
  });
});

describe('the project a file starts', () => {
  it('follows the file kind, with animated images as GIF projects', () => {
    expect(projectTypeFor('poster.png', 'image')).toBe('image');
    expect(projectTypeFor('sticker.gif', 'image')).toBe('gif');
    expect(projectTypeFor('sticker.apng', 'image')).toBe('gif');
    expect(projectTypeFor('pasted', 'image', 'image/gif')).toBe('gif');
    expect(projectTypeFor('intro.mp3', 'audio')).toBe('audio');
    expect(projectTypeFor('trip.mov', 'video')).toBe('video');
    expect(projectTypeFor('guide.pdf', 'pdf')).toBe('pdf');
  });

  it('opens only text-like documents as text projects', () => {
    expect(projectTypeFor('notes.md', 'doc')).toBe('text');
    expect(projectTypeFor('readme.txt', 'doc')).toBe('text');
    expect(projectTypeFor('data.json', 'doc')).toBe('text');
    expect(projectTypeFor('budget.xlsx', 'doc')).toBeNull();
    expect(projectTypeFor('deck.pptx', 'doc')).toBeNull();
    expect(projectTypeFor('letter.docx', 'doc')).toBeNull();
    expect(projectTypeFor('mystery.bin', 'unknown')).toBeNull();
  });
});
