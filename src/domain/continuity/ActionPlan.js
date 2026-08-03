import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';

export const ACTION_PLAN_STATUS = Object.freeze({
  active: 'active',
  consumed: 'consumed',
  dismissed: 'dismissed',
  expired: 'expired',
  superseded: 'superseded',
});

export const ACTION_PLAN_TRIGGER = Object.freeze({
  time: 'time',
  window: 'window',
  appOpen: 'app-open',
  eventEnd: 'event-end',
  location: 'location',
  manual: 'manual',
});

function isoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createActionPlan({
  playerUUID,
  targetType = 'todo',
  targetUUID,
  triggerType = ACTION_PLAN_TRIGGER.time,
  triggerValue = {},
  plannedWindowStart = null,
  plannedWindowEnd = null,
  createdAt = new Date().toISOString(),
  UUID = uuid(),
} = {}) {
  if (!playerUUID || !targetUUID) {
    throw new TypeError('An Action Plan requires a player and target.');
  }
  if (!Object.values(ACTION_PLAN_TRIGGER).includes(triggerType)) {
    throw new TypeError(`Unsupported Action Plan trigger: ${triggerType}`);
  }
  const start = isoOrNull(plannedWindowStart);
  const end = isoOrNull(plannedWindowEnd);
  if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
    throw new RangeError('An Action Plan window cannot end before it starts.');
  }
  return Object.freeze({
    UUID,
    parent: String(playerUUID),
    targetType,
    targetUUID: String(targetUUID),
    triggerType,
    triggerValue: triggerValue && typeof triggerValue === 'object' ? { ...triggerValue } : {},
    plannedWindowStart: start,
    plannedWindowEnd: end,
    status: ACTION_PLAN_STATUS.active,
    createdAt,
    updatedAt: createdAt,
    resolvedAt: null,
  });
}

export async function saveActionPlan(databaseConnection, input) {
  const plan = createActionPlan(input);
  const existing = await databaseConnection.getPlayerStore(STORES.actionPlan, plan.parent);
  const superseded = existing
    .filter((row) => (
      row.status === ACTION_PLAN_STATUS.active
      && String(row.targetUUID) === String(plan.targetUUID)
      && row.UUID !== plan.UUID
    ))
    .map((row) => ({
      store: STORES.actionPlan,
      record: {
        ...row,
        status: ACTION_PLAN_STATUS.superseded,
        resolvedAt: plan.createdAt,
        updatedAt: plan.createdAt,
      },
    }));
  await databaseConnection.commitAtomicMutation({
    label: 'continuity-action-plan-save',
    puts: [...superseded, { store: STORES.actionPlan, record: plan }],
  });
  return plan;
}

export async function consumeActionPlan(
  databaseConnection,
  actionPlanUUID,
  at = new Date().toISOString(),
) {
  if (!actionPlanUUID) return null;
  const current = await databaseConnection.get(STORES.actionPlan, actionPlanUUID);
  if (!current || current.status !== ACTION_PLAN_STATUS.active) return current;
  const consumed = {
    ...current,
    status: ACTION_PLAN_STATUS.consumed,
    resolvedAt: at,
    updatedAt: at,
  };
  await databaseConnection.add(STORES.actionPlan, consumed);
  return consumed;
}
