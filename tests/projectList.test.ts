import { describe, expect, it } from 'vitest';
import { ageGroup, filterCounts, groupByAge, liveFilter, matchesFilter, matchesQuery, projectTypeFor } from '../src/lib/projectList';
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

describe('finding a project', () => {
  it('matches every typed word in the name, in any case', () => {
    const p = rec({ name: 'Episode 12 — Final Cut' });
    expect(matchesQuery(p, '')).toBe(true);
    expect(matchesQuery(p, 'final')).toBe(true);
    expect(matchesQuery(p, '  CUT   episode ')).toBe(true);
    expect(matchesQuery(p, 'final draft')).toBe(false);
    expect(matchesQuery(rec({ name: '第 12 集剪輯' }), '剪輯')).toBe(true);
  });

  it('sorts a date into today, the last 7 days, the last 30 days or older', () => {
    const now = new Date(2026, 10, 18, 9, 0).getTime(); // 18 Nov, 09:00 local time
    const at = (d: number, h = 12) => new Date(2026, 10, d, h, 0).getTime();
    expect(ageGroup(new Date(2026, 10, 18, 0, 0).getTime(), now)).toBe('today'); // since midnight
    expect(ageGroup(at(17, 23), now)).toBe('week'); // yesterday evening: not "today", though under 24 h ago
    expect(ageGroup(now - 7 * 86_400_000 + 1, now)).toBe('week');
    expect(ageGroup(now - 7 * 86_400_000, now)).toBe('month');
    expect(ageGroup(now - 30 * 86_400_000 + 1, now)).toBe('month');
    expect(ageGroup(now - 30 * 86_400_000, now)).toBe('older');
    expect(ageGroup(now + 60_000, now)).toBe('today'); // a clock a little ahead still reads as today
  });

  it('keeps the list order inside each date section and leaves empty sections out', () => {
    const now = new Date(2026, 10, 18, 9, 0).getTime();
    const list = [
      rec({ id: 'a', updatedAt: now - 3_600_000 }),
      rec({ id: 'b', updatedAt: now - 2 * 86_400_000 }),
      rec({ id: 'c', updatedAt: now - 100 * 86_400_000 }),
      rec({ id: 'd', updatedAt: now - 3 * 86_400_000 }),
    ];
    expect(groupByAge(list, now).map((g) => [g.key, g.items.map((p) => p.id)])).toEqual([
      ['today', ['a']],
      ['week', ['b', 'd']],
      ['older', ['c']],
    ]);
  });
});
