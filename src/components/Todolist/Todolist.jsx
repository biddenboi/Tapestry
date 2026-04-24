import './TodoList.css';
import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import NiceModal from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { GAME_STATE, MINUTE, STORES } from '../../utils/Constants.js';
import {
  getSlopes,
  getNextTodo,
  getAllWPDFromArray,
  getDisplaySlope,
  getSlopeTier,
  buildSlopeContext,
} from '../../utils/Helpers/Tasks.js';
import { prettyPrintDate, formatDuration } from '../../utils/Helpers/Time.js';
import { getLocalDate } from '../../utils/Helpers/Time.js';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu.jsx';
import TaskPreviewMenu from '../../Modals/TaskPreviewMenu/TaskPreviewMenu.jsx';
import ProjectsModal from '../../Modals/ProjectsModal/ProjectsModal.jsx';

// ── TodoItem ──────────────────────────────────────────────────────────────

/**
 * Format a slope value for display. Keeps the width consistent across the
 * list so the column reads like a proper data column:
 *   < 10 → "1.2", "3.5"
 *   ≥ 10 → "12", "24"  (no decimal — saves horizontal space without hiding info)
 */
function formatSlope(s) {
  if (!Number.isFinite(s)) return '0.0';
  return s >= 10 ? String(Math.round(s)) : s.toFixed(1);
}

function TodoItem({ element, onSelect, projectName, slope }) {
  const tier = getSlopeTier(slope);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = element.dueDate && new Date(element.dueDate) < today;

  return (
    <div
      className={
        `todo-item todo-item--${tier}` +
        (element._crossProject ? ' todo-item--cross-project' : '')
      }
      onClick={() => onSelect(element)}
      role="button"
      tabIndex={0}
    >
      {/* ── Slope chip — left edge, primary priority signal ── */}
      <div className="todo-slope-chip" title={`Slope: ${slope.toFixed(2)} (${tier})`}>
        <span className="todo-slope-value">{formatSlope(slope)}</span>
        <span className="todo-slope-label">{tier.toUpperCase()}</span>
      </div>

      {/* ── Name + meta ── */}
      <div className="todo-item-left">
        <span className="todo-item-name">{element.name}</span>
        <span className="todo-item-meta">
          {element.estimatedDuration}min
          {projectName ? ` · [${projectName}]` : ''}
        </span>
      </div>

      {/* ── Due date (right) ── */}
      <span className={`todo-item-due${isOverdue ? ' todo-item-due--overdue' : ''}`}>
        {prettyPrintDate(element.dueDate)}
      </span>
    </div>
  );
}

// ── TodoList ──────────────────────────────────────────────────────────────

