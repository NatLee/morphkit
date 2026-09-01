import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { zipSync } from 'fflate';
import { Hero } from './components/Hero';
import { DropZone } from './components/DropZone';
import { FileCard } from './components/FileCard';
import { SettingsPanel } from './components/SettingsPanel';
import { FormatMatrix } from './components/FormatMatrix';
import { MediaEditor } from './components/MediaEditor';
import { InstallPrompt } from './components/InstallPrompt';
import { Studio } from './components/Studio';
import { ImageEditor } from './components/ImageEditor';
import { GifEditor } from './components/GifEditor';
import { PdfEditor } from './components/PdfEditor';
import { PdfPasswordModal } from './components/PdfPasswordModal';
import { DocEditor } from './components/DocEditor';
import { QrTool } from './components/QrTool';
import { SheetEditor } from './components/SheetEditor';
import { LANGS, useI18n } from './i18n';
import { defaultTarget, detectKind, docTypeOf, extOf, formatBytes, isTextDoc, outputFileName } from './lib/formats';
import { convertImage } from './lib/imageConvert';
import { convertAnimImage } from './lib/animImage';
import { convertMedia, isEngineReady } from './lib/ffmpegClient';
import { extractMeta } from './lib/metadata';
import { convertDoc } from './lib/docs';
import { closePdf, imageToPdf, mergeToPdf, openPdf, PdfPasswordError, pdfToImages, pdfToText, rasterizePdf } from './lib/pdf';
import { loadSettings, saveSettings, type Settings } from './lib/settings';
import { createProjectWithAsset } from './lib/idb';
import type { ProjectType } from './lib/studioTypes';
import type { Item, MediaEdit } from './types';

let uid = 0;
type EngineState = 'idle' | 'loading' | 'ready' | 'error';

/** 'auto' follows the OS (app-like default); light/dark are manual overrides. */
type ThemePref = 'auto' | 'light' | 'dark';

const THEME_COLORS = { light: '#f2f5fb', dark: '#0a0e1c' } as const;

/** Flip the page theme + keep the browser/PWA chrome color in sync
    (initial values come from the index.html inline script). */
function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.dataset.theme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[resolved]);
}

