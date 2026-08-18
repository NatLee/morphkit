import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { GIFEncoder } from 'gifenc';
import { writeGifFrame } from '../lib/animImage';
import { useI18n } from '../i18n';
import { Mixer } from './Mixer';
import { ImageEditor, type Layer } from './ImageEditor';
import { GifEditor } from './GifEditor';
import { VideoWorkspace } from './VideoWorkspace';
import { FramePicker } from './FramePicker';
import { InfoTip } from './InfoTip';
import { Overlay } from './Overlay';
import { createPortal } from 'react-dom';
import { detectKind, extOf, formatBytes } from '../lib/formats';
import { decodeAssetBuffer, dropAssetBuffer } from '../lib/audioEngine';
import { decodeAnim } from '../lib/animImage';
import { convertMedia } from '../lib/ffmpegClient';
import { loadSettings } from '../lib/settings';
import {
  deleteAsset as idbDeleteAsset,
  deleteProject as idbDeleteProject,
  listAssets,
  listProjects,
  putAsset,
  putProject,
} from '../lib/idb';
import {
  emptyImageDoc,
  emptyMixer,
  emptyVideoDoc,
  uid,
  type AssetRec,
  type Clip,
  type MixerDoc,
  type ProjectRec,
  type ProjectType,
  type VideoDoc,
} from '../lib/studioTypes';
import type { Item } from '../types';

const KIND_GLYPH: Record<string, string> = {
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 10 3.5-4.5 2.5 3 2-2.5L18 15H6z',
  audio: 'M9 18a3 3 0 1 1-2-2.83V6l11-2v10a3 3 0 1 1-2-2.83V7.4l-7 1.27V18z',
  video: 'M4 6h11a1 1 0 0 1 1 1v2.5l4-2.5a.6.6 0 0 1 1 .5v9a.6.6 0 0 1-1 .5l-4-2.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  gif: 'M4 5h16v14H4zM4 9h16M8 5v14M16 5v14',
};

const TYPE_META: Record<ProjectType, { labelKey: string; descKey: string; glyph: string }> = {
  audio: { labelKey: 'typeAudio', descKey: 'typeAudioDesc', glyph: KIND_GLYPH.audio },
  image: { labelKey: 'typeImage', descKey: 'typeImageDesc', glyph: KIND_GLYPH.image },
  gif: { labelKey: 'typeGif', descKey: 'typeGifDesc', glyph: KIND_GLYPH.gif },
  video: { labelKey: 'typeVideo', descKey: 'typeVideoDesc', glyph: KIND_GLYPH.video },
};

/** Common canvas sizes offered when starting a blank image project. */
const CANVAS_PRESETS = [
  { label: 'HD', w: 1280, h: 720 },
  { label: 'FHD', w: 1920, h: 1080 },
  { label: '2K', w: 2560, h: 1440 },
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'A4 150dpi', w: 1240, h: 1754 },
  { label: 'Icon', w: 512, h: 512 },
  { label: 'Banner', w: 1500, h: 500 },
];

