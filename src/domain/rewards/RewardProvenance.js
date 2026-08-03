import { STORES } from '@domain/constants.js';

export const REWARD_POLICY_VERSION = 1;

function cleanIdPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .slice(0, 180);
}

export function createRewardProvenance({
  playerUUID,
  sourceEventUUID,
  sourceType,
  rewardType,
  amount = null,
  itemId = null,
  explanation,
  policyVersion = REWARD_POLICY_VERSION,
  idempotencyKey = null,
  issuedAt = new Date().toISOString(),
} = {}) {
  if (!playerUUID || !sourceEventUUID || !sourceType || !rewardType || !explanation) {
    throw new TypeError('Reward provenance requires a player, source event, source type, reward type, and explanation.');
  }
  const key = idempotencyKey
    || [sourceEventUUID, rewardType, itemId || 'amount', policyVersion].join(':');
  return Object.freeze({
    UUID: `reward-provenance:${cleanIdPart(key)}`,
    parent: String(playerUUID),
    sourceEventUUID: String(sourceEventUUID),
    sourceType: String(sourceType),
    rewardType: String(rewardType),
    amount: amount == null ? null : Number(amount),
    itemId: itemId == null ? null : String(itemId),
    policyVersion: Math.max(1, Math.trunc(Number(policyVersion) || 1)),
    explanation: String(explanation).trim().slice(0, 500),
    idempotencyKey: String(key),
    issuedAt,
    createdAt: issuedAt,
  });
}

export async function recordRewardProvenance(databaseConnection, input) {
  const record = createRewardProvenance(input);
  const existing = await databaseConnection.get(STORES.rewardProvenance, record.UUID);
  if (existing) return existing;
  const operationId = input.operationId || `reward-provenance-record:${record.idempotencyKey}`;
  await databaseConnection.commitAtomicMutation({
    operationId,
    label: 'reward-provenance-record',
    puts: [{ store: STORES.rewardProvenance, record }],
    sync: databaseConnection.createSyncCommandContext?.({
      origin: input.origin || 'desktop',
      enqueueSync: input.enqueueSync !== false,
      operationId,
      playerId: record.parent,
      commandType: 'recordRewardProvenance',
      entityType: 'reward-provenance',
      entityId: record.UUID,
      payload: record,
      occurredAt: record.issuedAt,
    }) || { origin: input.origin || 'desktop', enqueueSync: false },
  });
  return record;
}

export function explainRewardProvenance(record) {
  if (!record) return '';
  const amount = record.amount == null
    ? ''
    : `${Number(record.amount) > 0 ? '+' : ''}${Number(record.amount).toLocaleString()} `;
  return `${amount}${record.rewardType}: ${record.explanation}`;
}
