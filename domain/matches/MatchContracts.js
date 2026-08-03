import { buildProfileIdentity } from '../profile/ProfileIdentity.js';

export const MATCH_PARTICIPANT_SNAPSHOT_VERSION = 2;
export const MATCH_RULES_SNAPSHOT_VERSION = 1;

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableClone(value[key])]),
  );
}

function hashString(value = '') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function snapshotHash(value) {
  return hashString(JSON.stringify(stableClone(value)));
}

function compactReplayTrace(trace) {
  if (!trace?.sessions?.length) return null;
  return {
    sourceMatchUUID: trace.sourceMatchUUID || null,
    durationMs: Math.max(0, Number(trace.durationMs) || 0),
    totalPoints: Math.max(0, Number(trace.totalPoints) || 0),
    sessions: trace.sessions.map((session) => ({
      startOffset: Math.max(0, Number(session.startOffset) || 0),
      endOffset: Math.max(0, Number(session.endOffset) || 0),
      points: Number(session.points) || 0,
      name: session.name || 'working',
    })),
  };
}

export function createMatchParticipantSnapshot(player = {}, {
  teamIndex = null,
  isCurrentPlayer = false,
  snapshotAt = null,
} = {}) {
  const identity = buildProfileIdentity(player, { snapshotAt });
  return {
    UUID: String(player.UUID || ''),
    username: identity.username,
    profilePicture: identity.profilePicture,
    elo: identity.elo,
    title: identity.title,
    frame: identity.frame,
    theme: identity.theme,
    rankLabel: identity.rankLabel,
    snapshotAt: identity.snapshotAt,
    teamIndex: Number.isInteger(teamIndex) ? teamIndex : null,
    isCurrentPlayer: !!(isCurrentPlayer || player.isCurrentPlayer),
    isGenerated: !!player.isGenerated,
    generatedSeed: player.generatedSeed ?? null,
    estimatedTotal: Math.max(0, Number(player.estimatedTotal) || 0),
    pointsPerMs: Math.max(0, Number(player.pointsPerMs) || 0),
    replayTrace: compactReplayTrace(player.replayTrace),
    recentTaskNames: Array.isArray(player.recentTaskNames)
      ? player.recentTaskNames.filter(Boolean).slice(0, 15)
      : [],
    playerTheme: identity.theme,
    cardBanner: player.cardBanner ?? player.activeCosmetics?.cardBanner ?? null,
    activeTitle: identity.title,
    selectedAchievements: Array.isArray(player.selectedAchievements)
      ? [...player.selectedAchievements]
      : [],
  };
}

export function createMatchParticipantRoster(teams = [], createdAt = new Date().toISOString()) {
  const normalizedTeams = (teams || []).map((team, teamIndex) => (
    (team || [])
      .map((player) => createMatchParticipantSnapshot(player, {
        teamIndex,
        isCurrentPlayer: !!player?.isCurrentPlayer,
        snapshotAt: createdAt,
      }))
      .filter((player) => player.UUID)
  ));
  const participants = normalizedTeams.flat();
  const body = {
    schemaVersion: MATCH_PARTICIPANT_SNAPSHOT_VERSION,
    createdAt,
    teamUUIDs: normalizedTeams.map((team) => team.map((player) => player.UUID)),
    participants,
  };
  return Object.freeze({ ...body, hash: snapshotHash(body) });
}

export function createMatchRulesSnapshot({
  durationHours,
  createdAt = new Date().toISOString(),
  inGameTimestamp = 0,
  scoreModel = 'completed-task-points-v1',
  eloModel = 'team-contribution-v1',
  ghostModel = 'replay-or-rate-v1',
  forfeitPolicy = 'forced-team-loss-v1',
} = {}) {
  const body = {
    schemaVersion: MATCH_RULES_SNAPSHOT_VERSION,
    createdAt,
    durationHours: Math.max(0, Number(durationHours) || 0),
    inGameTimestamp: Math.max(0, Number(inGameTimestamp) || 0),
    scoreModel,
    eloModel,
    ghostModel,
    forfeitPolicy,
  };
  return Object.freeze({ ...body, hash: snapshotHash(body) });
}

export function teamsFromParticipantSnapshot(snapshot) {
  if (!snapshot?.participants?.length || !Array.isArray(snapshot.teamUUIDs)) return null;
  const byUUID = new Map(snapshot.participants.map((participant) => [String(participant.UUID), participant]));
  return snapshot.teamUUIDs.map((team) => (
    (team || []).map((uuid) => byUUID.get(String(uuid))).filter(Boolean)
  ));
}

export function getMatchTeams(match) {
  return teamsFromParticipantSnapshot(match?.participantSnapshot)
    || (Array.isArray(match?.teams) ? match.teams : []);
}

export function getMatchRules(match) {
  if (match?.rulesSnapshot) return match.rulesSnapshot;
  return createMatchRulesSnapshot({
    durationHours: match?.duration,
    createdAt: match?.createdAt,
    inGameTimestamp: match?.inGameTimestamp,
  });
}

export function withImmutableMatchSnapshots(match = {}) {
  const createdAt = match.createdAt || new Date().toISOString();
  const participantSnapshot = match.participantSnapshot
    || createMatchParticipantRoster(match.teams || [], createdAt);
  const rulesSnapshot = match.rulesSnapshot
    || createMatchRulesSnapshot({
      durationHours: match.duration,
      createdAt,
      inGameTimestamp: match.inGameTimestamp,
    });
  const teams = teamsFromParticipantSnapshot(participantSnapshot) || match.teams || [];
  return {
    ...match,
    duration: rulesSnapshot.durationHours,
    participantUUIDs: Array.from(new Set(participantSnapshot.participants.map((participant) => participant.UUID))),
    participantSnapshot,
    rulesSnapshot,
    teams,
  };
}

export function matchSnapshotsAreIntact(match = {}) {
  const participant = match.participantSnapshot;
  const rules = match.rulesSnapshot;
  if (!participant?.hash || !rules?.hash) return false;
  const participantBody = { ...participant };
  const rulesBody = { ...rules };
  delete participantBody.hash;
  delete rulesBody.hash;
  return snapshotHash(participantBody) === participant.hash
    && snapshotHash(rulesBody) === rules.hash;
}
