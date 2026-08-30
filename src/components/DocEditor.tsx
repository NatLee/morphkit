import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { docEditSource, docSave, previewHtml, type EditMode } from '../lib/docs';
import { docTypeOf } from '../lib/formats';
import type { Item } from '../types';

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose?: () => void;
  /** Studio workspace mode: renders in place, save writes back to the asset */
  inline?: boolean;
}

/**
 * Document editor — a source pane + live preview. The source is whatever the format edits
 * best: Markdown for .md, .txt AND .docx/.pptx (regenerated on save), raw HTML, CSV for
 * spreadsheets (first sheet), JSON, or plain text. Markdown mode gets a formatting toolbar
 * (headings, marks, lists, link/image, table picker, code, quote, hr) plus MorphKit specials:
 * TOC generator, date stamp, CSV/TSV-selection → table, and inline QR-code image insertion.
 */
export function DocEditor({ item, onSave, onClose, inline }: Props) {
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
  const [pop, setPop] = useState<'table' | 'qr' | null>(null);
  const [tblDim, setTblDim] = useState<{ r: number; c: number }>({ r: 2, c: 3 });
  const [qrText, setQrText] = useState('https://');
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

  // ---------- markdown editing helpers (selection-aware; focus restored after each action) ----------
  const apply = (next: string, selStart: number, selEnd: number) => {
    setText(next);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };
  const sel = () => {
    const ta = taRef.current;
    if (!ta) return { s: text.length, e: text.length, chunk: '' };
    return { s: ta.selectionStart, e: ta.selectionEnd, chunk: text.slice(ta.selectionStart, ta.selectionEnd) };
  };
  /** wrap the selection with markers (or insert a selected placeholder) */
  const wrapSel = (before: string, after = before, placeholder = 'text') => {
    const { s, e, chunk } = sel();
    const body = chunk || placeholder;
    apply(text.slice(0, s) + before + body + after + text.slice(e), s + before.length, s + before.length + body.length);
  };
  /** transform every selected line (headings replace an existing #-prefix; lists re-prefix) */
  const linesSel = (fn: (line: string, i: number) => string) => {
    const { s, e } = sel();
    const start = text.lastIndexOf('\n', s - 1) + 1;
    const endIdx = text.indexOf('\n', Math.max(e, s));
    const end = endIdx === -1 ? text.length : endIdx;
    const block = text.slice(start, end).split('\n').map(fn).join('\n');
    apply(text.slice(0, start) + block + text.slice(end), start, start + block.length);
  };
  /** insert a standalone block at the cursor, padded with blank lines */
  const insertBlock = (block: string) => {
    const { s, e } = sel();
    const before = text.slice(0, s);
    const after = text.slice(e);
    const pre = before.length && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const post = after.length && !after.startsWith('\n') ? '\n\n' : '\n';
    apply(before + pre + block + post + after, s + pre.length, s + pre.length + block.length);
  };
  const heading = (level: number) =>
    linesSel((l) => (level === 0 ? l.replace(/^#{1,6}\s+/, '') : `${'#'.repeat(level)} ${l.replace(/^#{1,6}\s+/, '')}`));
  const insertLink = () => {
    const { chunk } = sel();
    if (/^https?:\/\//.test(chunk)) wrapSel('[', `](${chunk})`, chunk); // selected a URL → link it
    else wrapSel('[', '](https://)', chunk || t('mdLinkText'));
  };
  const insertTable = (rows: number, cols: number) => {
    const head = `| ${Array.from({ length: cols }, (_, i) => `${t('mdCol')} ${i + 1}`).join(' | ')} |`;
    const sepr = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
    const row = `| ${Array.from({ length: cols }, () => '   ').join(' | ')} |`;
    insertBlock([head, sepr, ...Array.from({ length: rows }, () => row)].join('\n'));
    setPop(null);
  };
  /** generate a linked table of contents from the document's headings */
  const insertToc = () => {
    const items: string[] = [];
    let fence = false;
    for (const l of text.split('\n')) {
      if (/^```/.test(l)) { fence = !fence; continue; }
      if (fence) continue;
      const m = /^(#{1,4})\s+(.+)/.exec(l);
      if (!m) continue;
      const title = m[2].replace(/[*_`~[\]]/g, '').trim();
      const slug = title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
      items.push(`${'  '.repeat(m[1].length - 1)}- [${title}](#${slug})`);
    }
    insertBlock(items.length ? items.join('\n') : `- ${t('mdTocEmpty')}`);
  };
  /** selected CSV/TSV → markdown table (quote-aware, delimiter auto-detected) */
  const csvToTable = () => {
    const { s, e, chunk } = sel();
    const src = chunk.trim();
    if (!src || (!src.includes('\n') && !/[\t,]/.test(src))) { insertBlock(`<!-- ${t('mdCsvHint')} -->`); return; }
    const rows = src.split(/\r?\n/).filter((r) => r.trim());
    const d = (rows[0].match(/\t/g)?.length ?? 0) >= (rows[0].match(/,/g)?.length ?? 0) ? '\t' : ',';
    const split = (line: string) => {
      const out: string[] = [];
      let cur = '';
      let q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === d && !q) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((v) => v.trim().replace(/\|/g, '\\|'));
    };
    const grid = rows.map(split);
    const cols = Math.max(...grid.map((r) => r.length));
    const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ')} |`;
    const md = [line(grid[0]), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...grid.slice(1).map(line)].join('\n');
    apply(text.slice(0, s) + md + text.slice(e), s, s + md.length);
  };
  /** MorphKit special: bake a QR code for a URL/text straight into the document as a data-URI image */
  const insertQr = async () => {
    try {
      const { qrToCanvas, DEFAULT_QR } = await import('../lib/qr');
      const c = await qrToCanvas(qrText || ' ', { ...DEFAULT_QR, size: 240, margin: 2 });
      insertBlock(`![QR](${c.toDataURL('image/png')})`);
      setPop(null);
    } catch { /* payload too long for a QR */ }
  };

  // Tab inserts a tab / Ctrl+S saves / Ctrl+B/I/K marks (markdown mode)
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      const next = text.slice(0, s) + '\t' + text.slice(en);
      setText(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 1; });
    }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    if (mode === 'md' && mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSel('**'); }
    if (mode === 'md' && mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrapSel('_'); }
    if (mode === 'md' && mod && e.key.toLowerCase() === 'k') { e.preventDefault(); insertLink(); }
  };
  useEffect(() => {
    if (inline) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (pop) setPop(null); else onClose?.(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, inline, pop]);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text ? text.split('\n').length : 0;
  const dirty = text !== orig;
  const modeLabel = { md: 'Markdown', text: t('docModeText'), html: 'HTML', csv: `CSV${sheetName ? ` · ${sheetName}` : ''}`, json: 'JSON' }[mode];

  const MdBtn = ({ label, tip, onClick, wide }: { label: React.ReactNode; tip: string; onClick: () => void; wide?: boolean }) => (
    <button className={`tool-btn mdb-btn${wide ? ' mdb-wide' : ''}`} title={tip} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{label}</button>
  );

  const body = (
    <div className={inline ? 'ie-inline-wrap' : 'editor-overlay'} onClick={inline || busy ? undefined : onClose}>
      <div className={`editor editor-wide doc-editor view-${view}${inline ? ' ie-inline' : ''}`} role={inline ? undefined : 'dialog'} aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        {!inline && (
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        )}

        <div className="ed-toolbar doc-tools">
          <span className="chip">{modeLabel}</span>
          {type === 'docx' && <span className="ed-hint">{t('docDocxHint')}</span>}
          {type === 'pptx' && <span className="ed-hint">{t('docPptxHint')}</span>}
          {type === 'sheet' && sheetName && <span className="ed-hint">{t('docSheetHint')}</span>}
          <span className="opt-spacer" />
          <div className="ed-seg">
            <button className={view === 'source' ? 'active' : ''} onClick={() => setView('source')}>{t('docSource')}</button>
            <button className={view === 'split' ? 'active' : ''} onClick={() => setView('split')}>{t('docSplit')}</button>
            <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>{t('pdfPreview')}</button>
          </div>
          <button className={`btn btn-ghost btn-sm${wrap ? ' active' : ''}`} onClick={() => setWrap((w) => !w)} title={t('docWrap')}>↩</button>
        </div>

        {mode === 'md' && view !== 'preview' && (
          <div className="ed-toolbar doc-mdbar">
            <select
              className="tb-select md-heading"
              value=""
              title={t('mdHeading')}
              onChange={(e) => { if (e.target.value !== '') heading(Number(e.target.value)); e.target.value = ''; }}
            >
              <option value="" disabled>{t('mdHeading')}</option>
              {[1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{'H' + h}</option>)}
              <option value={0}>{t('mdHeadingClear')}</option>
            </select>
            <MdBtn label={<b>B</b>} tip={`${t('mdBold')} (Ctrl+B)`} onClick={() => wrapSel('**')} />
            <MdBtn label={<i>I</i>} tip={`${t('mdItalic')} (Ctrl+I)`} onClick={() => wrapSel('_')} />
            <MdBtn label={<s>S</s>} tip={t('mdStrike')} onClick={() => wrapSel('~~')} />
            <MdBtn label={<code>{'<>'}</code>} tip={t('mdCode')} onClick={() => wrapSel('`', '`', 'code')} />
            <span className="tb-sep" />
            <MdBtn label="•—" tip={t('mdUl')} onClick={() => linesSel((l) => (l.trim() ? `- ${l.replace(/^(- \[[ x]\]|-|\d+\.)\s+/, '')}` : l))} />
            <MdBtn label="1." tip={t('mdOl')} onClick={() => linesSel((l, i) => (l.trim() ? `${i + 1}. ${l.replace(/^(- \[[ x]\]|-|\d+\.)\s+/, '')}` : l))} />
            <MdBtn label="☑" tip={t('mdTask')} onClick={() => linesSel((l) => (l.trim() ? `- [ ] ${l.replace(/^(- \[[ x]\]|-|\d+\.)\s+/, '')}` : l))} />
            <MdBtn label="❝" tip={t('mdQuote')} onClick={() => linesSel((l) => `> ${l}`)} />
            <span className="tb-sep" />
            <MdBtn label="🔗" tip={`${t('mdLink')} (Ctrl+K)`} onClick={insertLink} />
            <MdBtn label="🖼" tip={t('mdImage')} onClick={() => wrapSel('![', '](https://)', 'alt')} />
            <MdBtn label="▦" tip={t('mdTable')} onClick={() => setPop(pop === 'table' ? null : 'table')} />
            <MdBtn label="{ }" tip={t('mdCodeBlock')} onClick={() => { const { chunk } = sel(); insertBlock('```\n' + (chunk || 'code') + '\n```'); }} wide />
            <MdBtn label="—" tip={t('mdHr')} onClick={() => insertBlock('---')} />
            <span className="tb-sep" />
            <MdBtn label="☰" tip={t('mdToc')} onClick={insertToc} />
            <MdBtn label="🕒" tip={t('mdDate')} onClick={() => { const { s, e } = sel(); const d = new Date().toLocaleString(); apply(text.slice(0, s) + d + text.slice(e), s + d.length, s + d.length); }} />
            <MdBtn label="⇄▦" tip={t('mdCsv')} onClick={csvToTable} wide />
            <MdBtn
              label={<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 18h2v2h-2z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
              tip={t('mdQr')}
              onClick={() => { const { chunk } = sel(); if (chunk) setQrText(chunk); setPop(pop === 'qr' ? null : 'qr'); }}
            />

            {pop === 'table' && (
              <div className="md-pop" onMouseDown={(e) => e.preventDefault()}>
                <div className="md-grid" onMouseLeave={() => setTblDim({ r: 2, c: 3 })}>
                  {Array.from({ length: 6 }, (_, r) => Array.from({ length: 8 }, (_, c) => (
                    <span
                      key={`${r}-${c}`}
                      className={`md-cell${r < tblDim.r && c < tblDim.c ? ' on' : ''}`}
                      onMouseEnter={() => setTblDim({ r: r + 1, c: c + 1 })}
                      onClick={() => insertTable(tblDim.r, tblDim.c)}
                    />
                  )))}
                </div>
                <p className="ed-hint">{tblDim.c} × {tblDim.r}</p>
              </div>
            )}
            {pop === 'qr' && (
              <div className="md-pop md-pop-qr">
                <input className="ed-input" value={qrText} placeholder="https://" onChange={(e) => setQrText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void insertQr(); if (e.key === 'Escape') setPop(null); }} />
                <button className="btn btn-accent btn-sm" onClick={() => void insertQr()}>{t('mdQrInsert')}</button>
              </div>
            )}
          </div>
        )}

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
            {!inline && <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>}
            <button className="btn btn-accent" onClick={() => void save()} disabled={busy || !loaded || error}>
              {busy ? t('processing') : inline ? t('pdfSaveAsset') : t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  return inline ? body : createPortal(body, document.body);
}
