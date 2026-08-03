import {
  createImportLedgerStatements,
  deterministicRows,
  fingerprintShadowSource,
  numberOrNull,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';
import { DEFAULT_WORKSPACE_ID } from '../../../domain/planning/WorkspacePlanningScope.js';

const IMPORTER_VERSION = 'workspace-planning-v2';
const PROJECT_KEYS = ['UUID','parent','playerUUID','workspaceId','createdByPlayerId','name','description','status','createdAt','inGameTimestamp','updatedAt','completedAt','archivedAt'];
const TODO_KEYS = [
  'UUID','parent','playerUUID','workspaceId','createdByPlayerId','projectId','name','description','efficiency','planNotes',
  'estimatedDuration','dueDate','aversion','planEligible','taskRevisionHash','blockerType',
  'clarificationFailures','createdAt','inGameTimestamp','updatedAt',
];
const TASK_KEYS = [
  'UUID','parent','playerUUID','workspaceId','projectId','todoUUID','previousTaskId','previous_task_id','lastCompletedTask','lastCompletedTaskUUID',
  'name','description','efficiency','planNotes','reasonToSelect','estimatedDuration','sessionDuration','actualDurationMs','points','pointsBase','source',
  'createdAt','updatedAt','completedAt','inGameTimestamp','completedInGameTimestamp',
];
const REMINDER_KEYS = ['UUID','parent','playerUUID','workspaceId','createdByPlayerId','title','body','remindAt','snoozedUntil','completedAt','dismissedAt','createdAt','inGameTimestamp','updatedAt'];

function requestedPreviousId(task) {
  return textOrNull(
    task.previousTaskId
    ?? task.previous_task_id
    ?? task.lastCompletedTaskUUID
    ?? task.lastCompletedTask?.UUID,
  );
}

function sanitizePreviousLinks(tasks, diagnostics) {
  const ids = new Set(tasks.map((task) => String(task.UUID)));
  const links = new Map();
  for (const task of tasks) {
    const id = String(task.UUID);
    const previous = requestedPreviousId(task);
    if (!previous) {
      links.set(id, null);
    } else if (previous === id) {
      links.set(id, null);
      diagnostics.push({ kind: 'task', recordId: id, reason: 'self-previous-task-link', previousTaskId: previous });
    } else if (!ids.has(previous)) {
      links.set(id, null);
      diagnostics.push({ kind: 'task', recordId: id, reason: 'missing-previous-task', previousTaskId: previous });
    } else {
      links.set(id, previous);
    }
  }

  const state = new Map();
  const stack = [];
  const position = new Map();
  const cycles = [];
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const start = position.get(id) ?? 0;
      cycles.push(stack.slice(start));
      return;
    }
    state.set(id, 1);
    position.set(id, stack.length);
    stack.push(id);
    const next = links.get(id);
    if (next) visit(next);
    stack.pop();
    position.delete(id);
    state.set(id, 2);
  };
  for (const id of [...ids].sort()) visit(id);
  for (const cycle of cycles) {
    const normalized = [...new Set(cycle)].sort();
    diagnostics.push({ kind: 'task', reason: 'previous-task-cycle', taskIds: normalized });
    for (const id of normalized) links.set(id, null);
  }
  return links;
}

