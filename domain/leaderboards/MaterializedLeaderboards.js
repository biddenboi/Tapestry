import {
  EVENT,
  MATCH_STATUS,
  SPECIAL_EVENT_IDS,
  STORES,
} from '@domain/constants.js';
import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';
import { withPlayerMatchResult } from '@domain/matches/IGT.js';
import {
  isDerivedCacheMetadata,
  readStaleWhileRevalidate,
  sourceVersionsForRecordGroups,
  withDerivedCacheMetadata,
} from '@shared/cache/DerivedCache.js';
export const MATERIALIZED_LEADERBOARD_SCHEMA_VERSION = 2;
export const MATCH_LEADERBOARD_SNAPSHOT_ID = 'matchLeaderboardSnapshot:v1';
export const CONTRIBUTION_LEADERBOARD_SNAPSHOT_ID = 'contributionLeaderboardSnapshot:v1';
export const MATERIALIZED_LEADERBOARDS_UPDATED_EVENT = 'tapestry:materialized-leaderboards-updated';
export const MATERIALIZED_LEADERBOARDS_REBUILDING_EVENT = 'tapestry:materialized-leaderboards-rebuilding';

export const LEADERBOARD_REBUILD_SCOPE = Object.freeze({
  match: 'match',
  contribution: 'contribution',
  lobby: 'lobby',
});

const ALL_SCOPES = Object.freeze(Object.values(LEADERBOARD_REBUILD_SCOPE));
const rebuildStateByConnection = new WeakMap();

