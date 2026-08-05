import {
  EVENT,
  MATCH_STATUS,
  STORES,
} from '@domain/constants.js';
import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';
import {
  getMatchTeams,
} from '@domain/matches/MatchContracts.js';
import {
  buildPlayerEloTimeline,
  getReliableMatchCompletionIGT,
  projectPlayerEloTimeline,
  withPlayerMatchResult,
} from '@domain/matches/IGT.js';
import {
  isDerivedCacheMetadata,
  readStaleWhileRevalidate,
  sourceVersionsForRecordGroups,
  withDerivedCacheMetadata,
} from '@shared/cache/DerivedCache.js';
import { getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';
// v13 retains rated-participation evidence for legacy matches and a compact
// Contribution ledger. Both leaderboards are projected at the viewer's exact
// IGT rather than mixing current totals with a historical profile view.
export const MATERIALIZED_LEADERBOARD_SCHEMA_VERSION = 13;
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
const lobbyProjectionCacheByConnection = new WeakMap();

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
    baseElo: Math.max(0, Number(player.igtBaseElo ?? player.elo ?? 0)),
    activeTitle: player.activeCosmetics?.title || player.activeTitle || null,
    isGenerated: !!player.isGenerated,
  };
}

function matchParticipantSummaries(matches = []) {
  const byUUID = new Map();
  for (const match of [...(matches || [])].sort((left, right) => (
    matchTimelineIGT(left) - matchTimelineIGT(right)
  ))) {
    for (const participant of getMatchTeams(match).flat()) {
      const summary = toParticipantSummary(participant);
      if (!summary) continue;
      const previous = byUUID.get(summary.UUID);
      byUUID.set(summary.UUID, {
        ...(previous || {}),
        ...summary,
        username: summary.username === 'Unknown'
          ? previous?.username || summary.username
          : summary.username,
        profilePicture: summary.profilePicture || previous?.profilePicture || null,
        isGenerated: summary.isGenerated || previous?.isGenerated || false,
      });
    }
  }
  return [...byUUID.values()];
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

function nonNegativeNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function completedTaskPoints(tasks = []) {
  const totalByPlayer = {};
  const dailyByPlayer = {};
  for (const task of tasks || []) {
    const parent = cleanId(task?.parent);
    if (!parent || !task?.completedAt) continue;
    // Historical task documents may contain fractional or multiplied display
    // values. The universal ledger is whole, direct-work points only.
    const points = getCanonicalTaskPoints(task);
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

function contributionEventsByPlayer(contributions = []) {
  const byPlayer = {};
  for (const [index, row] of (contributions || []).entries()) {
    const parent = cleanId(row?.parent || row?.playerUUID);
    if (!parent) continue;
    const inGameTimestamp = Number(row?.inGameTimestamp);
    if (!byPlayer[parent]) byPlayer[parent] = [];
    byPlayer[parent].push({
      UUID: String(row?.UUID || `${parent}:contribution:${index}`),
      inGameTimestamp: Number.isFinite(inGameTimestamp) ? Math.max(0, inGameTimestamp) : 0,
      value: Number(row?.value || row?.contribution || 0),
    });
  }
  for (const events of Object.values(byPlayer)) {
    events.sort((left, right) => (
      left.inGameTimestamp - right.inGameTimestamp
      || left.UUID.localeCompare(right.UUID)
    ));
  }
  return byPlayer;
}

function matchTimelineIGT(match) {
  const completed = getReliableMatchCompletionIGT(match);
  if (completed != null) return completed;
  const started = Number(match?.inGameTimestamp);
  return Number.isFinite(started) ? Math.max(0, started) : 0;
}

function matchSort(left, right) {
  return matchTimelineIGT(right) - matchTimelineIGT(left)
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
    rulesetId: projected.rulesetId || projected.rulesSnapshot?.rulesetId || null,
    ratingMode: projected.ratingMode ?? null,
    duration: Number(projected.duration || 0),
    teams: getMatchTeams(projected).map((team) => (
      (team || []).map(toParticipantSummary).filter(Boolean)
    )),
    createdAt: projected.createdAt || null,
    inGameTimestamp: Number(projected.inGameTimestamp || 0),
    completedInGameTimestamp: matchTimelineIGT(projected),
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
      eloChange: projected.result.eloChange == null ? null : Number(projected.result.eloChange),
      oldElo: projected.result.oldElo == null ? null : Number(projected.result.oldElo),
      newElo: projected.result.newElo == null ? null : Number(projected.result.newElo),
      playerEloChanges: Object.fromEntries(
        Object.entries(projected.result.playerEloChanges || {}).map(([UUID, change]) => [
          UUID,
          {
            oldElo: change?.oldElo == null ? null : Number(change.oldElo),
            newElo: change?.newElo == null ? null : Number(change.newElo),
            change: Number(change?.change || 0),
          },
        ]),
      ),
    } : null,
  };
}

function materializeMatchHistory(matches = [], playerUUID) {
  return (matches || [])
    .filter((match) => (match.participantUUIDs || []).some((UUID) => String(UUID) === String(playerUUID)))
    .sort(matchSort)
    .map((match) => matchSummaryForPlayer(match, playerUUID));
}

function ratedResultSort(left, right) {
  return Number(left.completedIGT || 0) - Number(right.completedIGT || 0)
    || String(left.concludedAt || '').localeCompare(String(right.concludedAt || ''))
    || String(left.matchUUID || '').localeCompare(String(right.matchUUID || ''));
}

export function buildMatchLeaderboardSnapshot({
  players = [],
  matches = [],
  tasks = [],
  friendships = [],
  events = [],
  generatedAt = isoNow(),
} = {}) {
  const participantSummaries = (players || []).map(toParticipantSummary).filter(Boolean);
  const playerByUUID = new Map((players || []).map((player) => [String(player.UUID), player]));
  const fellowByUUID = new Map(
    matchParticipantSummaries(matches).map((participant) => [String(participant.UUID), participant]),
  );
  for (const participant of participantSummaries) {
    fellowByUUID.set(String(participant.UUID), {
      ...(fellowByUUID.get(String(participant.UUID)) || {}),
      ...participant,
    });
  }
  const fellowSummaries = [...fellowByUUID.values()].sort(stableParticipantSort);
  const points = completedTaskPoints(tasks);
  const allPlayerUUIDs = participantSummaries.map((player) => player.UUID);
  const matchSummariesByPlayer = {};
  const eloTimelineByPlayer = {};
  const activeMatchUUIDByPlayer = {};

  for (const playerUUID of fellowSummaries.map((player) => player.UUID)) {
    const fellow = playerByUUID.get(playerUUID) || fellowByUUID.get(playerUUID);
    eloTimelineByPlayer[playerUUID] = buildPlayerEloTimeline(fellow, matches, {
      reconcileCurrent: playerByUUID.has(playerUUID),
    });
  }
  for (const playerUUID of allPlayerUUIDs) {
    matchSummariesByPlayer[playerUUID] = materializeMatchHistory(matches, playerUUID);
  }
  for (const match of matches || []) {
    if (![MATCH_STATUS.pending, MATCH_STATUS.active].includes(match?.status)) continue;
    for (const playerUUID of match.participantUUIDs || []) {
      if (!activeMatchUUIDByPlayer[playerUUID]) activeMatchUUIDByPlayer[playerUUID] = match.UUID;
    }
  }

  return withDerivedCacheMetadata({
    schemaVersion: MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
    updatedAt: generatedAt,
    participantSummaries,
    fellowSummaries,
    globalRankedUUIDs: rankedPlayerUUIDs(
      participantSummaries.filter((player) => eloTimelineByPlayer[player.UUID]?.ratedResults?.length),
      (player) => eloTimelineByPlayer[player.UUID].ratedResults.at(-1)?.newElo,
    ),
    pointsRankedUUIDs: rankedPlayerUUIDs(participantSummaries, (player) => points.totalByPlayer[player.UUID] || 0),
    pointsByPlayer: points.totalByPlayer,
    dailyPointsByPlayer: points.dailyByPlayer,
    friendUUIDsByPlayer: acceptedFriendshipsByPlayer(friendships),
    matchSummariesByPlayer,
    activeMatchUUIDByPlayer,
    eloTimelineByPlayer,
    scheduleByPlayer: latestScheduleByPlayer(events),
  }, {
    generatedAt,
    sourceVersions: sourceVersionsForRecordGroups({
      profiles: players,
      matches,
      tasks,
      social: friendships,
      dailyLifecycle: events,
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
  const ledgerByPlayer = contributionEventsByPlayer(contributions);
  return withDerivedCacheMetadata({
    schemaVersion: MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
    updatedAt: generatedAt,
    participantSummaries,
    totalsByPlayer,
    ledgerByPlayer,
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
    fellowSummaries: [],
    globalRankedUUIDs: [],
    pointsRankedUUIDs: [],
    pointsByPlayer: {},
    dailyPointsByPlayer: {},
    friendUUIDsByPlayer: {},
    matchSummariesByPlayer: {},
    activeMatchUUIDByPlayer: {},
    eloTimelineByPlayer: {},
    scheduleByPlayer: {},
  }, { sourceVersions: {}, generatedAt: null });
}

function emptyContributionSnapshot() {
  return withDerivedCacheMetadata({
    schemaVersion: MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
    updatedAt: null,
    participantSummaries: [],
    totalsByPlayer: {},
    ledgerByPlayer: {},
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

function viewerBoundary(viewerIGT) {
  const value = Number(viewerIGT);
  return Number.isFinite(value) ? Math.max(0, value) : Infinity;
}

/** Pure Contribution projection using the same IGT boundary as profile and Elo views. */
export function projectContributionLeaderboardAtIGT(snapshot, {
  viewerIGT = Infinity,
} = {}) {
  const boundary = viewerBoundary(viewerIGT);
  const participants = snapshot?.participantSummaries || [];
  const ledger = snapshot?.ledgerByPlayer || {};
  const totalsByPlayer = Object.fromEntries(participants.map(({ UUID }) => {
    const events = ledger[String(UUID)];
    if (!Array.isArray(events)) {
      // Compatibility fallback is only reachable for an already-materialized
      // snapshot in memory during a schema upgrade; v13 rebuilds immediately.
      return [String(UUID), boundary === Infinity
        ? Math.max(0, Number(snapshot?.totalsByPlayer?.[UUID]) || 0)
        : 0];
    }
    return [String(UUID), events.reduce((total, event) => (
      Number(event?.inGameTimestamp || 0) <= boundary
        ? total + Number(event?.value || 0)
        : total
    ), 0)];
  }));
  return {
    ...snapshot,
    totalsByPlayer,
    rankedUUIDs: rankedPlayerUUIDs(participants, (player) => totalsByPlayer[player.UUID] || 0),
    viewerIGT: boundary,
  };
}

function visibleMatchTimestamp(match) {
  if (match?.status === MATCH_STATUS.complete) return matchTimelineIGT(match);
  return Number(match?.inGameTimestamp || 0);
}

function projectEloHistory(timeline = {}, boundary = Infinity) {
  return projectPlayerEloTimeline(timeline, boundary).eloHistory;
}

/** Pure historical projection of a temporal match snapshot at the viewer's IGT. */
export function projectMatchLeaderboardAtIGT(snapshot, {
  viewerIGT = Infinity,
  playerUUID = null,
} = {}) {
  const boundary = viewerBoundary(viewerIGT);
  const playerId = cleanId(playerUUID);
  const projectParticipant = (participant) => {
    const timeline = snapshot?.eloTimelineByPlayer?.[participant.UUID] || {};
    const baseElo = Math.max(0, Number(timeline.baseElo ?? participant.baseElo ?? participant.elo ?? 0));
    const projectedTimeline = projectPlayerEloTimeline(timeline, boundary);
    return {
      ...participant,
      baseElo,
      elo: projectedTimeline.elo,
      hasVisibleRating: projectedTimeline.hasVisibleRating,
      firstRatedIGT: projectedTimeline.firstRatedIGT,
    };
  };
  const participants = (snapshot?.participantSummaries || []).map(projectParticipant);
  const fellows = (snapshot?.fellowSummaries || snapshot?.participantSummaries || [])
    .map(projectParticipant);
  const participantByUUID = new Map(participants.map((participant) => [String(participant.UUID), participant]));
  const ratedParticipants = participants.filter((participant) => participant.hasVisibleRating);
  const globalRankedUUIDs = rankedPlayerUUIDs(ratedParticipants, (participant) => participant.elo);
  const friendUUIDs = playerId ? snapshot?.friendUUIDsByPlayer?.[playerId] || [] : [];
  const friendSet = new Set(friendUUIDs.map(String));
  const friendRankedUUIDs = globalRankedUUIDs.filter((UUID) => friendSet.has(String(UUID)));
  const friendRatings = friendRankedUUIDs
    .map((UUID) => participantByUUID.get(String(UUID)))
    .filter(Boolean)
    .map(({ UUID, username, profilePicture, elo }) => ({
      UUID,
      username,
      profilePicture,
      elo,
      eloHistory: projectEloHistory(snapshot?.eloTimelineByPlayer?.[UUID], boundary),
    }));
  const fellowRatings = fellows
    .filter((participant) => (
      String(participant.UUID) !== String(playerId)
      && participant.hasVisibleRating
    ))
    .map(({ UUID, username, profilePicture, elo, isGenerated }) => ({
      UUID,
      username,
      profilePicture,
      elo,
      isGenerated,
      eloHistory: projectEloHistory(snapshot?.eloTimelineByPlayer?.[UUID], boundary),
    }))
    .filter((participant) => participant.eloHistory.length >= 2)
    .sort((left, right) => (
      right.elo - left.elo
      || stableParticipantSort(left, right)
    ));
  const viewer = playerId ? participantByUUID.get(playerId) || null : null;
  const eloHistory = playerId
    ? projectEloHistory(snapshot?.eloTimelineByPlayer?.[playerId], boundary)
    : [];
  const matchHistory = playerId
    ? (snapshot?.matchSummariesByPlayer?.[playerId] || [])
      .filter((match) => visibleMatchTimestamp(match) <= boundary)
      .sort(matchSort)
      .slice(0, 4)
    : [];

  return {
    participants,
    globalRankedUUIDs,
    friendRankedUUIDs,
    friendRatings,
    fellowRatings,
    friendUUIDs,
    eloHistory,
    matchHistory,
    viewerRating: viewer?.elo ?? null,
    viewerHasVisibleRating: !!viewer?.hasVisibleRating,
  };
}

function cachedLobbyProjection(databaseConnection, snapshot, playerUUID, viewerIGT) {
  let cache = lobbyProjectionCacheByConnection.get(databaseConnection);
  if (!cache) {
    cache = new Map();
    lobbyProjectionCacheByConnection.set(databaseConnection, cache);
  }
  const boundary = viewerBoundary(viewerIGT);
  // Rank visibility is an exact IGT boundary. Minute bucketing can retain a
  // projection that includes (or excludes) a result on the wrong side of the
  // viewer's current cursor until the next wall-clock minute.
  const exactBoundary = Number.isFinite(boundary) ? Math.trunc(boundary) : 'all';
  const key = `${snapshot?.updatedAt || 'empty'}:${cleanId(playerUUID) || 'none'}:${exactBoundary}`;
  if (!cache.has(key)) {
    cache.set(key, projectMatchLeaderboardAtIGT(snapshot, { viewerIGT: boundary, playerUUID }));
    while (cache.size > 48) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

export async function readLobbyMaterializedData(databaseConnection, playerUUID, viewerIGT = Infinity) {
  const snapshots = await readMaterializedLeaderboardSnapshotsSWR(databaseConnection);
  const playerId = cleanId(playerUUID);
  const projection = cachedLobbyProjection(databaseConnection, snapshots.match, playerId, viewerIGT);
  const contributionProjection = projectContributionLeaderboardAtIGT(
    snapshots.contribution,
    { viewerIGT },
  );
  const participantMap = new Map();
  for (const participant of [
    ...(snapshots.contribution.participantSummaries || []),
    ...projection.participants,
  ]) {
    if (participant?.UUID) participantMap.set(String(participant.UUID), participant);
  }
  return {
    ...snapshots,
    contribution: contributionProjection,
    match: {
      ...snapshots.match,
      globalRankedUUIDs: projection.globalRankedUUIDs,
    },
    participants: [...participantMap.values()],
    playerUUID: playerId,
    matchHistory: projection.matchHistory,
    activeMatchUUID: playerId ? snapshots.match.activeMatchUUIDByPlayer?.[playerId] || null : null,
    scheduleStage: playerId ? snapshots.match.scheduleByPlayer?.[playerId] || null : null,
    friendUUIDs: projection.friendUUIDs,
    eloHistory: projection.eloHistory,
    globalRankedUUIDs: projection.globalRankedUUIDs,
    friendRankedUUIDs: projection.friendRankedUUIDs,
    friendRatings: projection.friendRatings,
    fellowRatings: projection.fellowRatings,
    viewerRating: projection.viewerRating,
    viewerHasVisibleRating: projection.viewerHasVisibleRating,
    todayPoints: playerId
      ? Number(snapshots.match.dailyPointsByPlayer?.[playerId]?.[localDayKey()] || 0)
      : 0,
    totalPoints: playerId
      ? Math.floor(Number(snapshots.match.pointsByPlayer?.[playerId] || 0))
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
    domains.add('dailyLifecycle');
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
    const [profileRows, matches, tasks, friendships, events] = await Promise.all([
      getPlayers(),
      databaseConnection.getAll(STORES.match),
      databaseConnection.getAll(STORES.task),
      databaseConnection.getAll(STORES.friendship),
      databaseConnection.getAll(STORES.event),
    ]);
    matchSnapshot = buildMatchLeaderboardSnapshot({
      players: profileRows,
      matches,
      tasks,
      friendships,
      events,
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
