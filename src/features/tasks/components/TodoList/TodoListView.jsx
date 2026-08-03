import {
  TODO_DUE_FILTERS,
  TODO_HUB_TABS,
  TODO_SORTS,
} from '@domain/tasks/TodoView.js';
import { formatTaskRecurrence } from '@domain/tasks/TaskRecurrence.js';
import { prettyPrintDate } from '@domain/time/Time.js';
import EmptyState from '@shared/ui/EmptyState.jsx';
import SectionTabs from '@shared/ui/SectionTabs.jsx';
import useProgressiveList from '@shared/ui/useProgressiveList.js';
import Icon from '@shared/icons/Icon.jsx';
function formatSlope(s) {
  if (!Number.isFinite(s)) return '0.0';
  return s >= 10 ? String(Math.round(s)) : s.toFixed(1);
}

function formatDayLabel(day) {
  return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMonthLabel(day) {
  return day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getReminderDate(reminder) {
  const date = new Date(reminder?.snoozedUntil || reminder?.remindAt || '');
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatReminderTime(reminder, withDate = false) {
  const date = getReminderDate(reminder);
  if (!date) return 'Time unavailable';
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return withDate
    ? `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`
    : time;
}

function getDragTask(event, tasks) {
  const id = event.dataTransfer?.getData('text/todo-id');
  return tasks.find((task) => task.UUID === id) || null;
}

function TodoHubTabs({ activeTab, onChange }) {
  return (
    <SectionTabs
      items={TODO_HUB_TABS.map(([id, label]) => ({ id, label }))}
      value={activeTab}
      onChange={onChange}
      label="Task views"
    />
  );
}

function TodoHubControls({
  search,
  projectFilter,
  dueFilter,
  sortMode,
  projects,
  onSearchChange,
  onProjectChange,
  onDueChange,
  onSortChange,
}) {
  return (
    <div className="todo-hub-controls">
      <input
        className="todo-hub-search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search tasks"
        aria-label="Search tasks"
      />
      <select value={projectFilter} onChange={(event) => onProjectChange(event.target.value)}>
        <option value="all">All goals</option>
        <option value="__none__">No Goal</option>
        {projects.map((project) => (
          <option key={project.UUID} value={project.UUID}>{project.name}</option>
        ))}
      </select>
      <select value={dueFilter} onChange={(event) => onDueChange(event.target.value)}>
        {TODO_DUE_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <select value={sortMode} onChange={(event) => onSortChange(event.target.value)}>
        {TODO_SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </div>
  );
}

function TaskPill({ task, onSelect, onStart, onDragStart }) {
  return (
    <button
      type="button"
      className={`todo-task-pill todo-task-pill--${task.slopeTier}`}
      style={{ '--task-color': task.projectColor || 'var(--color-task)' }}
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onClick={() => onSelect(task)}
      title={`${task.name} · ${formatSlope(task.slope)} priority`}
    >
      <span>{task.name || 'Untitled task'}</span>
      <small>
        {task.estimatedDuration || 0}m
        {task.projectName ? ` · ${task.projectName}` : ''}
      </small>
      <span
        className="todo-pill-start"
        role="button"
        tabIndex={0}
        onClick={(event) => { event.stopPropagation(); onStart(task); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onStart(task);
          }
        }}
      >
        Start
      </span>
    </button>
  );
}

function ReminderPill({ reminder, onSelect, calendarCompact = false }) {
  const due = getReminderDate(reminder);
  const overdue = due && due.getTime() <= Date.now();
  return (
    <button
      type="button"
      className={`todo-reminder-pill ${calendarCompact ? 'todo-reminder-pill--calendar-compact' : ''} ${overdue ? 'is-overdue' : ''}`}
      onClick={() => onSelect(reminder)}
      title={`${reminder.title} at ${formatReminderTime(reminder, true)}`}
    >
      <Icon name="bell" size={13} />
      <time>{formatReminderTime(reminder)}</time>
      <span>{reminder.title || 'Untitled reminder'}</span>
    </button>
  );
}

function ReminderCard({ reminder, onComplete, onSnooze, onEdit, onDismiss }) {
  const due = getReminderDate(reminder);
  const overdue = due && due.getTime() <= Date.now();
  return (
    <article className={`todo-reminder-card ${overdue ? 'is-overdue' : ''}`}>
      <div className="todo-reminder-card-icon"><Icon name="bell" size={17} /></div>
      <div className="todo-reminder-card-copy">
        <strong>{reminder.title || 'Untitled reminder'}</strong>
        <time>{formatReminderTime(reminder, true)}</time>
        {reminder.body && <p>{reminder.body}</p>}
      </div>
      <div className="todo-reminder-card-actions">
        <button type="button" onClick={() => onComplete(reminder)}>Complete</button>
        <button type="button" onClick={() => onSnooze(reminder, 10)}>Snooze 10m</button>
        <button type="button" onClick={() => onEdit(reminder)}>Edit</button>
        <button type="button" onClick={() => onDismiss(reminder)}>Dismiss</button>
      </div>
    </article>
  );
}

function ReminderSection({
  reminders,
  onComplete,
  onSnooze,
  onEdit,
  onDismiss,
  title = 'Reminders',
  subtitle = 'Wall-clock prompts',
}) {
  return (
    <section className="todo-task-section todo-reminder-section">
      <div className="todo-task-section-head">
        <div>
          <span>{title}</span>
          <small>{subtitle}</small>
        </div>
        <strong>{reminders.length}</strong>
      </div>
      <div className="todo-task-section-list">
        {reminders.length === 0 ? (
          <EmptyState title="No reminders need your attention." icon="○" className="todo-hub-empty" />
        ) : reminders.map((reminder) => (
          <ReminderCard
            key={reminder.UUID}
            reminder={reminder}
            onComplete={onComplete}
            onSnooze={onSnooze}
            onEdit={onEdit}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task, selected, onSelect, onStart, onDragStart }) {
  return (
    <div
      className={`todo-hub-task-card todo-hub-task-card--${task.slopeTier} ${selected ? 'selected' : ''}`}
      style={{ '--task-color': task.projectColor || 'var(--color-task)' }}
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onClick={() => onSelect(task)}
      role="button"
      tabIndex={0}
    >
      <div className="todo-hub-task-top">
        <span className="todo-hub-task-name">{task.name || 'Untitled task'}</span>
        <span className={`todo-hub-task-tier todo-hub-task-tier--${task.slopeTier}`}>
          {formatSlope(task.slope)}
        </span>
      </div>
      <div className="todo-hub-task-meta">
        <span>{task.estimatedDuration || 0}m</span>
        <span>{task.dueDate ? prettyPrintDate(task.dueDate) : 'No date'}</span>
        {task.projectName && <span>{task.projectName}</span>}
      </div>
      <div className="todo-hub-task-actions">
        <button type="button" onClick={(event) => { event.stopPropagation(); onStart(task); }}>Start</button>
      </div>
    </div>
  );
}

function CalendarDay({
  day,
  tasks,
  reminders,
  selected,
  outsideMonth,
  focused,
  onDropTask,
  onSelectTask,
  onStartTask,
  onSelectReminder,
  onDragStart,
  onFocusDay,
  onOpenDayMenu,
  compact = false,
}) {
  const visibleReminders = reminders.slice(0, 2);
  const visibleTasks = tasks.slice(0, compact ? Math.max(0, 4 - visibleReminders.length) : 3);
  const visibleCount = visibleReminders.length + visibleTasks.length;
  const hiddenCount = Math.max(0, tasks.length + reminders.length - visibleCount);

  return (
    <div
      className={`todo-calendar-day ${selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''} ${outsideMonth ? 'is-outside' : ''}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDropTask(event, day)}
      onClick={() => onFocusDay(day)}
      onContextMenu={(event) => onOpenDayMenu(event, day)}
      role="button"
      tabIndex={0}
    >
      <div className="todo-calendar-day-head">
        <span>{day.getDate()}</span>
        <small>{tasks.length + reminders.length}</small>
      </div>
      <div className="todo-calendar-day-list">
        {compact ? (
          <>
            {visibleReminders.map((reminder) => (
              <ReminderPill
                key={reminder.UUID}
                reminder={reminder}
                calendarCompact
                onSelect={(item) => {
                  onFocusDay(day);
                  onSelectReminder(item);
                }}
              />
            ))}
            {visibleTasks.map((task) => (
              <button
                key={task.UUID}
                type="button"
                className="todo-calendar-bullet todo-calendar-bullet--task"
                style={{ '--task-color': task.projectColor || 'var(--color-task)' }}
                onClick={(event) => {
                  event.stopPropagation();
                  onFocusDay(day);
                  onSelectTask(task);
                }}
                title={task.name || 'Untitled task'}
              >
                <span aria-hidden="true">•</span>
                <b>{task.name || 'Untitled task'}</b>
              </button>
            ))}
            {hiddenCount > 0 && <span className="todo-calendar-more">+{hiddenCount} more</span>}
          </>
        ) : <>
          {visibleReminders.map((reminder) => (
            <ReminderPill key={reminder.UUID} reminder={reminder} onSelect={onSelectReminder} />
          ))}
          {visibleTasks.map((task) => (
          <TaskPill
            key={task.UUID}
            task={task}
            onSelect={onSelectTask}
            onStart={onStartTask}
            onDragStart={onDragStart}
          />
        ))}
        {hiddenCount > 0 && <span className="todo-calendar-more">+{hiddenCount} more</span>}
        </>}
      </div>
    </div>
  );
}

function DayAgenda({
  day,
  tasks,
  reminders,
  onSelectTask,
  onStartTask,
  onDragStart,
  onSelectReminder,
  onNewTask,
  onNewReminder,
}) {
  return (
    <section className="todo-day-agenda">
      <div className="todo-day-agenda-head">
        <div>
          <span className="todo-panel-title">Selected day</span>
          <strong>{formatDayLabel(day)}</strong>
        </div>
        <div className="todo-day-agenda-actions">
          <button type="button" onClick={() => onNewReminder(day)}>New reminder</button>
          <button type="button" onClick={() => onNewTask(day)}>New task</button>
        </div>
      </div>
      <div className="todo-day-agenda-list">
        {tasks.length === 0 && reminders.length === 0 ? (
          <EmptyState title="Nothing scheduled for this day." icon="○" className="todo-hub-empty" />
        ) : (
          <>
            {reminders.map((reminder) => (
              <ReminderPill key={reminder.UUID} reminder={reminder} onSelect={onSelectReminder} />
            ))}
            {tasks.map((task) => (
              <TaskPill
                key={task.UUID}
                task={task}
                onSelect={onSelectTask}
                onStart={onStartTask}
                onDragStart={onDragStart}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function TaskSection({ title, subtitle, emptyMessage, tasks, selectedId, onSelect, onStart, onDragStart }) {
  return (
    <section className="todo-task-section">
      <div className="todo-task-section-head">
        <div>
          <span>{title}</span>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <strong>{tasks.length}</strong>
      </div>
      <div className="todo-task-section-list">
        {tasks.length === 0 ? (
          <EmptyState title={emptyMessage || `No ${title.toLowerCase()} tasks.`} icon="✓" className="todo-hub-empty" />
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.UUID}
              task={task}
              selected={selectedId === task.UUID}
              onSelect={onSelect}
              onStart={onStart}
              onDragStart={onDragStart}
            />
          ))
        )}
      </div>
    </section>
  );
}

const TODOIST_GROUPS = [
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['week', 'This week'],
  ['later', 'Later'],
  ['unscheduled', 'No date'],
];

function TodoistTaskList({ tasks, selectedId, completingId, onSelect, onStart, onComplete, onDragStart }) {
  const { visibleItems, sentinelRef, hasMore } = useProgressiveList(tasks, 20);
  const groups = TODOIST_GROUPS
    .map(([id, label]) => ({
      id,
      label,
      tasks: visibleItems.filter((task) => task.dueState === id),
      total: tasks.filter((task) => task.dueState === id).length,
    }))
    .filter((group) => group.total > 0);

  if (tasks.length === 0) {
    return <EmptyState title="No tasks match these filters." icon="✓" className="todo-hub-empty" />;
  }

  return (
    <div className="todoist-list">
      {groups.map((group) => (
        <section key={group.id} className="todoist-group">
          <header>
            <strong>{group.label}</strong>
            <span>{group.total}</span>
          </header>
          <div className="todoist-group-list">
            {group.tasks.map((task) => (
              <article
                key={task.UUID}
                className={`todoist-row todoist-row--${task.slopeTier} ${selectedId === task.UUID ? 'is-selected' : ''}`}
                draggable
                onDragStart={(event) => onDragStart(event, task)}
                onClick={() => onSelect(task)}
              >
                <button
                  type="button"
                  className="todoist-complete"
                  onClick={(event) => { event.stopPropagation(); onComplete(task); }}
                  aria-label={`Complete ${task.name || 'task'}`}
                  aria-busy={completingId === task.UUID}
                  disabled={Boolean(completingId)}
                />
                <div className="todoist-copy">
                  <strong>{task.name || 'Untitled task'}</strong>
                  <span>
                    {task.estimatedDuration || 0}m
                    {task.projectName ? ` · ${task.projectName}` : ''}
                    {task.dueDate ? ` · ${prettyPrintDate(task.dueDate)}` : ''}
                  </span>
                </div>
                {(task.recurrence || task.repeatRule) && (
                  <span
                    className="todoist-recurrence"
                    role="img"
                    aria-label={`Repeats ${formatTaskRecurrence(task.recurrence || task.repeatRule)}`}
                    title={`Repeats ${formatTaskRecurrence(task.recurrence || task.repeatRule)}`}
                  >
                    ↻
                  </span>
                )}
                <span className={`todoist-priority todoist-priority--${task.slopeTier}`}>
                  {formatSlope(task.slope)}
                </span>
              </article>
            ))}
          </div>
        </section>
      ))}
      {hasMore && <div ref={sentinelRef} className="todo-list-sentinel">Loading more tasks.</div>}
    </div>
  );
}

export { CalendarDay, DayAgenda, ReminderSection, TaskSection, TodoHubControls, TodoHubTabs, TodoistTaskList, formatMonthLabel, getDragTask, getReminderDate };
