import { useState } from 'react';
import { useI18n } from '../i18n';
import { filterTasks, TASKS, type Task, type TaskKind } from '../lib/tasks';

interface Props {
  /** the task chosen and waiting for files (highlighted) */
  chosen: string | null;
  onPick: (task: Task) => void;
}

/** Filter chips, in this order; the label keys are the file-kind names used across the app. */
const KIND_FILTERS: ReadonlyArray<[TaskKind | 'all', string]> = [
  ['all', 'taskAll'], ['image', 'kindImage'], ['audio', 'kindAudio'], ['video', 'kindVideo'],
  ['pdf', 'kindPdf'], ['doc', 'kindDoc'], ['other', 'taskOther'],
];

/** Home page "I want to…": every task from lib/tasks, with a search box and a file-type filter. */
export function TaskList({ chosen, onPick }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<TaskKind | 'all'>('all');
  const list = filterTasks(query, kind, (task) => `${t(`task_${task.id}`)} ${t(`task_${task.id}_d`)}`);

  return (
    <section className="tasks" aria-labelledby="tasks-title">
      <div className="tasks-head">
        <h2 id="tasks-title">{t('tasksTitle')}</h2>
        <span>{t('tasksHint', { n: String(TASKS.length) })}</span>
      </div>
      <div className="tasks-find">
        <input
          type="search"
          value={query}
          placeholder={t('tasksSearch')}
          aria-label={t('tasksSearchLabel')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="tasks-kinds" role="group" aria-label={t('tasksKindLabel')}>
          {KIND_FILTERS.map(([k, key]) => (
            <button key={k} className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(key)}
            </button>
          ))}
        </div>
      </div>
      {list.length ? (
        <div className="tasks-grid">
          {list.map((task) => (
            <button
              key={task.id}
              className={`task tk-${task.kind}${chosen === task.id ? ' chosen' : ''}`}
              title={t(`task_${task.id}_d`)}
              aria-pressed={chosen === task.id}
              onClick={() => onPick(task)}
            >
              <b>{t(`task_${task.id}`)}</b>
              <span>{t(`task_${task.id}_d`)}</span>
              <i>{t(`taskRun_${task.run}`)}</i>
            </button>
          ))}
        </div>
      ) : (
        <p className="tasks-empty">{t('tasksEmpty')}</p>
      )}
    </section>
  );
}