function cleanId(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isoNow() {
  return new Date().toISOString();
}

export function localDayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toParticipantSummary(player = {}) {
  const UUID = cleanId(player.UUID);
  if (!UUID) return null;
  return {
    UUID,
    username: player.username || 'Unknown',
    profilePicture: player.profilePicture || null,
    elo: Math.max(0, Number(player.elo || 0)),
    activeTitle: player.activeCosmetics?.title || player.activeTitle || null,
  };
}

function stableParticipantSort(left, right) {
  return String(left?.username || '').localeCompare(String(right?.username || ''))
    || String(left?.UUID || '').localeCompare(String(right?.UUID || ''));
}

function rankedPlayerUUIDs(players = [], valueFor) {
  return [...players]
    .sort((left, right) => (
      Number(valueFor(right) || 0) - Number(valueFor(left) || 0)
      || stableParticipantSort(left, right)
    ))
    .map((player) => String(player.UUID));
}

function acceptedFriendshipsByPlayer(friendships = []) {
  const result = {};
  for (const friendship of friendships || []) {
    if (friendship?.status !== 'accepted') continue;
    const players = [...new Set((friendship.players || []).map(cleanId).filter(Boolean))];
    for (const playerUUID of players) {
      const peers = result[playerUUID] || new Set();
      for (const peerUUID of players) {
        if (peerUUID !== playerUUID) peers.add(peerUUID);
      }
      result[playerUUID] = peers;
    }
  }
  return Object.fromEntries(
    Object.entries(result).map(([playerUUID, peers]) => [playerUUID, [...peers].sort()]),
  );
}

function latestScheduleByPlayer(events = []) {
  const allowed = new Set([EVENT.wake, EVENT.end_work, EVENT.sleep]);
  const result = {};
  for (const event of events || []) {
    const parent = cleanId(event?.parent);
    if (!parent || !allowed.has(event?.type)) continue;
    const previous = result[parent];
    if (!previous || String(event.createdAt || '') > String(previous.createdAt || '')) {
      result[parent] = {
        UUID: event.UUID || null,
        type: event.type,
        createdAt: event.createdAt || null,
        inGameTimestamp: Number(event.inGameTimestamp || 0),
      };
    }
  }
  return result;
}

function dojoMomentumByPlayer(eventBuffs = []) {
  const result = {};
  for (const buff of eventBuffs || []) {
    const parent = cleanId(buff?.parent);
    if (!parent || buff?.eventUUID !== SPECIAL_EVENT_IDS.dojoMultiplier) continue;
    const previous = result[parent];
    if (!previous || String(buff.updatedAt || buff.createdAt || '') > String(previous.updatedAt || previous.createdAt || '')) {
      result[parent] = {
        UUID: buff.UUID || null,
        eventUUID: buff.eventUUID,
        multiplierValue: Number(buff.multiplierValue || 1),
        createdAt: buff.createdAt || null,
        updatedAt: buff.updatedAt || null,
      };
    }
  }
  return result;
}

function completedTaskPoints(tasks = []) {
  const totalByPlayer = {};
  const dailyByPlayer = {};
  for (const task of tasks || []) {
    const parent = cleanId(task?.parent);
    if (!parent || !task?.completedAt) continue;
    const points = Number(task.points || 0);
    totalByPlayer[parent] = Number(totalByPlayer[parent] || 0) + points;
    const day = localDayKey(task.completedAt);
    if (!day) continue;
    if (!dailyByPlayer[parent]) dailyByPlayer[parent] = {};
    dailyByPlayer[parent][day] = Number(dailyByPlayer[parent][day] || 0) + points;
  }
  return { totalByPlayer, dailyByPlayer };
}

function contributionTotals(contributions = []) {
  const totals = {};
  for (const row of contributions || []) {
    const parent = cleanId(row?.parent || row?.playerUUID);
    if (!parent) continue;
    totals[parent] = Number(totals[parent] || 0) + Number(row.value || row.contribution || 0);
  }
  return totals;
}

function matchSort(left, right) {
  return Number(right?.completedInGameTimestamp || right?.inGameTimestamp || 0)
    - Number(left?.completedInGameTimestamp || left?.inGameTimestamp || 0)
    || String(right?.result?.concludedAt || right?.createdAt || '')
      .localeCompare(String(left?.result?.concludedAt || left?.createdAt || ''))
    || String(left?.UUID || '').localeCompare(String(right?.UUID || ''));
}

function matchSummaryForPlayer(match, playerUUID) {
  const projected = withPlayerMatchResult(match, playerUUID);
  const viewerOutcome = getMatchOutcomeForPlayer(projected, playerUUID);
  return {
    UUID: projected.UUID,
    parent: projected.parent || null,
    status: projected.status,
    duration: Number(projected.duration || 0),
    createdAt: projected.createdAt || null,
    inGameTimestamp: Number(projected.inGameTimestamp || 0),
    completedInGameTimestamp: Number(projected.completedInGameTimestamp || 0),
    participantUUIDs: [...new Set((projected.participantUUIDs || []).map(String))],
    viewerOutcome,
    result: projected.result ? {
      winner: projected.result.winner ?? null,
      team1Total: Number(projected.result.team1Total || 0),
      team2Total: Number(projected.result.team2Total || 0),
      iWon: projected.result.iWon ?? null,
      wasForfeited: !!projected.result.wasForfeited,
      concludedAt: projected.result.concludedAt || null,
      inGameTimestamp: Number(projected.result.inGameTimestamp || 0),
      eloChange: Number(projected.result.eloChange || 0),
      oldElo: Number(projected.result.oldElo || 0),
      newElo: Number(projected.result.newElo || 0),
    } : null,
  };
}

function materializeMatchHistory(matches = [], playerUUID) {
  return (matches || [])
    .filter((match) => (match.participantUUIDs || []).some((UUID) => String(UUID) === String(playerUUID)))
    .sort(matchSort)
    .slice(0, 4)
    .map((match) => matchSummaryForPlayer(match, playerUUID));
}

function materializeEloHistory(matches = [], playerUUID, currentElo = 0) {
  const rows = (matches || [])
    .filter((match) => match.status === MATCH_STATUS.complete)
    .map((match) => ({
      match,
      change: match.result?.playerEloChanges?.[playerUUID]
        || (String(match.parent) === String(playerUUID) && match.result?.eloChange != null
          ? {
              oldElo: Number(match.result.oldElo || 0),
              newElo: Number(match.result.newElo || 0),
              change: Number(match.result.eloChange || 0),
            }
          : null),
    }))
    .filter((entry) => entry.change)
    .sort((left, right) => matchSort(right.match, left.match));
  if (!rows.length) return [];
  const history = [{
    t: Number(rows[0].match.inGameTimestamp || rows[0].match.completedInGameTimestamp || 0),
    elo: Number(rows[0].change.oldElo || 0),
  }];
  for (const { match, change } of rows) {
    history.push({
      t: Number(match.completedInGameTimestamp || match.result?.inGameTimestamp || match.inGameTimestamp || 0),
      elo: Number(change.newElo ?? (history.at(-1)?.elo || 0) + Number(change.change || 0)),
    });
  }
  if (history.length === 1) history.push({ t: history[0].t, elo: Number(currentElo || history[0].elo) });
  return history;
}

export function buildMatchLeaderboardSnapshot({
  players = [],
  matches = [],
  tasks = [],
  friendships = [],
  events = [],
  eventBuffs = [],
  generatedAt = isoNow(),
} = {}) {
  const participantSummaries = (players || []).map(toParticipantSummary).filter(Boolean);
  const playerByUUID = new Map(participantSummaries.map((player) => [player.UUID, player]));
  const points = completedTaskPoints(tasks);
  const allPlayerUUIDs = participantSummaries.map((player) => player.UUID);
  const matchSummariesByPlayer = {};
  const eloHistoryByPlayer = {};
  const activeMatchUUIDByPlayer = {};

  for (const playerUUID of allPlayerUUIDs) {
    matchSummariesByPlayer[playerUUID] = materializeMatchHistory(matches, playerUUID);
    eloHistoryByPlayer[playerUUID] = materializeEloHistory(
      matches,
      playerUUID,
      playerByUUID.get(playerUUID)?.elo || 0,
    );
  }
  for (const match of matches || []) {
    if (match?.status !== MATCH_STATUS.active) continue;
    for (const playerUUID of match.participantUUIDs || []) {
      if (!activeMatchUUIDByPlayer[playerUUID]) activeMatchUUIDByPlayer[playerUUID] = match.UUID;
    }
  }

  return withDerivedCacheMetadata({
    schemaVersion: MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
    updatedAt: generatedAt,
    participantSummaries,
    globalRankedUUIDs: rankedPlayerUUIDs(participantSummaries, (player) => player.elo),
    pointsRankedUUIDs: rankedPlayerUUIDs(participantSummaries, (player) => points.totalByPlayer[player.UUID] || 0),
    pointsByPlayer: points.totalByPlayer,
    dailyPointsByPlayer: points.dailyByPlayer,
    friendUUIDsByPlayer: acceptedFriendshipsByPlayer(friendships),
    matchSummariesByPlayer,
    activeMatchUUIDByPlayer,
    eloHistoryByPlayer,
    scheduleByPlayer: latestScheduleByPlayer(events),
    dojoMomentumByPlayer: dojoMomentumByPlayer(eventBuffs),
  }, {
    generatedAt,
    sourceVersions: sourceVersionsForRecordGroups({
      profiles: players,
      matches,
      tasks,
      social: friendships,
      dailyLifecycle: events,
      eventBuffs,
    }),
  });
}

export function buildContributionLeaderboardSnapshot({
  players = [],
  contributions = [],
  generatedAt = isoNow(),
} = {}) {
  const participantSummaries = (players || []).map(toParticipantSummary).filter(Boolean);
  const totalsByPlayer = contributionTotals(contributions);
  return withDerivedCacheMetadata({
    schemaVersion: MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
    updatedAt: generatedAt,
    participantSummaries,
    totalsByPlayer,
    rankedUUIDs: rankedPlayerUUIDs(participantSummaries, (player) => totalsByPlayer[player.UUID] || 0),
  }, {
    generatedAt,
    sourceVersions: sourceVersionsForRecordGroups({
      profiles: players,
      competitiveArenas: contributions,
    }),
  });
}

function emptyMatchSnapshot() {
  return withDerivedCacheMetadata({
    schemaVersion: MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
    updatedAt: null,
    participantSummaries: [],
    globalRankedUUIDs: [],
    pointsRankedUUIDs: [],
    pointsByPlayer: {},
    dailyPointsByPlayer: {},
    friendUUIDsByPlayer: {},
    matchSummariesByPlayer: {},
    activeMatchUUIDByPlayer: {},
    eloHistoryByPlayer: {},
    scheduleByPlayer: {},
    dojoMomentumByPlayer: {},
  }, { sourceVersions: {}, generatedAt: null });
}

function emptyContributionSnapshot() {
  return withDerivedCacheMetadata({
    schemaVersion: MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
    updatedAt: null,
    participantSummaries: [],
    totalsByPlayer: {},
    rankedUUIDs: [],
  }, { sourceVersions: {}, generatedAt: null });
}

function isCurrentSnapshot(value) {
  return Number(value?.schemaVersion) === MATERIALIZED_LEADERBOARD_SCHEMA_VERSION
    && isDerivedCacheMetadata(value?.cache);
}

function normalizeSnapshot(value, fallback) {
  return isCurrentSnapshot(value) ? value : fallback();
}

async function readSetting(databaseConnection, UUID) {
  return databaseConnection.get(STORES.derivedCache, UUID).catch(() => null);
}

export async function readMaterializedLeaderboardSnapshots(databaseConnection) {
  const [matchRecord, contributionRecord] = await Promise.all([
    readSetting(databaseConnection, MATCH_LEADERBOARD_SNAPSHOT_ID),
    readSetting(databaseConnection, CONTRIBUTION_LEADERBOARD_SNAPSHOT_ID),
  ]);
  return {
    match: normalizeSnapshot(matchRecord?.value, emptyMatchSnapshot),
    contribution: normalizeSnapshot(contributionRecord?.value, emptyContributionSnapshot),
  };
}

export async function readMaterializedLeaderboardSnapshotsSWR(databaseConnection) {
  const snapshots = await readMaterializedLeaderboardSnapshots(databaseConnection);
  const state = rebuildStateByConnection.get(databaseConnection);
  const pending = state?.promise || state?.running || null;
  const match = readStaleWhileRevalidate({
    value: snapshots.match,
    expectedSourceVersions: pending ? { __pendingRebuild: 'complete' } : null,
    revalidate: pending ? () => pending : null,
  });
  const contribution = readStaleWhileRevalidate({
    value: snapshots.contribution,
    expectedSourceVersions: pending ? { __pendingRebuild: 'complete' } : null,
    revalidate: pending ? () => pending : null,
  });
  return {
    ...snapshots,
    stale: !!pending || match.stale || contribution.stale,
    revalidation: pending || match.revalidation || contribution.revalidation || null,
  };
}

export async function readLobbyMaterializedData(databaseConnection, playerUUID) {
  const snapshots = await readMaterializedLeaderboardSnapshotsSWR(databaseConnection);
  const playerId = cleanId(playerUUID);
  const participantMap = new Map();
  for (const participant of [
    ...(snapshots.match.participantSummaries || []),
    ...(snapshots.contribution.participantSummaries || []),
  ]) {
    if (participant?.UUID) participantMap.set(String(participant.UUID), participant);
  }
  return {
    ...snapshots,
    participants: [...participantMap.values()],
    playerUUID: playerId,
    matchHistory: playerId ? snapshots.match.matchSummariesByPlayer?.[playerId] || [] : [],
    activeMatchUUID: playerId ? snapshots.match.activeMatchUUIDByPlayer?.[playerId] || null : null,
    scheduleStage: playerId ? snapshots.match.scheduleByPlayer?.[playerId] || null : null,
    dojoMomentum: playerId ? snapshots.match.dojoMomentumByPlayer?.[playerId] || null : null,
    friendUUIDs: playerId ? snapshots.match.friendUUIDsByPlayer?.[playerId] || [] : [],
    eloHistory: playerId ? snapshots.match.eloHistoryByPlayer?.[playerId] || [] : [],
    todayPoints: playerId
      ? Number(snapshots.match.dailyPointsByPlayer?.[playerId]?.[localDayKey()] || 0)
      : 0,
  };
}

function dispatchLeaderboardEvent(type, detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  if (typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  } else {
    window.dispatchEvent(new Event(type));
  }
}

function scopesForInput(scopes) {
  const requested = Array.isArray(scopes) ? scopes.flat(Infinity) : [scopes];
  const normalized = [...new Set(requested.filter((scope) => ALL_SCOPES.includes(scope)))];
  return normalized.length ? normalized : [...ALL_SCOPES];
}

async function yieldForBackgroundWork() {
  const scheduler = globalThis.scheduler;
  if (scheduler?.postTask) {
    await scheduler.postTask(() => undefined, { priority: 'background' });
    return;
  }
  await new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 250 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function settingRecord(UUID, value) {
  return { UUID, value, updatedAt: value.updatedAt || isoNow() };
}

export async function rebuildMaterializedLeaderboards(databaseConnection, {
  scopes = ALL_SCOPES,
  reason = 'committed-event',
} = {}) {
  const normalizedScopes = scopesForInput(scopes);
  const needsMatch = normalizedScopes.some((scope) => (
    scope === LEADERBOARD_REBUILD_SCOPE.match || scope === LEADERBOARD_REBUILD_SCOPE.lobby
  ));
  const needsContribution = normalizedScopes.includes(LEADERBOARD_REBUILD_SCOPE.contribution);
  const domains = new Set(['leaderboards', 'profiles']);
  if (needsMatch) {
    domains.add('matches');
    domains.add('tasks');
    domains.add('social');
    domains.add('events');
  }
  if (needsContribution) domains.add('tasks');

  await databaseConnection.ensureDomainsLoaded?.([...domains]);
  await yieldForBackgroundWork();

  const current = await readMaterializedLeaderboardSnapshots(databaseConnection);
  const generatedAt = isoNow();
  let players = null;
  const getPlayers = async () => {
    if (!players) players = await databaseConnection.getAllPlayers();
    return players;
  };

  let matchSnapshot = current.match;
  if (needsMatch) {
    const [eloWorld, tasks, friendships, events, eventBuffs] = await Promise.all([
      databaseConnection.getEloWorldAtIGT(Infinity),
      databaseConnection.getAll(STORES.task),
      databaseConnection.getAll(STORES.friendship),
      databaseConnection.getAll(STORES.event),
      databaseConnection.getAll(STORES.eventBuff),
    ]);
    matchSnapshot = buildMatchLeaderboardSnapshot({
      players: eloWorld.players,
      matches: eloWorld.matches,
      tasks,
      friendships,
      events,
      eventBuffs,
      generatedAt,
    });
  }

  let contributionSnapshot = current.contribution;
  if (needsContribution) {
    const [profileRows, contributions] = await Promise.all([
      getPlayers(),
      databaseConnection.getAll(STORES.contribution),
    ]);
    contributionSnapshot = buildContributionLeaderboardSnapshot({
      players: profileRows,
      contributions,
      generatedAt,
    });
  }

  const puts = [];
  if (needsMatch) puts.push({ store: STORES.derivedCache, record: settingRecord(MATCH_LEADERBOARD_SNAPSHOT_ID, matchSnapshot) });
  if (needsContribution) puts.push({ store: STORES.derivedCache, record: settingRecord(CONTRIBUTION_LEADERBOARD_SNAPSHOT_ID, contributionSnapshot) });

  if (puts.length) {
    await databaseConnection.commitAtomicMutation({
      label: 'materialized-leaderboard-rebuild',
      puts,
      flush: false,
    });
  }
  dispatchLeaderboardEvent(MATERIALIZED_LEADERBOARDS_UPDATED_EVENT, {
    reason,
    scopes: normalizedScopes,
    updatedAt: generatedAt,
  });
  return {
    reason,
    scopes: normalizedScopes,
    updatedAt: generatedAt,
    match: matchSnapshot,
    contribution: contributionSnapshot,
  };
}

function scheduleCallback(callback) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, { timeout: 1000 });
    return () => globalThis.cancelIdleCallback?.(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

export function queueMaterializedLeaderboardRebuild(databaseConnection, {
  scopes = ALL_SCOPES,
  reason = 'committed-event',
} = {}) {
  if (!databaseConnection) return Promise.resolve(null);
  let state = rebuildStateByConnection.get(databaseConnection);
  if (!state) {
    state = {
      scopes: new Set(),
      reasons: new Set(),
      scheduled: null,
      running: null,
      resolve: null,
      reject: null,
      promise: null,
    };
    rebuildStateByConnection.set(databaseConnection, state);
  }
  scopesForInput(scopes).forEach((scope) => state.scopes.add(scope));
  state.reasons.add(reason);

  if (!state.promise) {
    state.promise = new Promise((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
  }
  if (state.scheduled || state.running) return state.promise;

  dispatchLeaderboardEvent(MATERIALIZED_LEADERBOARDS_REBUILDING_EVENT, {
    reason,
    scopes: [...state.scopes],
  });
  state.scheduled = scheduleCallback(async () => {
    state.scheduled = null;
    let latestResult = null;
    try {
      while (state.scopes.size) {
        const runScopes = [...state.scopes];
        const runReason = [...state.reasons].join(',') || reason;
        state.scopes.clear();
        state.reasons.clear();
        state.running = rebuildMaterializedLeaderboards(databaseConnection, {
          scopes: runScopes,
          reason: runReason,
        });
        // New requests arriving during this await are accumulated in state.scopes
        // and drained before the shared promise resolves.
        latestResult = await state.running;
        state.running = null;
      }
      state.resolve?.(latestResult);
    } catch (error) {
      state.running = null;
      state.reject?.(error);
    } finally {
      state.promise = null;
      state.resolve = null;
      state.reject = null;
    }
  });
  return state.promise;
}

function playerSummaryChanged(operation) {
  if (operation?.type === 'clear' || operation?.type === 'replace-store') return true;
  const before = toParticipantSummary(operation?.previousRecord || {});
  const after = toParticipantSummary(operation?.record || {});
  return JSON.stringify(before) !== JSON.stringify(after);
}

function operationTouches(operation, predicate) {
  if (operation?.type === 'clear' || operation?.type === 'replace-store') return true;
  return [operation?.record, operation?.previousRecord].some((record) => record && predicate(record));
}

export function leaderboardScopesForOperations(operations = []) {
  const scopes = new Set();
  for (const operation of operations || []) {
    const store = operation?.store;
    if (!store) continue;
    if (store === STORES.match || store === STORES.friendship) {
      scopes.add(LEADERBOARD_REBUILD_SCOPE.match);
      scopes.add(LEADERBOARD_REBUILD_SCOPE.lobby);
      continue;
    }
    if (store === STORES.task && operationTouches(operation, (task) => !!task.completedAt)) {
      scopes.add(LEADERBOARD_REBUILD_SCOPE.match);
      scopes.add(LEADERBOARD_REBUILD_SCOPE.lobby);
      continue;
    }
    if (store === STORES.event && operationTouches(operation, (event) => (
      [EVENT.wake, EVENT.end_work, EVENT.sleep].includes(event.type)
    ))) {
      scopes.add(LEADERBOARD_REBUILD_SCOPE.match);
      scopes.add(LEADERBOARD_REBUILD_SCOPE.lobby);
      continue;
    }
    if (store === STORES.eventBuff && operationTouches(operation, (buff) => (
      buff.eventUUID === SPECIAL_EVENT_IDS.dojoMultiplier
    ))) {
      scopes.add(LEADERBOARD_REBUILD_SCOPE.match);
      scopes.add(LEADERBOARD_REBUILD_SCOPE.lobby);
      continue;
    }
    if (store === STORES.contribution) {
      scopes.add(LEADERBOARD_REBUILD_SCOPE.contribution);
      continue;
    }
    if (store === STORES.player && playerSummaryChanged(operation)) {
      scopes.add(LEADERBOARD_REBUILD_SCOPE.match);
      scopes.add(LEADERBOARD_REBUILD_SCOPE.lobby);
      scopes.add(LEADERBOARD_REBUILD_SCOPE.contribution);
    }
  }
  return [...scopes];
}

export function leaderboardScopesForStores(stores = []) {
  return leaderboardScopesForOperations((stores || []).map((store) => ({
    type: 'replace-store',
    store,
  })));
}

export function queueLeaderboardRebuildForOperations(
  databaseConnection,
  operations,
  reason = 'committed-store-mutation',
) {
  const scopes = leaderboardScopesForOperations(operations);
  if (!scopes.length) return Promise.resolve(null);
  return queueMaterializedLeaderboardRebuild(databaseConnection, { scopes, reason });
}

export function queueLeaderboardRebuildForStores(databaseConnection, stores, reason = 'committed-store-mutation') {
  const operations = (stores || []).map((store) => ({ type: 'replace-store', store }));
  return queueLeaderboardRebuildForOperations(databaseConnection, operations, reason);
}
