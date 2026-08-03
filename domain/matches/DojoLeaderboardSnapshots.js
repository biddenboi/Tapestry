import { STORES } from '@domain/constants.js';
import {
  bumpSourceVersion,
  isDerivedCacheMetadata,
  sourceVersionsForRecordGroups,
  withDerivedCacheMetadata,
} from '@shared/cache/DerivedCache.js';

export const DOJO_LEADERBOARD_SNAPSHOT_ID = 'dojoLeaderboardSnapshot:v1';
export const DOJO_LEADERBOARD_SCHEMA_VERSION = 3;
export const DOJO_LEGACY_MIGRATION_VERSION = 1;
export const DOJO_LEADERBOARD_UPDATED_EVENT = 'tapestry:dojo-leaderboard-updated';

function cleanId(value) {
  const text = String(value || '').trim();
  return text || null;
}

function dayKey(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'unknown-day';
}

export function legacyDojoSessionUUID(task = {}) {
  return cleanId(task.dojoSessionId)
    || cleanId(task.dojoSession)
    || cleanId(task.sessionUUID)
    || cleanId(task.sessionId)
    || (task.source === 'dojo' && task.parent
      ? `legacy-dojo:${task.parent}:${dayKey(task.completedAt || task.createdAt)}`
      : null);
}

export function canonicalizeLegacyDojoTask(task = {}) {
  if (task.source !== 'dojo' || cleanId(task.dojoSessionUUID)) return task;
  const dojoSessionUUID = legacyDojoSessionUUID(task);
  if (!dojoSessionUUID) return task;
  const migrated = {
    ...task,
    dojoSessionUUID,
    dojoRecordVersion: 1,
  };
  delete migrated.dojoSessionId;
  delete migrated.dojoSession;
  delete migrated.sessionId;
  delete migrated.sessionUUID;
  return migrated;
}

export function buildDojoLeaderboardSnapshot(tasks = [], { migratedAt = null, players = [] } = {}) {
  const sessions = new Map();
  const processedTaskUUIDs = [];
  for (const task of tasks || []) {
    if (task?.source !== 'dojo' || !task?.dojoSessionUUID || !task?.parent || !task?.UUID) continue;
    const sessionUUID = String(task.dojoSessionUUID);
    const current = sessions.get(sessionUUID) || {
      sessionUUID,
      playerUUID: String(task.parent),
      points: 0,
      taskCount: 0,
      completedAt: task.completedAt || null,
    };
    current.points += Number(task.points || 0);
    current.taskCount += 1;
    if (String(task.completedAt || '') > String(current.completedAt || '')) {
      current.completedAt = task.completedAt || null;
    }
    sessions.set(sessionUUID, current);
    processedTaskUUIDs.push(String(task.UUID));
  }
  return withDerivedCacheMetadata({
    schemaVersion: DOJO_LEADERBOARD_SCHEMA_VERSION,
    migrationVersion: DOJO_LEGACY_MIGRATION_VERSION,
    migratedAt: migratedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessions: [...sessions.values()].sort((left, right) => (
      Number(right.points || 0) - Number(left.points || 0)
      || String(right.completedAt || '').localeCompare(String(left.completedAt || ''))
      || String(left.sessionUUID).localeCompare(String(right.sessionUUID))
    )),
    processedTaskUUIDs,
    participantSummaries: (players || [])
      .filter((player) => [...sessions.values()].some((session) => String(session.playerUUID) === String(player?.UUID || '')))
      .map(toDojoParticipantSummary)
      .filter(Boolean),
  }, {
    sourceVersions: sourceVersionsForRecordGroups({ tasks, profiles: players }),
  });
}

function isCurrentSnapshot(value = null) {
  return Number(value?.schemaVersion) === DOJO_LEADERBOARD_SCHEMA_VERSION
    && Number(value?.migrationVersion) === DOJO_LEGACY_MIGRATION_VERSION
    && Array.isArray(value?.sessions)
    && Array.isArray(value?.processedTaskUUIDs)
    && Array.isArray(value?.participantSummaries)
    && isDerivedCacheMetadata(value?.cache);
}


function toDojoParticipantSummary(player = {}) {
  const UUID = cleanId(player.UUID);
  if (!UUID) return null;
  return {
    UUID,
    username: player.username || 'Unknown',
    profilePicture: player.profilePicture || null,
    elo: Math.max(0, Number(player.elo || 0)),
  };
}

export function emptyDojoLeaderboardSnapshot() {
  return withDerivedCacheMetadata({
    schemaVersion: DOJO_LEADERBOARD_SCHEMA_VERSION,
    migrationVersion: DOJO_LEGACY_MIGRATION_VERSION,
    migratedAt: null,
    updatedAt: null,
    sessions: [],
    processedTaskUUIDs: [],
    participantSummaries: [],
  }, { sourceVersions: { tasks: '0', profiles: '0' }, generatedAt: null });
}

function normalizeReadableSnapshot(value = null) {
  if (isCurrentSnapshot(value)) return value;
  if (Array.isArray(value?.sessions) && Array.isArray(value?.processedTaskUUIDs)) {
    return withDerivedCacheMetadata({
      ...emptyDojoLeaderboardSnapshot(),
      ...value,
      schemaVersion: DOJO_LEADERBOARD_SCHEMA_VERSION,
      participantSummaries: Array.isArray(value.participantSummaries) ? value.participantSummaries : [],
    }, {
      generatedAt: value.updatedAt || value.migratedAt || null,
      sourceVersions: value.cache?.sourceVersions || { tasks: 'legacy', profiles: 'legacy' },
    });
  }
  return emptyDojoLeaderboardSnapshot();
}

