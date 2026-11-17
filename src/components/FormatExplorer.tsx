import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../i18n';
import { formatLabel, KINDS, type DocType, type Kind } from '../lib/formats';
import { KIND_ICONS } from '../lib/kindIcons';
import {
  allOutputs, describeKey, DOC_TYPES, formatRows, inputsOf, needsFor, optionsFor, outputsOf, searchFormats, tasksFor,
  type FormatHit,
} from '../lib/formatMap';
import { formatTask, taskById, taskName, type Task } from '../lib/tasks';

interface Props {
  /** the task (or format pick) chosen and waiting for files */
  chosen: string | null;
  /** choose a task / a format, or take the choice back (App's pickTask toggles) */
  onPick: (task: Task) => void;
}

/** Per kind: its signal colour and name key (lib/formats KINDS), the editor line under the panel. */
const KIND_COLOR = Object.fromEntries(KINDS.map((k) => [k.kind, k.color])) as Record<Kind, string>;
const KIND_NAME = Object.fromEntries(KINDS.map((k) => [k.kind, k.nameKey])) as Record<Kind, string>;
const EDIT_KEY: Record<Kind, string> = { image: 'mxEditImage', audio: 'mxEditAudio', video: 'mxEditVideo', pdf: 'mxEditPdf', doc: 'mxEditDoc' };
const KIND_STORE = 'mk-fx-kind';

function savedKind(): Kind {
  try {
    const k = localStorage.getItem(KIND_STORE);
    if (k && k in KIND_COLOR) return k as Kind;
  } catch { /* storage off */ }
  return KINDS[0].kind;
}

/**
 * Home page: "I have a ___ file and want to…". Pick the kind of file you have and see, in one place,
 * the jobs people do with it, every format it can become, what each conversion lets you adjust and
 * what it needs; one click sets it up for the files you drop next. The "all formats" view is the
 * whole map at once (rows = what you have, columns = what it becomes). Everything comes from
 * lib/formatMap, which reads the converter's own registries.
 */
