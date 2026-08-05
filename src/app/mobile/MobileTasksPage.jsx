import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { formatTaskRecurrence } from '@domain/tasks/TaskRecurrence.js';
import { completeTodoNow } from '@features/tasks/domain/completeTodoNow.js';
import { queryMobileWorkspaceAgenda } from './application/MobileAgendaQueryService.js';
import { taskCompletionFeedback } from './application/MobileFeedback.js';
import {
  getDateSlideDirection,
  mobileDateFromKey,
  mobileDateKey,
  mobileDaySwipeDirection,
  mobileDueKey,
  moveMobileDay,
  nearestApplicableReminder,
} from './application/MobileAgendaPresentation.js';
import { useMobileSurface } from './MobileSurfaceContext.jsx';

function selectedDateTitle(selected, today) {
  if (selected === today) return 'Today';
  if (selected === moveMobileDay(today, 1)) return 'Tomorrow';
  if (selected === moveMobileDay(today, -1)) return 'Yesterday';
  return mobileDateFromKey(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function reminderTime(reminder) {
  const date = new Date(reminder.snoozedUntil || reminder.remindAt);
  const delta = date.getTime() - Date.now();
  if (delta > 0 && delta < 60 * 60_000) return `in ${Math.max(1, Math.round(delta / 60_000))}m`;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function MobileTasksPage() {
  const {
    databaseConnection,
    currentPlayer,
    domainRevisions,
    invalidateDomains,
    notify,
    emitRewardEvent,
    gameState: [gameState],
    dojoSessionUUID,
  } = useAppContext();
  const {
    openSurface,
    presentFeedback,
    registerPrimaryAction,
  } = useMobileSurface();
  const today = mobileDateKey();
  const [selectedDate, setSelectedDate] = useState(today);
  const [slideDirection, setSlideDirection] = useState('none');
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [goals, setGoals] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [error, setError] = useState('');
  const touchStartRef = useRef(null);

  const reload = useCallback(async () => {
    if (!currentPlayer?.UUID) {
      setTasks([]);
      setReminders([]);
      setGoals([]);
      return;
    }
    const agenda = await queryMobileWorkspaceAgenda(databaseConnection, {
      playerUUID: currentPlayer.UUID,
    });
    setTasks(agenda.tasks);
    setReminders(agenda.reminders);
    setGoals(agenda.goals);
  }, [currentPlayer?.UUID, databaseConnection]);

  useEffect(() => { void reload(); }, [reload, domainRevisions.tasks, domainRevisions.reminders, domainRevisions.goals]);

  const selectDate = useCallback((nextDate) => {
    setSelectedDate((previous) => {
      setSlideDirection(getDateSlideDirection(previous, nextDate));
      return nextDate;
    });
  }, []);

  const openCreateMenu = useCallback(() => {
    openSurface('create-menu', { selectedDate, onSaved: reload });
  }, [openSurface, reload, selectedDate]);

  useEffect(() => registerPrimaryAction({
    label: `Create task or reminder for ${selectedDateTitle(selectedDate, today)}`,
    onInvoke: openCreateMenu,
  }), [openCreateMenu, registerPrimaryAction, selectedDate, today]);

  const goalNames = useMemo(() => new Map(goals.map((goal) => [String(goal.UUID), goal.name])), [goals]);
  const visibleTasks = useMemo(() => tasks
    .filter((task) => {
      const due = mobileDueKey(task.dueDate);
      return due === selectedDate || (selectedDate === today && due && due < today);
    })
    .sort((left, right) => new Date(left.dueDate || 8.64e15).getTime() - new Date(right.dueDate || 8.64e15).getTime()), [selectedDate, tasks, today]);
  const nearestReminder = useMemo(
    () => nearestApplicableReminder(reminders, selectedDate, today),
    [reminders, selectedDate, today],
  );
  const dateRail = useMemo(() => Array.from({ length: 7 }, (_, index) => moveMobileDay(selectedDate, index - 3)), [selectedDate]);
  const overdueCount = selectedDate === today
    ? visibleTasks.filter((task) => mobileDueKey(task.dueDate) < today).length
    : 0;

  const openTask = (task) => openSurface('task-actions', {
    task: { ...task, projectName: goalNames.get(String(task.projectId || '')) || null },
    onChanged: reload,
  });

  const getNext = async () => {
    if (nextBusy || !tasks.length) return;
    setNextBusy(true);
    setError('');
    try {
      const { launchRecommendedTask } = await import('@domain/tasks/TaskRecommender.js');
      const result = await launchRecommendedTask(databaseConnection, currentPlayer, { todos: tasks, source: 'tasks' });
      if (!result?.task) {
        setError('No eligible next task is available right now.');
        return;
      }
      openSurface('system-direction', {
        task: result.task,
        reason: result.recommendation?.reasonChips?.join(' · ') || result.recommendation?.primaryReason || result.task.reasonToSelect,
        onChooseAnother: getNext,
      });
    } catch (nextError) {
      setError(nextError?.message || 'Get Next could not choose a task.');
    } finally {
      setNextBusy(false);
    }
  };

  const completeTask = async (task) => {
    if (busyId) return;
    setBusyId(task.UUID);
    setError('');
    try {
      const result = await completeTodoNow({
        databaseConnection,
        todo: task,
        player: currentPlayer,
        gameState,
        dojoSessionUUID,
        notify,
        emitRewardEvent,
        source: 'mobile-agenda',
        origin: 'mobile',
      });
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      presentFeedback(taskCompletionFeedback(task, result));
      await new Promise((resolve) => window.setTimeout(resolve, 280));
      await reload();
    } catch (completionError) {
      setError(completionError?.message || 'The task could not be completed.');
    } finally {
      setBusyId(null);
    }
  };

  const finishSwipe = (event) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = event.changedTouches?.[0];
    if (!start || !touch) return;
    const direction = mobileDaySwipeDirection(start, {
      x: touch.clientX,
      y: touch.clientY,
    });
    if (!direction) return;
    selectDate(moveMobileDay(selectedDate, direction));
  };

  return (
    <section
      className="mobile-page mobile-today-page"
      data-slide-direction={slideDirection}
      onAnimationEnd={() => setSlideDirection('none')}
    >
      <header className="mobile-page-header">
        <button type="button" className="mobile-date-title" onClick={() => openSurface('date-picker', { selectedDate, onSelect: selectDate })}>
          <span>Daily agenda</span><h1>{selectedDateTitle(selectedDate, today)}</h1>
        </button>
        {selectedDate === today
          ? <button type="button" disabled={nextBusy || !tasks.length} onClick={getNext}>{nextBusy ? 'Choosing…' : 'Get Next'}</button>
          : <button type="button" onClick={() => selectDate(today)}>Today</button>}
      </header>
      <nav
        className="mobile-date-rail"
        aria-label="Task date"
        onTouchStart={(event) => {
          const touch = event.touches?.[0];
          touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchEnd={finishSwipe}
        onTouchCancel={() => { touchStartRef.current = null; }}
      >
        {dateRail.map((key) => {
          const date = mobileDateFromKey(key);
          return (
            <button key={key} type="button" aria-current={key === selectedDate ? 'date' : undefined} className={`${key === selectedDate ? 'is-selected' : ''} ${key === today ? 'is-today' : ''}`} onClick={() => selectDate(key)}>
              <span>{date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</span><b>{date.getDate()}</b>
            </button>
          );
        })}
      </nav>
      {nearestReminder && (
        <button type="button" className="mobile-nearest-reminder" onClick={() => openSurface('reminder-actions', { reminder: nearestReminder, onChanged: reload })}>
          <span aria-hidden="true">◷</span><strong>{nearestReminder.title || 'Reminder'}</strong><small>{reminderTime(nearestReminder)}</small>
        </button>
      )}
      {error && <div className="mobile-tasks-error" role="alert">{error}</div>}
      <section className="mobile-agenda-list" aria-live="polite">
        <h2><span>{overdueCount ? `${overdueCount} overdue · ` : ''}Tasks</span><b>{visibleTasks.length}</b></h2>
        {visibleTasks.map((task) => {
          const overdue = selectedDate === today && mobileDueKey(task.dueDate) < today;
          return (
            <article
              key={task.UUID}
              className={`mobile-task-row is-${task.slopeTier || 'dormant'} ${overdue ? 'is-overdue' : ''} ${busyId === task.UUID ? 'is-completing' : ''}`}
              style={{ '--task-color': task.projectColor || 'var(--color-task)' }}
            >
              <button type="button" className="mobile-task-checkbox" disabled={busyId === task.UUID} onClick={() => completeTask(task)} aria-label={`Complete ${task.name || 'task'}`}><span aria-hidden="true" /></button>
              <button type="button" className="mobile-task-row__body" onClick={() => openTask(task)}>
                <strong>{task.name || 'Untitled task'}</strong>
                <span>{overdue ? 'Overdue · ' : ''}{task.estimatedDuration ? `${task.estimatedDuration}m` : 'No duration'}{task.projectId && goalNames.get(String(task.projectId)) ? ` · ${goalNames.get(String(task.projectId))}` : ''}{task.recurrence || task.repeatRule ? ` · ${formatTaskRecurrence(task.recurrence || task.repeatRule)}` : ''}</span>
              </button>
            </article>
          );
        })}
        {!visibleTasks.length && <div className="mobile-agenda-empty"><strong>This day is clear</strong><span>Add a task or choose another day.</span></div>}
      </section>
    </section>
  );
}
