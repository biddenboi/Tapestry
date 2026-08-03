import { STORES } from '@domain/constants.js';
import {
  invalidateTaskRecommenderV12Budget,
  normalizeTaskRecommenderV12BudgetState,
  reserveTaskRecommenderV12Budget,
  resolveTaskRecommenderV12Budget,
  taskRecommenderV12PolicyDecisionPayload,
} from './TaskRecommenderV12Policy.js';

export const TASK_RECOMMENDER_V12_POLICY_STATE_PREFIX = 'task-recommender-v12-policy-state';
export const TASK_RECOMMENDER_V12_POLICY_STATE_SCHEMA_VERSION = 4;

const policyStateQueues = new WeakMap();

export function taskRecommenderV12PolicyStateId(playerUUID) {
  if (!playerUUID) throw new TypeError('A v12 policy state requires playerUUID');
  return `${TASK_RECOMMENDER_V12_POLICY_STATE_PREFIX}:${playerUUID}`;
}

function normalizeReceipt(receipt = {}) {
  if (!receipt.decisionUUID || !receipt.policyDecision) return null;
  try {
    return Object.freeze({
      decisionUUID: String(receipt.decisionUUID),
      status: ['resolved', 'invalidated'].includes(receipt.status)
        ? receipt.status
        : 'pending',
      policyDecision: Object.freeze(taskRecommenderV12PolicyDecisionPayload(receipt.policyDecision)),
      reservedAt: receipt.reservedAt ? new Date(receipt.reservedAt).toISOString() : null,
      resolvedAt: receipt.resolvedAt ? new Date(receipt.resolvedAt).toISOString() : null,
      invalidatedAt: receipt.invalidatedAt
        ? new Date(receipt.invalidatedAt).toISOString()
        : null,
      observedImmediateWorkSeconds: receipt.status === 'resolved'
        ? Math.max(0, Number(
          receipt.observedImmediateWorkSeconds ?? receipt.productiveSeconds,
        ) || 0)
        : null,
      valueHorizon: receipt.policyDecision?.safety?.valueHorizon || null,
    });
  } catch {
    return null;
  }
}

export function normalizeTaskRecommenderV12PolicyState(value = {}) {
  const receipts = Array.isArray(value.decisionReceipts)
    ? value.decisionReceipts.map(normalizeReceipt).filter(Boolean).slice(-128)
    : [];
  return Object.freeze({
    policyStateSchemaVersion: TASK_RECOMMENDER_V12_POLICY_STATE_SCHEMA_VERSION,
    budget: normalizeTaskRecommenderV12BudgetState(value.budget),
    decisionReceipts: Object.freeze(receipts),
  });
}

export async function getTaskRecommenderV12PolicyState(databaseConnection, playerUUID) {
  const record = await databaseConnection.get(
    STORES.appSetting,
    taskRecommenderV12PolicyStateId(playerUUID),
  );
  if (!record?.value) {
    return { state: normalizeTaskRecommenderV12PolicyState(), recoveredFromInvalidState: false };
  }
  try {
    const schemaVersion = Number(record.value.policyStateSchemaVersion);
    if (schemaVersion !== TASK_RECOMMENDER_V12_POLICY_STATE_SCHEMA_VERSION) {
      throw new RangeError('Unsupported v12 policy state');
    }
    return {
      state: normalizeTaskRecommenderV12PolicyState(record.value),
      recoveredFromInvalidState: false,
    };
  } catch {
    return { state: normalizeTaskRecommenderV12PolicyState(), recoveredFromInvalidState: true };
  }
}

export function invalidateTaskRecommenderV12PolicyDecision(
  databaseConnection,
  playerUUID,
  decisionUUID,
) {
  return serializePolicyStateUpdate(databaseConnection, playerUUID, (state) => ({
    ...state,
    budget: invalidateTaskRecommenderV12Budget(state.budget, decisionUUID),
    decisionReceipts: state.decisionReceipts.map((receipt) => (
      receipt.decisionUUID === String(decisionUUID) && receipt.status === 'pending'
        ? {
          ...receipt,
          status: 'invalidated',
          invalidatedAt: new Date().toISOString(),
        }
        : receipt
    )),
  }));
}

export async function saveTaskRecommenderV12PolicyState(
  databaseConnection,
  playerUUID,
  value,
) {
  const state = normalizeTaskRecommenderV12PolicyState(value);
  const updatedAt = new Date().toISOString();
  await databaseConnection.add(STORES.appSetting, {
    UUID: taskRecommenderV12PolicyStateId(playerUUID),
    parent: String(playerUUID),
    value: JSON.parse(JSON.stringify(state)),
    updatedAt,
  });
  return state;
}

function serializePolicyStateUpdate(databaseConnection, playerUUID, update) {
  let byPlayer = policyStateQueues.get(databaseConnection);
  if (!byPlayer) {
    byPlayer = new Map();
    policyStateQueues.set(databaseConnection, byPlayer);
  }
  const key = String(playerUUID);
  const previous = byPlayer.get(key) || Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const { state } = await getTaskRecommenderV12PolicyState(databaseConnection, key);
    return saveTaskRecommenderV12PolicyState(databaseConnection, key, update(state));
  });
  let tracked;
  tracked = run.finally(() => {
    if (byPlayer.get(key) === tracked) byPlayer.delete(key);
  });
  byPlayer.set(key, tracked);
  return tracked;
}

export function reserveTaskRecommenderV12PolicyDecision(
  databaseConnection,
  playerUUID,
  decisionUUID,
  policyDecision,
) {
  const payload = taskRecommenderV12PolicyDecisionPayload(policyDecision);
  return serializePolicyStateUpdate(databaseConnection, playerUUID, (state) => {
    if (state.decisionReceipts.some((receipt) => receipt.decisionUUID === String(decisionUUID))) {
      return state;
    }
    return {
      ...state,
      budget: reserveTaskRecommenderV12Budget(state.budget, decisionUUID, payload),
      decisionReceipts: [...state.decisionReceipts, {
        decisionUUID: String(decisionUUID),
        status: 'pending',
        policyDecision: payload,
        reservedAt: new Date().toISOString(),
      }],
    };
  });
}

export function resolveTaskRecommenderV12PolicyDecision(
  databaseConnection,
  playerUUID,
  decisionUUID,
  productiveSeconds = 0,
) {
  return serializePolicyStateUpdate(databaseConnection, playerUUID, (state) => ({
    ...state,
    budget: resolveTaskRecommenderV12Budget(state.budget, decisionUUID, productiveSeconds),
    decisionReceipts: state.decisionReceipts.map((receipt) => (
      receipt.decisionUUID === String(decisionUUID) && receipt.status !== 'resolved'
        ? {
          ...receipt,
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
          observedImmediateWorkSeconds: Math.max(0, Number(productiveSeconds) || 0),
          valueHorizon: 'current-session-verified-work-hours',
        }
        : receipt
    )),
  }));
}
