import { STORES } from '@domain/constants.js';

export const ACTION_SESSION_SYNC_COMMANDS = Object.freeze([
  'startActionSession',
  'pauseActionSession',
  'resumeActionSession',
  'takeOverActionSession',
  'finalizeActionSession',
]);

function canonicalPut(store, record) {
  return record?.UUID ? { store, record } : null;
}

function ownedBy(record, playerUUID) {
  return !record?.UUID || String(record.parent || '') === String(playerUUID || '');
}

/**
 * Replays the complete canonical Action Session mutation on another device.
 * Final settlement carries its evidence records because a mobile client cannot
 * publish the desktop working-set mirror itself.
 */
export function buildRemoteActionSessionMutation(entry) {
  const payload = entry?.payload || {};
  const session = payload.session;
  if (!session?.UUID) {
    throw new Error(`Remote ${entry?.commandType || 'Action Session command'} is missing its canonical Action Session.`);
  }
  const playerUUID = session.parent;
  const ownedRecords = [
    payload.contribution,
    payload.goalUpdate,
    payload.daybookEvent,
    payload.worldReceipt,
    payload.scoreEvent,
    ...(payload.handoffRecords || []),
    ...(payload.provenance || []),
  ].filter(Boolean);
  if (!ownedRecords.every((record) => ownedBy(record, playerUUID))) {
    const error = new Error('Remote Action Session evidence does not match its pinned profile.');
    error.code = 'action-session-profile-mismatch';
    throw error;
  }
  if (payload.player?.UUID && String(payload.player.UUID) !== String(playerUUID || '')) {
    const error = new Error('Remote Action Session player does not match its pinned profile.');
    error.code = 'action-session-profile-mismatch';
    throw error;
  }
  if (payload.todo?.UUID && String(payload.todo.UUID) !== String(session.targetUUID || '')) {
    const error = new Error('Remote Action Session task does not match its pinned target.');
    error.code = 'action-session-target-mismatch';
    throw error;
  }

  const puts = [
    entry.commandType === 'startActionSession'
      ? canonicalPut(STORES.todo, payload.task)
      : null,
    canonicalPut(STORES.actionSession, session),
    canonicalPut(STORES.player, payload.player),
    canonicalPut(STORES.todo, payload.todo),
    canonicalPut(STORES.contribution, payload.contribution),
    canonicalPut(STORES.goalUpdate, payload.goalUpdate),
    canonicalPut(STORES.event, payload.daybookEvent),
    canonicalPut(STORES.worldConsequenceReceipt, payload.worldReceipt),
    ...(payload.handoffRecords || []).map((record) => canonicalPut(STORES.handoff, record)),
    canonicalPut(STORES.matchScoreEvent, payload.scoreEvent),
    ...(payload.provenance || []).map((record) => canonicalPut(STORES.rewardProvenance, record)),
  ].filter(Boolean);

  return {
    label: `remote-${entry.commandType}`,
    puts,
    sync: { origin: 'remote-sync', enqueueSync: false },
  };
}

export default buildRemoteActionSessionMutation;
