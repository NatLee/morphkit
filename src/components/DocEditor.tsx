import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { docEditSource, docSave, previewHtml, type EditMode } from '../lib/docs';
import { docTypeOf } from '../lib/formats';
import type { Item } from '../types';

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose: () => void;
}

/**
 * Document editor — a source pane + live preview. The source is whatever the format edits
 * best: Markdown for .md AND .docx (docx round-trips through HTML→MD→HTML→docx, lossy for
 * exotic Word features), raw HTML, CSV for spreadsheets (first sheet), JSON, or plain text.
 * Save re-generates the ORIGINAL format (lib/docs `docSave`) and replaces the Item's file.
 */
export function DocEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<EditMode>('text');
  const [text, setText] = useState('');
  const [orig, setOrig] = useState('');
  const [sheetName, setSheetName] = useState<string | undefined>();
  const [html, setHtml] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'split' | 'source' | 'preview'>('split');
  const [wrap, setWrap] = useState(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const type = docTypeOf(item.file);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const src = await docEditSource(item.file);
        if (!alive) return;
        setMode(src.mode);
        setText(src.text);
        setOrig(src.text);
        setSheetName(src.sheetName);
        setLoaded(true);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [item.file]);

  // debounced preview
  useEffect(() => {
    if (!loaded) return;
    const h = window.setTimeout(() => {
      void previewHtml(mode, text).then(setHtml).catch(() => setHtml(''));
    }, 250);
    return () => window.clearTimeout(h);
  }, [text, mode, loaded]);

  const save = async () => {
    setBusy(true);
    try {
      onSave(item.id, await docSave(item.file, mode, text, sheetName));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  // Tab inserts a tab / Ctrl+S saves / Esc closes
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      const next = text.slice(0, s) + '\t' + text.slice(en);
      setText(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1; });
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text ? text.split('\n').length : 0;
  const dirty = text !== orig;
  const modeLabel = { md: 'Markdown', text: t('docModeText'), html: 'HTML', csv: `CSV${sheetName ? ` · ${sheetName}` : ''}`, json: 'JSON' }[mode];

  const body = (
    <div className="editor-overlay" onClick={busy ? undefined : onClose}>
      <div className={`editor editor-wide doc-editor view-${view}`} role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="ed-toolbar doc-tools">
          <span className="chip">{modeLabel}</span>
          {type === 'docx' && <span className="ed-hint">{t('docDocxHint')}</span>}
          {type === 'sheet' && sheetName && <span className="ed-hint">{t('docSheetHint')}</span>}
          <span className="opt-spacer" />
          <div className="ed-seg">
            <button className={view === 'source' ? 'active' : ''} onClick={() => setView('source')}>{t('docSource')}</button>
            <button className={view === 'split' ? 'active' : ''} onClick={() => setView('split')}>{t('docSplit')}</button>
            <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>{t('pdfPreview')}</button>
          </div>
          <button className={`btn btn-ghost btn-sm${wrap ? ' active' : ''}`} onClick={() => setWrap((w) => !w)} title={t('docWrap')}>↩</button>
        </div>

        <div className="doc-body">
          {view !== 'preview' && (
            <textarea
              ref={taRef}
              className="doc-source"
              value={text}
              spellCheck={false}
              wrap={wrap ? 'soft' : 'off'}
              disabled={!loaded || error}
              placeholder={error ? t('docLoadError') : loaded ? '' : t('processing')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
          )}
          {view !== 'source' && (
            <div className="doc-preview">
              {/* sanitized by lib/docs (scripts/handlers stripped) before it gets here */}
              <div className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          )}
        </div>

        <div className="ed-foot">
          <span className="ed-hint">
            {error ? t('docLoadError') : `${t('docStats', { words: String(words), lines: String(lines), chars: String(text.length) })}${dirty ? ` · ${t('docUnsaved')}` : ''}`}
            <span className="kbd-hints"> · <kbd>Ctrl</kbd>+<kbd>S</kbd> {t('save')}</span>
          </span>
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={() => void save()} disabled={busy || !loaded || error}>
              {busy ? t('processing') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
