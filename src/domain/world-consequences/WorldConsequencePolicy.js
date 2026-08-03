import { STORES } from '@domain/constants.js';

export const WORLD_CONSEQUENCE_POLICY_VERSION = 1;

const CONSEQUENCE_BY_SOURCE = Object.freeze({
  'goal-completed': 'landmark',
  'milestone-completed': 'route-segment',
  'shared-session': 'shared-trace',
  'story-completed': 'archive-object',
  'match-completed': 'arena-record',
  'era-transition': 'historical-district',
  'action-session': 'work-trace',
});

function consequenceUUID(sourceEventUUID, consequenceType, policyVersion) {
  return `world-consequence:${sourceEventUUID}:${consequenceType}:v${policyVersion}`;
}

export function createWorldConsequenceReceipt({
  playerUUID,
  sourceEventUUID,
  sourceType = 'action-session',
  consequenceType = CONSEQUENCE_BY_SOURCE[sourceType] || 'work-trace',
  payload = {},
  policyVersion = WORLD_CONSEQUENCE_POLICY_VERSION,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!playerUUID || !sourceEventUUID) {
    throw new TypeError('World consequence receipts require a player and source event.');
  }
  return Object.freeze({
    UUID: consequenceUUID(sourceEventUUID, consequenceType, policyVersion),
    parent: String(playerUUID),
    sourceEventUUID: String(sourceEventUUID),
    consequenceType,
    consequencePayload: { ...payload, sourceType },
    policyVersion,
    createdAt,
    revealedAt: null,
    appliedAt: createdAt,
  });
}

export async function issueWorldConsequenceReceipt(databaseConnection, input) {
  const receipt = createWorldConsequenceReceipt(input);
  const existing = await databaseConnection.get(STORES.worldConsequenceReceipt, receipt.UUID);
  if (existing) return existing;
  await databaseConnection.add(STORES.worldConsequenceReceipt, receipt);
  return receipt;
}

export async function revealWorldConsequence(databaseConnection, receiptUUID, at = new Date().toISOString()) {
  const receipt = await databaseConnection.get(STORES.worldConsequenceReceipt, receiptUUID);
  if (!receipt || receipt.revealedAt) return receipt;
  const next = { ...receipt, revealedAt: at, updatedAt: at };
  await databaseConnection.add(STORES.worldConsequenceReceipt, next);
  return next;
}

