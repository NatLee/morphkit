import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { readSheets, sheetsToXlsx, type SheetInfo } from '../lib/docs';
import type { Item } from '../types';

interface Props {
  item: Item;
  onSave: (id: string, file: File) => void;
  onClose: () => void;
}

/**
 * Spreadsheet grid editor for csv/tsv/xlsx/xls/ods items. One tab per sheet; cells are plain
 * inputs (Enter/Tab/arrows move, Esc reverts), rows/columns can be inserted, deleted, and moved;
 * header row toggle only affects how the first row is styled. Large sheets render in windows of
 * `PAGE` rows (no virtualisation library — the page shows a "show more" bar). Save writes the
 * original container back: xlsx/ods → xlsx (all sheets), csv/tsv → text of the active sheet.
 */
const PAGE = 300;
const MIN_COLS = 4;
const MIN_ROWS = 12;

type Cell = string | number | boolean | null | undefined;

export function SheetEditor({ item, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [info, setInfo] = useState<SheetInfo | null>(null);
  const [active, setActive] = useState('');
  const [rows, setRows] = useState<Cell[][]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const histRef = useRef<Cell[][][]>([]);
  const tableRef = useRef<HTMLDivElement>(null);
  const isCsv = /\.(csv|tsv)$/i.test(item.file.name);
  const sep = /\.tsv$/i.test(item.file.name) ? '\t' : ',';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await readSheets(item.file);
        if (!alive) return;
        setInfo(s);
        const first = s.names[0] ?? 'Sheet1';
        setActive(first);
        setRows(pad((s.rows[first] ?? []) as Cell[][]));
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [item.file]);

  /** keep a comfortable editing area: pad to MIN sizes + one spare row/col */
  function pad(r: Cell[][]): Cell[][] {
    const cols = Math.max(MIN_COLS, ...r.map((x) => x.length)) + 1;
    const out = r.map((x) => [...x, ...Array(Math.max(0, cols - x.length)).fill('')]);
    while (out.length < Math.max(MIN_ROWS, r.length + 1)) out.push(Array(cols).fill(''));
    return out;
  }
  /** strip trailing empty rows/cols before saving */
  function trim(r: Cell[][]): Cell[][] {
    const empty = (v: Cell) => v == null || v === '';
    let out = r.filter((row, i) => !row.every(empty) || r.slice(i).some((x) => !x.every(empty)));
    while (out.length && out[out.length - 1].every(empty)) out.pop();
    let cols = 0;
    for (const row of out) for (let c = row.length - 1; c >= 0; c--) if (!empty(row[c])) { cols = Math.max(cols, c + 1); break; }
    out = out.map((row) => row.slice(0, cols));
    return out;
  }

  const commitRows = (next: Cell[][]) => {
    histRef.current.push(rows);
    if (histRef.current.length > 50) histRef.current.shift();
    setRows(next);
    setDirty(true);
  };
  const undo = () => {
    const prev = histRef.current.pop();
    if (prev) { setRows(prev); setDirty(true); }
  };

  // persist the active sheet into `info` when switching / saving
  const flushInto = (s: SheetInfo): SheetInfo => ({ ...s, rows: { ...s.rows, [active]: trim(rows) } });
  const switchSheet = (name: string) => {
    if (!info || name === active) return;
    const s = flushInto(info);
    setInfo(s);
    setActive(name);
    setRows(pad((s.rows[name] ?? []) as Cell[][]));
    setSel(null);
    setLimit(PAGE);
    histRef.current = [];
  };

  const setCell = (r: number, c: number, v: string) => {
    const next = rows.map((row) => [...row]);
    // grow when typing into the spare row/col
    if (r === next.length - 1) next.push(Array(next[0].length).fill(''));
    if (c === next[0].length - 1) for (const row of next) row.push('');
    next[r][c] = coerce(v);
    commitRows(next);
  };
  const coerce = (v: string): Cell => {
    if (v === '') return '';
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
    if (/^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
    return v;
  };
  const insertRow = (at: number) => commitRows([...rows.slice(0, at), Array(rows[0].length).fill(''), ...rows.slice(at)]);
  const deleteRow = (at: number) => rows.length > 1 && commitRows(rows.filter((_, i) => i !== at));
  const insertCol = (at: number) => commitRows(rows.map((row) => [...row.slice(0, at), '', ...row.slice(at)]));
  const deleteCol = (at: number) => rows[0].length > 1 && commitRows(rows.map((row) => row.filter((_, i) => i !== at)));
  const moveRow = (at: number, dir: -1 | 1) => {
    const to = at + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[at], next[to]] = [next[to], next[at]];
    commitRows(next);
    setSel((s) => (s ? { ...s, r: to } : s));
  };
  const moveCol = (at: number, dir: -1 | 1) => {
    const to = at + dir;
    if (to < 0 || to >= rows[0].length) return;
    commitRows(rows.map((row) => { const n = [...row]; [n[at], n[to]] = [n[to], n[at]]; return n; }));
    setSel((s) => (s ? { ...s, c: to } : s));
  };
  const sortByCol = (c: number, dir: 1 | -1) => {
    const [head, ...body] = rows;
    const cmp = (a: Cell, b: Cell) => {
      const na = typeof a === 'number', nb = typeof b === 'number';
      if (na && nb) return (a as number) - (b as number);
      return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
    };
    const empty = (v: Cell) => v == null || v === '';
    const filled = body.filter((r) => !r.every(empty));
    const blanks = body.filter((r) => r.every(empty));
    filled.sort((x, y) => dir * cmp(x[c], y[c]));
    commitRows([head, ...filled, ...blanks]);
  };

  // sheet ops
  const addSheet = () => {
    if (!info) return;
    let n = info.names.length + 1;
    let name = `Sheet${n}`;
    while (info.names.includes(name)) name = `Sheet${++n}`;
    const s = flushInto(info);
    const next = { names: [...s.names, name], rows: { ...s.rows, [name]: [] } };
    setInfo(next);
    setActive(name);
    setRows(pad([]));
    setDirty(true);
  };
  const deleteSheet = () => {
    if (!info || info.names.length < 2) return;
    const names = info.names.filter((n) => n !== active);
    const rowsMap = { ...info.rows };
    delete rowsMap[active];
    setInfo({ names, rows: rowsMap });
    setActive(names[0]);
    setRows(pad((rowsMap[names[0]] ?? []) as Cell[][]));
    setDirty(true);
  };
  const renameSheet = (name: string) => {
    if (!info) return;
    const clean = name.trim().slice(0, 31);
    if (!clean || clean === active || info.names.includes(clean)) { setRenaming(false); return; }
    const s = flushInto(info);
    const rowsMap: Record<string, unknown[][]> = {};
    for (const n of s.names) rowsMap[n === active ? clean : n] = s.rows[n];
    setInfo({ names: s.names.map((n) => (n === active ? clean : n)), rows: rowsMap });
    setActive(clean);
    setRenaming(false);
    setDirty(true);
  };

  const save = async () => {
    if (!info) return;
    setBusy(true);
    try {
      const s = flushInto(info);
      let file: File;
      if (isCsv) {
        const X = await import('xlsx');
        const csv = X.utils.sheet_to_csv(X.utils.aoa_to_sheet(s.rows[active]), { FS: sep });
        file = new File([csv], item.file.name, { type: item.file.type || 'text/csv' });
      } else {
        const name = item.file.name.replace(/\.(xls|ods)$/i, '.xlsx');
        file = new File([await sheetsToXlsx(s)], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      }
      onSave(item.id, file);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  // keyboard navigation inside the grid
  const focusCell = (r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
    if (el) { el.focus(); el.select(); }
  };
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return; }
    const move = (dr: number, dc: number) => { e.preventDefault(); focusCell(Math.max(0, Math.min(rows.length - 1, r + dr)), Math.max(0, Math.min(rows[0].length - 1, c + dc))); };
    if (e.key === 'Enter') move(e.shiftKey ? -1 : 1, 0);
    else if (e.key === 'Tab') move(0, e.shiftKey ? -1 : 1);
    else if (e.key === 'ArrowDown') move(1, 0);
    else if (e.key === 'ArrowUp') move(-1, 0);
    else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) move(0, -1);
    else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length) move(0, 1);
    else if (e.key === 'Escape') { (e.currentTarget as HTMLInputElement).blur(); }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const colLabel = (c: number) => { let s = ''; let n = c; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
  const visible = useMemo(() => rows.slice(0, limit), [rows, limit]);
  const cols = rows[0]?.length ?? 0;
  const filledRows = rows.filter((r) => r.some((v) => v != null && v !== '')).length;

  const body = (
    <div className="editor-overlay" onClick={busy ? undefined : onClose}>
      <div className="editor editor-wide sheet-editor" role="dialog" aria-label={t('edit')} onClick={(e) => e.stopPropagation()}>
        <div className="ed-head">
          <span className="ed-title" title={item.file.name}>{item.file.name}</span>
          <button className="theme-toggle" onClick={onClose} aria-label={t('close')}>
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="ed-toolbar sheet-tools">
          <button className="btn btn-ghost btn-sm" disabled={!histRef.current.length} onClick={undo} title={t('undo')}>↶ {t('undo')}</button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && insertRow(sel.r)} title={t('shRowAbove')}>{t('shRowAbove')}</button>
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && insertRow(sel.r + 1)} title={t('shRowBelow')}>{t('shRowBelow')}</button>
          <button className="btn btn-ghost btn-sm pdf-del" disabled={!sel} onClick={() => sel && deleteRow(sel.r)}>{t('shDelRow')}</button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && insertCol(sel.c)}>{t('shColLeft')}</button>
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && insertCol(sel.c + 1)}>{t('shColRight')}</button>
          <button className="btn btn-ghost btn-sm pdf-del" disabled={!sel} onClick={() => sel && deleteCol(sel.c)}>{t('shDelCol')}</button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && moveRow(sel.r, -1)} title={t('shMoveUp')}>↑</button>
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && moveRow(sel.r, 1)} title={t('shMoveDown')}>↓</button>
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && moveCol(sel.c, -1)} title={t('shMoveLeft')}>←</button>
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && moveCol(sel.c, 1)} title={t('shMoveRight')}>→</button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && sortByCol(sel.c, 1)} title={t('shSortAsc')}>A→Z</button>
          <button className="btn btn-ghost btn-sm" disabled={!sel} onClick={() => sel && sortByCol(sel.c, -1)} title={t('shSortDesc')}>Z→A</button>
          <span className="opt-spacer" />
          <span className="ed-hint">{sel ? `${colLabel(sel.c)}${sel.r + 1}` : ''}</span>
        </div>

        {info && (
          <div className="sheet-tabs" role="tablist">
            {info.names.map((n) => (
              renaming && n === active ? (
                <input key={n} className="ed-input sheet-rename" defaultValue={n} autoFocus onBlur={(e) => renameSheet(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') renameSheet((e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(false); }} />
              ) : (
                <button key={n} role="tab" className={`sheet-tab${n === active ? ' active' : ''}`} onClick={() => switchSheet(n)} onDoubleClick={() => !isCsv && setRenaming(true)} title={isCsv ? undefined : t('shRenameHint')}>{n}</button>
              )
            ))}
            {!isCsv && <button className="sheet-tab sheet-add" onClick={addSheet} title={t('shAddSheet')}>＋</button>}
            {!isCsv && info.names.length > 1 && <button className="sheet-tab sheet-del" onClick={deleteSheet} title={t('shDelSheet')}>✕</button>}
          </div>
        )}

        <div className="sheet-grid" ref={tableRef}>
          {error && <p className="pdf-status danger">{t('docLoadError')}</p>}
          {!info && !error && <p className="pdf-status"><span className="spinner" /> {t('processing')}</p>}
          {info && (
            <table>
              <thead>
                <tr>
                  <th className="sh-corner" />
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c} className={sel?.c === c ? 'sel' : ''} onClick={() => setSel({ r: sel?.r ?? 0, c })}>{colLabel(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, r) => (
                  <tr key={r} className={r === 0 ? 'sh-header' : ''}>
                    <th className={sel?.r === r ? 'sel' : ''} onClick={() => setSel({ r, c: sel?.c ?? 0 })}>{r + 1}</th>
                    {row.map((v, c) => (
                      <td key={c} className={sel && sel.r === r && sel.c === c ? 'sel' : ''}>
                        <input
                          data-r={r}
                          data-c={c}
                          value={v == null ? '' : String(v)}
                          className={typeof v === 'number' ? 'num' : ''}
                          onFocus={() => setSel({ r, c })}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onKeyDown={(e) => onCellKey(e, r, c)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {info && rows.length > limit && (
            <button className="btn btn-ghost btn-sm sheet-more" onClick={() => setLimit((l) => l + PAGE)}>
              {t('shShowMore', { n: String(rows.length - limit) })}
            </button>
          )}
        </div>

        <div className="ed-foot">
          <span className="ed-hint">
            {info ? t('shStats', { rows: String(filledRows), cols: String(Math.max(0, cols - 1)), sheets: String(info.names.length) }) : ''}
            {dirty ? ` · ${t('docUnsaved')}` : ''}
            <span className="kbd-hints"> · <kbd>Enter</kbd>/<kbd>Tab</kbd> {t('shNavHint')} · <kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
          </span>
          <div className="ed-foot-main">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('cancel')}</button>
            <button className="btn btn-accent" onClick={() => void save()} disabled={busy || !info}>{busy ? t('processing') : t('save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
