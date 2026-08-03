import EmptyState from '@shared/ui/EmptyState.jsx';

function outcomeLabel(task) {
  return task.sessionOutcome
    || task.outcome
    || (task.completedAt ? 'Completed' : 'Progressed');
}

export default function TaskHistoryPage({ tasks = [] }) {
  const ordered = [...tasks].sort((left, right) => String(
    right.completedAt || right.updatedAt || right.createdAt || '',
  ).localeCompare(String(left.completedAt || left.updatedAt || left.createdAt || '')));

  return (
    <section className="task-history-page" aria-labelledby="task-history-title">
      <div className="todo-task-section-head">
        <div>
          <span id="task-history-title">Work ledger</span>
          <small>Sessions and task outcomes</small>
        </div>
        <strong>{ordered.length}</strong>
      </div>
      {ordered.length === 0 ? (
        <EmptyState title="No work outcomes yet." icon="○" className="todo-hub-empty" />
      ) : (
        <div className="task-history-ledger">
          {ordered.slice(0, 100).map((task) => (
            <article key={task.UUID} className="task-history-row">
              <div>
                <strong>{task.name || task.title || 'Untitled task'}</strong>
                <span>{task.projectName || task.goalName || 'Independent work'}</span>
              </div>
              <span className={`task-history-outcome task-history-outcome--${outcomeLabel(task).toLowerCase()}`}>
                {outcomeLabel(task)}
              </span>
              <time>
                {new Date(task.completedAt || task.updatedAt || task.createdAt).toLocaleDateString()}
              </time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

