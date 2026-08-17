import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../i18n';
import { Mixer } from './Mixer';
import { ImageEditor } from './ImageEditor';
import { GifEditor } from './GifEditor';
import { InfoTip } from './InfoTip';
import { detectKind, extOf, formatBytes } from '../lib/formats';
import { decodeAssetBuffer, dropAssetBuffer } from '../lib/audioEngine';
import {
  deleteAsset as idbDeleteAsset,
  deleteProject as idbDeleteProject,
  listAssets,
  listProjects,
  putAsset,
  putProject,
} from '../lib/idb';
import {
  emptyMixer,
  uid,
  type AssetRec,
  type Clip,
  type MixerDoc,
  type ProjectRec,
} from '../lib/studioTypes';
import type { Item } from '../types';

const KIND_GLYPH: Record<string, string> = {
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 10 3.5-4.5 2.5 3 2-2.5L18 15H6z',
  audio: 'M9 18a3 3 0 1 1-2-2.83V6l11-2v10a3 3 0 1 1-2-2.83V7.4l-7 1.27V18z',
  video: 'M4 6h11a1 1 0 0 1 1 1v2.5l4-2.5a.6.6 0 0 1 1 .5v9a.6.6 0 0 1-1 .5l-4-2.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
};

/** Media-tab card with live preview (object URL managed per card). */
function MediaCard({ a, onEdit, onRemove, editable }: {
  a: AssetRec;
  onEdit: () => void;
  onRemove: () => void;
  editable: boolean;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(a.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [a.blob]);

  return (
    <div className="media-card">
      <div className="media-thumb">
        {a.kind === 'video'
          ? <video src={url} controls preload="metadata" />
          : <img src={url} alt={a.name} draggable={false} />}
      </div>
      <p className="media-name" title={a.name}>{a.name}</p>
      <div className="media-actions">
        <span className="asset-size">{formatBytes(a.blob.size)}</span>
        <span className="opt-spacer" />
        {editable && (
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>{t('edit')}</button>
        )}
        <a className="btn btn-ghost btn-sm" href={url} download={a.name}>{t('download')}</a>
        <button className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={t('remove')}>×</button>
      </div>
    </div>
  );
}

export function Studio() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectRec[]>([]);
  const [curId, setCurId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRec[]>([]);
  const [doc, setDoc] = useState<MixerDoc>(emptyMixer());
  const [bufVer, setBufVer] = useState(0);
  const [view, setView] = useState<'mix' | 'media'>('mix');
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssetRec | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef(0);
  const curRef = useRef<ProjectRec | null>(null);

  const cur = projects.find((p) => p.id === curId) ?? null;
  useEffect(() => { curRef.current = cur; }, [cur]);

  // ---- init: load / create project ----
  useEffect(() => {
    void (async () => {
      let list = await listProjects();
      if (!list.length) {
        const p: ProjectRec = {
          id: uid(), name: 'Project 1', createdAt: Date.now(), updatedAt: Date.now(), mixer: emptyMixer(),
        };
        await putProject(p);
        list = [p];
      }
      setProjects(list.sort((a, b) => b.updatedAt - a.updatedAt));
      const saved = localStorage.getItem('morphkit-project');
      setCurId(list.some((p) => p.id === saved) ? saved : list[0].id);
    })();
  }, []);

  // ---- switch project: load assets + mixer, warm decode cache ----
  useEffect(() => {
    if (!curId) return;
    try { localStorage.setItem('morphkit-project', curId); } catch { /* ignore */ }
    const proj = projects.find((p) => p.id === curId);
    if (!proj) return;
    setDoc(proj.mixer);
    setActiveTrackId(proj.mixer.tracks[0]?.id ?? null);
    void (async () => {
      const list = await listAssets(curId);
      setAssets(list.sort((a, b) => a.addedAt - b.addedAt));
      const ids = new Set(proj.mixer.tracks.flatMap((tr) => tr.clips.map((c) => c.assetId)));
      for (const id of ids) {
        const a = list.find((x) => x.id === id);
        if (a) {
          try { await decodeAssetBuffer(a.id, a.blob); } catch { /* undecodable */ }
        }
      }
      setBufVer((v) => v + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId, projects.length]);

  const persistDoc = (mixer: MixerDoc) => {
    const c = curRef.current;
    if (!c) return;
    const next = { ...c, mixer, updatedAt: Date.now() };
    setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void putProject(next), 500);
  };

  /** Functional doc update — safe across async boundaries. */
  const updateDoc = (fn: (d: MixerDoc) => MixerDoc) => {
    setDoc((prev) => {
      const next = fn(prev);
      persistDoc(next);
      return next;
    });
  };

  const renameProject = (name: string) => {
    const c = curRef.current;
    if (!c) return;
    const next = { ...c, name, updatedAt: Date.now() };
    setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void putProject(next), 500);
  };

  // ---- project ops ----
  const createProject = async () => {
    const p: ProjectRec = {
      id: uid(), name: `Project ${projects.length + 1}`,
      createdAt: Date.now(), updatedAt: Date.now(), mixer: emptyMixer(),
    };
    await putProject(p);
    setProjects((prev) => [p, ...prev]);
    setCurId(p.id);
  };

  const removeProject = async () => {
    const c = curRef.current;
    if (!c) return;
    await idbDeleteProject(c.id);
    const rest = projects.filter((p) => p.id !== c.id);
    setProjects(rest);
    if (rest.length) setCurId(rest[0].id);
    else void createProject();
  };

  // ---- assets ----
  const importFiles = async (files: File[]) => {
    if (!curId) return;
    const added: AssetRec[] = [];
    for (const f of files) {
      const kind = detectKind(f);
      if (!kind) continue;
      const rec: AssetRec = {
        id: uid(), projectId: curId, name: f.name, kind, blob: f, addedAt: Date.now(),
      };
      await putAsset(rec);
      added.push(rec);
    }
    if (added.length) setAssets((prev) => [...prev, ...added]);
  };

  const removeAsset = async (a: AssetRec) => {
    await idbDeleteAsset(a.id);
    dropAssetBuffer(a.id);
    setAssets((prev) => prev.filter((x) => x.id !== a.id));
    updateDoc((d) => ({
      tracks: d.tracks.map((tr) => ({
        ...tr,
        clips: tr.clips.filter((c) => c.assetId !== a.id),
      })),
    }));
  };

  /** Add audio to the timeline: lands on the focused track, else a new track. */
  const addToMix = async (a: AssetRec, atSec?: number) => {
    try {
      const buf = await decodeAssetBuffer(a.id, a.blob);
      const mkClip = (start: number): Clip => ({
        id: uid(), assetId: a.id, start, offset: 0, duration: buf.duration, gain: 1,
      });
      updateDoc((d) => {
        const act = d.tracks.find((tr) => tr.id === activeTrackId);
        if (act) {
          const end = atSec ?? act.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
          return {
            tracks: d.tracks.map((tr) =>
              tr.id === act.id ? { ...tr, clips: [...tr.clips, mkClip(end)] } : tr
            ),
          };
        }
        const id = uid();
        const short = a.name.replace(/\.[^.]+$/, '').slice(0, 14);
        window.setTimeout(() => setActiveTrackId(id), 0);
        return {
          tracks: [...d.tracks, {
            id, name: short || t('trackName', { n: String(d.tracks.length + 1) }),
            gain: 1, muted: false, solo: false, clips: [mkClip(atSec ?? 0)],
          }],
        };
      });
      setBufVer((v) => v + 1);
      setView('mix');
    } catch { /* not decodable as audio */ }
  };

  const onRecorded = async (blob: Blob, atSec: number) => {
    if (!curId) return;
    const rec: AssetRec = {
      id: uid(), projectId: curId,
      name: `rec_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.webm`,
      kind: 'audio', blob, addedAt: Date.now(),
    };
    await putAsset(rec);
    setAssets((prev) => [...prev, rec]);
    await addToMix(rec, atSec);
  };

  const onEditorSave = async (id: string, file: File) => {
    const a = assets.find((x) => x.id === id);
    if (!a) return;
    const rec: AssetRec = { ...a, blob: file, name: file.name };
    await putAsset(rec);
    setAssets((prev) => prev.map((x) => (x.id === id ? rec : x)));
    setEditing(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void importFiles(Array.from(e.dataTransfer.files));
  };

  const isGifAsset = (a: AssetRec) =>
    ['gif', 'apng'].includes(extOf(a.name)) || a.blob.type === 'image/gif' || a.blob.type === 'image/apng';

  const pseudoItem = (a: AssetRec): Item => ({
    id: a.id,
    file: new File([a.blob], a.name, { type: a.blob.type }),
    kind: 'image',
    target: 'png',
    quality: 0.9,
    status: 'ready',
    progress: 0,
  });

  const names = Object.fromEntries(assets.map((a) => [a.id, a.name]));
  const mediaAssets = assets.filter((a) => a.kind !== 'audio');

  return (
    <div className="studio">
      <div className="st-bar">
        <select className="tb-select" value={curId ?? ''} onChange={(e) => setCurId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {cur && (
          <input className="st-name" value={cur.name} onChange={(e) => renameProject(e.target.value)} />
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void createProject()}>
          {t('newProject')} +
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void removeProject()}>
          {t('deleteProject')}
        </button>
        <InfoTip text={t('tipProjects')} />

        <span className="opt-spacer" />

        <div className="st-tabs" role="group">
          <button className={view === 'mix' ? 'active' : ''} onClick={() => setView('mix')}>
            {t('tabMix')}
          </button>
          <button className={view === 'media' ? 'active' : ''} onClick={() => setView('media')}>
            {t('tabMedia')}
          </button>
        </div>
        <InfoTip text={t('tipTabs')} />
      </div>

      <div className="st-body">
        <aside className="st-assets" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <div className="st-assets-head">
            <span className="mx-label">
              {t('assetsLabel')} <InfoTip text={t('tipAssets')} />
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => importRef.current?.click()}>
              {t('importFiles')}
            </button>
            <input
              ref={importRef}
              type="file"
              multiple
              hidden
              accept="image/*,audio/*,video/*"
              onChange={(e) => {
                void importFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>

          {assets.length === 0 && <p className="st-empty">{t('emptyAssets')}</p>}

          {assets.map((a) => (
            <div className="asset-row" key={a.id}>
              <span className="asset-icon">
                <svg viewBox="0 0 24 24" width="14" height="14"><path d={KIND_GLYPH[a.kind] ?? KIND_GLYPH.image} fill="currentColor" /></svg>
              </span>
              <span className="asset-name" title={a.name}>{a.name}</span>
              <span className="asset-size">{formatBytes(a.blob.size)}</span>
              <span className="asset-btns">
                {(a.kind === 'audio' || a.kind === 'video') && (
                  <button onClick={() => void addToMix(a)} title={t('addToTrack')}>＋</button>
                )}
                {a.kind === 'image' && (
                  <button onClick={() => { setEditing(a); }} title={t('edit')}>
                    <svg viewBox="0 0 24 24" width="12" height="12"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                  </button>
                )}
                <button onClick={() => void removeAsset(a)} title={t('remove')}>×</button>
              </span>
            </div>
          ))}
        </aside>

        <main className="st-main">
          {view === 'mix' ? (
            <Mixer
              doc={doc}
              onChange={(d) => updateDoc(() => d)}
              onRecorded={onRecorded}
              bufVer={bufVer}
              names={names}
              activeTrackId={activeTrackId}
              onActiveTrack={setActiveTrackId}
            />
          ) : (
            <div className="media-view">
              {mediaAssets.length === 0 && <p className="st-empty">{t('noMedia')}</p>}
              <div className="media-grid">
                {mediaAssets.map((a) => (
                  <MediaCard
                    key={`${a.id}-${a.blob.size}`}
                    a={a}
                    editable={a.kind === 'image'}
                    onEdit={() => setEditing(a)}
                    onRemove={() => void removeAsset(a)}
                  />
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {editing && (
        isGifAsset(editing) ? (
          <GifEditor item={pseudoItem(editing)} onSave={onEditorSave} onClose={() => setEditing(null)} />
        ) : (
          <ImageEditor item={pseudoItem(editing)} onSave={onEditorSave} onClose={() => setEditing(null)} />
        )
      )}
    </div>
  );
}
