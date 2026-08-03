function id(prefix = 'task-plan-receipt') {
  return globalThis.crypto?.randomUUID?.()
    ? `${prefix}:${globalThis.crypto.randomUUID()}`
    : `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function stableMeaningfulTask(task = {}) {
  return JSON.stringify({
    name: String(task.name || '').trim(),
    description: String(task.description ?? task.efficiency ?? '').trim(),
    projectId: task.projectId || null,
    dueDate: task.dueDate || null,
    estimatedDuration: Number(task.estimatedDuration) || 0,
    blockerType: task.blockerType || null,
    prerequisites: [...(task.prerequisites || [])].map(String).sort(),
    requiresIndivisibleBlock: task.requiresIndivisibleBlock === true,
  });
}

export function hashTaskRevision(task = {}) {
  const value = stableMeaningfulTask(task);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `task-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createTaskPlanReceipt({
  id: receiptId = id(),
  playerUUID,
  task,
  nextAction,
  intendedOpportunity = null,
  optionalSteps = [],
  estimatedRemainingMinutes = null,
  blockerType = null,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!playerUUID || !task?.UUID) throw new Error('A player and task are required.');
  const action = String(nextAction || '').trim();
  if (!action) throw new Error('A Plan Receipt requires a next visible action.');
  return Object.freeze({
    UUID: String(receiptId),
    id: String(receiptId),
    parent: String(playerUUID),
    playerUUID: String(playerUUID),
    taskUUID: String(task.UUID),
    taskRevisionHash: hashTaskRevision(task),
    createdAt,
    updatedAt: createdAt,
    nextAction: action.slice(0, 500),
    intendedOpportunity: intendedOpportunity?.triggerType
      ? {
          triggerType: intendedOpportunity.triggerType,
          triggerValue: String(intendedOpportunity.triggerValue || '').slice(0, 500) || undefined,
        }
      : null,
    optionalSteps: optionalSteps.map((step) => String(step).trim()).filter(Boolean).slice(0, 12),
    estimatedRemainingMinutes: Number.isFinite(Number(estimatedRemainingMinutes))
      ? Math.max(0, Math.round(Number(estimatedRemainingMinutes)))
      : null,
    blockerType: blockerType || null,
    status: 'active',
    invalidatedAt: null,
    consumedAt: null,
    failureCount: 0,
  });
}

export function isTaskPlanReceiptValid(receipt, task) {
  return Boolean(
    receipt?.status === 'active'
    && task?.UUID
    && String(receipt.taskUUID) === String(task.UUID)
    && receipt.taskRevisionHash === hashTaskRevision(task)
    && String(receipt.nextAction || '').trim(),
  );
}

export function invalidateTaskPlanReceipt(receipt, {
  reason = 'task-materially-changed',
  at = new Date().toISOString(),
} = {}) {
  return Object.freeze({
    ...receipt,
    status: 'invalidated',
    invalidationReason: reason,
    invalidatedAt: at,
    updatedAt: at,
  });
}

export function consumeTaskPlanReceipt(receipt, at = new Date().toISOString()) {
  return Object.freeze({
    ...receipt,
    status: 'consumed',
    consumedAt: at,
    updatedAt: at,
  });
}

export function failTaskPlanReceipt(receipt, task, at = new Date().toISOString()) {
  const failed = invalidateTaskPlanReceipt(receipt, {
    reason: 'next-action-not-executable',
    at,
  });
  return {
    receipt: Object.freeze({ ...failed, failureCount: Number(receipt?.failureCount || 0) + 1 }),
    task: Object.freeze({
      ...task,
      blockerType: task?.blockerType || 'unclear',
      status: 'blocked',
      clarificationFailures: Number(task?.clarificationFailures || 0) + 1,
      updatedAt: at,
    }),
  };
}