export default function TodoList({ style }) {
  const {
    databaseConnection,
    refreshApp,
    closePanel,
    gameState: [gameState],
    activeTask: [activeTask, setActiveTask],
  } = useContext(AppContext);

  const [todos, setTodos]                     = useState([]);
  const [projects, setProjects]               = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);  // null = All
  const [nextTodo, setNextTodo]               = useState(null);
  const [timeCleared, setTimeCleared]         = useState(null);
  const [slopeContext, setSlopeContext]       = useState(null);

  // Load todos + projects + task history whenever deps change.
  const reload = useCallback(async () => {
    const currentPlayer = await databaseConnection.getCurrentPlayer();

    const [todoArray, projectArray, completedTasks] = await Promise.all([
      databaseConnection.getAll(STORES.todo),
      databaseConnection.getAll(STORES.project),
      // getPlayerStore uses the 'parent' index — fast scoped query.
      currentPlayer
        ? databaseConnection.getPlayerStore(STORES.task, currentPlayer.UUID)
        : Promise.resolve([]),
    ]);

    // Deduplicate by UUID — guards against duplicate DB entries causing React
    // "same key" warnings. Last-write-wins (final entry kept per UUID).
    const seenUUIDs = new Map();
    for (const t of todoArray) seenUUIDs.set(t.UUID, t);
    const dedupedTodos = [...seenUUIDs.values()];

    setProjects(projectArray.sort((a, b) => String(a.name).localeCompare(String(b.name))));

    // Build the slope-evaluation context once per reload. Used for the full
    // 6-factor slope: aversion × urgency × procrastination × size ×
    // saturation × momentum (see getDisplaySlope in Tasks.js).
    const ctx = buildSlopeContext(completedTasks);
    setSlopeContext(ctx);

    // WPD / time-remaining calculation uses all todos regardless of filter.
    const allWPD = getAllWPDFromArray(dedupedTodos);
    const sumWPD = allWPD.reduce((a, c) => a + c, 0);
    const diff = sumWPD - (currentPlayer?.minutesClearedToday ?? 0);
    setTimeCleared(formatDuration(diff * MINUTE));

    // Slope-based weights (0-100 normalised) — kept for legacy consumers.
    const slopeArray = getSlopes(dedupedTodos, ctx);
    const withWeight = dedupedTodos.map((t, i) => ({
      ...t,
      weight: Math.floor(slopeArray[i] || 0),
    }));
    setTodos(withWeight);

    // ── NEXT TASK with project scope ─────────────────────────────
    const today = getLocalDate(new Date());
    const isOverdue = (t) => t.dueDate && new Date(t.dueDate).getTime() < today.getTime();

    let pool;
    if (!activeProjectId) {
      pool = withWeight;
    } else {
      const inProject = withWeight.filter((t) => t.projectId === activeProjectId);
      const overdueOther = withWeight.filter(
        (t) => t.projectId !== activeProjectId && isOverdue(t),
      );
      const projectNameMap = Object.fromEntries(projectArray.map((p) => [p.UUID, p.name]));
      const annotated = overdueOther.map((t) => ({
        ...t,
        _crossProject: true,
        _projectLabel: projectNameMap[t.projectId] || '?',
        reasonToSelect: `[${projectNameMap[t.projectId] || '?'}] Overdue — outside active project`,
      }));
      pool = [...inProject, ...annotated];
    }

    setNextTodo(getNextTodo(pool, ctx));
  }, [databaseConnection, activeTask, refreshApp, activeProjectId]);

  useEffect(() => { reload(); }, [reload]);

  const inSessionMode = useMemo(
    () => gameState === GAME_STATE.practice || gameState === GAME_STATE.match,
    [gameState],
  );

  const projectMap = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.UUID, p.name])),
    [projects],
  );

  // ── Filtered & slope-sorted display list ──────────────────────────────
  //
  // The list sorts descending by slope so the most-critical task always
  // appears at the top. Combined with the tier-coloured chip on the left,
  // this makes priority scannable at a glance.
  const displayedTodos = useMemo(() => {
    const today = getLocalDate(new Date());
    const isOverdue = (t) => t.dueDate && new Date(t.dueDate).getTime() < today.getTime();
    let list = todos;
    if (activeProjectId) {
      list = todos.filter(
        (t) => t.projectId === activeProjectId || (t.projectId !== activeProjectId && isOverdue(t)),
      );
    }
    // Evaluate slope once per render (not inside TodoItem) — one map over the
    // filtered list, shared with the sort comparator.
    const withSlope = list.map((t) => ({
      todo: t,
      slope: getDisplaySlope(t, slopeContext),
    }));
    withSlope.sort((a, b) => b.slope - a.slope);
    return withSlope;
  }, [todos, activeProjectId, slopeContext]);

  // ── Task flow ─────────────────────────────────────────────────────────
  const openTaskFlow = async (todo) => {
    if (!todo) return;
    const currentPlayer = await databaseConnection.getCurrentPlayer();
    const taskDraft = {
      ...todo,
      parent: currentPlayer?.UUID || todo.parent,
      originalDuration: Number(todo.estimatedDuration || 0),
      reasonToSelect: todo.reasonToSelect || 'Manually selected',
    };

    setActiveTask(taskDraft);

    if (inSessionMode) {
      await databaseConnection.remove(STORES.todo, todo.UUID);
      refreshApp();
    }

    closePanel();

    requestAnimationFrame(() => {
      NiceModal.show(inSessionMode ? TaskPreviewMenu : TaskCreationMenu);
    });
  };

  // ── Projects modal ────────────────────────────────────────────────────
  const openProjectsModal = () => {
    NiceModal.show(ProjectsModal, {
      onChanged: () => {
        reload();
        databaseConnection.getAll(STORES.project).then((rows) => {
          const stillExists = rows.some((p) => p.UUID === activeProjectId);
          if (!stillExists) setActiveProjectId(null);
        }).catch(() => {});
      },
    });
  };

  return (
    <div className="todo-list" style={style}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="todo-header">
        <span className="todo-header-title">TODO LIST</span>
        <div className="todo-header-right">
          {timeCleared && <span className="todo-header-stat">{timeCleared} remaining</span>}
          <button className="todo-projects-btn" onClick={openProjectsModal} title="Manage projects">
            ⬡ Projects
          </button>
        </div>
      </div>

      {/* ── Project filter bar ─────────────────────────────── */}
      {projects.length > 0 && (
        <div className="project-filter-bar">
          <button
            className={`project-chip ${!activeProjectId ? 'active' : ''}`}
            onClick={() => setActiveProjectId(null)}
          >
            All
          </button>
          {projects.map((p) => (
            <button
              key={p.UUID}
              className={`project-chip ${activeProjectId === p.UUID ? 'active' : ''}`}
              onClick={() => setActiveProjectId((prev) => (prev === p.UUID ? null : p.UUID))}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Item list ──────────────────────────────────────── */}
      <div className="todo-items">
        {displayedTodos.length === 0 ? (
          <p className="todo-empty">
            {activeProjectId ? 'No tasks in this project.' : 'No tasks — add one with the button above.'}
          </p>
        ) : (
          displayedTodos.map(({ todo: element, slope }) => (
            <TodoItem
              key={element.UUID}
              element={element}
              slope={slope}
              onSelect={openTaskFlow}
              projectName={
                (!activeProjectId && element.projectId)
                  ? projectMap[element.projectId]
                  : element._crossProject
                    ? element._projectLabel
                    : null
              }
            />
          ))
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div className="todo-footer">
        <button
          className={`next-task-btn ${nextTodo ? 'primary' : 'disabled'}`}
          onClick={() => openTaskFlow(nextTodo)}
          disabled={!nextTodo}
        >
          ↑ NEXT TASK
        </button>
      </div>

    </div>
  );
}