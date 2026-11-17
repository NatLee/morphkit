import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n';
import { listProjects } from '../lib/idb';
import { TYPE_META, typeOf } from '../lib/projectList';
import { isTrashed, type ProjectRec } from '../lib/studioTypes';

/** How many projects the home page offers to pick up again. */
export const RECENT_PROJECTS = 3;

/**
 * Home page "Continue": the projects changed last, one click back into each. Shown only when there
 * are projects; it reads the same IndexedDB list as the Projects page and stores nothing of its own.
 */
export function RecentProjects({ onOpen, onAll }: { onOpen: (id: string) => void; onAll: () => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<ProjectRec[]>([]);
  useEffect(() => {
    let stale = false;
    listProjects()
      .then((all) => {
        if (!stale) setList(all.filter((p) => !isTrashed(p)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_PROJECTS));
      })
      .catch(() => { /* no IndexedDB (private window): nothing to continue */ });
    return () => { stale = true; };
  }, []);
  if (!list.length) return null;
  return (
    <section className="recent" aria-labelledby="recent-title">
      <h2 id="recent-title">{t('recentTitle')}</h2>
      <div className="recent-list">
        {list.map((p) => {
          const ty = typeOf(p);
          return (
            <button key={p.id} type="button" className="recent-pj" style={{ '--c': TYPE_META[ty].color } as CSSProperties} onClick={() => onOpen(p.id)}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d={TYPE_META[ty].glyph} fill={ty === 'gif' ? 'none' : 'currentColor'} stroke={ty === 'gif' ? 'currentColor' : 'none'} strokeWidth="1.8" />
              </svg>
              <span>
                <b>{p.name}</b>
                <small>{t(TYPE_META[ty].labelKey)} · {new Date(p.updatedAt).toLocaleDateString()}</small>
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="recent-all" onClick={onAll}>{t('recentAll')}</button>
    </section>
  );
}