export function refreshDojoParticipantSummaries(snapshot, players = [], updatedAt = new Date().toISOString()) {
  const participantUUIDs = new Set((snapshot?.sessions || []).map((session) => String(session.playerUUID || '')).filter(Boolean));
  const current = normalizeReadableSnapshot(snapshot);
  return withDerivedCacheMetadata({
    ...current,
    updatedAt,
    participantSummaries: (players || [])
      .filter((player) => participantUUIDs.has(String(player?.UUID || '')))
      .map(toDojoParticipantSummary)
      .filter(Boolean),
  }, {
    generatedAt: updatedAt,
    sourceVersions: bumpSourceVersion(current.cache?.sourceVersions, 'profiles'),
  });
}

async function saveSnapshot(databaseConnection, value) {
  const record = {
    UUID: DOJO_LEADERBOARD_SNAPSHOT_ID,
    value,
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
  await databaseConnection.add(STORES.derivedCache, record);
  if (typeof window !== 'undefined'
    && typeof window.dispatchEvent === 'function'
    && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DOJO_LEADERBOARD_UPDATED_EVENT));
  }
  return value;
}

export async function migrateLegacyDojoRecordsOnce(databaseConnection) {
  const existing = await databaseConnection.get(STORES.derivedCache, DOJO_LEADERBOARD_SNAPSHOT_ID).catch(() => null);
  if (isCurrentSnapshot(existing?.value)) return existing.value;

  await databaseConnection.ensureDomainLoaded?.('tasks');
  const tasks = await databaseConnection.getAll(STORES.task);
  const canonicalTasks = [];
  for (const task of tasks || []) {
    const migrated = canonicalizeLegacyDojoTask(task);
    canonicalTasks.push(migrated);
    if (migrated !== task) {
      // One-time rewrite makes all future consumers canonical-only.
      // eslint-disable-next-line no-await-in-loop
      await databaseConnection.add(STORES.task, migrated);
    }
  }
  const players = typeof databaseConnection.getAllPlayers === 'function'
    ? await databaseConnection.getAllPlayers().catch(() => [])
    : [];
  const snapshot = buildDojoLeaderboardSnapshot(canonicalTasks, {
    migratedAt: new Date().toISOString(),
    players,
  });
  return saveSnapshot(databaseConnection, snapshot);
}

export async function getDojoLeaderboardSnapshot(databaseConnection) {
  const record = await databaseConnection.get(STORES.derivedCache, DOJO_LEADERBOARD_SNAPSHOT_ID).catch(() => null);
  return normalizeReadableSnapshot(record?.value);
}

export async function recordDojoCompletionInSnapshot(databaseConnection, { task, event, player } = {}) {
  if (!task?.UUID || task.source !== 'dojo' || !task.dojoSessionUUID || !task.parent) {
    return { updated: false };
  }
  const stored = await databaseConnection.get(STORES.derivedCache, DOJO_LEADERBOARD_SNAPSHOT_ID).catch(() => null);
  const snapshot = isCurrentSnapshot(stored?.value)
    ? stored.value
    : await migrateLegacyDojoRecordsOnce(databaseConnection);
  const processed = new Set(snapshot.processedTaskUUIDs || []);
  if (processed.has(String(task.UUID))) return { updated: false, snapshot };

  const sessions = new Map((snapshot.sessions || []).map((session) => [String(session.sessionUUID), { ...session }]));
  const sessionUUID = String(task.dojoSessionUUID);
  const current = sessions.get(sessionUUID) || {
    sessionUUID,
    playerUUID: String(task.parent),
    points: 0,
    taskCount: 0,
    completedAt: null,
  };
  current.points = Number(current.points || 0) + Number(task.points || 0);
  current.taskCount = Number(current.taskCount || 0) + 1;
  current.completedAt = String(task.completedAt || event?.completedAt || '') > String(current.completedAt || '')
    ? (task.completedAt || event?.completedAt || null)
    : current.completedAt;
  sessions.set(sessionUUID, current);
  processed.add(String(task.UUID));

  const participantMap = new Map((snapshot.participantSummaries || []).map((entry) => [String(entry.UUID), entry]));
  const participant = toDojoParticipantSummary(player);
  if (participant) participantMap.set(participant.UUID, participant);
  const updatedAt = new Date().toISOString();
  const next = withDerivedCacheMetadata({
    ...snapshot,
    updatedAt,
    participantSummaries: [...participantMap.values()],
    sessions: [...sessions.values()].sort((left, right) => (
      Number(right.points || 0) - Number(left.points || 0)
      || String(right.completedAt || '').localeCompare(String(left.completedAt || ''))
      || String(left.sessionUUID).localeCompare(String(right.sessionUUID))
    )),
    processedTaskUUIDs: [...processed],
  }, {
    generatedAt: updatedAt,
    sourceVersions: bumpSourceVersion(
      bumpSourceVersion(snapshot.cache?.sourceVersions, 'tasks'),
      participant ? 'profiles' : null,
    ),
  });
  await saveSnapshot(databaseConnection, next);
  return { updated: true, snapshot: next };
}

export function materializeDojoLeaderboard(snapshot, players = null, limit = 10) {
  const sourcePlayers = Array.isArray(players) ? players : snapshot?.participantSummaries || [];
  const playerMap = new Map((sourcePlayers || []).map((player) => [String(player.UUID), player]));
  return (snapshot?.sessions || [])
    .slice(0, Math.max(0, Number(limit) || 10))
    .map((session) => ({ ...session, player: playerMap.get(String(session.playerUUID)) || null }))
    .filter((session) => session.player);
}