function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const s = localStorage.getItem('morphkit-theme');
      return s === 'light' || s === 'dark' ? s : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  );

  // auto mode follows the OS live — flipping the system theme retints the app
  useEffect(() => {
    if (pref !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const r = mq.matches ? 'dark' : 'light';
      setTheme(r);
      applyTheme(r);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);

  // cycle auto → light → dark → auto (the auto effect above re-resolves)
  const toggle = () =>
    setPref((prev) => {
      const next: ThemePref = prev === 'auto' ? 'light' : prev === 'light' ? 'dark' : 'auto';
      if (next !== 'auto') {
        setTheme(next);
        applyTheme(next);
      }
      try { localStorage.setItem('morphkit-theme', next); } catch { /* ignore */ }
      return next;
    });

  return { theme, pref, toggle };
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const { pref, toggle } = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [engine, setEngine] = useState<EngineState>('idle');
  const [engineDl, setEngineDl] = useState<{ received: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState('');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'convert' | 'studio'>('convert');
  // set by "open as project" so Studio skips its launcher and opens the new project
  const [studioEnterId, setStudioEnterId] = useState<string | null>(null);
  // encrypted PDF awaiting its password (item id)
  const [pwFor, setPwFor] = useState<string | null>(null);
  // QR tool modal: null = closed, '' = generator, text = reader with that payload
  const [qrOpen, setQrOpen] = useState<string | null>(null);

  const itemsRef = useRef<Item[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // counting semaphore — caps concurrent media jobs at settings.concurrency
  const runningRef = useRef(0);
  const waitersRef = useRef<(() => void)[]>([]);

  const acquireSlot = () =>
    new Promise<void>((resolve) => {
      if (runningRef.current < settingsRef.current.concurrency) {
        runningRef.current++;
        resolve();
      } else {
        waitersRef.current.push(() => {
          runningRef.current++;
          resolve();
        });
      }
    });

  const releaseSlot = () => {
    runningRef.current--;
    waitersRef.current.shift()?.();
  };

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  const patch = (id: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const addFiles = (files: File[]) => {
    const bad: string[] = [];
    const good: Item[] = [];
    for (const f of files) {
      const kind = detectKind(f);
      if (!kind) { bad.push(f.name); continue; }
      const target = defaultTarget(kind, f);
      good.push({
        id: `f${++uid}`,
        file: f,
        kind,
        target,
        quality: settingsRef.current.defaultQuality,
        status: 'ready',
        progress: 0,
      });
    }
    if (good.length) {
      setItems((prev) => [...prev, ...good]);
      // extract metadata (dims / duration / EXIF / GPS) in the background
      for (const it of good) {
        extractMeta(it.file, it.kind).then((meta) => patch(it.id, { meta }));
      }
    }
    if (bad.length) {
      setSkipped(bad.join(', '));
      window.setTimeout(() => setSkipped(''), 6000);
    }
  };

  /** New Markdown note (from Ctrl+V text or the DropZone link) — added AND opened in the editor. */
  let noteN = 0;
  const addNote = (text = '') => {
    const n = itemsRef.current.filter((i) => /^note-\d+\.md$/.test(i.file.name)).length + 1 + noteN++;
    const f = new File([text], `note-${n}.md`, { type: 'text/markdown' });
    const id = `f${++uid}`;
    setItems((prev) => [...prev, { id, file: f, kind: 'doc', target: 'pdf', quality: 0.9, status: 'ready', progress: 0 }]);
    extractMeta(f, 'doc').then((meta) => patch(id, { meta }));
    setEditingId(id);
  };

  const runConvert = async (id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) return;
    if (item.outUrl) URL.revokeObjectURL(item.outUrl);
    patch(id, { status: 'converting', progress: 0, outUrl: undefined });
    try {
      let blob: Blob;
      let outName = outputFileName(item.file.name, item.target);
      if (item.kind === 'doc') {
        // documents: html intermediate → md/txt/html/docx/pdf/png, sheets → csv/xlsx/json
        const r = await convertDoc(item.file, item.target, (p) => patch(id, { progress: p }), { pdfText: settingsRef.current.docPdfText, pageSize: settingsRef.current.docPageSize, fontSize: settingsRef.current.docFontSize });
        blob = r.blob;
        if (r.multi) outName = outName.replace(/\.[^.]+$/, '.zip');
      } else if (item.kind === 'pdf') {
        // pdf.js render / text extraction / pdf-lib re-save — no ffmpeg involved
        const onP = (p: number) => patch(id, { progress: p });
        const pw = item.pdfPassword;
        const enc = !!item.meta?.encrypted;
        if (item.target === 'txt') blob = await pdfToText(item.file, onP, pw);
        else if (item.target === 'docx' || item.target === 'md' || item.target === 'html') {
          // text-layer export: paragraphs from pdf.js text, re-flowed through the doc pipeline
          const txt = await (await pdfToText(item.file, (p) => onP(p * 0.6), pw)).text();
          const { convertDoc: cd } = await import('./lib/docs');
          blob = (await cd(new File([txt], item.file.name.replace(/\.pdf$/i, '.txt'), { type: 'text/plain' }), item.target, (p) => onP(0.6 + p * 0.4))).blob;
        }
        else if (item.target === 'pdf') {
          try {
            blob = await mergeToPdf([{ file: item.file, password: pw, encrypted: enc }], onP);
          } catch (e) {
            if (e instanceof PdfPasswordError) throw e;
            blob = await rasterizePdf(item.file, pw, onP); // plan B: qpdf couldn't decrypt
          }
        } else {
          const r = await pdfToImages(item.file, item.target as 'png' | 'jpeg' | 'webp', item.quality, settingsRef.current.imageMaxDim, onP, pw, settingsRef.current.pdfImageScale);
          blob = r.blob;
          if (r.multi) outName = outName.replace(/\.[^.]+$/, '.zip'); // one file per page
        }
      } else if (item.kind === 'image') {
        if (item.target === 'pdf') {
          blob = await imageToPdf(item.file);
        } else if (item.target === 'apng' || item.target === 'gif') {
          // animated pipeline — keeps every frame; APNG preserves alpha
          blob = await convertAnimImage(item.file, item.target);
        } else {
          blob = await convertImage(
            item.file,
            item.target as 'png' | 'jpeg' | 'webp',
            item.quality,
            settingsRef.current.imageMaxDim
          );
        }
      } else {
        if (!isEngineReady()) setEngine('loading');
        try {
          blob = await convertMedia(
            item.file,
            item.target,
            settingsRef.current,
            item.edit,
            (p) => patch(id, { progress: p }),
            (received, total) => setEngineDl({ received, total })
          );
          setEngine('ready');
          setEngineDl(null);
        } catch (e) {
          if (!isEngineReady()) { setEngine('error'); setEngineDl(null); }
          throw e;
        }
      }
      patch(id, {
        status: 'done',
        progress: 1,
        outUrl: URL.createObjectURL(blob),
        outName,
        outSize: blob.size,
      });
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        // password missing/stale — back to ready and ask
        patch(id, { status: 'ready', progress: 0, pdfPassword: undefined });
        setPwFor(id);
        return;
      }
      patch(id, { status: 'error' });
    }
  };

  const schedule = (id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item || item.status === 'converting' || item.status === 'queued') return;
    if (item.kind === 'pdf' && item.meta?.encrypted && !item.pdfPassword) { setPwFor(id); return; }
    if (item.kind === 'image' && item.target !== 'pdf') {
      // images are near-instant — run immediately, no queue (PDF work goes through the semaphore)
      void runConvert(id);
      return;
    }
    patch(id, { status: 'queued' });
    void (async () => {
      await acquireSlot();
      try {
        // re-check: the item may have been removed while waiting
        if (itemsRef.current.some((i) => i.id === id)) await runConvert(id);
      } finally {
        releaseSlot();
      }
    })();
  };

  const convertAll = () => {
    for (const it of itemsRef.current) {
      if (it.status === 'ready' || it.status === 'error') schedule(it.id);
    }
  };

  const revokePreview = (it?: Item) => {
    if (it?.meta?.preview?.startsWith('blob:')) URL.revokeObjectURL(it.meta.preview);
  };

  const remove = (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it?.outUrl) URL.revokeObjectURL(it.outUrl);
    revokePreview(it);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearAll = () => {
    for (const it of itemsRef.current) {
      if (it.outUrl) URL.revokeObjectURL(it.outUrl);
      revokePreview(it);
    }
    setItems([]);
  };

  /** Every PDF + image in list order → one PDF download (images become full-bleed pages). */
  const [merging, setMerging] = useState(false);
  const mergeAll = async () => {
    const items = itemsRef.current.filter((i) => i.kind === 'pdf' || i.kind === 'image');
    if (items.length < 2) return;
    const locked = items.find((i) => i.kind === 'pdf' && i.meta?.encrypted && !i.pdfPassword);
    if (locked) { setPwFor(locked.id); return; } // unlock first, then merge again
    const src = items.map((i) => ({ file: i.file, password: i.pdfPassword, encrypted: !!i.meta?.encrypted }));
    setMerging(true);
    try {
      const blob = await mergeToPdf(src);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'morphkit-merged.pdf';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { /* undecodable input — nothing to download */ } finally {
      setMerging(false);
    }
  };

  const downloadAll = async () => {
    const done = itemsRef.current.filter((i) => i.status === 'done' && i.outUrl && i.outName);
    if (!done.length) return;
    const entries: Record<string, Uint8Array> = {};
    for (const it of done) {
      const buf = await fetch(it.outUrl as string).then((r) => r.arrayBuffer());
      let name = it.outName as string;
      let n = 1;
      while (entries[name]) name = (it.outName as string).replace(/(\.[^.]+)$/, `_${n++}$1`);
      entries[name] = new Uint8Array(buf);
    }
    const zipped = zipSync(entries);
    const url = URL.createObjectURL(new Blob([zipped.slice()], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'morphkit.zip';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // global paste: Ctrl+V with a file (e.g. a screenshot) adds it to the list
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingId || showSettings || qrOpen != null) return;
      const files: File[] = [];
      for (const it of Array.from(e.clipboardData?.items ?? [])) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        addFiles(files);
        return;
      }
      // plain text → a Markdown note item (opens straight into the editor)
      const txt = e.clipboardData?.getData('text/plain');
      if (txt && txt.trim() && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        addNote(txt);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, showSettings, qrOpen]);

  // close settings drawer on Escape
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSettings(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings]);

  // ---- editors ----
  const editingItem = editingId ? items.find((i) => i.id === editingId) ?? null : null;
  const isGifItem = (it: Item) =>
    it.kind === 'image' && (
      ['gif', 'apng'].includes(extOf(it.file.name)) ||
      it.file.type === 'image/gif' ||
      it.file.type === 'image/apng'
    );

  /** Send a queued file into Studio as a fresh typed project and jump there. */
  const openAsProject = async (id: string) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (!it) return;
    if (it.kind === 'doc' && !isTextDoc(it.file)) return; // only text-ish docs become projects
    const type: ProjectType = isGifItem(it) ? 'gif' : it.kind === 'doc' ? 'text' : (it.kind as ProjectType);
    const p = await createProjectWithAsset(it.file.name, it.kind, it.file, type);
    try { localStorage.setItem('morphkit-project', p.id); } catch { /* ignore */ }
    setStudioEnterId(p.id);
    setMode('studio');
  };

  const saveMediaEdit = (id: string, edit: MediaEdit | undefined) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it?.outUrl) URL.revokeObjectURL(it.outUrl);
    patch(id, { edit, status: 'ready', outUrl: undefined, progress: 0 });
    setEditingId(null);
  };

  const saveEditedImage = (id: string, file: File) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it?.outUrl) URL.revokeObjectURL(it.outUrl);
    revokePreview(it);
    patch(id, { file, edited: true, status: 'ready', outUrl: undefined, progress: 0 });
    extractMeta(file, 'image').then((meta) => patch(id, { meta }));
    setEditingId(null);
  };

  /** Edited document replaces the source file (same format), like saveEditedImage. */
  const saveEditedDoc = (id: string, file: File) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it?.outUrl) URL.revokeObjectURL(it.outUrl);
    patch(id, { file, edited: true, status: 'ready', outUrl: undefined, progress: 0 });
    extractMeta(file, 'doc').then((meta) => patch(id, { meta }));
    setEditingId(null);
  };

  /** Edited PDF is itself the deliverable — mirrors saveEditedGif. */
  const saveEditedPdf = (id: string, file: File) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it?.outUrl) URL.revokeObjectURL(it.outUrl);
    revokePreview(it);
    patch(id, {
      file,
      edited: true,
      status: 'done',
      progress: 1,
      outUrl: URL.createObjectURL(file),
      outName: file.name,
      outSize: file.size,
    });
    // the export is plain (or freshly encrypted with a NEW password) — the old password is void
    patch(id, { pdfPassword: undefined });
    extractMeta(file, 'pdf').then((meta) => patch(id, { meta }));
    setEditingId(null);
  };

  /** Verify the password with pdf.js, then remember it on the item and re-probe metadata. */
  const unlockPdf = async (id: string, pw: string): Promise<boolean> => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (!it) return false;
    try {
      const doc = await openPdf(await it.file.arrayBuffer(), pw);
      await closePdf(doc);
    } catch (e) {
      if (e instanceof PdfPasswordError) return false;
      throw e;
    }
    patch(id, { pdfPassword: pw });
    extractMeta(it.file, 'pdf', pw).then((meta) => patch(id, { meta: { ...meta, encrypted: true } }));
    return true;
  };

  const saveEditedGif = (id: string, file: File) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it?.outUrl) URL.revokeObjectURL(it.outUrl);
    revokePreview(it);
    // edited GIF is itself the deliverable — mark done with a ready download
    patch(id, {
      file,
      edited: true,
      status: 'done',
      progress: 1,
      outUrl: URL.createObjectURL(file),
      outName: file.name,
      outSize: file.size,
    });
    extractMeta(file, 'image').then((meta) => patch(id, { meta }));
    setEditingId(null);
  };

  const hasVideo = items.some((i) => i.kind === 'video');
  const mergeable = items.filter((i) => i.kind === 'pdf' || i.kind === 'image').length;
  const pending = items.filter((i) => i.status === 'ready' || i.status === 'error').length;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const activeCount = items.filter((i) => i.status === 'converting' || i.status === 'queued').length;
  const totalSize = items.reduce((s, i) => s + i.file.size, 0);
  const overall = items.length
    ? items.reduce(
        (s, i) => s + (i.status === 'done' ? 1 : i.status === 'converting' ? i.progress : 0),
        0
      ) / items.length
    : 0;
  const dlPct = engineDl && engineDl.total > 0
    ? Math.min(100, Math.round((engineDl.received / engineDl.total) * 100))
    : 0;

  return (
    <div className={`app${mode === 'studio' ? ' studio-mode' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              {/* chamfered cyber mark, mirrors the favicon */}
              <defs>
                <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--paint-red)" />
                </linearGradient>
              </defs>
              <path d="M6 1h20l5 5v20l-5 5H6l-5-5V6z" fill="var(--mark-bg)" />
              <path d="M10 21V11l6 6 6-6v10" stroke="url(#brand-g)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-name">MorphKit</span>
        </div>

        <div className="topbar-actions">
          <button
            className={`studio-toggle${mode === 'studio' ? ' active' : ''}`}
            onClick={() => {
              setMode((m) => (m === 'studio' ? 'convert' : 'studio'));
              setStudioEnterId(null); // manual toggle always lands on the launcher
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 6h16M4 12h10M4 18h13M18 10v8m-2.5-2.5L18 18l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {mode === 'studio' ? t('backLabel') : 'Studio'}
          </button>
          <button className="theme-toggle qr-btn" onClick={() => setQrOpen('')} aria-label={t('qrTitle')} title={t('qrTitle')}>
            <svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 18h2v2h-2zM14 20h1M20 18v2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          </button>
          <div className="lang-switch" role="group">
            {LANGS.map((l) => (
              <button
                key={l.code}
                className={lang === l.code ? 'active' : ''}
                onClick={() => setLang(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <button
            className={`theme-toggle${showSettings ? ' active' : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            aria-label={t('settings')}
            title={t('settings')}
          >
            <svg viewBox="0 0 24 24" width="17" height="17"><path d="M10.3 3.6a2 2 0 0 1 3.4 0l.6 1a2 2 0 0 0 2.1.9l1.1-.2a2 2 0 0 1 2.3 2.3l-.2 1.1a2 2 0 0 0 .9 2.1l1 .6a2 2 0 0 1 0 3.4l-1 .6a2 2 0 0 0-.9 2.1l.2 1.1a2 2 0 0 1-2.3 2.3l-1.1-.2a2 2 0 0 0-2.1.9l-.6 1a2 2 0 0 1-3.4 0l-.6-1a2 2 0 0 0-2.1-.9l-1.1.2a2 2 0 0 1-2.3-2.3l.2-1.1a2 2 0 0 0-.9-2.1l-1-.6a2 2 0 0 1 0-3.4l1-.6a2 2 0 0 0 .9-2.1l-.2-1.1A2 2 0 0 1 6.5 5.3l1.1.2a2 2 0 0 0 2.1-.9z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          </button>
          <button
            className="theme-toggle"
            onClick={toggle}
            aria-label={t(pref === 'auto' ? 'themeAuto' : pref === 'light' ? 'themeLight' : 'themeDark')}
            title={t(pref === 'auto' ? 'themeAuto' : pref === 'light' ? 'themeLight' : 'themeDark')}
          >
            {pref === 'auto' ? (
              // half-filled circle = follow the system
              <svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" /></svg>
            ) : pref === 'light' ? (
              <svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4m0-12.8 1.4-1.4M4.2 19.8l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="17" height="17"><path d="M20.4 14.5A8.5 8.5 0 0 1 9.5 3.6a8.5 8.5 0 1 0 10.9 10.9z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            )}
          </button>
        </div>
      </header>

      {mode === 'studio' ? (
        <main>
          <Studio enterProjectId={studioEnterId} />
        </main>
      ) : (
      <main>
        <Hero compact={items.length > 0} />

        <section className="workbench">
          <DropZone onFiles={addFiles} compact={items.length > 0} onNewNote={() => addNote()} />

          {engine === 'loading' && (
            <div className="banner info engine-banner">
              <span className="spinner" aria-hidden="true" />
              <div className="engine-dl">
                <span>{t('engineLoading')}</span>
                {engineDl && (
                  <>
                    <div className="fc-progress engine-progress">
                      <div className="fc-bar" style={{ width: `${dlPct}%` }} />
                    </div>
                    <span className="fc-pct">
                      {formatBytes(engineDl.received)} / {formatBytes(engineDl.total)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          {engine === 'error' && <div className="banner danger">{t('engineError')}</div>}
          {skipped && <div className="banner warn">{t('unsupported', { names: skipped })}</div>}
          {hasVideo && <div className="banner note">{t('warnVideo')}</div>}

          {items.length > 0 && (
            <>
              <div className="batch-bar">
                <div className="bb-info">
                  <span className="bb-count">
                    {t('filesSummary', { n: String(items.length), size: formatBytes(totalSize) })}
                  </span>
                  {(doneCount > 0 || activeCount > 0) && (
                    <span className="bb-progress-wrap">
                      <span className="bb-progress">
                        <span className="bb-bar" style={{ width: `${Math.round(overall * 100)}%` }} />
                      </span>
                      <span className="bb-done">
                        {t('progressSummary', { done: String(doneCount), total: String(items.length) })}
                      </span>
                    </span>
                  )}
                </div>
                <div className="bb-actions">
                  <button className="btn btn-accent" onClick={convertAll} disabled={pending === 0}>
                    {t('convertAll')}
                  </button>
                  {mergeable > 1 && (
                    <button className="btn btn-ghost" onClick={() => void mergeAll()} disabled={merging} title={t('mergePdfTip')}>
                      {merging ? t('processing') : t('mergePdf')}
                    </button>
                  )}
                  {doneCount > 1 && (
                    <button className="btn btn-ghost" onClick={downloadAll}>
                      {t('downloadAll')}
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={clearAll}>
                    {t('clearAll')}
                  </button>
                </div>
              </div>
              <div className="file-list">
                {items.map((item) => (
                  <FileCard
                    key={item.id}
                    item={item}
                    onTarget={(id, target) => patch(id, { target, status: 'ready', outUrl: undefined })}
                    onQuality={(id, quality) => patch(id, { quality })}
                    onConvert={schedule}
                    onRemove={remove}
                    onEdit={setEditingId}
                    onToProject={(id) => void openAsProject(id)}
                    onUnlock={setPwFor}
                    onQr={(text) => setQrOpen(text)}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <FormatMatrix />
      </main>
      )}

      {editingItem && (
        isGifItem(editingItem) ? (
          <GifEditor item={editingItem} onSave={saveEditedGif} onClose={() => setEditingId(null)} />
        ) : editingItem.kind === 'image' ? (
          <ImageEditor item={editingItem} onSave={saveEditedImage} onClose={() => setEditingId(null)} />
        ) : editingItem.kind === 'pdf' ? (
          <PdfEditor item={editingItem} onSave={saveEditedPdf} onClose={() => setEditingId(null)} />
        ) : editingItem.kind === 'doc' && docTypeOf(editingItem.file) === 'sheet' ? (
          <SheetEditor item={editingItem} onSave={saveEditedDoc} onClose={() => setEditingId(null)} />
        ) : editingItem.kind === 'doc' ? (
          <DocEditor item={editingItem} onSave={saveEditedDoc} onClose={() => setEditingId(null)} />
        ) : (
          <MediaEditor item={editingItem} onSave={saveMediaEdit} onClose={() => setEditingId(null)} />
        )
      )}

      {qrOpen != null && (
        <QrTool initialDecoded={qrOpen || null} onAddImage={(f) => addFiles([f])} onClose={() => setQrOpen(null)} />
      )}

      {pwFor && (() => {
        const it = items.find((i) => i.id === pwFor);
        return it ? (
          <PdfPasswordModal
            fileName={it.file.name}
            onSubmit={async (pw) => { const ok = await unlockPdf(it.id, pw); if (ok) setPwFor(null); return ok; }}
            onCancel={() => setPwFor(null)}
          />
        ) : null;
      })()}

      {showSettings && (
        <div className="drawer-overlay" onClick={() => setShowSettings(false)}>
          <aside
            className="drawer"
            role="dialog"
            aria-label={t('settings')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>{t('settings')}</h2>
              <button
                className="theme-toggle"
                onClick={() => setShowSettings(false)}
                aria-label={t('close')}
              >
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </button>
            </div>
            <SettingsPanel settings={settings} onChange={updateSettings} />
            <button className="btn btn-ghost drawer-bottom-close" onClick={() => setShowSettings(false)}>
              {t('close')}
            </button>
          </aside>
        </div>
      )}

      <InstallPrompt />

      {/* phone-only bottom tab bar (hidden >640px via CSS) — the app-like
          primary nav; mirrors topbar Studio toggle + settings drawer.
          PORTALED to <body>: .app is a stacking context (z-index:1), so the
          bar's z95 was trapped under body-portaled overlays like the QR sheet
          (z90 at body level beats the whole .app) */}
      {createPortal(
      <nav className="m-tabbar" aria-label="MorphKit">
        <button
          className={mode === 'convert' && !showSettings ? 'active' : ''}
          onClick={() => { setMode('convert'); setShowSettings(false); }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h11m0 0-3-3m3 3-3 3M20 17H9m0 0 3-3m-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{t('tabConvert')}</span>
        </button>
        <button
          className={mode === 'studio' && !showSettings ? 'active' : ''}
          onClick={() => {
            setMode('studio');
            setStudioEnterId(null);
            setShowSettings(false);
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 6h16M4 12h10M4 18h13M18 10v8m-2.5-2.5L18 18l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Studio</span>
        </button>
        <button className={qrOpen != null ? 'active' : ''} onClick={() => setQrOpen((v) => (v == null ? '' : null))}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 18h2v2h-2zM14 20h1M20 18v2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          <span>QR</span>
        </button>
        <button className={showSettings ? 'active' : ''} onClick={() => setShowSettings((v) => !v)}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M10.3 3.6a2 2 0 0 1 3.4 0l.6 1a2 2 0 0 0 2.1.9l1.1-.2a2 2 0 0 1 2.3 2.3l-.2 1.1a2 2 0 0 0 .9 2.1l1 .6a2 2 0 0 1 0 3.4l-1 .6a2 2 0 0 0-.9 2.1l.2 1.1a2 2 0 0 1-2.3 2.3l-1.1-.2a2 2 0 0 0-2.1.9l-.6 1a2 2 0 0 1-3.4 0l-.6-1a2 2 0 0 0-2.1-.9l-1.1.2a2 2 0 0 1-2.3-2.3l.2-1.1a2 2 0 0 0-.9-2.1l-1-.6a2 2 0 0 1 0-3.4l1-.6a2 2 0 0 0 .9-2.1l-.2-1.1A2 2 0 0 1 6.5 5.3l1.1.2a2 2 0 0 0 2.1-.9z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          <span>{t('tabSettings')}</span>
        </button>
      </nav>,
      document.body)}

      <footer className="footer">
        <p>
          <a
            className="footer-link"
            href="https://github.com/NatLee/morphkit"
            target="_blank"
            rel="noreferrer"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" fill="currentColor" /></svg>
            NatLee/morphkit
          </a>
        </p>
      </footer>
    </div>
  );
}