export function FormatExplorer({ chosen, onPick }: Props) {
  const { t } = useI18n();
  const [kind, setKindState] = useState<Kind>(savedKind);
  const [doc, setDoc] = useState<DocType>(DOC_TYPES[0]);
  const [out, setOut] = useState<string>(() => outputsOf(savedKind(), DOC_TYPES[0])[0]);
  const [view, setView] = useState<'kind' | 'all'>('kind');
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState('');

  /** Show a kind (and a document sub-type, an output, a format to point at). */
  const show = (k: Kind, opts: { doc?: DocType; out?: string; hit?: string } = {}) => {
    const d = opts.doc ?? (k === 'doc' ? doc : DOC_TYPES[0]); // staying on documents keeps the sub-type
    const outs = outputsOf(k, d);
    setKindState(k);
    setDoc(d);
    setOut(opts.out && outs.includes(opts.out) ? opts.out : outs[0]);
    setHit(opts.hit ?? '');
    setView('kind');
    try { localStorage.setItem(KIND_STORE, k); } catch { /* storage off */ }
  };

  // a task chosen elsewhere (a search hit, a card) brings its kind into view
  const chosenTask = taskById(chosen);
  useEffect(() => {
    if (chosenTask && chosenTask.kind !== 'other' && chosenTask.kind !== kind) show(chosenTask.kind, { out: chosenTask.target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  const name = (task: Task) => taskName(task, t);
  const kindName = (k: Kind) => t(KIND_NAME[k]);
  const rowName = (k: Kind, d?: DocType) => (k === 'doc' && d ? t(`docSub_${d}`) : kindName(k));
  const hits = searchFormats(query, (task) => `${name(task)} ${t(`task_${task.id}_d`)}`);
  const qr = taskById('qr');

  const pickHit = (h: FormatHit) => {
    setQuery('');
    if (h.type === 'input') show(h.kind, { doc: h.doc, hit: h.format });
    else if (h.type === 'output') show(h.kind, { doc: h.doc, out: h.format });
    else {
      if (h.task.kind !== 'other') show(h.task.kind, { out: h.task.target });
      onPick(h.task);
    }
  };

  const outs = outputsOf(kind, doc);
  const ins = inputsOf(kind, kind === 'doc' ? doc : undefined);
  const pick = formatTask(kind, out);
  const picked = chosen === pick.id;
  const needs = needsFor(kind, out);
  const opts = optionsFor(kind, out);
  const related = tasksFor(kind, out);
  const what = kind === 'doc' ? t(`docSub_${doc}`) : kindName(kind);

  return (
    <section className="fx" aria-labelledby="fx-title">
      <div className="fx-q">
        <h2 id="fx-title">{t('fxBefore')}</h2>
        <div className="fx-kinds" role="group" aria-label={t('fxKindLabel')}>
          {KINDS.map((k) => {
            const on = view === 'kind' && !query && k.kind === kind;
            return (
              <button key={k.kind} type="button" className={`fx-kind${on ? ' on' : ''}`} aria-pressed={on} style={{ '--c': k.color } as CSSProperties} onClick={() => { setQuery(''); show(k.kind); }}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={KIND_ICONS[k.kind]} fill="currentColor" /></svg>
                {t(k.nameKey)}
              </button>
            );
          })}
        </div>
        <span className="fx-after">{t('fxAfter')}</span>
      </div>

      <div className="fx-tools">
        <input type="search" className="fx-search" value={query} placeholder={t('fxSearch')} aria-label={t('fxSearchLabel')} onChange={(e) => setQuery(e.target.value)} />
        <div className="fx-view" role="group" aria-label={t('fxViewLabel')}>
          <button type="button" className={view === 'kind' ? 'on' : ''} aria-pressed={view === 'kind'} onClick={() => setView('kind')}>{t('fxByKind')}</button>
          <button type="button" className={view === 'all' ? 'on' : ''} aria-pressed={view === 'all'} onClick={() => { setQuery(''); setView('all'); }}>{t('fxAll')}</button>
        </div>
      </div>

      {query.trim() ? (
        hits.length ? (
          <ul className="fx-hits">
            {hits.map((h, i) => (
              <li key={i}>
                <button type="button" onClick={() => pickHit(h)}>
                  <small>{t(`fxHit_${h.type}`)}</small>
                  {h.type === 'task' ? (
                    <span><b>{name(h.task)}</b> · {t(`task_${h.task.id}_d`)}</span>
                  ) : h.type === 'input' ? (
                    <span><b>{formatLabel(h.format)}</b> · {rowName(h.kind, h.doc)}</span>
                  ) : (
                    <span>{rowName(h.kind, h.doc)} → <b>{formatLabel(h.format)}</b> · {t(describeKey(h.kind, h.format), { fmt: formatLabel(h.format) })}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fx-none">{t('fxNoMatch', { q: query.trim() })}</p>
        )
      ) : view === 'all' ? (
        <Overview onCell={(k, d, o) => show(k, { doc: d, out: o })} rowName={rowName} />
      ) : (
        <div className="fx-kindview" style={{ '--c': KIND_COLOR[kind] } as CSSProperties}>
          {kind === 'doc' && (
            <div className="fx-subs" role="group" aria-label={t('fxDocLabel')}>
              {DOC_TYPES.map((d) => (
                <button key={d} type="button" className={d === doc ? 'on' : ''} aria-pressed={d === doc} onClick={() => show('doc', { doc: d })}>{t(`docSub_${d}`)}</button>
              ))}
            </div>
          )}
          <p className="fx-ins">
            <span>{t('fxOpens')}</span>
            {ins.map((f) => <span key={f} className={`chip${hit === f ? ' hit' : ''}`}>{formatLabel(f)}</span>)}
          </p>

          <div className="fx-body">
            <div className="fx-col">
              <h3>{t('fxTasks')}</h3>
              {tasksFor(kind, undefined, kind === 'doc' ? doc : undefined).map((task) => (
                <button key={task.id} type="button" className={`fx-task${chosen === task.id ? ' on' : ''}`} aria-pressed={chosen === task.id} title={t(`task_${task.id}_d`)} onClick={() => onPick(task)}>
                  <b>{name(task)}</b>
                  <em>{t(`taskRun_${task.run}`)}</em>
                  <span>{t(`task_${task.id}_d`)}</span>
                </button>
              ))}
            </div>

            <div className="fx-col">
              <h3>{t('fxOuts')}</h3>
              <div className="fx-outs" role="group" aria-label={t('fxOuts')}>
                {outs.map((f) => {
                  const n = needsFor(kind, f);
                  return (
                    <button key={f} type="button" className={`fx-out${f === out ? ' on' : ''}${chosen === formatTask(kind, f).id ? ' set' : ''}`} aria-pressed={f === out} onClick={() => setOut(f)}>
                      <b>{formatLabel(f)}</b>
                      <span>{t(describeKey(kind, f), { fmt: formatLabel(f) })}</span>
                      {(n === 'engine' || n === 'ocr') && <i className={`fx-need nd-${n}`} title={t(`needs_${n}`)} />}
                    </button>
                  );
                })}
              </div>
              <div className="fx-detail" aria-live="polite">
                <h4>{what} → {formatLabel(out)}</h4>
                <p>{t(describeKey(kind, out), { fmt: formatLabel(out) })}</p>
                <p className="fx-needs">{(needs === 'engine' || needs === 'ocr') && <i className={`fx-need nd-${needs}`} aria-hidden="true" />}{t(`needs_${needs}`)}</p>
                <p className="fx-lbl">{t('fxOptions')}</p>
                <div className="fx-chips">
                  {opts.length ? opts.map((k) => <span key={k} className="fx-opt">{t(k)}</span>) : <span className="fx-quiet">{t('fxNoOptions')}</span>}
                </div>
                {related.length > 0 && (
                  <>
                    <p className="fx-lbl">{t('fxRelated')}</p>
                    <div className="fx-chips">
                      {related.map((task) => (
                        <button key={task.id} type="button" className={`fx-opt${chosen === task.id ? ' on' : ''}`} aria-pressed={chosen === task.id} onClick={() => onPick(task)}>{name(task)}</button>
                      ))}
                    </div>
                  </>
                )}
                <button type="button" className={`btn ${picked ? 'btn-ghost' : 'btn-accent'} fx-go`} aria-pressed={picked} onClick={() => onPick(pick)}>
                  {t(picked ? 'fxUnset' : 'fxSet', { kind: what, fmt: formatLabel(out) })}
                </button>
              </div>
            </div>
          </div>

          <p className="fx-foot">
            <span>{t(EDIT_KEY[kind])}</span>
            {qr && <button type="button" className="fx-tool" onClick={() => onPick(qr)}>{t('fxTools')}: {name(qr)}</button>}
          </p>
        </div>
      )}
      <p className="fx-legend">
        <span><i className="fx-need nd-engine" />{t('needs_engine')}</span>
        <span><i className="fx-need nd-ocr" />{t('needs_ocr')}</span>
      </p>
    </section>
  );
}

/** Every way in (rows) against every format out (columns); a filled cell converts. */
function Overview({ onCell, rowName }: { onCell: (k: Kind, d: DocType | undefined, out: string) => void; rowName: (k: Kind, d?: DocType) => string }) {
  const { t } = useI18n();
  const rows = formatRows();
  const cols = allOutputs(rows);
  return (
    <div className="fx-all">
      <div className="fx-table-wrap">
        <table className="fx-table">
          <caption>{t('fxAllHint')}</caption>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">{t('fxHave')}</span></th>
              {cols.map((c) => <th key={c} scope="col"><span>{formatLabel(c)}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.doc ?? ''}`} style={{ '--c': KIND_COLOR[r.kind] } as CSSProperties}>
                <th scope="row">
                  {rowName(r.kind, r.doc)}
                  <small>{r.inputs.map(formatLabel).join(' ')}</small>
                </th>
                {cols.map((c) => (
                  <td key={c}>
                    {r.outputs.includes(c) && (
                      <button
                        type="button"
                        aria-label={`${rowName(r.kind, r.doc)} → ${formatLabel(c)}`}
                        title={`${rowName(r.kind, r.doc)} → ${formatLabel(c)}: ${t(describeKey(r.kind, c), { fmt: formatLabel(c) })}`}
                        onClick={() => onCell(r.kind, r.doc, c)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