export class PlanningShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('PlanningShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ projects = [], todos = [], tasks = [], reminders = [], runId = null } = {}) {
    const source = { projects, todos, tasks, reminders };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs WHERE domain='planning' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) {
      return {
        duplicate: true,
        runId: existing.runId,
        sourceFingerprint,
        counts: JSON.parse(existing.countsJson),
        diagnostics: JSON.parse(existing.diagnosticsJson),
      };
    }

    const normalized = {
      projects: deterministicRows(projects, { kind: 'project' }),
      todos: deterministicRows(todos, { kind: 'todo' }),
      tasks: deterministicRows(tasks, { kind: 'task' }),
      reminders: deterministicRows(reminders, { kind: 'reminder' }),
    };
    const diagnostics = Object.values(normalized).flatMap((entry) => [...entry.rejected, ...entry.conflicts]);
    const playerRows = await this.client.query({ sql: 'SELECT id FROM players ORDER BY id', result: 'all' });
    const playerIds = new Set(playerRows.map((row) => String(row.id)));

    const selectedProjects = normalized.projects.selected.filter((project) => {
      const playerId = textOrNull(project.parent ?? project.playerUUID);
      if (playerId && playerIds.has(playerId)) return true;
      diagnostics.push({ kind: 'project', recordId: project.UUID, reason: 'unknown-player', playerId });
      return false;
    });
    const projectIds = new Set(selectedProjects.map((project) => String(project.UUID)));

    const selectedTodos = normalized.todos.selected.filter((todo) => {
      const playerId = textOrNull(todo.parent ?? todo.playerUUID);
      if (playerId && playerIds.has(playerId)) return true;
      diagnostics.push({ kind: 'todo', recordId: todo.UUID, reason: 'unknown-player', playerId });
      return false;
    });
    const todoIds = new Set(selectedTodos.map((todo) => String(todo.UUID)));

    const selectedTasks = normalized.tasks.selected.filter((task) => {
      const playerId = textOrNull(task.parent ?? task.playerUUID);
      if (playerId && playerIds.has(playerId)) return true;
      diagnostics.push({ kind: 'task', recordId: task.UUID, reason: 'unknown-player', playerId });
      return false;
    });
    const previousLinks = sanitizePreviousLinks(selectedTasks, diagnostics);

    const selectedReminders = normalized.reminders.selected.filter((reminder) => {
      const playerId = textOrNull(reminder.parent ?? reminder.playerUUID);
      if (playerId && playerIds.has(playerId)) return true;
      diagnostics.push({ kind: 'reminder', recordId: reminder.UUID, reason: 'unknown-player', playerId });
      return false;
    });

    const timestamp = this.now().toISOString();
    const effectiveRunId = runId || `planning:${sourceFingerprint.slice(0, 24)}`;
    const statements = [];

    for (const project of selectedProjects) {
      statements.push({
        sql: `INSERT INTO projects(id,player_id,workspace_id,created_by_player_id,name,description,status,created_at,in_game_timestamp,updated_at,completed_at,archived_at,extra_json)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,workspace_id=excluded.workspace_id,
                created_by_player_id=COALESCE(projects.created_by_player_id,excluded.created_by_player_id),name=excluded.name,
                description=excluded.description,status=excluded.status,created_at=excluded.created_at,
                in_game_timestamp=excluded.in_game_timestamp,updated_at=excluded.updated_at,completed_at=excluded.completed_at,
                archived_at=excluded.archived_at,extra_json=excluded.extra_json`,
        bind: [
          String(project.UUID), String(project.parent ?? project.playerUUID),
          project.workspaceId || DEFAULT_WORKSPACE_ID,
          textOrNull(project.createdByPlayerId || project.parent || project.playerUUID),
          String(project.name || ''),
          textOrNull(project.description), textOrNull(project.status), textOrNull(project.createdAt),
          numberOrNull(project.inGameTimestamp, { min: 0, integer: true }) ?? 0,
          textOrNull(project.updatedAt), textOrNull(project.completedAt), textOrNull(project.archivedAt),
          stableJson(omitKeys(project, PROJECT_KEYS)),
        ], result: 'changes',
      });
    }

    for (const todo of selectedTodos) {
      const requestedProject = textOrNull(todo.projectId);
      const projectId = requestedProject && projectIds.has(requestedProject) ? requestedProject : null;
      if (requestedProject && !projectId) diagnostics.push({ kind: 'todo', recordId: todo.UUID, reason: 'unknown-project', projectId: requestedProject });
      statements.push({
        sql: `INSERT INTO todos(id,player_id,workspace_id,created_by_player_id,project_id,name,description,plan_notes,estimated_duration_minutes,due_at,aversion,created_at,in_game_timestamp,updated_at,extra_json,plan_eligible,task_revision_hash,blocker_type,clarification_failures)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,workspace_id=excluded.workspace_id,
                created_by_player_id=COALESCE(todos.created_by_player_id,excluded.created_by_player_id),project_id=excluded.project_id,
                name=excluded.name,description=excluded.description,plan_notes=excluded.plan_notes,
                estimated_duration_minutes=excluded.estimated_duration_minutes,due_at=excluded.due_at,
                aversion=excluded.aversion,created_at=excluded.created_at,in_game_timestamp=excluded.in_game_timestamp,updated_at=excluded.updated_at,
                extra_json=excluded.extra_json,plan_eligible=excluded.plan_eligible,task_revision_hash=excluded.task_revision_hash,
                blocker_type=excluded.blocker_type,clarification_failures=excluded.clarification_failures`,
        bind: [
          String(todo.UUID), String(todo.parent ?? todo.playerUUID), todo.workspaceId || DEFAULT_WORKSPACE_ID,
          textOrNull(todo.createdByPlayerId || todo.parent || todo.playerUUID), projectId, String(todo.name || ''),
          textOrNull(todo.description ?? todo.efficiency), textOrNull(todo.planNotes),
          numberOrNull(todo.estimatedDuration, { min: 0 }), textOrNull(todo.dueDate),
          numberOrNull(todo.aversion, { min: 0 }), textOrNull(todo.createdAt),
          numberOrNull(todo.inGameTimestamp, { min: 0, integer: true }) ?? 0, textOrNull(todo.updatedAt),
          stableJson(omitKeys(todo, TODO_KEYS)), todo.planEligible || /(^|\s)#plan(?=\s|$|[.,;:!?])/i.test(String(todo.description ?? todo.efficiency ?? '')) ? 1 : 0,
          textOrNull(todo.taskRevisionHash), textOrNull(todo.blockerType),
          Math.max(0, Math.trunc(Number(todo.clarificationFailures) || 0)),
        ], result: 'changes',
      });
    }

    for (const task of selectedTasks) {
      const requestedProject = textOrNull(task.projectId);
      const projectId = requestedProject && projectIds.has(requestedProject) ? requestedProject : null;
      if (requestedProject && !projectId) diagnostics.push({ kind: 'task', recordId: task.UUID, reason: 'unknown-project', projectId: requestedProject });
      const requestedTodo = textOrNull(task.todoUUID);
      const todoId = requestedTodo && todoIds.has(requestedTodo) ? requestedTodo : null;
      if (requestedTodo && !todoId) diagnostics.push({ kind: 'task', recordId: task.UUID, reason: 'unknown-todo', todoId: requestedTodo });
      statements.push({
        sql: `INSERT INTO tasks(
                id,player_id,workspace_id,project_id,todo_id,previous_task_id,name,description,plan_notes,reason_to_select,
                estimated_duration_minutes,actual_duration_ms,points,points_base,source,created_at,updated_at,completed_at,
                in_game_timestamp,completed_in_game_timestamp,extra_json
              ) VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,workspace_id=excluded.workspace_id,project_id=excluded.project_id,
                todo_id=excluded.todo_id,previous_task_id=NULL,name=excluded.name,description=excluded.description,
                plan_notes=excluded.plan_notes,reason_to_select=excluded.reason_to_select,
                estimated_duration_minutes=excluded.estimated_duration_minutes,actual_duration_ms=excluded.actual_duration_ms,
                points=excluded.points,points_base=excluded.points_base,source=excluded.source,created_at=excluded.created_at,updated_at=excluded.updated_at,
                completed_at=excluded.completed_at,in_game_timestamp=excluded.in_game_timestamp,
                completed_in_game_timestamp=excluded.completed_in_game_timestamp,extra_json=excluded.extra_json`,
        bind: [
          String(task.UUID), String(task.parent ?? task.playerUUID), task.workspaceId || DEFAULT_WORKSPACE_ID,
          projectId, todoId,
          String(task.name || ''), textOrNull(task.description), textOrNull(task.planNotes ?? task.efficiency),
          textOrNull(task.reasonToSelect), numberOrNull(task.estimatedDuration, { min: 0 }),
          numberOrNull(task.actualDurationMs ?? task.sessionDuration, { min: 0, integer: true }),
          Math.max(0, Number(task.points) || 0), Math.max(0, Number(task.pointsBase ?? task.points) || 0),
          textOrNull(task.source), textOrNull(task.createdAt),
          textOrNull(task.updatedAt), textOrNull(task.completedAt),
          numberOrNull(task.inGameTimestamp, { integer: true }),
          numberOrNull(task.completedInGameTimestamp, { integer: true }),
          stableJson(omitKeys(task, TASK_KEYS)),
        ], result: 'changes',
      });
    }
    for (const [taskId, previousTaskId] of [...previousLinks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!previousTaskId) continue;
      statements.push({
        sql: 'UPDATE tasks SET previous_task_id=? WHERE id=?',
        bind: [previousTaskId, taskId], result: 'changes',
      });
    }

    for (const reminder of selectedReminders) {
      statements.push({
        sql: `INSERT INTO reminders(id,player_id,workspace_id,created_by_player_id,title,body,remind_at,snoozed_until,completed_at,dismissed_at,created_at,in_game_timestamp,updated_at,extra_json)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,workspace_id=excluded.workspace_id,
                created_by_player_id=COALESCE(reminders.created_by_player_id,excluded.created_by_player_id),title=excluded.title,
                body=excluded.body,remind_at=excluded.remind_at,snoozed_until=excluded.snoozed_until,
                completed_at=excluded.completed_at,dismissed_at=excluded.dismissed_at,
                created_at=excluded.created_at,in_game_timestamp=excluded.in_game_timestamp,updated_at=excluded.updated_at,extra_json=excluded.extra_json`,
        bind: [
          String(reminder.UUID), String(reminder.parent ?? reminder.playerUUID), reminder.workspaceId || DEFAULT_WORKSPACE_ID,
          textOrNull(reminder.createdByPlayerId || reminder.parent || reminder.playerUUID), String(reminder.title || ''),
          textOrNull(reminder.body), textOrNull(reminder.remindAt), textOrNull(reminder.snoozedUntil),
          textOrNull(reminder.completedAt), textOrNull(reminder.dismissedAt),
          textOrNull(reminder.createdAt),
          numberOrNull(reminder.inGameTimestamp, { min: 0, integer: true }) ?? 0,
          textOrNull(reminder.updatedAt),
          stableJson(omitKeys(reminder, REMINDER_KEYS)),
        ], result: 'changes',
      });
    }

    const counts = {
      projects: selectedProjects.length,
      todos: selectedTodos.length,
      tasks: selectedTasks.length,
      reminders: selectedReminders.length,
      previousTaskLinks: [...previousLinks.values()].filter(Boolean).length,
      diagnostics: diagnostics.length,
    };
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId, domain: 'planning', sourceFingerprint,
      importerVersion: IMPORTER_VERSION, startedAt: timestamp, finishedAt: timestamp,
      counts, diagnostics,
    }));
    const result = await this.client.executeAtomic({
      commandId: `shadow-import:${effectiveRunId}`,
      label: 'shadow-import-planning',
      statements,
    });
    return { duplicate: result.duplicate, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default PlanningShadowImporter;
