import { extOf, isTextDoc } from './formats';
import { backupState, type ProjectRec, type ProjectType } from './studioTypes';

/**
 * What the Projects page lists: every project, one project type, the ones whose latest state is
 * not in a backup, or the trash. The left rail (a row of chips on phones) picks one.
 */
export type ProjectFilter = 'all' | ProjectType | 'unsaved' | 'trash';

/** Legacy records have no type: they are audio projects (invariant 14). */
export const typeOf = (p: ProjectRec): ProjectType => p.type ?? 'audio';

/** Does a LIVE project belong under this filter? (the trash is its own list) */
export function matchesFilter(p: ProjectRec, filter: ProjectFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'trash') return false;
  if (filter === 'unsaved') return backupState(p) !== 'fresh';
  return typeOf(p) === filter;
}

/**
 * The filter in effect. A choice that has emptied out (the last PDF project was deleted, the trash
 * was emptied, every project got backed up) falls back to everything instead of an empty page.
 */
export function liveFilter(filter: ProjectFilter, projects: readonly ProjectRec[], trashCount: number): ProjectFilter {
  if (filter === 'trash') return trashCount > 0 ? 'trash' : 'all';
  return filter === 'all' || projects.some((p) => matchesFilter(p, filter)) ? filter : 'all';
}

/** How many live projects each filter holds (the numbers on the rail). */
export function filterCounts(projects: readonly ProjectRec[], trashCount: number): Record<ProjectFilter, number> {
  const counts = { all: projects.length, unsaved: 0, trash: trashCount, audio: 0, image: 0, gif: 0, video: 0, pdf: 0, text: 0 };
  for (const p of projects) {
    counts[typeOf(p)]++;
    if (backupState(p) !== 'fresh') counts.unsaved++;
  }
  return counts;
}

const ANIMATED = new Set(['gif', 'apng']);

/**
 * The project a file starts. One rule for every way in: a file dropped on "new project", an
 * asset spun off into its own project, and a converter card's "save as project".
 * `null` = it cannot be a project (spreadsheets, slides and Word files do not edit as text).
 */
export function projectTypeFor(name: string, kind: string, mime = ''): ProjectType | null {
  if (kind === 'image') return ANIMATED.has(extOf(name)) || mime === 'image/gif' || mime === 'image/apng' ? 'gif' : 'image';
  if (kind === 'audio' || kind === 'video' || kind === 'pdf') return kind;
  if (kind === 'doc') return isTextDoc({ name }) ? 'text' : null;
  return null;
}

/** Does a project's name hold every word typed in the search box? (case-insensitive) */
export function matchesQuery(p: ProjectRec, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const name = p.name.toLocaleLowerCase();
  return words.every((w) => name.includes(w));
}

/** The date sections of a list sorted by "last changed": today, the 7 and 30 days before, older. */
export type AgeGroup = 'today' | 'week' | 'month' | 'older';
const DAY_MS = 86_400_000;

export function ageGroup(updatedAt: number, now: number): AgeGroup {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (updatedAt >= midnight.getTime()) return 'today';
  const age = now - updatedAt;
  if (age < 7 * DAY_MS) return 'week';
  if (age < 30 * DAY_MS) return 'month';
  return 'older';
}

/** Split a list (already in the order it is shown) into its date sections; empty sections are left out. */
export function groupByAge(list: readonly ProjectRec[], now: number): { key: AgeGroup; items: ProjectRec[] }[] {
  const order: AgeGroup[] = ['today', 'week', 'month', 'older'];
  const groups = new Map<AgeGroup, ProjectRec[]>(order.map((k) => [k, []]));
  for (const p of list) groups.get(ageGroup(p.updatedAt, now))!.push(p);
  return order.filter((k) => groups.get(k)!.length).map((k) => ({ key: k, items: groups.get(k)! }));
}
