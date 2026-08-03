import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';

export const HANDOFF_STATUS = Object.freeze({
  active: 'active',
  consumed: 'consumed',
  expired: 'expired',
  superseded: 'superseded',
});

export function createHandoff({
  playerUUID,
  sourceSessionUUID = null,
  resumeTargetType = null,
  resumeTargetUUID = null,
  goalUUID = null,
  milestoneUUID = null,
  nextStep = null,
  unresolvedContext = null,
  generatedSummary = null,
  expiresAt = null,
  createdAt = new Date().toISOString(),
  UUID = uuid(),
} = {}) {
  if (!playerUUID) throw new TypeError('A Handoff requires a player.');
  return Object.freeze({
    UUID,
    parent: String(playerUUID),
    sourceSessionUUID,
    resumeTargetType,
    resumeTargetUUID,
    goalUUID,
    milestoneUUID,
    nextStep: String(nextStep || '').trim().slice(0, 500) || null,
    unresolvedContext: String(unresolvedContext || '').trim().slice(0, 1200) || null,
    generatedSummary: String(generatedSummary || '').trim().slice(0, 800) || null,
    status: HANDOFF_STATUS.active,
    createdAt,
    expiresAt,
    consumedAt: null,
  });
}

export function handoffIsRelevant(handoff, now = Date.now()) {
  if (!handoff || handoff.status !== HANDOFF_STATUS.active) return false;
  if (!handoff.expiresAt) return true;
  const expiresAt = new Date(handoff.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt > Number(now);
}

export async function getActiveHandoff(databaseConnection, playerUUID, now = Date.now()) {
  const handoffs = await databaseConnection.getPlayerStore(STORES.handoff, playerUUID);
  return handoffs
    .filter((handoff) => handoffIsRelevant(handoff, now))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] || null;
}

export async function saveHandoff(databaseConnection, input) {
  const handoff = createHandoff(input);
  const existing = await databaseConnection.getPlayerStore(STORES.handoff, handoff.parent);
  const superseded = existing
    .filter((row) => row.status === HANDOFF_STATUS.active && row.UUID !== handoff.UUID)
    .map((row) => ({
      store: STORES.handoff,
      record: { ...row, status: HANDOFF_STATUS.superseded, updatedAt: handoff.createdAt },
    }));
  await databaseConnection.commitAtomicMutation({
    label: 'continuity-handoff-save',
    puts: [
      ...superseded,
      { store: STORES.handoff, record: handoff },
    ],
  });
  return handoff;
}

export async function consumeHandoff(databaseConnection, handoffUUID, at = new Date().toISOString()) {
  const current = await databaseConnection.get(STORES.handoff, handoffUUID);
  if (!current || current.status === HANDOFF_STATUS.consumed) return current;
  const next = {
    ...current,
    status: HANDOFF_STATUS.consumed,
    consumedAt: at,
    updatedAt: at,
  };
  await databaseConnection.add(STORES.handoff, next);
  return next;
}

export async function expireStaleHandoffs(databaseConnection, playerUUID, now = new Date()) {
  const handoffs = await databaseConnection.getPlayerStore(STORES.handoff, playerUUID);
  const at = now.toISOString();
  const stale = handoffs.filter((handoff) => (
    handoff.status === HANDOFF_STATUS.active
    && handoff.expiresAt
    && new Date(handoff.expiresAt).getTime() <= now.getTime()
  ));
  if (!stale.length) return [];
  await databaseConnection.commitAtomicMutation({
    label: 'continuity-handoff-expire',
    puts: stale.map((handoff) => ({
      store: STORES.handoff,
      record: { ...handoff, status: HANDOFF_STATUS.expired, updatedAt: at },
    })),
  });
  return stale.map((handoff) => handoff.UUID);
}

