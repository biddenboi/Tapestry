import '@features/tasks/components/TodoList/TodoList.css';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES } from '@domain/constants.js';
import { saveTaskCommand } from '@domain/tasks/TaskCommands.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import {
  buildSlopeContext,
  coerceAversion,
  createTaskDraft,
  getSlopes,
} from '@domain/tasks/Tasks.js';
import {
  buildWorkloadModel,
  formatPlanningMinutes,
} from '@domain/planning/Planning.js';
import {
  annotateTodos,
  buildTodoHubViewModel,
  dateKey,
  filterAnnotatedTodos,
  getMonthGrid,
  getWeekDays,
  makeDueDateForDay,
  normalizeTaskDraft,
  startOfDay,
} from '@domain/tasks/TodoView.js';
import { showTaskCreationMenu } from '@features/tasks/modals/TaskCreationMenu/loadTaskCreationMenu.js';
import { showTaskPreviewMenu } from '@features/tasks/modals/TaskPreviewMenu/loadTaskPreviewMenu.js';
import ReminderModal from '@features/reminders/modals/ReminderModal/ReminderModal.jsx';
import { completeTodoNow } from '@features/tasks/domain/completeTodoNow.js';
import { isGoalActive, isGoalTaskCategory } from '@domain/contribution/Contribution.js';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import TasksShell, { TASK_LOCAL_PAGES } from '@features/tasks/pages/TasksShell/TasksShell.jsx';
import TaskNowPage from '@features/tasks/pages/TaskNowPage/TaskNowPage.jsx';
import TaskHistoryPage from '@features/tasks/pages/TaskHistoryPage/TaskHistoryPage.jsx';

import {
  CalendarDay,
  DayAgenda,
  ReminderSection,
  TaskSection,
  TodoHubControls,
  TodoistTaskList,
  formatMonthLabel,
  getDragTask,
  getReminderDate,
} from '@features/tasks/components/TodoList/TodoListView.jsx';

const EMPTY_SEED_TODOS = Object.freeze([]);

function selectNowTask(todos = []) {
  const task = [...todos].sort((left, right) => (
    Number(right.weight || 0) - Number(left.weight || 0)
    || Number(left.estimatedDuration || 0) - Number(right.estimatedDuration || 0)
    || String(left.UUID).localeCompare(String(right.UUID))
  ))[0];
  if (!task) return null;
  return {
    ...task,
    reasonToSelect: task.isNextActionForGoal
      ? 'This is the next action for your current Goal.'
      : task.isInCurrentFocusGoal
        ? 'This supports your current Goal focus.'
        : 'This is the highest-priority available task.',
  };
}

