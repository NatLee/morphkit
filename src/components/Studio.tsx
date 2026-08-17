import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../i18n';
import { Mixer } from './Mixer';
import { ImageEditor } from './ImageEditor';
import { GifEditor } from './GifEditor';
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
  type MixerDoc,
  type ProjectRec,
} from '../lib/studioTypes';
import type { Item } from '../types';

const KIND_GLYPH: Record<string, string> = {
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 10 3.5-4.5 2.5 3 2-2.5L18 15H6z',
  audio: 'M9 18a3 3 0 1 1-2-2.83V6l11-2v10a3 3 0 1 1-2-2.83V7.4l-7 1.27V18z',
  video: 'M4 6h11a1 1 0 0 1 1 1v2.5l4-2.5a.6.6 0 0 1 1 .5v9a.6.6 0 0 1-1 .5l-4-2.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
};

export function Studio() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectRec[]>([]);
  const [curId, setCurId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRec[]>([]);
  const [doc, setDoc] = useState<MixerDoc>(emptyMixer());
  const [bufVer, setBufVer] = useState(0);
  const [editing, setEditing] = useState<AssetRec | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef(0);

  const cur = projects.find((p) => p.id === curId) ?? null;

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

  const persist = (patch: Partial<ProjectRec>) => {
    if (!cur) return;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void putProject(next), 500);
  };

  const updateDoc = (d: MixerDoc) => {
    setDoc(d);
    persist({ mixer: d });
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
    if (!cur) return;
    await idbDeleteProject(cur.id);
    const rest = projects.filter((p) => p.id !== cur.id);
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
    updateDoc({
      tracks: doc.tracks.map((tr) => ({
        ...tr,
        clips: tr.clips.filter((c) => c.assetId !== a.id),
      })),
    });
  };

  /** Add an audio/video asset to the timeline as a new track. */
  const addToMix = async (a: AssetRec, atSec = 0) => {
    try {
      const buf = await decodeAssetBuffer(a.id, a.blob);
      const short = a.name.replace(/\.[^.]+$/, '').slice(0, 14);
      updateDoc({
        tracks: [...doc.tracks, {
          id: uid(), name: short || t('trackName', { n: String(doc.tracks.length + 1) }),
          gain: 1, muted: false, solo: false,
          clips: [{ id: uid(), assetId: a.id, start: atSec, offset: 0, duration: buf.duration, gain: 1 }],
        }],
      });
      setBufVer((v) => v + 1);
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

  return (
    <div className="studio">
      <div className="st-bar">
        <select
          className="tb-select"
          value={curId ?? ''}
          onChange={(e) => setCurId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {cur && (
          <input
            className="st-name"
            value={cur.name}
            onChange={(e) => persist({ name: e.target.value })}
          />
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void createProject()}>
          {t('newProject')} +
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void removeProject()}>
          {t('deleteProject')}
        </button>
      </div>

      <div className="st-body">
        <aside
          className="st-assets"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <div className="st-assets-head">
            <span className="mx-label">{t('assetsLabel')}</span>
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
                  <button onClick={() => setEditing(a)} title={t('edit')}>
                    <svg viewBox="0 0 24 24" width="12" height="12"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                  </button>
                )}
                <button onClick={() => void removeAsset(a)} title={t('remove')}>×</button>
              </span>
            </div>
          ))}
        </aside>

        <main className="st-main">
          <Mixer doc={doc} onChange={updateDoc} onRecorded={onRecorded} bufVer={bufVer} names={names} />
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
