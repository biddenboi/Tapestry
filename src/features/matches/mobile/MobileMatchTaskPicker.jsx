import { useMemo, useState } from 'react';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';

function taskDate(task) {
  const value = task?.dueDate || task?.createdAt || '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export default function MobileMatchTaskPicker({ payload = {} }) {
  const { closeSurface } = useMobileSurface();
  const [search, setSearch] = useState('');
  const tasks = useMemo(() => (payload.tasks || [])
    .filter((task) => task?.UUID && !task.completedAt && !task.deletedAt)
    .filter((task) => String(task.name || '').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((left, right) => (taskDate(left)?.getTime() || Infinity) - (taskDate(right)?.getTime() || Infinity)), [payload.tasks, search]);

  const choose = (task) => {
    closeSurface({ force: true });
    window.requestAnimationFrame(() => payload.onChoose?.(task));
  };

  return (
    <section className="mobile-sheet mobile-match-task-picker" role="dialog" aria-modal="true" aria-labelledby="mobile-match-task-picker-title">
      <header><div><span>Match work</span><h2 id="mobile-match-task-picker-title">Choose a task</h2></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <label className="mobile-match-task-search"><span>Filter tasks</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search open tasks" data-autofocus="true" /></label>
      <div className="mobile-sheet-scroll mobile-match-task-list">
        {tasks.map((task) => <button key={task.UUID} type="button" onClick={() => choose(task)}><strong>{task.name || 'Untitled task'}</strong><span>{task.estimatedDuration ? `${task.estimatedDuration} min` : 'Open task'}{taskDate(task) ? ` · ${taskDate(task).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</span></button>)}
        {!tasks.length && <div className="mobile-compact-empty"><strong>No matching open tasks</strong><span>Add a task or change the filter.</span></div>}
      </div>
    </section>
  );
}
