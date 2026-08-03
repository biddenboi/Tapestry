import { isTaskPlanReceiptValid } from './TaskPlanReceipt.js';
import {
  taskPriorityClass,
  usefulTaskFitsWindow,
} from '../navigation/NextMovePolicyV1.js';

const EXTERNAL_BLOCKERS = new Set([
  'person',
  'information',
  'approval',
  'file',
  'location',
  'environment',
  'technical',
  'event',
]);

const AMBIGUITY_BLOCKERS = new Set([
  'unclear',
  'ambiguity',
  'missing-step',
  'changed-scope',
  'approach-choice',
]);

export function canonicalTaskDescription(task = {}) {
  return String(task.description ?? task.efficiency ?? '').trim();
}

export function descriptionHasPlanTag(description = '') {
  return /(^|\s)#plan(?=\s|$|[.,;:!?])/i.test(String(description));
}

export function normalizeTaskPlanningMetadata(task = {}) {
  const description = canonicalTaskDescription(task);
  return {
    ...task,
    description,
    planEligible: task.planEligible === true || descriptionHasPlanTag(description),
  };
}

export function taskIsAmbiguityBlocked(task = {}, receipt = null) {
  const normalized = normalizeTaskPlanningMetadata(task);
  if (isTaskPlanReceiptValid(receipt, normalized)) return false;
  if (Number(normalized.clarificationFailures || 0) > 0 && !normalized.materialChangeAfterClarification) {
    return false;
  }
  return Boolean(
    normalized.planEligible
    && (
      normalized.needsPlanning === true
      || !String(normalized.nextAction || '').trim()
      || AMBIGUITY_BLOCKERS.has(normalized.blockerType)
    ),
  );
}

export function taskHasExternalBlocker(task = {}) {
  return task.externallyBlocked === true
    || EXTERNAL_BLOCKERS.has(task.blockerType)
    || (task.status === 'blocked' && !AMBIGUITY_BLOCKERS.has(task.blockerType));
}

export function taskIsExecutableNow(task = {}, {
  receipt = null,
  availableWindowSeconds = Infinity,
  currentLocationContext = null,
  completedPrerequisiteIds = new Set(),
} = {}) {
  const normalized = normalizeTaskPlanningMetadata(task);
  if (!normalized.UUID || normalized.completedAt || normalized.deletedAt || normalized.archivedAt) return false;
  if (taskHasExternalBlocker(normalized)) return false;
  if ((normalized.prerequisites || []).some((id) => !completedPrerequisiteIds.has(String(id)))) return false;
  if (
    normalized.requiredLocation
    && currentLocationContext
    && String(normalized.requiredLocation) !== String(currentLocationContext)
  ) return false;
  if (!usefulTaskFitsWindow(normalized, availableWindowSeconds)) return false;
  if (normalized.planEligible) {
    return Boolean(
      String(normalized.nextAction || '').trim()
      || isTaskPlanReceiptValid(receipt, normalized),
    );
  }
  return true;
}

export function buildTaskClarificationCandidate(task = {}, receipt = null, now = new Date()) {
  if (!taskIsAmbiguityBlocked(task, receipt)) return null;
  const priorityClass = taskPriorityClass(task, now);
  return {
    UUID: task.UUID,
    entityUUID: task.UUID,
    entityType: 'task',
    title: priorityClass <= 1 ? 'Define the first visible action' : `Clarify ${task.name || 'this task'}`,
    context: priorityClass <= 1
      ? 'What can create visible progress in the next 10 minutes?'
      : 'One next visible action is enough to make this executable.',
    routeLabel: `Tasks → ${task.name || 'Untitled task'} → next action`,
    priorityClass,
    canImmediatelyUnlock: true,
    failedSinceLastMaterialChange: Number(task.clarificationFailures || 0) > 0
      && !task.materialChangeAfterClarification,
    sourceEntityRefs: [{ type: 'task', UUID: task.UUID }],
    invalidationKeys: [`task:${task.UUID}:${task.taskRevisionHash || task.updatedAt || 'current'}`],
  };
}
