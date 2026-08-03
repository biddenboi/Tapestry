import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';
import { normalizeTaskPlanningMetadata } from '@domain/planning/TaskPlanningEligibility.js';
import { hashTaskRevision } from '@domain/planning/TaskPlanReceipt.js';
import { coerceAversion, getDaysUntilDue } from '@domain/tasks/Tasks.js';
import { ruleWithAnchor } from '@domain/tasks/TaskRecurrence.js';
import { saveTaskCommand } from '@domain/tasks/TaskCommands.js';

export function buildTaskDraftRecord(taskDraft = {}, fields = {}, player = null, {
  now = new Date(),
} = {}) {
  const dueDate = fields.dueDate || taskDraft.dueDate || null;
  const description = String(fields.description ?? taskDraft.description ?? taskDraft.efficiency ?? '');
  const normalizedPlanning = normalizeTaskPlanningMetadata({
    ...taskDraft,
    ...fields,
    description,
  });
  const task = {
    ...taskDraft,
    ...normalizedPlanning,
    UUID: taskDraft.UUID || fields.UUID || uuid(),
    parent: taskDraft.parent || fields.parent || player?.UUID || null,
    name: String(fields.name ?? taskDraft.name ?? '').trim(),
    estimatedDuration: Math.max(1, Number(fields.estimatedDuration ?? taskDraft.estimatedDuration ?? 30) || 30),
    dueDate,
    createdAt: taskDraft.todoCreatedAt || taskDraft.createdAt || now.toISOString(),
    inGameTimestamp: taskDraft.inGameTimestamp ?? getCurrentIGT(player),
    aversion: coerceAversion(fields.aversion ?? taskDraft.aversion),
    projectId: fields.projectId ?? taskDraft.projectId ?? null,
    recurrence: ruleWithAnchor(
      fields.recurrence ?? taskDraft.recurrence ?? taskDraft.repeatRule ?? null,
      dueDate,
    ),
    description,
    efficiency: description,
    needsPlanning: Boolean(fields.needsPlanning ?? taskDraft.needsPlanning),
  };
  task.taskRevisionHash = hashTaskRevision(task);
  delete task.todoCreatedAt;
  delete task.originalDuration;
  return task;
}

export async function saveTaskDraftCommand(databaseConnection, {
  taskDraft = {},
  fields = {},
  player: providedPlayer = null,
} = {}, {
  origin = 'desktop',
  at = new Date(),
} = {}) {
  const player = providedPlayer?.UUID ? providedPlayer : await databaseConnection.getCurrentPlayer();
  if (!player?.UUID) throw new Error('Select or create a profile before saving a task.');
  const task = buildTaskDraftRecord(taskDraft, fields, player, { now: at });
  if (!task.name) throw new Error('Add a task title before saving.');
  if (!task.dueDate || !Number.isFinite(new Date(task.dueDate).getTime())) throw new Error('Choose a valid task date.');

  if (taskDraft.originalDuration !== undefined) {
    const durationDiff = task.estimatedDuration - Number(taskDraft.originalDuration || 0);
    const daysUntil = getDaysUntilDue(task);
    const delta = daysUntil > 0 ? durationDiff / daysUntil : 0;
    if (delta !== 0) {
      await databaseConnection.add(STORES.player, {
        ...player,
        minutesClearedToday: (player.minutesClearedToday || 0) - delta,
      });
    }
  }

  const goalRepository = databaseConnection.getRepository?.('goals');
  if (goalRepository?.saveTodoGoalAssociation) {
    await goalRepository.saveTodoGoalAssociation(task, player, { origin });
  } else {
    await saveTaskCommand(databaseConnection, task, { origin, at });
  }
  return Object.freeze({ task, player });
}

export default saveTaskDraftCommand;
