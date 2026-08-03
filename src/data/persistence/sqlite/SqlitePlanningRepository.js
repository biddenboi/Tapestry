import {
  numberOrNull,
  omitKeys,
  parseJson,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';
import { DEFAULT_WORKSPACE_ID } from '../../../domain/planning/WorkspacePlanningScope.js';

const PROJECT_KEYS = ['UUID','parent','workspaceId','createdByPlayerId','name','description','status','createdAt','inGameTimestamp','updatedAt','completedAt','archivedAt'];
const TODO_KEYS = [
  'UUID','parent','workspaceId','createdByPlayerId','projectId','name','description','efficiency','planNotes','estimatedDuration',
  'dueDate','aversion','planEligible','taskRevisionHash','blockerType','clarificationFailures',
  'createdAt','inGameTimestamp','updatedAt',
];
const TASK_KEYS = [
  'UUID','parent','workspaceId','projectId','todoUUID','previousTaskId','lastCompletedTaskUUID','name','description','efficiency','planNotes','reasonToSelect',
  'estimatedDuration','sessionDuration','actualDurationMs','points','pointsBase','source','createdAt','updatedAt','completedAt','inGameTimestamp','completedInGameTimestamp',
];
const REMINDER_KEYS = ['UUID','parent','workspaceId','createdByPlayerId','title','body','remindAt','snoozedUntil','completedAt','dismissedAt','createdAt','inGameTimestamp','updatedAt'];

function projectFromRow(row) {
  return row ? {
    ...parseJson(row.extraJson, {}), UUID: row.id, parent: row.playerId,
    workspaceId: row.workspaceId || DEFAULT_WORKSPACE_ID,
    createdByPlayerId: row.createdByPlayerId || row.playerId, name: row.name,
    description: row.description, status: row.status, createdAt: row.createdAt,
    inGameTimestamp: Number(row.inGameTimestamp || 0),
    updatedAt: row.updatedAt, completedAt: row.completedAt, archivedAt: row.archivedAt,
  } : null;
}
function todoFromRow(row) {
  return row ? {
    ...parseJson(row.extraJson, {}), UUID: row.id, parent: row.playerId,
    workspaceId: row.workspaceId || DEFAULT_WORKSPACE_ID,
    createdByPlayerId: row.createdByPlayerId || row.playerId, projectId: row.projectId,
    name: row.name, description: row.description, efficiency: row.description,
    planNotes: row.planNotes, planEligible: Number(row.planEligible || 0) === 1,
    taskRevisionHash: row.taskRevisionHash, blockerType: row.blockerType,
    clarificationFailures: Number(row.clarificationFailures || 0),
    estimatedDuration: row.estimatedDuration == null ? null : Number(row.estimatedDuration),
    dueDate: row.dueAt, aversion: row.aversion == null ? null : Number(row.aversion),
    createdAt: row.createdAt, inGameTimestamp: Number(row.inGameTimestamp || 0), updatedAt: row.updatedAt,
  } : null;
}
function taskFromRow(row) {
  return row ? {
    ...parseJson(row.extraJson, {}), UUID: row.id, parent: row.playerId,
    workspaceId: row.workspaceId || DEFAULT_WORKSPACE_ID, projectId: row.projectId,
    todoUUID: row.todoId, previousTaskId: row.previousTaskId,
    name: row.name, description: row.description, efficiency: row.planNotes,
    reasonToSelect: row.reasonToSelect,
    estimatedDuration: row.estimatedDuration == null ? null : Number(row.estimatedDuration),
    sessionDuration: row.actualDurationMs == null ? null : Number(row.actualDurationMs),
    points: Number(row.points), pointsBase: Number(row.pointsBase), source: row.source, createdAt: row.createdAt,
    updatedAt: row.updatedAt, completedAt: row.completedAt,
    inGameTimestamp: row.inGameTimestamp == null ? null : Number(row.inGameTimestamp),
    completedInGameTimestamp: row.completedInGameTimestamp == null ? null : Number(row.completedInGameTimestamp),
  } : null;
}
function reminderFromRow(row) {
  return row ? {
    ...parseJson(row.extraJson, {}), UUID: row.id, parent: row.playerId,
    workspaceId: row.workspaceId || DEFAULT_WORKSPACE_ID,
    createdByPlayerId: row.createdByPlayerId || row.playerId, title: row.title,
    body: row.body, remindAt: row.remindAt, snoozedUntil: row.snoozedUntil,
    completedAt: row.completedAt, dismissedAt: row.dismissedAt,
    createdAt: row.createdAt, inGameTimestamp: Number(row.inGameTimestamp || 0), updatedAt: row.updatedAt,
  } : null;
}

const PROJECT_SELECT = `SELECT id,player_id AS playerId,workspace_id AS workspaceId,
  created_by_player_id AS createdByPlayerId,name,description,status,created_at AS createdAt,
  in_game_timestamp AS inGameTimestamp,updated_at AS updatedAt,completed_at AS completedAt,
  archived_at AS archivedAt,extra_json AS extraJson FROM projects`;
const TODO_SELECT = `SELECT id,player_id AS playerId,workspace_id AS workspaceId,
  created_by_player_id AS createdByPlayerId,project_id AS projectId,name,description,plan_notes AS planNotes,
  plan_eligible AS planEligible,task_revision_hash AS taskRevisionHash,blocker_type AS blockerType,
  clarification_failures AS clarificationFailures,
  estimated_duration_minutes AS estimatedDuration,due_at AS dueAt,aversion,created_at AS createdAt,
  in_game_timestamp AS inGameTimestamp,updated_at AS updatedAt,extra_json AS extraJson FROM todos`;
const TASK_SELECT = `SELECT id,player_id AS playerId,workspace_id AS workspaceId,project_id AS projectId,todo_id AS todoId,
  previous_task_id AS previousTaskId,name,description,plan_notes AS planNotes,reason_to_select AS reasonToSelect,
  estimated_duration_minutes AS estimatedDuration,actual_duration_ms AS actualDurationMs,
  points,points_base AS pointsBase,source,
  created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt,
  in_game_timestamp AS inGameTimestamp,completed_in_game_timestamp AS completedInGameTimestamp,
  extra_json AS extraJson FROM tasks`;
const REMINDER_SELECT = `SELECT id,player_id AS playerId,workspace_id AS workspaceId,
  created_by_player_id AS createdByPlayerId,title,body,remind_at AS remindAt,snoozed_until AS snoozedUntil,
  completed_at AS completedAt,dismissed_at AS dismissedAt,created_at AS createdAt,updated_at AS updatedAt,
  in_game_timestamp AS inGameTimestamp,extra_json AS extraJson FROM reminders`;

export class SqlitePlanningRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqlitePlanningRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async listProjects(playerId) {
    return (await this.client.query({
      sql: `${PROJECT_SELECT}${playerId ? ' WHERE player_id=?' : ''} ORDER BY created_at DESC,id`,
      bind: playerId ? [playerId] : [], result: 'all',
    })).map(projectFromRow);
  }

  async listTodos(playerId) {
    return (await this.client.query({
      sql: `${TODO_SELECT}${playerId ? ' WHERE player_id=?' : ''}
            ORDER BY due_at IS NULL, due_at, created_at, id`,
      bind: playerId ? [playerId] : [], result: 'all',
    })).map(todoFromRow);
  }

  async listWorkspaceTodos(workspaceId = DEFAULT_WORKSPACE_ID) {
    return (await this.client.query({
      sql: `${TODO_SELECT} WHERE workspace_id=?
            ORDER BY due_at IS NULL, due_at, created_at, id`,
      bind: [workspaceId], result: 'all',
    })).map(todoFromRow);
  }

  async listTasks(playerId, { direction = 'desc' } = {}) {
    const order = direction === 'asc' ? 'ASC' : 'DESC';
    return (await this.client.query({
      sql: `${TASK_SELECT}${playerId ? ' WHERE player_id=?' : ''}
            ORDER BY completed_at ${order}, created_at ${order}, id ${order}`,
      bind: playerId ? [playerId] : [], result: 'all',
    })).map(taskFromRow);
  }

  async getTasksThroughIGT(playerId, viewerIGT = Infinity) {
    if (!Number.isFinite(Number(viewerIGT))) return this.listTasks(playerId);
    return (await this.client.query({
      sql: `${TASK_SELECT}
            WHERE player_id=? AND COALESCE(NULLIF(completed_in_game_timestamp,0),in_game_timestamp,completed_in_game_timestamp,0)<=?
            ORDER BY COALESCE(NULLIF(completed_in_game_timestamp,0),in_game_timestamp,completed_in_game_timestamp,0), id`,
      bind: [playerId, Math.max(0, Math.trunc(Number(viewerIGT)))], result: 'all',
    })).map(taskFromRow);
  }

  async getTask(taskId) {
    return taskFromRow(await this.client.query({ sql: `${TASK_SELECT} WHERE id=?`, bind: [taskId], result: 'one' }));
  }

  _projectUpsertStatement(project) {
    return {
      sql: `INSERT INTO projects(id,player_id,workspace_id,created_by_player_id,name,description,status,created_at,in_game_timestamp,updated_at,completed_at,archived_at,extra_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            player_id=excluded.player_id,workspace_id=excluded.workspace_id,
            created_by_player_id=COALESCE(projects.created_by_player_id,excluded.created_by_player_id),
            name=excluded.name,description=excluded.description,status=excluded.status,
            created_at=excluded.created_at,in_game_timestamp=excluded.in_game_timestamp,updated_at=excluded.updated_at,completed_at=excluded.completed_at,
            archived_at=excluded.archived_at,extra_json=excluded.extra_json`,
      bind: [project.UUID, project.parent, project.workspaceId || DEFAULT_WORKSPACE_ID,
        textOrNull(project.createdByPlayerId || project.parent), String(project.name || ''),
        textOrNull(project.description), textOrNull(project.status),
        textOrNull(project.createdAt), numberOrNull(project.inGameTimestamp, { min: 0, integer: true }) ?? 0,
        textOrNull(project.updatedAt), textOrNull(project.completedAt),
        textOrNull(project.archivedAt), stableJson(omitKeys(project, PROJECT_KEYS))],
      result: 'changes',
    };
  }

  _todoUpsertStatement(todo) {
    return {
      sql: `INSERT INTO todos(id,player_id,workspace_id,created_by_player_id,project_id,name,description,plan_notes,estimated_duration_minutes,due_at,aversion,created_at,in_game_timestamp,updated_at,extra_json,plan_eligible,task_revision_hash,blocker_type,clarification_failures)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            player_id=excluded.player_id,workspace_id=excluded.workspace_id,
            created_by_player_id=COALESCE(todos.created_by_player_id,excluded.created_by_player_id),
            project_id=excluded.project_id,name=excluded.name,description=excluded.description,
            plan_notes=excluded.plan_notes,estimated_duration_minutes=excluded.estimated_duration_minutes,due_at=excluded.due_at,
            aversion=excluded.aversion,created_at=excluded.created_at,in_game_timestamp=excluded.in_game_timestamp,updated_at=excluded.updated_at,
            extra_json=excluded.extra_json,plan_eligible=excluded.plan_eligible,task_revision_hash=excluded.task_revision_hash,
            blocker_type=excluded.blocker_type,clarification_failures=excluded.clarification_failures`,
      bind: [todo.UUID, todo.parent, todo.workspaceId || DEFAULT_WORKSPACE_ID,
        textOrNull(todo.createdByPlayerId || todo.parent), textOrNull(todo.projectId),
        String(todo.name || ''), textOrNull(todo.description),
        textOrNull(todo.planNotes), numberOrNull(todo.estimatedDuration, { min: 0 }), textOrNull(todo.dueDate),
        numberOrNull(todo.aversion, { min: 0 }), textOrNull(todo.createdAt),
        numberOrNull(todo.inGameTimestamp, { min: 0, integer: true }) ?? 0, textOrNull(todo.updatedAt),
        stableJson(omitKeys(todo, TODO_KEYS)), todo.planEligible ? 1 : 0, textOrNull(todo.taskRevisionHash),
        textOrNull(todo.blockerType), Math.max(0, Math.trunc(Number(todo.clarificationFailures) || 0))], result: 'changes',
    };
  }

  _taskUpsertStatements(task) {
    const previousTaskId = textOrNull(task.previousTaskId ?? task.lastCompletedTaskUUID ?? task.lastCompletedTask?.UUID);
    return [{
      sql: `INSERT INTO tasks(id,player_id,workspace_id,project_id,todo_id,previous_task_id,name,description,plan_notes,reason_to_select,
              estimated_duration_minutes,actual_duration_ms,points,points_base,source,created_at,updated_at,completed_at,
              in_game_timestamp,completed_in_game_timestamp,extra_json)
            VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,workspace_id=excluded.workspace_id,
              project_id=excluded.project_id,todo_id=excluded.todo_id,
              previous_task_id=NULL,name=excluded.name,description=excluded.description,plan_notes=excluded.plan_notes,
              reason_to_select=excluded.reason_to_select,estimated_duration_minutes=excluded.estimated_duration_minutes,
              actual_duration_ms=excluded.actual_duration_ms,points=excluded.points,points_base=excluded.points_base,source=excluded.source,
              created_at=excluded.created_at,updated_at=excluded.updated_at,completed_at=excluded.completed_at,
              in_game_timestamp=excluded.in_game_timestamp,completed_in_game_timestamp=excluded.completed_in_game_timestamp,
              extra_json=excluded.extra_json`,
      bind: [task.UUID, task.parent, task.workspaceId || DEFAULT_WORKSPACE_ID,
        textOrNull(task.projectId), textOrNull(task.todoUUID), String(task.name || ''),
        textOrNull(task.description), textOrNull(task.planNotes ?? task.efficiency), textOrNull(task.reasonToSelect),
        numberOrNull(task.estimatedDuration, { min: 0 }), numberOrNull(task.actualDurationMs ?? task.sessionDuration, { min: 0, integer: true }),
        Math.max(0, Number(task.points) || 0), Math.max(0, Number(task.pointsBase ?? task.points) || 0),
        textOrNull(task.source), textOrNull(task.createdAt), textOrNull(task.updatedAt),
        textOrNull(task.completedAt), numberOrNull(task.inGameTimestamp, { integer: true }),
        numberOrNull(task.completedInGameTimestamp, { integer: true }), stableJson(omitKeys(task, TASK_KEYS))],
      result: 'changes',
    }, ...(previousTaskId ? [{
      sql: `UPDATE tasks SET previous_task_id=?
            WHERE id=? AND ?<>id AND EXISTS(SELECT 1 FROM tasks previous WHERE previous.id=?)`,
      bind: [previousTaskId, task.UUID, previousTaskId, previousTaskId], result: 'changes',
    }] : [])];
  }

  async upsertProject(project, { operationId } = {}) {
    if (!operationId) throw new Error('Project writes require an operation ID.');
    const result = await this.client.executeAtomic({ commandId: `project:${operationId}`, label: 'project-upsert-shadow', statements: [this._projectUpsertStatement(project)] });
    return { duplicate: result.duplicate, project: projectFromRow(await this.client.query({ sql: `${PROJECT_SELECT} WHERE id=?`, bind: [project.UUID], result: 'one' })) };
  }

  async upsertTodo(todo, { operationId } = {}) {
    if (!operationId) throw new Error('Todo writes require an operation ID.');
    const result = await this.client.executeAtomic({ commandId: `todo:${operationId}`, label: 'todo-upsert-shadow', statements: [this._todoUpsertStatement(todo)] });
    return { duplicate: result.duplicate, todo: todoFromRow(await this.client.query({ sql: `${TODO_SELECT} WHERE id=?`, bind: [todo.UUID], result: 'one' })) };
  }

  async upsertTask(task, { operationId } = {}) {
    if (!operationId) throw new Error('Task writes require an operation ID.');
    const result = await this.client.executeAtomic({ commandId: `task:${operationId}`, label: 'task-upsert-shadow', statements: this._taskUpsertStatements(task) });
    return { duplicate: result.duplicate, task: await this.getTask(task.UUID) };
  }

  async commitPlanningCompletion({ task, sourceTodoId = null, operationId } = {}) {
    if (!task?.UUID || !operationId) throw new Error('Planning completion requires a task and operation ID.');
    const statements = this._taskUpsertStatements(task);
    if (sourceTodoId) statements.push({ sql: 'DELETE FROM todos WHERE id=?', bind: [sourceTodoId], result: 'changes' });
    const result = await this.client.executeAtomic({
      commandId: `planning-completion:${operationId}`,
      label: 'planning-completion-shadow', statements,
    });
    return { duplicate: result.duplicate, task: await this.getTask(task.UUID), removedTodoId: sourceTodoId };
  }

  async listReminders(playerId) {
    return (await this.client.query({
      sql: `${REMINDER_SELECT} WHERE player_id=?
            ORDER BY COALESCE(snoozed_until,remind_at,'9999-12-31T23:59:59.999Z'),created_at,id`,
      bind: [playerId], result: 'all',
    })).map(reminderFromRow);
  }

  async listWorkspaceReminders(workspaceId = DEFAULT_WORKSPACE_ID) {
    return (await this.client.query({
      sql: `${REMINDER_SELECT} WHERE workspace_id=?
            ORDER BY COALESCE(snoozed_until,remind_at,'9999-12-31T23:59:59.999Z'),created_at,id`,
      bind: [workspaceId], result: 'all',
    })).map(reminderFromRow);
  }

  async getUpcomingReminders(playerId, { limit = 4 } = {}) {
    return (await this.client.query({
      sql: `${REMINDER_SELECT} WHERE player_id=? AND completed_at IS NULL AND dismissed_at IS NULL
            ORDER BY COALESCE(snoozed_until,remind_at,'9999-12-31T23:59:59.999Z'),created_at,id LIMIT ?`,
      bind: [playerId, Math.max(1, Math.min(100, Number(limit) || 4))], result: 'all',
    })).map(reminderFromRow);
  }

  async getDueReminders(playerId, now = this.now()) {
    const boundary = new Date(now).toISOString();
    return (await this.client.query({
      sql: `${REMINDER_SELECT} WHERE player_id=? AND completed_at IS NULL AND dismissed_at IS NULL
            AND COALESCE(snoozed_until,remind_at)>'' AND COALESCE(snoozed_until,remind_at)<=?
            ORDER BY COALESCE(snoozed_until,remind_at),created_at,id`,
      bind: [playerId, boundary], result: 'all',
    })).map(reminderFromRow);
  }

  async upsertReminder(reminder, { operationId } = {}) {
    if (!operationId) throw new Error('Reminder writes require an operation ID.');
    const statement = {
      sql: `INSERT INTO reminders(id,player_id,workspace_id,created_by_player_id,title,body,remind_at,snoozed_until,completed_at,dismissed_at,created_at,in_game_timestamp,updated_at,extra_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET player_id=excluded.player_id,
            workspace_id=excluded.workspace_id,
            created_by_player_id=COALESCE(reminders.created_by_player_id,excluded.created_by_player_id),title=excluded.title,
            body=excluded.body,remind_at=excluded.remind_at,snoozed_until=excluded.snoozed_until,
            completed_at=excluded.completed_at,dismissed_at=excluded.dismissed_at,created_at=excluded.created_at,
            in_game_timestamp=excluded.in_game_timestamp,
            updated_at=excluded.updated_at,extra_json=excluded.extra_json`,
      bind: [reminder.UUID, reminder.parent, reminder.workspaceId || DEFAULT_WORKSPACE_ID,
        textOrNull(reminder.createdByPlayerId || reminder.parent), String(reminder.title || ''),
        textOrNull(reminder.body), textOrNull(reminder.remindAt),
        textOrNull(reminder.snoozedUntil), textOrNull(reminder.completedAt), textOrNull(reminder.dismissedAt),
        textOrNull(reminder.createdAt), numberOrNull(reminder.inGameTimestamp, { min: 0, integer: true }) ?? 0,
        textOrNull(reminder.updatedAt), stableJson(omitKeys(reminder, REMINDER_KEYS))],
      result: 'changes',
    };
    const result = await this.client.executeAtomic({ commandId: `reminder:${operationId}`, label: 'reminder-upsert-shadow', statements: [statement] });
    const row = await this.client.query({ sql: `${REMINDER_SELECT} WHERE id=?`, bind: [reminder.UUID], result: 'one' });
    return { duplicate: result.duplicate, reminder: reminderFromRow(row) };
  }

  async patchReminder(reminderId, patch, { operationId } = {}) {
    if (!operationId) throw new Error('Reminder patches require an operation ID.');
    const current = reminderFromRow(await this.client.query({ sql: `${REMINDER_SELECT} WHERE id=?`, bind: [reminderId], result: 'one' }));
    if (!current) return null;
    return this.upsertReminder({ ...current, ...patch, updatedAt: this.now().toISOString() }, { operationId });
  }

  completeReminder(reminderId, { operationId } = {}) {
    return this.patchReminder(reminderId, { completedAt: this.now().toISOString(), dismissedAt: null, snoozedUntil: null }, { operationId });
  }
  dismissReminder(reminderId, { operationId } = {}) {
    return this.patchReminder(reminderId, { dismissedAt: this.now().toISOString() }, { operationId });
  }
  snoozeReminder(reminderId, minutes = 10, { operationId } = {}) {
    const duration = Math.max(1, Number(minutes) || 10) * 60_000;
    return this.patchReminder(reminderId, { snoozedUntil: new Date(this.now().getTime() + duration).toISOString(), dismissedAt: null }, { operationId });
  }

  async explainTaskTimeline(playerId) {
    return this.client.query({
      sql: `EXPLAIN QUERY PLAN SELECT id FROM tasks
            WHERE player_id=? AND completed_in_game_timestamp<=?
            ORDER BY completed_in_game_timestamp,id`,
      bind: [playerId, Number.MAX_SAFE_INTEGER], result: 'all',
    });
  }
}

export default SqlitePlanningRepository;