/** Render an image project (bg + base + layers) to a small preview blob. */
async function flattenImageProject(p: ProjectRec, base: AssetRec): Promise<Blob | null> {
  const bmp = await createImageBitmap(base.blob);
  const TH = 320;
  const s = Math.min(1, TH / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  const g = c.getContext('2d')!;
  const bg = p.imageDoc?.bg;
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  for (const raw of (p.imageDoc?.layers ?? []) as Layer[]) {
    if (!raw?.visible || !raw.src) continue;
    try {
      const lb = await (await fetch(raw.src)).blob();
      const lbmp = await createImageBitmap(lb);
      g.save();
      g.globalAlpha = raw.opacity ?? 1;
      if (raw.blend && raw.blend !== 'normal') {
        g.globalCompositeOperation = raw.blend as GlobalCompositeOperation;
      }
      g.drawImage(lbmp, 0, 0, c.width, c.height);
      g.restore();
      lbmp.close();
    } catch { /* skip bad layer */ }
  }
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

const isGifAsset = (a: AssetRec) =>
  ['gif', 'apng'].includes(extOf(a.name)) || a.blob.type === 'image/gif' || a.blob.type === 'image/apng';

const projectTypeFor = (a: AssetRec): ProjectType =>
  isGifAsset(a) ? 'gif' : a.kind === 'image' ? 'image' : a.kind === 'video' ? 'video' : 'audio';

export function Studio() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectRec[]>([]);
  const [curId, setCurId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRec[]>([]);
  const [bufVer, setBufVer] = useState(0);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [pickType, setPickType] = useState(false);
  const [pjStats, setPjStats] = useState<Record<string, { n: number; bytes: number }>>({});
  const [thumbs, setThumbs] = useState<Record<string, { url: string; video: boolean }>>({});
  const [layout, setLayout] = useState<'grid' | 'list'>(
    () => (localStorage.getItem('mk-layout') as 'grid' | 'list') || 'grid'
  );
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'size'>(
    () => (localStorage.getItem('mk-sort') as 'updated' | 'name' | 'size') || 'updated'
  );
  const [metaPj, setMetaPj] = useState<ProjectRec | null>(null);
  const [blankOpen, setBlankOpen] = useState(false);
  const [imgImport, setImgImport] = useState<Blob | null>(null);
  const [gifImportFrames, setGifImportFrames] = useState<{ img: ImageData; delay: number }[] | null>(null);
  const [framePick, setFramePick] = useState<{ blob: Blob; mode: 'single' | 'range' } | null>(null);
  const [note, setNote] = useState('');
  const [dropHot, setDropHot] = useState(false);
  const [bcW, setBcW] = useState(1280);
  const [bcH, setBcH] = useState(720);
  const importRef = useRef<HTMLInputElement>(null);
  const pjImportRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef(0);
  const curRef = useRef<ProjectRec | null>(null);
  /** ids that exist in IndexedDB — untouched new projects are discarded on exit */
  const persistedRef = useRef<Set<string>>(new Set());
  const thumbUrlsRef = useRef<string[]>([]);

  const setLayoutP = (v: 'grid' | 'list') => {
    setLayout(v);
    try { localStorage.setItem('mk-layout', v); } catch { /* ignore */ }
  };
  const setSortP = (v: 'updated' | 'name' | 'size') => {
    setSortBy(v);
    try { localStorage.setItem('mk-sort', v); } catch { /* ignore */ }
  };

  const cur = projects.find((p) => p.id === curId) ?? null;
  useEffect(() => { curRef.current = cur; }, [cur]);
  const ptype: ProjectType = cur?.type ?? 'audio';

  // ---- init ----
  useEffect(() => {
    void (async () => {
      const list = (await listProjects()).map((p) => ({ ...p, type: p.type ?? ('audio' as ProjectType) }));
      persistedRef.current = new Set(list.map((p) => p.id));
      setProjects(list.sort((a, b) => b.updatedAt - a.updatedAt));
      const saved = localStorage.getItem('morphkit-project');
      if (list.some((p) => p.id === saved)) setCurId(saved);
      else if (list.length) setCurId(list[0].id);
    })();
    return () => {
      thumbUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // ---- switch project: load assets, warm audio cache ----
  useEffect(() => {
    if (!curId) return;
    try { localStorage.setItem('morphkit-project', curId); } catch { /* ignore */ }
    const proj = projects.find((p) => p.id === curId);
    if (!proj) return;
    const mix = proj.type === 'video' ? proj.videoDoc?.mixer : proj.mixer;
    setActiveTrackId(mix?.tracks[0]?.id ?? null);
    void (async () => {
      const list = await listAssets(curId);
      setAssets(list.sort((a, b) => a.addedAt - b.addedAt));
      const ids = new Set((mix?.tracks ?? []).flatMap((tr) => tr.clips.map((c) => c.assetId)));
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

  /** Merge a patch into the current project; debounce the IndexedDB write. */
  const savePatch = (patch: Partial<ProjectRec>) => {
    const c = curRef.current;
    if (!c) return;
    const next = { ...c, ...patch, updatedAt: Date.now() };
    curRef.current = next; // stay fresh across rapid successive patches
    persistedRef.current.add(next.id);
    setProjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void putProject(next), 500);
  };

  const leaveWorkspace = () => {
    const c = curRef.current;
    if (c && !persistedRef.current.has(c.id) && assets.length === 0) {
      // never touched — silently drop the empty project
      setProjects((prev) => prev.filter((p) => p.id !== c.id));
      setCurId(null);
    }
    setEntered(false);
  };

  const patchVideoDoc = (fn: (d: VideoDoc) => VideoDoc) =>
    savePatch({ videoDoc: fn(curRef.current?.videoDoc ?? emptyVideoDoc()) });

  // ---- project ops ----
  const createProject = async (type: ProjectType) => {
    const p: ProjectRec = {
      id: uid(), name: `Project ${projects.length + 1}`, type,
      createdAt: Date.now(), updatedAt: Date.now(), mixer: emptyMixer(),
      ...(type === 'image' ? { imageDoc: emptyImageDoc() } : {}),
      ...(type === 'video' ? { videoDoc: emptyVideoDoc() } : {}),
      ...(type === 'gif' ? { gifAssetId: null } : {}),
    };
    // ephemeral until the user actually does something (savePatch persists)
    setProjects((prev) => [p, ...prev]);
    setCurId(p.id);
    setPickType(false);
    setEntered(true);
  };

  const removeProject = async () => {
    const c = curRef.current;
    if (!c) return;
    await idbDeleteProject(c.id);
    setProjects((prev) => prev.filter((p) => p.id !== c.id));
    setCurId(null);
    setEntered(false);
  };

  const renameProject = (name: string) => savePatch({ name });

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
    if (added.length) {
      setAssets((prev) => [...prev, ...added]);
      // importing assets counts as "touching" the project
      if (curRef.current && !persistedRef.current.has(curRef.current.id)) savePatch({});
    }
  };

  const removeAsset = async (a: AssetRec) => {
    await idbDeleteAsset(a.id);
    dropAssetBuffer(a.id);
    setAssets((prev) => prev.filter((x) => x.id !== a.id));
    const stripMix = (m: MixerDoc): MixerDoc => ({
      tracks: m.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.assetId !== a.id) })),
    });
    const c = curRef.current;
    if (!c) return;
    savePatch({
      mixer: stripMix(c.mixer),
      ...(c.videoDoc ? { videoDoc: { ...c.videoDoc, mixer: stripMix(c.videoDoc.mixer), videoAssetId: c.videoDoc.videoAssetId === a.id ? null : c.videoDoc.videoAssetId } } : {}),
      ...(c.imageDoc?.baseAssetId === a.id ? { imageDoc: { ...c.imageDoc, baseAssetId: null } } : {}),
      ...(c.gifAssetId === a.id ? { gifAssetId: null } : {}),
    });
  };

  const downloadAsset = (a: AssetRec) => {
    const u = URL.createObjectURL(a.blob);
    const el = document.createElement('a');
    el.href = u;
    el.download = a.name;
    el.click();
    window.setTimeout(() => URL.revokeObjectURL(u), 10000);
  };

  /** Append a clip to the focused track (or a fresh one) of a mixer doc. */
  const withClip = (m: MixerDoc, a: AssetRec, durSec: number, atSec?: number): { mixer: MixerDoc; newActive?: string } => {
    const mk = (start: number): Clip => ({ id: uid(), assetId: a.id, start, offset: 0, duration: durSec, gain: 1 });
    const act = m.tracks.find((tr) => tr.id === activeTrackId);
    if (act) {
      const end = atSec ?? act.clips.reduce((x, c) => Math.max(x, c.start + c.duration), 0);
      return {
        mixer: { tracks: m.tracks.map((tr) => (tr.id === act.id ? { ...tr, clips: [...tr.clips, mk(end)] } : tr)) },
      };
    }
    const id = uid();
    const short = a.name.replace(/\.[^.]+$/, '').slice(0, 14) || `Track ${m.tracks.length + 1}`;
    return {
      mixer: { tracks: [...m.tracks, { id, name: short, gain: 1, muted: false, solo: false, clips: [mk(atSec ?? 0)] }] },
      newActive: id,
    };
  };

  const addToMix = async (a: AssetRec, atSec?: number) => {
    try {
      const buf = await decodeAssetBuffer(a.id, a.blob);
      if (ptype === 'video') {
        const res = withClip(curRef.current?.videoDoc?.mixer ?? emptyMixer(), a, buf.duration, atSec);
        patchVideoDoc((d) => ({ ...d, mixer: res.mixer }));
        if (res.newActive) setActiveTrackId(res.newActive);
      } else {
        const res = withClip(curRef.current?.mixer ?? emptyMixer(), a, buf.duration, atSec);
        savePatch({ mixer: res.mixer });
        if (res.newActive) setActiveTrackId(res.newActive);
      }
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

  /** Spin an asset off into its own typed project. */
  const newFromAsset = async (a: AssetRec) => {
    const type = projectTypeFor(a);
    const pid = uid();
    const nid = uid();
    await putAsset({ id: nid, projectId: pid, name: a.name, kind: a.kind, blob: a.blob, addedAt: Date.now() });
    const p: ProjectRec = {
      id: pid,
      name: a.name.replace(/\.[^.]+$/, '').slice(0, 20) || 'Project',
      type, createdAt: Date.now(), updatedAt: Date.now(), mixer: emptyMixer(),
      ...(type === 'image' ? { imageDoc: { baseAssetId: nid, objects: [] } } : {}),
      ...(type === 'gif' ? { gifAssetId: nid } : {}),
      ...(type === 'video' ? { videoDoc: { ...emptyVideoDoc(), videoAssetId: nid } } : {}),
    };
    await putProject(p);
    setProjects((prev) => [p, ...prev]);
    setCurId(pid);
    setEntered(true);
  };

  // ---- launcher stats + thumbnails ----
  useEffect(() => {
    if (entered || !projects.length) return;
    void (async () => {
      thumbUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      thumbUrlsRef.current = [];
      const stats: Record<string, { n: number; bytes: number }> = {};
      const th: Record<string, { url: string; video: boolean }> = {};
      for (const p of projects) {
        const list = await listAssets(p.id);
        stats[p.id] = { n: list.length, bytes: list.reduce((s, a) => s + a.blob.size, 0) };
        const primId = p.imageDoc?.baseAssetId ?? p.gifAssetId ?? p.videoDoc?.videoAssetId ?? null;
        const prim =
          list.find((a) => a.id === primId) ??
          list.find((a) => a.kind === 'image') ??
          list.find((a) => a.kind === 'video') ??
          null;

        // image projects: flatten base + layers so the card shows real work,
        // not the untouched source asset
        if (p.type === 'image' && prim && prim.kind === 'image') {
          try {
            const flat = await flattenImageProject(p, prim);
            if (flat) {
              const u = URL.createObjectURL(flat);
              thumbUrlsRef.current.push(u);
              th[p.id] = { url: u, video: false };
              continue;
            }
          } catch { /* fall through to the raw asset */ }
        }

        if (prim) {
          const u = URL.createObjectURL(prim.blob);
          thumbUrlsRef.current.push(u);
          th[p.id] = { url: u, video: prim.kind === 'video' };
        }
      }
      setPjStats(stats);
      setThumbs(th);
    })();
  }, [entered, projects]);

  const sortedProjects = useMemo(() => {
    const list = [...projects];
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'size') list.sort((a, b) => (pjStats[b.id]?.bytes ?? 0) - (pjStats[a.id]?.bytes ?? 0));
    else list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [projects, sortBy, pjStats]);

  /** White blank canvas asset for image projects. */
  const blankCanvas = async (w: number, h: number) => {
    const cw = Math.min(4096, Math.max(8, Math.round(w)));
    const ch = Math.min(4096, Math.max(8, Math.round(h)));
    // base stays transparent — the white comes from the editable BG layer,
    // otherwise an opaque base would hide background-colour changes
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob || !curId) return;
    const rec: AssetRec = {
      id: uid(), projectId: curId, name: `canvas_${cw}x${ch}.png`, kind: 'image', blob, addedAt: Date.now(),
    };
    await putAsset(rec);
    setAssets((prev) => [...prev, rec]);
    savePatch({ imageDoc: { baseAssetId: rec.id, objects: [], bg: '#ffffff' } });
    setBlankOpen(false);
  };

  /** White single-frame GIF so GIF projects can start from blank. */
  const blankGif = async () => {
    if (!curId) return;
    const w = 480;
    const h = 360;
    const img = new ImageData(w, h);
    img.data.fill(255);
    const enc = GIFEncoder();
    writeGifFrame(enc, img.data, w, h, 100, false);
    enc.finish();
    const blob = new Blob([enc.bytes().slice()], { type: 'image/gif' });
    const rec: AssetRec = {
      id: uid(), projectId: curId, name: 'blank.gif', kind: 'image', blob, addedAt: Date.now(),
    };
    await putAsset(rec);
    setAssets((prev) => [...prev, rec]);
    savePatch({ gifAssetId: rec.id });
  };

  // ---- project zip export / import ----
  const remapMixer = (m: MixerDoc, idMap: Record<string, string>): MixerDoc => ({
    tracks: m.tracks.map((tr) => ({
      ...tr, id: uid(),
      clips: tr.clips.filter((c) => idMap[c.assetId]).map((c) => ({ ...c, id: uid(), assetId: idMap[c.assetId] })),
    })),
  });

  const exportProjectZip = async (p: ProjectRec) => {
    const list = await listAssets(p.id);
    const entries: Record<string, Uint8Array> = {
      'project.json': strToU8(JSON.stringify({
        name: p.name, type: p.type ?? 'audio', mixer: p.mixer,
        imageDoc: p.imageDoc ?? null, videoDoc: p.videoDoc ?? null, gifAssetId: p.gifAssetId ?? null,
        assets: list.map((a) => ({ id: a.id, name: a.name, kind: a.kind, addedAt: a.addedAt, type: a.blob.type })),
      })),
    };
    for (const a of list) entries[`assets/${a.id}`] = new Uint8Array(await a.blob.arrayBuffer());
    const zipped = zipSync(entries);
    const url = URL.createObjectURL(new Blob([zipped.slice()], { type: 'application/zip' }));
    const el = document.createElement('a');
    el.href = url;
    el.download = `${p.name.replace(/[\\/:*?"<>|]/g, '_') || 'project'}.morphkit.zip`;
    el.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const importProjectZip = async (file: File) => {
    try {
      const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const meta = JSON.parse(strFromU8(unzipped['project.json'])) as {
        name: string; type?: ProjectType; mixer: MixerDoc;
        imageDoc?: { baseAssetId: string | null; objects: unknown[] } | null;
        videoDoc?: VideoDoc | null; gifAssetId?: string | null;
        assets: { id: string; name: string; kind: string; addedAt: number; type?: string }[];
      };
      const pid = uid();
      const idMap: Record<string, string> = {};
      for (const a of meta.assets) {
        const data = unzipped[`assets/${a.id}`];
        if (!data) continue;
        const nid = uid();
        idMap[a.id] = nid;
        await putAsset({
          id: nid, projectId: pid, name: a.name, kind: a.kind,
          blob: new Blob([data.slice()], { type: a.type || 'application/octet-stream' }),
          addedAt: a.addedAt,
        });
      }
      const p: ProjectRec = {
        id: pid, name: meta.name || 'Imported', type: meta.type ?? 'audio',
        createdAt: Date.now(), updatedAt: Date.now(),
        mixer: remapMixer(meta.mixer ?? emptyMixer(), idMap),
        ...(meta.imageDoc ? { imageDoc: { baseAssetId: meta.imageDoc.baseAssetId ? idMap[meta.imageDoc.baseAssetId] ?? null : null, objects: meta.imageDoc.objects ?? [] } } : {}),
        ...(meta.videoDoc ? { videoDoc: { videoAssetId: meta.videoDoc.videoAssetId ? idMap[meta.videoDoc.videoAssetId] ?? null : null, trimStart: meta.videoDoc.trimStart, trimEnd: meta.videoDoc.trimEnd, mixer: remapMixer(meta.videoDoc.mixer ?? emptyMixer(), idMap) } } : {}),
        ...(meta.gifAssetId !== undefined ? { gifAssetId: meta.gifAssetId ? idMap[meta.gifAssetId] ?? null : null } : {}),
      };
      await putProject(p);
      setProjects((prev) => [p, ...prev]);
    } catch { /* not a valid project zip */ }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void importFiles(Array.from(e.dataTransfer.files));
  };

  // Ctrl+V anywhere in the studio: pasted files become assets
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!entered) return;
      const files: File[] = [];
      for (const it of Array.from(e.clipboardData?.items ?? [])) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) void importFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, curId]);

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(''), 5000);
  };

  /** Route an asset into the active editor, converting across types as needed. */
  const importAssetToEditor = async (a: AssetRec) => {
    if (ptype === 'image') {
      if (a.kind === 'video') { setFramePick({ blob: a.blob, mode: 'single' }); return; }
      setImgImport(a.blob); // images & GIFs (first frame) become movable layers
      return;
    }
    if (ptype === 'gif') {
      if (a.kind === 'video') { setFramePick({ blob: a.blob, mode: 'range' }); return; }
      if (isGifAsset(a)) {
        const anim = await decodeAnim(new File([a.blob], a.name, { type: a.blob.type }));
        setGifImportFrames(anim.frames.map((f) => ({ img: f.img, delay: f.delay })));
        return;
      }
      // static image → a single appended frame
      const bmp = await createImageBitmap(a.blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      setGifImportFrames([{ img: ctx.getImageData(0, 0, c.width, c.height), delay: 500 }]);
      return;
    }
    if (ptype === 'video' && isGifAsset(a)) {
      // GIF → MP4 so it can be the project's video (size-capped: wasm memory)
      if (a.blob.size > 15 * 1024 * 1024) {
        flash(t('tooBigGif', { n: '15' }));
        return;
      }
      flash(t('processing'));
      try {
        const mp4 = await convertMedia(
          new File([a.blob], a.name, { type: a.blob.type }),
          'mp4', loadSettings(), { mute: true }, () => { /* progress */ }
        );
        const rec: AssetRec = {
          id: uid(), projectId: curId!, name: a.name.replace(/\.[^.]+$/, '') + '.mp4',
          kind: 'video', blob: mp4, addedAt: Date.now(),
        };
        await putAsset(rec);
        setAssets((prev) => [...prev, rec]);
        patchVideoDoc((d) => ({ ...d, videoAssetId: rec.id }));
        setNote('');
      } catch {
        flash(t('failed'));
      }
    }
  };

  /** File dropped on the workspace: keep it as an asset, then route it in. */
  const dropExternalToEditor = async (f: File) => {
    if (!curId) return;
    const kind = detectKind(f);
    if (!kind) return;
    const rec: AssetRec = {
      id: uid(), projectId: curId, name: f.name, kind, blob: f, addedAt: Date.now(),
    };
    await putAsset(rec);
    setAssets((prev) => [...prev, rec]);
    if (!persistedRef.current.has(curId)) savePatch({});
    if (canImportToEditor(rec)) await importAssetToEditor(rec);
  };

  const onFramesPicked = (frames: { img: ImageData; delay: number }[]) => {
    setFramePick(null);
    if (ptype === 'image') {
      const f = frames[0];
      if (!f) return;
      const c = document.createElement('canvas');
      c.width = f.img.width;
      c.height = f.img.height;
      c.getContext('2d')!.putImageData(f.img, 0, 0);
      c.toBlob((b) => { if (b) setImgImport(b); }, 'image/png');
    } else {
      setGifImportFrames(frames);
    }
  };

  /** Which assets can be pulled into the current workspace? */
  const canImportToEditor = (a: AssetRec): boolean => {
    if (ptype === 'image') return !!imgBaseId && (a.kind === 'image' || a.kind === 'video');
    if (ptype === 'gif') return !!cur?.gifAssetId && (a.kind === 'image' || a.kind === 'video');
    if (ptype === 'video') return isGifAsset(a);
    return false;
  };
  const imgBaseId = cur?.imageDoc?.baseAssetId ?? null;

  // ---- workspace helpers ----
  const pseudoItem = (a: AssetRec): Item => ({
    id: a.id,
    file: new File([a.blob], a.name, { type: a.blob.type }),
    kind: 'image',
    target: 'png',
    quality: 0.9,
    status: 'ready',
    progress: 0,
  });

  const imgBase = ptype === 'image' ? assets.find((a) => a.id === cur?.imageDoc?.baseAssetId) ?? null : null;
  const gifAsset = ptype === 'gif' ? assets.find((a) => a.id === cur?.gifAssetId) ?? null : null;
  const videoAsset = ptype === 'video' ? assets.find((a) => a.id === cur?.videoDoc?.videoAssetId) ?? null : null;

  const imgItem = useMemo(
    () => (imgBase ? pseudoItem(imgBase) : null),
    [imgBase?.id, imgBase?.blob]  // eslint-disable-line react-hooks/exhaustive-deps
  );
  const gifItem = useMemo(
    () => (gifAsset ? pseudoItem(gifAsset) : null),
    [gifAsset?.id, gifAsset?.blob]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Raster edits from the canvas are written back to the base asset (debounced). */
  const baseSaveTimer = useRef(0);
  const persistBase = (assetId: string, blob: Blob) => {
    window.clearTimeout(baseSaveTimer.current);
    baseSaveTimer.current = window.setTimeout(() => {
      const a = assets.find((x) => x.id === assetId);
      if (!a) return;
      const rec: AssetRec = { ...a, blob };
      void putAsset(rec);
      // keep the in-memory copy in sync WITHOUT remounting the editor:
      // ImageEditor is keyed by asset id, and the blob identity change would
      // otherwise reset the canvas mid-edit
      const i = assets.findIndex((x) => x.id === assetId);
      if (i >= 0) assets[i] = rec;
      if (curRef.current && !persistedRef.current.has(curRef.current.id)) savePatch({});
    }, 600);
  };

  const replaceAssetBlob = async (id: string, file: File) => {
    const a = assets.find((x) => x.id === id);
    if (!a) return;
    const rec: AssetRec = { ...a, blob: file, name: file.name };
    await putAsset(rec);
    setAssets((prev) => prev.map((x) => (x.id === id ? rec : x)));
  };

  const exportAsset = async (file: File) => {
    if (!curId) return;
    const rec: AssetRec = {
      id: uid(), projectId: curId, name: file.name, kind: 'image', blob: file, addedAt: Date.now(),
    };
    await putAsset(rec);
    setAssets((prev) => [...prev, rec]);
  };

  const names = Object.fromEntries(assets.map((a) => [a.id, a.name]));
  const assetsBytes = assets.reduce((s, a) => s + a.blob.size, 0);

  // ================= launcher =================
  if (!entered) {
    return (
      <div className="studio st-launcher">
        <div className="st-bar">
          <h2 className="launcher-title">{t('projectsTitle')}</h2>
          <InfoTip text={t('tipProjects')} />
          <span className="opt-spacer" />
          <select className="tb-select" value={sortBy} onChange={(e) => setSortP(e.target.value as 'updated' | 'name' | 'size')}>
            <option value="updated">{t('sortUpdated')}</option>
            <option value="name">{t('sortName')}</option>
            <option value="size">{t('sortSize')}</option>
          </select>
          <div className="st-tabs" role="group">
            <button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayoutP('grid')} title="Grid">
              <svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            </button>
            <button className={layout === 'list' ? 'active' : ''} onClick={() => setLayoutP('list')} title="List">
              <svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
          <button className="btn btn-ghost" onClick={() => pjImportRef.current?.click()}>
            {t('importProject')}
          </button>
          <input
            ref={pjImportRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importProjectZip(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className={layout === 'grid' ? 'pj-grid' : 'pj-list'}>
          {sortedProjects.map((p) => (
            <div className="pj-card" key={p.id}>
              <button className="pj-open" onClick={() => { setCurId(p.id); setEntered(true); }}>
                <span className="pj-thumb">
                  {thumbs[p.id] ? (
                    thumbs[p.id].video
                      ? <video src={thumbs[p.id].url} muted preload="metadata" />
                      : <img src={thumbs[p.id].url} alt="" draggable={false} />
                  ) : (
                    <svg viewBox="0 0 24 24" width="26" height="26"><path d={TYPE_META[p.type ?? 'audio'].glyph} fill={(p.type ?? 'audio') === 'gif' ? 'none' : 'currentColor'} stroke={(p.type ?? 'audio') === 'gif' ? 'currentColor' : 'none'} strokeWidth="1.8" /></svg>
                  )}
                </span>
                <span className="pj-body">
                  <span className={`type-badge tb-${p.type ?? 'audio'}`}>
                    {t(TYPE_META[p.type ?? 'audio'].labelKey)}
                  </span>
                  <span className="pj-name">{p.name}</span>
                  <span className="pj-meta">
                    {new Date(p.updatedAt).toLocaleDateString()} · {t('filesCount', { n: String(pjStats[p.id]?.n ?? 0) })} · {formatBytes(pjStats[p.id]?.bytes ?? 0)}
                  </span>
                </span>
              </button>
              <div className="pj-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setMetaPj(p)} title={t('projectInfo')}>
                  <svg viewBox="0 0 24 24" width="13" height="13"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 11v5M12 7.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => void exportProjectZip(p)}>
                  {t('exportProject')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    persistedRef.current.delete(p.id);
                    void idbDeleteProject(p.id).then(() =>
                      setProjects((prev) => prev.filter((x) => x.id !== p.id))
                    );
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}

          <button className="pj-card pj-new" onClick={() => setPickType(true)}>
            <span className="pj-plus">＋</span>
            <span className="pj-name">{t('newProject')}</span>
          </button>
        </div>

        {projects.length === 0 && <p className="st-empty">{t('noProjects')}</p>}

        {/* type picker — overlay modal (portaled: always full-viewport) */}
        {pickType && (
          <Overlay onClick={() => setPickType(false)}>
            <div className="editor type-modal" onClick={(e) => e.stopPropagation()}>
              <p className="mx-label">{t('chooseType')}</p>
              <div className="pj-grid">
                {(Object.keys(TYPE_META) as ProjectType[]).map((tp) => (
                  <button key={tp} className="pj-card pj-type" onClick={() => void createProject(tp)}>
                    <span className="type-icon">
                      <svg viewBox="0 0 24 24" width="22" height="22"><path d={TYPE_META[tp].glyph} fill={tp === 'gif' ? 'none' : 'currentColor'} stroke={tp === 'gif' ? 'currentColor' : 'none'} strokeWidth="1.8" /></svg>
                    </span>
                    <span className="pj-name">{t(TYPE_META[tp].labelKey)}</span>
                    <span className="pj-meta">{t(TYPE_META[tp].descKey)}</span>
                  </button>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setPickType(false)}>{t('cancel')}</button>
            </div>
          </Overlay>
        )}

        {/* project metadata modal */}
        {metaPj && (
          <Overlay onClick={() => setMetaPj(null)}>
            <div className="editor mini-modal" onClick={(e) => e.stopPropagation()}>
              <p className="mx-label">{t('projectInfo')}</p>
              <dl className="fc-details meta-list">
                <div className="fc-detail-row"><dt>{t('fileType')}</dt><dd>{t(TYPE_META[metaPj.type ?? 'audio'].labelKey)}</dd></div>
                <div className="fc-detail-row"><dt>{t('createdLabel')}</dt><dd>{new Date(metaPj.createdAt).toLocaleString()}</dd></div>
                <div className="fc-detail-row"><dt>{t('updatedLabel')}</dt><dd>{new Date(metaPj.updatedAt).toLocaleString()}</dd></div>
                <div className="fc-detail-row"><dt>{t('assetsLabel')}</dt><dd>{t('filesCount', { n: String(pjStats[metaPj.id]?.n ?? 0) })} · {formatBytes(pjStats[metaPj.id]?.bytes ?? 0)}</dd></div>
                <div className="fc-detail-row"><dt>{t('tracksLabel')}</dt><dd>{(metaPj.type === 'video' ? metaPj.videoDoc?.mixer.tracks.length : metaPj.mixer.tracks.length) ?? 0}</dd></div>
              </dl>
              <div className="ed-foot-main">
                <button className="btn btn-ghost" onClick={() => setMetaPj(null)}>{t('close')}</button>
              </div>
            </div>
          </Overlay>
        )}
      </div>
    );
  }

  // ================= workspace =================
  return (
    <div className="studio">
      <div className="st-bar">
        <button className="btn btn-ghost btn-sm" onClick={leaveWorkspace}>
          ← {t('backToProjects')}
        </button>
        <span className={`type-badge tb-${ptype}`}>{t(TYPE_META[ptype].labelKey)}</span>
        {cur && (
          <input className="st-name" value={cur.name} onChange={(e) => renameProject(e.target.value)} />
        )}
        <span className="opt-spacer" />
        {cur && (
          <button className="btn btn-ghost btn-sm" onClick={() => void exportProjectZip(cur)}>
            {t('exportProject')}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void removeProject()}>
          {t('deleteProject')}
        </button>
      </div>

      <div className="st-body">
        <aside className="st-assets" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <div className="st-assets-head">
            <span className="mx-label">
              {t('assetsLabel')} <InfoTip text={t('tipAssets')} />
            </span>
            <span className="asset-size">
              {t('filesCount', { n: String(assets.length) })} · {formatBytes(assetsBytes)}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm st-import" onClick={() => importRef.current?.click()}>
            ↥ {t('importFiles')}
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

          {assets.length === 0 && <p className="st-empty">{t('emptyAssets')}</p>}

          {assets.map((a) => (
            <div
              className={`asset-row${canImportToEditor(a) ? ' asset-draggable' : ''}`}
              key={a.id}
              draggable={canImportToEditor(a)}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-morphkit-asset', a.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="asset-icon">
                <svg viewBox="0 0 24 24" width="14" height="14"><path d={KIND_GLYPH[a.kind] ?? KIND_GLYPH.image} fill="currentColor" /></svg>
              </span>
              <span className="asset-name" title={a.name}>{a.name}</span>
              <span className="asset-size">{formatBytes(a.blob.size)}</span>
              <span className="asset-btns">
                {(ptype === 'audio' || ptype === 'video') && (a.kind === 'audio' || a.kind === 'video') && (
                  <button onClick={() => void addToMix(a)} title={t('addToTrack')}>＋</button>
                )}
                {ptype === 'image' && a.kind === 'image' && !isGifAsset(a) && (
                  <button onClick={() => savePatch({ imageDoc: { baseAssetId: a.id, objects: curRef.current?.imageDoc?.objects ?? [] } })} title={t('pickBase')}>◎</button>
                )}
                {ptype === 'gif' && isGifAsset(a) && (
                  <button onClick={() => savePatch({ gifAssetId: a.id })} title={t('pickGif')}>◎</button>
                )}
                {ptype === 'video' && a.kind === 'video' && (
                  <button onClick={() => patchVideoDoc((d) => ({ ...d, videoAssetId: a.id }))} title={t('pickVideo')}>◎</button>
                )}
                {canImportToEditor(a) && (
                  <button onClick={() => void importAssetToEditor(a)} title={t('importToEditor')}>
                    {/* arrow pointing INTO a frame — distinct from the download glyph */}
                    <svg viewBox="0 0 24 24" width="12" height="12"><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M3 12h10m0 0-3.5-3.5M13 12l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}
                <button onClick={() => newFromAsset(a)} title={t('newFromAsset')}>
                  <svg viewBox="0 0 24 24" width="12" height="12"><path d="M8 8h12v12H8zM4 16V4h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                </button>
                <button onClick={() => downloadAsset(a)} title={t('download')}>
                  <svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button onClick={() => void removeAsset(a)} title={t('remove')}>×</button>
              </span>
            </div>
          ))}
        </aside>

        <main
          className={`st-main${dropHot ? ' drop-hot' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-morphkit-asset') &&
                !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!dropHot) setDropHot(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropHot(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDropHot(false);
            const id = e.dataTransfer.getData('application/x-morphkit-asset');
            if (id) {
              const a = assets.find((x) => x.id === id);
              if (a) void importAssetToEditor(a);
              return;
            }
            // external file dropped straight onto the canvas: store, then import
            const files = Array.from(e.dataTransfer.files);
            if (files.length) void dropExternalToEditor(files[0]);
          }}
        >
          <div className="view-anim" key={ptype + (curId ?? '')}>
            {ptype === 'audio' && cur && (
              <Mixer
                doc={cur.mixer}
                onChange={(m) => savePatch({ mixer: m })}
                onRecorded={onRecorded}
                bufVer={bufVer}
                names={names}
                activeTrackId={activeTrackId}
                onActiveTrack={setActiveTrackId}
              />
            )}

            {ptype === 'image' && (
              !imgBase || !imgItem ? (
                <div className="picker-panel">
                  <p className="mx-label">{t('pickBase')}</p>
                  <div className="picker-list">
                    <button className="btn btn-accent" onClick={() => setBlankOpen(true)}>
                      {t('blankCanvas')}…
                    </button>
                    {assets.filter((a) => a.kind === 'image' && !isGifAsset(a)).map((a) => (
                      <button
                        key={a.id}
                        className="btn btn-ghost"
                        onClick={() => savePatch({ imageDoc: { baseAssetId: a.id, objects: [] } })}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                  <p className="st-empty">{t('noneOfKind')}</p>
                </div>
              ) : (
                <ImageEditor
                  inline
                  key={imgBase.id}
                  item={imgItem}
                  initialLayers={(cur?.imageDoc?.layers ?? []) as Layer[]}
                  bg={cur?.imageDoc?.bg ?? null}
                  onLayersChange={(ls) =>
                    savePatch({
                      imageDoc: {
                        baseAssetId: imgBase.id,
                        objects: [], // superseded by layers
                        layers: ls,
                        bg: curRef.current?.imageDoc?.bg ?? null,
                      },
                    })
                  }
                  onBgChange={(c) =>
                    savePatch({
                      imageDoc: {
                        baseAssetId: imgBase.id,
                        objects: [],
                        layers: curRef.current?.imageDoc?.layers ?? [],
                        bg: c,
                      },
                    })
                  }
                  onBaseChange={(blob) => persistBase(imgBase.id, blob)}
                  onSave={(_id, file) => void exportAsset(file)}
                  importBlob={imgImport}
                  onImportDone={() => setImgImport(null)}
                />
              )
            )}

            {ptype === 'gif' && (
              !gifAsset || !gifItem ? (
                <div className="picker-panel">
                  <p className="mx-label">{t('pickGif')}</p>
                  <div className="picker-list">
                    <button className="btn btn-accent" onClick={() => void blankGif()}>
                      {t('blankGif')}
                    </button>
                    {assets.filter(isGifAsset).map((a) => (
                      <button key={a.id} className="btn btn-ghost" onClick={() => savePatch({ gifAssetId: a.id })}>
                        {a.name}
                      </button>
                    ))}
                  </div>
                  <p className="st-empty">{t('noneOfKind')}</p>
                </div>
              ) : (
                <GifEditor
                  inline
                  key={`${gifAsset.id}-${gifAsset.blob.size}`}
                  item={gifItem}
                  onSave={(id, file) => void replaceAssetBlob(id, file)}
                  importFrames={gifImportFrames}
                  onImportDone={() => setGifImportFrames(null)}
                />
              )
            )}

            {ptype === 'video' && cur && (
              <VideoWorkspace
                videoAsset={videoAsset}
                candidates={assets.filter((a) => a.kind === 'video')}
                doc={cur.videoDoc ?? emptyVideoDoc()}
                onDoc={patchVideoDoc}
                onRecorded={onRecorded}
                bufVer={bufVer}
                names={names}
                activeTrackId={activeTrackId}
                onActiveTrack={setActiveTrackId}
                projectName={cur.name}
              />
            )}
          </div>
        </main>
      </div>

      {note && createPortal(<div className="banner info st-note">{note}</div>, document.body)}

      {framePick && (
        <FramePicker
          blob={framePick.blob}
          mode={framePick.mode}
          onDone={onFramesPicked}
          onClose={() => setFramePick(null)}
        />
      )}

      {/* blank canvas size modal */}
      {blankOpen && (
        <Overlay onClick={() => setBlankOpen(false)}>
          <div className="editor mini-modal canvas-modal" onClick={(e) => e.stopPropagation()}>
            <p className="mx-label">{t('blankCanvas')}</p>

            <div className="preset-grid">
              {CANVAS_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`preset${bcW === p.w && bcH === p.h ? ' active' : ''}`}
                  onClick={() => { setBcW(p.w); setBcH(p.h); }}
                >
                  <span className="preset-name">{p.label}</span>
                  <span className="preset-dim">{p.w}×{p.h}</span>
                </button>
              ))}
            </div>

            <div className="size-row">
              <label className="size-field">
                <span>W</span>
                <input type="number" min={8} max={4096} value={bcW} onChange={(e) => setBcW(Number(e.target.value))} />
              </label>
              <button
                className="tool-btn"
                title={t('swapSides')}
                onClick={() => { setBcW(bcH); setBcH(bcW); }}
              >⇄</button>
              <label className="size-field">
                <span>H</span>
                <input type="number" min={8} max={4096} value={bcH} onChange={(e) => setBcH(Number(e.target.value))} />
              </label>
              <span className="asset-size">px · max 4096</span>
            </div>
            <div className="ed-foot-main">
              <button className="btn btn-ghost" onClick={() => setBlankOpen(false)}>{t('cancel')}</button>
              <button className="btn btn-accent" onClick={() => void blankCanvas(bcW, bcH)}>{t('applyLabel')}</button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