export default function TodoList({
  style,
  fromQueue = false,
  focusTaskId = null,
  seedTodos = EMPTY_SEED_TODOS,
}) {
  const {
    databaseConnection,
    domainRevisions,
    invalidateDomains,
    currentPlayer,
    notify,
    emitRewardEvent,
    activeTask: [, setActiveTask],
    gameState: [gameState],
    dojoSessionUUID,
    routeIntent,
    consumeRouteIntent,
    reportLocalSubpage,
  } = useAppContext();

  const [todos, setTodos] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [projects, setProjects] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [nextTodo, setNextTodo] = useState(null);
  const [slopeContext, setSlopeContext] = useState(null);

  const {
    activePageId: activeHubTab,
    selectPage: setActiveHubTab,
  } = useLocalSectionRoute({
    sectionId: 'tasks',
    pages: TASK_LOCAL_PAGES,
    profileUUID: currentPlayer?.UUID,
    databaseConnection,
    routeIntent: routeIntent?.panel === 'tasks' ? routeIntent : null,
    defaultPageId: fromQueue ? 'queue' : 'now',
    onIntentConsumed: consumeRouteIntent,
    onPageChange: reportLocalSubpage,
  });
  const [calendarMode, setCalendarMode] = useState('week');
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [focusedDay, setFocusedDay] = useState(null);
  const [dayMenu, setDayMenu] = useState(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [dueFilter, setDueFilter] = useState('all');
  const [sortMode, setSortMode] = useState('smart');
  const [completingId, setCompletingId] = useState(null);
  const openedFocusTaskRef = useRef(null);

  const reload = useCallback(async () => {
    const player = currentPlayer;

    const [todoArray, projectArray, completed, reminderArray, focusSetting] = await Promise.all([
      databaseConnection.getAll(STORES.todo),
      databaseConnection.getAll(STORES.project),
      player ? databaseConnection.getPlayerStore(STORES.task, player.UUID) : Promise.resolve([]),
      player ? databaseConnection.getPlayerReminders(player.UUID) : Promise.resolve([]),
      player ? databaseConnection.get(STORES.appSetting, `goals.currentFocus:${player.UUID}`) : Promise.resolve(null),
    ]);

    const sourceTodos = Array.isArray(todoArray) && todoArray.length > 0
      ? todoArray
      : seedTodos;
    const normalizedTodos = sourceTodos
      .filter((todo) => todo && typeof todo === 'object')
      .map((todo) => normalizeTaskDraft(todo));
    const seenUUIDs = new Map();
    for (const task of normalizedTodos) seenUUIDs.set(task.UUID, task);
    let dedupedTodos = [...seenUUIDs.values()]
      .filter((todo) => !player?.UUID || !todo.parent || todo.parent === player.UUID);
    if (dedupedTodos.length === 0 && seedTodos.length > 0) {
      dedupedTodos = seedTodos;
    }

    const sortedProjects = projectArray
      .filter((goal) => (
        (!player?.UUID || !goal.parent || String(goal.parent) === String(player.UUID))
        && isGoalActive(goal)
        && isGoalTaskCategory(goal)
      ))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const ctx = buildSlopeContext(completed);
    const slopeArray = getSlopes(dedupedTodos, ctx);
    const projectNameMap = Object.fromEntries(sortedProjects.map((project) => [project.UUID, project.name]));
    const projectMap = new Map(projectArray.map((project) => [String(project.UUID), project]));
    const focusGoalUUID = focusSetting?.value?.goalUUID || null;
    const withWeight = dedupedTodos.map((t, i) => ({
      ...t,
      weight: Math.floor(slopeArray[i] || 0),
      projectName: projectNameMap[t.projectId] || '',
      goalLifecycleStatus: projectMap.get(String(t.projectId))?.lifecycleStatus
        || projectMap.get(String(t.projectId))?.status
        || null,
      isInCurrentFocusGoal: Boolean(t.projectId && String(t.projectId) === String(focusGoalUUID)),
      isInBlockedGoal: projectMap.get(String(t.projectId))?.healthStatus === 'blocked',
      isInPausedGoal: ['paused', 'completed', 'archived'].includes(
        projectMap.get(String(t.projectId))?.lifecycleStatus
        || projectMap.get(String(t.projectId))?.status,
      ),
      isNextActionForGoal: String(projectMap.get(String(t.projectId))?.nextAction?.entityUUID || '') === String(t.UUID),
      daysUntilGoalTarget: projectMap.get(String(t.projectId))?.targetDate
        ? Math.ceil((new Date(projectMap.get(String(t.projectId)).targetDate).getTime() - Date.now()) / 86400000)
        : null,
    }));
    const recommendableTodos = withWeight.filter((todo) => (
      !todo.projectId
      || !['paused', 'completed', 'archived'].includes(todo.goalLifecycleStatus)
    ));

    setProjects(sortedProjects);
    setCompletedTasks(completed);
    setSlopeContext(ctx);
    setTodos(withWeight);
    setReminders(reminderArray.filter((reminder) => !reminder.completedAt && !reminder.dismissedAt));

    setNextTodo(selectNowTask(recommendableTodos));
  }, [databaseConnection, currentPlayer, fromQueue, seedTodos]);

  useEffect(() => { reload(); }, [
    reload,
    domainRevisions.tasks,
    domainRevisions.reminders,
  ]);

  useEffect(() => {
    if (!fromQueue) return;
    setActiveHubTab('today');
    setFocusedDay(null);
  }, [fromQueue]);

  useEffect(() => {
    if (!focusTaskId) return;
    setActiveHubTab('today');
    setFocusedDay(null);
  }, [focusTaskId]);

  useEffect(() => {
    if (!dayMenu) return undefined;
    const closeMenu = () => setDayMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [dayMenu]);

  const hubModel = useMemo(() => buildTodoHubViewModel({
    todos,
    projects,
    completedTasks,
    slopeContext,
    currentPlayer,
  }), [todos, projects, completedTasks, slopeContext, currentPlayer]);
  const seedAnnotatedTasks = useMemo(
    () => (seedTodos.length > 0 ? annotateTodos(seedTodos, projects, slopeContext) : []),
    [projects, seedTodos, slopeContext],
  );
  const annotatedTasks = useMemo(
    () => (
      fromQueue && hubModel.annotatedTasks.length === 0 && seedAnnotatedTasks.length > 0
        ? seedAnnotatedTasks
        : hubModel.annotatedTasks
    ),
    [fromQueue, hubModel.annotatedTasks, seedAnnotatedTasks],
  );

  const workloadModel = useMemo(() => buildWorkloadModel(
    annotatedTasks,
    completedTasks,
    new Date(),
    { todayProgressMinutes: currentPlayer?.minutesClearedToday },
  ), [annotatedTasks, completedTasks, currentPlayer?.minutesClearedToday]);

  const filteredTasks = useMemo(() => filterAnnotatedTodos(annotatedTasks, {
    search,
    projectId: projectFilter,
    dueState: dueFilter,
    sort: sortMode,
  }), [annotatedTasks, search, projectFilter, dueFilter, sortMode]);
  const displayTasks = useMemo(() => {
    const defaultFilters = !search.trim() && projectFilter === 'all' && dueFilter === 'all';
    if (fromQueue && defaultFilters && filteredTasks.length === 0 && annotatedTasks.length > 0) {
      return annotatedTasks;
    }
    return filteredTasks;
  }, [annotatedTasks, dueFilter, filteredTasks, fromQueue, projectFilter, search]);

  const calendarDays = useMemo(
    () => (calendarMode === 'month' ? getMonthGrid(selectedDate) : getWeekDays(selectedDate)),
    [calendarMode, selectedDate],
  );

  const tasksByDate = useMemo(() => {
    const map = {};
    for (const task of displayTasks) {
      if (task.dueKey === 'unscheduled') continue;
      if (!map[task.dueKey]) map[task.dueKey] = [];
      map[task.dueKey].push(task);
    }
    return map;
  }, [displayTasks]);

  const filteredReminders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reminders
      .filter((reminder) => {
        if (!query) return true;
        return [reminder.title, reminder.body]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => (
        (getReminderDate(a)?.getTime() ?? Infinity) - (getReminderDate(b)?.getTime() ?? Infinity)
      ));
  }, [reminders, search]);

  const remindersByDate = useMemo(() => {
    const map = {};
    for (const reminder of filteredReminders) {
      const date = getReminderDate(reminder);
      if (!date) continue;
      const key = dateKey(date);
      if (!map[key]) map[key] = [];
      map[key].push(reminder);
    }
    return map;
  }, [filteredReminders]);

  const focusedDayTasks = useMemo(
    () => (focusedDay ? tasksByDate[dateKey(focusedDay)] || [] : []),
    [focusedDay, tasksByDate],
  );

  const focusedDayReminders = useMemo(
    () => (focusedDay ? remindersByDate[dateKey(focusedDay)] || [] : []),
    [focusedDay, remindersByDate],
  );

  const overdueTasks = useMemo(
    () => displayTasks.filter((task) => task.dueState === 'overdue'),
    [displayTasks],
  );

  const unscheduledTasks = useMemo(
    () => displayTasks.filter((task) => task.dueState === 'unscheduled'),
    [displayTasks],
  );

  const openTaskFlow = async (todo, options = {}) => {
    if (!todo) return;
    const player = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
    const normalizedTodo = normalizeTaskDraft(todo);
    const taskDraft = {
      ...normalizedTodo,
      parent: player?.UUID || normalizedTodo.parent,
      todoCreatedAt: normalizedTodo.createdAt || null,
      createdAt: null,
      originalDuration: Number(normalizedTodo.estimatedDuration || 0),
      reasonToSelect: normalizedTodo.reasonToSelect || 'Manually selected',
    };

    setActiveTask(taskDraft);

    if (fromQueue && !options.skipQueueRemove) {
      setTodos((previous) => previous.filter((entry) => entry.UUID !== todo.UUID));
      databaseConnection.remove(STORES.todo, todo.UUID)
        .then(() => invalidateDomains(DOMAIN_INVALIDATION.taskWrite))
        .catch((error) => console.warn('[TodoList] queue remove failed:', error));
    }

    requestAnimationFrame(() => {
      if (fromQueue || options.forcePreview) {
        showTaskPreviewMenu().catch((error) => console.warn('[TodoList] task preview load failed:', error));
      } else {
        showTaskCreationMenu();
      }
    });
  };

  const openNextRecommendation = async () => {
    if (!nextTodo) return;
    await openTaskFlow(nextTodo, { skipQueueRemove: true, forcePreview: true });
  };

  const startTask = async (todo) => {
    if (!todo) return;
    const player = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
    const normalizedTodo = normalizeTaskDraft(todo);
    setActiveTask({
      ...normalizedTodo,
      parent: player?.UUID || normalizedTodo.parent,
      todoCreatedAt: normalizedTodo.createdAt || null,
      createdAt: null,
      originalDuration: Number(normalizedTodo.estimatedDuration || 0),
      reasonToSelect: normalizedTodo.reasonToSelect || 'Started from task hub',
    });
    requestAnimationFrame(() => {
      showTaskPreviewMenu().catch((error) => console.warn('[TodoList] task preview load failed:', error));
    });
  };

  const completeTask = async (todo) => {
    if (!todo?.UUID || completingId) return;
    setCompletingId(todo.UUID);
    try {
      const persistedPlayer = await databaseConnection.getCurrentPlayer();
      const completion = await completeTodoNow({
        databaseConnection,
        todo,
        player: persistedPlayer,
        gameState,
        dojoSessionUUID,
        notify,
        emitRewardEvent,
        source: 'task-menu-checkbox',
      });
      if (!completion) throw new Error('No completion record was saved.');
      setTodos((previous) => previous.filter((entry) => entry.UUID !== todo.UUID));
      invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
      await reload();
    } catch (error) {
      console.error('[TodoList] task completion failed:', error);
      notify?.({
        title: 'Task completion failed',
        message: error?.message || 'The task could not be completed. Please try again.',
        kind: 'error',
        persist: false,
      });
      reload().catch((reloadError) => console.warn('[TodoList] recovery reload failed:', reloadError));
    } finally {
      setCompletingId(null);
    }
  };

  const saveTodo = async (todo, patch) => {
    const player = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
    const updated = {
      ...todo,
      ...patch,
      UUID: todo.UUID || uuid(),
      parent: todo.parent || player?.UUID,
      createdAt: todo.createdAt || new Date().toISOString(),
      inGameTimestamp: todo.inGameTimestamp ?? getCurrentIGT(player),
      estimatedDuration: Math.max(0, Number(patch.estimatedDuration ?? todo.estimatedDuration ?? 0)),
      aversion: coerceAversion(patch.aversion ?? todo.aversion),
    };
    delete updated.dueDateObj;
    delete updated.dueKey;
    delete updated.dueState;
    delete updated.isOverdue;
    delete updated.isToday;
    delete updated.slope;
    delete updated.slopeTier;
    delete updated.projectName;
    delete updated.projectColor;
    delete updated.wpd;
    delete updated.ageDays;
    const saved = await saveTaskCommand(databaseConnection, updated);
    const persistedTask = saved.task;
    setTodos((previous) => {
      const existingIndex = previous.findIndex((entry) => entry.UUID === persistedTask.UUID);
      if (existingIndex === -1) return [...previous, persistedTask];
      const next = [...previous];
      next[existingIndex] = { ...previous[existingIndex], ...persistedTask };
      return next;
    });
    invalidateDomains(DOMAIN_INVALIDATION.taskWrite);
    reload().catch((error) => console.warn('[TodoList] background reload failed:', error));
  };

  const onDragStart = (event, task) => {
    event.dataTransfer?.setData('text/todo-id', task.UUID);
    event.dataTransfer.effectAllowed = 'move';
  };

  const dropOnDate = async (event, day) => {
    event.preventDefault();
    const task = getDragTask(event, annotatedTasks);
    if (!task) return;
    await saveTodo(task, { dueDate: makeDueDateForDay(day, task.dueDate) });
    setFocusedDay(startOfDay(day));
  };

  const openTaskCreationPopup = (day = null, projectId = null) => {
    const normalizedDay = day ? startOfDay(day) : null;
    const dueDate = normalizedDay ? makeDueDateForDay(normalizedDay) : null;
    setActiveTask(createTaskDraft({
      dueDate,
      projectId: projectId && projectId !== '__none__' ? projectId : null,
    }));
    if (normalizedDay) {
      setFocusedDay(normalizedDay);
      setSelectedDate(normalizedDay);
    }
    requestAnimationFrame(() => showTaskCreationMenu());
  };

  const shiftCalendar = (dir) => {
    const next = startOfDay(selectedDate);
    next.setDate(next.getDate() + dir * (calendarMode === 'month' ? 30 : 7));
    setSelectedDate(next);
    setFocusedDay(null);
  };

  const focusCalendarDay = (day) => {
    const normalized = startOfDay(day);
    setFocusedDay(normalized);
    setSelectedDate(normalized);
    setDayMenu(null);
  };

  const openDayMenu = (event, day) => {
    event.preventDefault();
    event.stopPropagation();
    setDayMenu({
      x: event.clientX,
      y: event.clientY,
      day: startOfDay(day),
    });
  };

  const selectTask = async (task) => {
    if (!task) return;
    const player = currentPlayer?.UUID ? currentPlayer : await databaseConnection.getCurrentPlayer();
    const normalized = normalizeTaskDraft(task);
    setActiveTask({
      ...normalized,
      parent: player?.UUID || normalized.parent,
      todoCreatedAt: normalized.createdAt || null,
      createdAt: null,
      sessionRequestedAt: null,
      actionSessionUUID: null,
      originalDuration: Number(normalized.estimatedDuration || 0),
    });
    requestAnimationFrame(() => showTaskCreationMenu());
  };

  useEffect(() => {
    if (!focusTaskId) {
      openedFocusTaskRef.current = null;
      return;
    }
    if (openedFocusTaskRef.current === focusTaskId) return;
    const focusedTask = todos.find((task) => String(task.UUID) === String(focusTaskId));
    if (!focusedTask) return;
    openedFocusTaskRef.current = focusTaskId;
    selectTask(focusedTask);
  }, [focusTaskId, todos]);

  const clearUpcomingFocus = (event) => {
    if (
      event.target.closest('.todo-calendar-day')
      || event.target.closest('.todo-day-agenda')
      || event.target.closest('.todo-day-menu')
    ) return;
    setFocusedDay(null);
  };

  const openReminderEditor = (reminder = null, day = null) => {
    const initialDate = day
      ? (() => {
        const date = new Date(day);
        date.setHours(9, 0, 0, 0);
        return date.toISOString();
      })()
      : null;
    NiceModal.show(ReminderModal, {
      reminder,
      initialDate,
      onSaved: async () => {
        invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
        await reload();
      },
    });
  };

  const updateReminder = async (action, reminder, minutes = null) => {
    if (!reminder?.UUID) return;
    if (action === 'complete') await databaseConnection.completeReminder(reminder.UUID);
    if (action === 'dismiss') await databaseConnection.dismissReminder(reminder.UUID);
    if (action === 'snooze') await databaseConnection.snoozeReminder(reminder.UUID, minutes || 10);
    invalidateDomains(DOMAIN_INVALIDATION.reminderWrite);
    await reload();
  };

  const renderUpcoming = () => (
    <div className="todo-upcoming-layout" onClick={clearUpcomingFocus}>
      <section className="todo-calendar-panel">
        <div className="todo-calendar-toolbar">
          <div>
            <span className="todo-panel-title">Upcoming calendar</span>
            <strong>{formatMonthLabel(selectedDate)}</strong>
          </div>
          <div className="todo-calendar-actions">
            <button type="button" className="todo-calendar-arrow" onClick={() => shiftCalendar(-1)}>{'<'}</button>
            <button
              type="button"
              onClick={() => {
                const today = startOfDay(new Date());
                setSelectedDate(today);
                setFocusedDay(null);
              }}
            >
              Today
            </button>
            <button type="button" className="todo-calendar-arrow" onClick={() => shiftCalendar(1)}>{'>'}</button>
            <button type="button" className={calendarMode === 'week' ? 'active' : ''} onClick={() => setCalendarMode('week')}>Week</button>
            <button type="button" className={calendarMode === 'month' ? 'active' : ''} onClick={() => setCalendarMode('month')}>Month</button>
          </div>
        </div>
        <div className={`todo-calendar-grid todo-calendar-grid--${calendarMode}`}>
          {calendarDays.map((day) => (
            <CalendarDay
              key={dateKey(day)}
              day={day}
              selected={dateKey(day) === dateKey(new Date())}
              focused={focusedDay && dateKey(day) === dateKey(focusedDay)}
              outsideMonth={calendarMode === 'month' && day.getMonth() !== selectedDate.getMonth()}
              tasks={tasksByDate[dateKey(day)] || []}
              reminders={remindersByDate[dateKey(day)] || []}
              onDropTask={dropOnDate}
              onSelectTask={selectTask}
              onStartTask={startTask}
              onSelectReminder={openReminderEditor}
              onDragStart={onDragStart}
              onFocusDay={focusCalendarDay}
              onOpenDayMenu={openDayMenu}
              compact={calendarMode === 'month'}
            />
          ))}
        </div>
        {dayMenu && (
          <div className="todo-day-menu" style={{ left: dayMenu.x, top: dayMenu.y }}>
            <button type="button" onClick={() => { openTaskCreationPopup(dayMenu.day); setDayMenu(null); }}>New task</button>
            <button type="button" onClick={() => { openReminderEditor(null, dayMenu.day); setDayMenu(null); }}>New reminder</button>
            <button type="button" onClick={() => focusCalendarDay(dayMenu.day)}>View day</button>
          </div>
        )}
      </section>
    </div>
  );

  const renderToday = () => (
    <TodoistTaskList
      tasks={displayTasks}
      selectedId={null}
      completingId={completingId}
      onSelect={selectTask}
      onStart={startTask}
      onComplete={completeTask}
      onDragStart={onDragStart}
    />
  );

  const renderReminders = () => (
    <div className="todo-reminders-view">
      <ReminderSection
        reminders={filteredReminders}
        title="All reminders"
        subtitle="Ordered by the next time they will notify you"
        onComplete={(reminder) => updateReminder('complete', reminder)}
        onSnooze={(reminder, minutes) => updateReminder('snooze', reminder, minutes)}
        onEdit={openReminderEditor}
        onDismiss={(reminder) => updateReminder('dismiss', reminder)}
      />
    </div>
  );

  const renderHubTab = () => {
    if (activeHubTab === 'history') return <TaskHistoryPage tasks={completedTasks} />;
    if (activeHubTab === 'planning') return renderUpcoming();
    if (activeHubTab === 'now') {
      return (
        <TaskNowPage
          recommendation={nextTodo}
          onStart={startTask}
          onInspect={selectTask}
        >
          <TodoistTaskList
            tasks={nextTodo ? displayTasks.filter((task) => task.UUID === nextTodo.UUID) : displayTasks.slice(0, 1)}
            selectedId={null}
            completingId={completingId}
            onSelect={selectTask}
            onStart={startTask}
            onComplete={completeTask}
            onDragStart={onDragStart}
          />
        </TaskNowPage>
      );
    }
    return renderToday();
  };

  const renderPlanningTray = () => (
    <aside className="todo-planning-tray">
      <TaskSection
        title="Overdue"
        subtitle="Drag onto the calendar to reschedule"
        emptyMessage="No overdue tasks."
        tasks={overdueTasks}
        selectedId={null}
        onSelect={selectTask}
        onStart={startTask}
        onDragStart={onDragStart}
      />
      <TaskSection
        title="Unscheduled"
        subtitle="Tasks waiting for a date"
        emptyMessage="No unscheduled tasks."
        tasks={unscheduledTasks}
        selectedId={null}
        onSelect={selectTask}
        onStart={startTask}
        onDragStart={onDragStart}
      />
    </aside>
  );

  const sidePanel = activeHubTab === 'history'
    ? null
    : activeHubTab === 'planning' && focusedDay
        ? (
          <DayAgenda
            day={focusedDay}
            tasks={focusedDayTasks}
            reminders={focusedDayReminders}
            onSelectTask={selectTask}
            onStartTask={startTask}
            onDragStart={onDragStart}
            onSelectReminder={openReminderEditor}
            onNewTask={openTaskCreationPopup}
            onNewReminder={(day) => openReminderEditor(null, day)}
          />
        )
        : activeHubTab === 'planning'
          ? renderPlanningTray()
          : null;

  return (
    <div
      className="todo-list todo-list--hub"
      style={style}
      data-seed-count={seedTodos.length}
      data-todo-count={todos.length}
      data-filtered-count={filteredTasks.length}
      data-display-count={displayTasks.length}
    >
      <TasksShell
        activePageId={activeHubTab}
        onPageChange={(nextPage) => {
          setActiveHubTab(nextPage);
          setFocusedDay(null);
        }}
        actions={(
          <div className="todo-header-actions">
            <button
              type="button"
              className={nextTodo ? 'primary' : ''}
              onClick={openNextRecommendation}
              disabled={!nextTodo}
            >
              Get next
            </button>
            <button type="button" onClick={() => openReminderEditor()}>Add reminder</button>
            <button type="button" className="primary" onClick={() => openTaskCreationPopup()}>Add task</button>
          </div>
        )}
      >
      <div className="todo-tabs-row todo-tabs-row--summary">
        <p className="todo-tabs-summary">
          Today {formatPlanningMinutes(workloadModel.todayRemainingMinutes)} · debt {formatPlanningMinutes(workloadModel.overdueDebtMinutes)} · backlog {workloadModel.backlogPressure.label} · {workloadModel.paceStatus.replace('-', ' ')}
        </p>
      </div>
      {activeHubTab === 'planning' ? (
        <div className="todo-reminder-controls">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search planning"
            aria-label="Search planning"
          />
          <button type="button" onClick={() => openReminderEditor()}>Add reminder</button>
        </div>
      ) : activeHubTab === 'all' || activeHubTab === 'queue' ? (
        <TodoHubControls
          search={search}
          projectFilter={projectFilter}
          dueFilter={dueFilter}
          sortMode={sortMode}
          projects={projects}
          onSearchChange={setSearch}
          onProjectChange={setProjectFilter}
          onDueChange={setDueFilter}
          onSortChange={setSortMode}
        />
      ) : null}

      <div className={`todo-hub-body todo-hub-body--${activeHubTab} ${sidePanel ? 'has-side-panel' : 'no-side-panel'}`}>
        <main className="todo-hub-main">
          {renderHubTab()}
        </main>
        {sidePanel}
      </div>
      </TasksShell>
    </div>
  );
}
