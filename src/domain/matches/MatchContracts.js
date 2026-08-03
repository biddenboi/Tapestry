import { buildProfileIdentity } from '../profile/ProfileIdentity.js';

export const MATCH_PARTICIPANT_SNAPSHOT_VERSION = 3;
export const MATCH_RULES_SNAPSHOT_VERSION = 4;
export const MATCH_CONTEXT_SNAPSHOT_VERSION = 1;
export const PAIR_MATCH_RULESET_ID = 'pair_match_v1';
export const LEGACY_MATCH_RULESET_ID = 'legacy_configurable_v2';
export const PAIR_MATCH_DURATION_MS = 60 * 60 * 1000;
export const PAIR_MATCH_TEAM_SIZE = 2;
export const PAIR_MATCH_RATING_RANGE = 400;
export const PAIR_MATCH_MAX_TEAM_RATING_GAP = 150;
export const MATCH_PROMISE_REWARD_POLICY_ID = 'match-promise-v1';
export const MATCH_PROMISE_MAX_SCALAR = 1.5;

export const PAIR_MATCH_V1 = Object.freeze({
  schemaVersion: MATCH_RULES_SNAPSHOT_VERSION,
  rulesetId: PAIR_MATCH_RULESET_ID,
  teamSize: PAIR_MATCH_TEAM_SIZE,
  durationMs: PAIR_MATCH_DURATION_MS,
  ratingPolicy: 'elo-team-average-v1',
  scoreVisibility: 'live-fixed',
  scoringPolicy: 'sum-eligible-task-points',
  contextPolicy: 'profile-projection-snapshot-v1',
  minimumValidActivityMs: 60 * 1000,
  forfeitPolicy: 'forced-team-loss-v1',
  scoreRewardPolicy: MATCH_PROMISE_REWARD_POLICY_ID,
  maxPromiseScalar: MATCH_PROMISE_MAX_SCALAR,
});

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

function compactContextProjection(projection) {
  if (!projection) return null;
  const compactItems = (items = []) => items.slice(0, 8).map((item) => ({
    id: item.id || null,
    type: item.type || null,
    text: item.text || '',
    tentative: item.tentative === true,
    expiresAt: item.expiresAt || null,
    freshness: item.freshness || null,
  }));
  return {
    contractVersion: Number(projection.contractVersion) || 1,
    subjectId: projection.subjectId || null,
    viewerTier: projection.viewerTier || 'outside',
    asOfIGT: Math.max(0, Number(projection.asOfIGT) || 0),
    reason: projection.reason || null,
    chapter: projection.chapter ? {
      text: projection.chapter.text || '',
      tentative: projection.chapter.tentative === true,
    } : null,
    now: compactItems(projection.now),
    near: compactItems(projection.near),
    recent: compactItems(projection.recent),
    goals: compactItems(projection.goals),
    showUp: compactItems(projection.showUp),
    availability: compactItems(projection.availability),
    capsule: compactItems(projection.capsule).slice(0, 3),
  };
}

function compactReplayTrace(trace) {
  if (!trace?.sessions?.length) return null;
  return {
    sourceMatchUUID: trace.sourceMatchUUID || null,
    durationMs: Math.max(0, Number(trace.durationMs) || 0),
    totalPoints: Math.max(0, Math.floor(Number(trace.totalPoints) || 0)),
    sessions: trace.sessions.map((session) => ({
      startOffset: Math.max(0, Number(session.startOffset) || 0),
      endOffset: Math.max(0, Number(session.endOffset) || 0),
      points: Math.max(0, Math.floor(Number(session.points) || 0)),
      name: session.name || 'working',
    })),
  };
}

export function createMatchParticipantSnapshot(player = {}, {
  teamIndex = null,
  isCurrentPlayer = false,
  snapshotAt = null,
  matchRole = player.matchRole || null,
  matchContext = player.matchContext || null,
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
    profileTheme: player.profileTheme ?? player.activeCosmetics?.profileTheme ?? identity.theme,
    avatarFrame: player.avatarFrame ?? player.activeCosmetics?.avatarFrame ?? identity.frame ?? 'default',
    matchCard: player.matchCard ?? player.activeCosmetics?.matchCard ?? 'default',
    standingsRow: player.standingsRow ?? player.activeCosmetics?.standingsRow ?? 'default',
    cardBanner: player.cardBanner ?? player.activeCosmetics?.cardBanner ?? null,
    activeTitle: identity.title,
    selectedAchievements: Array.isArray(player.selectedAchievements)
      ? [...player.selectedAchievements]
      : [],
    matchRole: ['self', 'teammate', 'opponent'].includes(matchRole) ? matchRole : null,
    matchContext: compactContextProjection(matchContext),
  };
}

export function createPairMatchContextSnapshot({
  viewerUUID,
  teams = [],
  projections = new Map(),
  createdAt = new Date().toISOString(),
} = {}) {
  const viewerTeamIndex = teams.findIndex((team) => (team || []).some((player) => (
    String(player?.UUID) === String(viewerUUID || '')
  )));
  const projectionFor = (playerUUID) => (
    projections instanceof Map ? projections.get(String(playerUUID)) : projections?.[String(playerUUID)]
  );
  const participants = teams.flatMap((team, teamIndex) => (team || []).map((player) => {
    const isViewer = String(player?.UUID) === String(viewerUUID || '');
    const role = isViewer ? 'self' : teamIndex === viewerTeamIndex ? 'teammate' : 'opponent';
    return {
      participantUUID: String(player?.UUID || ''),
      role,
      projection: isViewer ? null : compactContextProjection(projectionFor(player?.UUID)),
    };
  })).filter((entry) => entry.participantUUID);
  const body = {
    schemaVersion: MATCH_CONTEXT_SNAPSHOT_VERSION,
    policyId: PAIR_MATCH_V1.contextPolicy,
    createdAt,
    viewerUUID: String(viewerUUID || ''),
    participants,
  };
  return Object.freeze({ ...body, hash: snapshotHash(body) });
}

export function createMatchParticipantRoster(
  teams = [],
  createdAt = new Date().toISOString(),
  { contextSnapshot = null } = {},
) {
  const contextByParticipant = new Map((contextSnapshot?.participants || []).map((entry) => (
    [String(entry.participantUUID), entry]
  )));
  const normalizedTeams = (teams || []).map((team, teamIndex) => (
    (team || [])
      .map((player) => createMatchParticipantSnapshot(player, {
        teamIndex,
        isCurrentPlayer: !!player?.isCurrentPlayer,
        snapshotAt: createdAt,
        matchRole: contextByParticipant.get(String(player?.UUID))?.role,
        matchContext: contextByParticipant.get(String(player?.UUID))?.projection,
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

export function createPairMatchRulesSnapshot({
  createdAt = new Date().toISOString(),
  inGameTimestamp = null,
} = {}) {
  const parsedIGT = inGameTimestamp == null || inGameTimestamp === ''
    ? null
    : Number(inGameTimestamp);
  const body = {
    ...PAIR_MATCH_V1,
    createdAt,
    inGameTimestamp: Number.isFinite(parsedIGT) ? Math.max(0, parsedIGT) : null,
  };
  return Object.freeze({ ...body, hash: snapshotHash(body) });
}

export function createMatchRulesSnapshot({
  durationHours,
  createdAt = new Date().toISOString(),
  inGameTimestamp = null,
  scoreModel = 'completed-task-points-v1',
  eloModel = 'team-contribution-v1',
  ghostModel = 'replay-or-rate-v1',
  forfeitPolicy = 'forced-team-loss-v1',
  mode = null,
  ratingMode = 'unrated',
  scoreVisibility = null,
  checkpointIntervalMs = 30 * 60 * 1000,
  eligibleGoalUUIDs = [],
  eligibleMilestoneUUIDs = [],
  eligibleTaskUUIDs = [],
  allowNewLinkedTasks = true,
  presenceDetail = 'state-only',
  minimumValidActivityMs = 60 * 1000,
} = {}) {
  const parsedIGT = inGameTimestamp == null || inGameTimestamp === ''
    ? null
    : Number(inGameTimestamp);
  const resolvedMode = ['sprint', 'deep', 'team', 'cooperative'].includes(mode)
    ? mode
    : Number(durationHours) <= 0.75 ? 'sprint' : 'deep';
  const resolvedVisibility = ['live', 'checkpoint', 'final-only'].includes(scoreVisibility)
    ? scoreVisibility
    : resolvedMode === 'sprint' ? 'live' : 'checkpoint';
  const body = {
    schemaVersion: 2,
    rulesetId: LEGACY_MATCH_RULESET_ID,
    legacy: true,
    createdAt,
    durationHours: Math.max(0, Number(durationHours) || 0),
    inGameTimestamp: Number.isFinite(parsedIGT) ? Math.max(0, parsedIGT) : null,
    scoreModel,
    eloModel,
    ghostModel,
    forfeitPolicy,
    mode: resolvedMode,
    ratingMode: ratingMode === 'rated' && resolvedMode !== 'cooperative' ? 'rated' : 'unrated',
    scoreVisibility: resolvedVisibility,
    checkpointIntervalMs: Math.max(60_000, Number(checkpointIntervalMs) || 30 * 60 * 1000),
    eligibleGoalUUIDs: [...new Set(eligibleGoalUUIDs.filter(Boolean).map(String))],
    eligibleMilestoneUUIDs: [...new Set(eligibleMilestoneUUIDs.filter(Boolean).map(String))],
    eligibleTaskUUIDs: [...new Set(eligibleTaskUUIDs.filter(Boolean).map(String))],
    allowNewLinkedTasks: Boolean(allowNewLinkedTasks),
    presenceDetail: ['state-only', 'goal', 'task'].includes(presenceDetail)
      ? presenceDetail
      : 'state-only',
    minimumValidActivityMs: Math.max(0, Number(minimumValidActivityMs) || 0),
    scoreRewardPolicy: MATCH_PROMISE_REWARD_POLICY_ID,
    maxPromiseScalar: MATCH_PROMISE_MAX_SCALAR,
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
  if (match?.rulesetId === PAIR_MATCH_RULESET_ID) {
    return createPairMatchRulesSnapshot({
      createdAt: match?.createdAt,
      inGameTimestamp: match?.inGameTimestamp,
    });
  }
  return createMatchRulesSnapshot({
    durationHours: match?.duration,
    createdAt: match?.createdAt,
    inGameTimestamp: match?.inGameTimestamp,
    mode: match?.mode,
    ratingMode: match?.ratingMode,
    scoreVisibility: match?.scoreVisibility,
    checkpointIntervalMs: match?.checkpointIntervalMs,
    eligibleGoalUUIDs: match?.eligibleGoalUUIDs,
    eligibleMilestoneUUIDs: match?.eligibleMilestoneUUIDs,
    eligibleTaskUUIDs: match?.eligibleTaskUUIDs,
    allowNewLinkedTasks: match?.allowNewLinkedTasks,
    presenceDetail: match?.presenceDetail,
    minimumValidActivityMs: match?.minimumValidActivityMs,
  });
}

export function isPairMatch(match) {
  return getMatchRules(match)?.rulesetId === PAIR_MATCH_RULESET_ID;
}

export function getMatchDurationMs(match) {
  const rules = getMatchRules(match);
  if (Number.isFinite(Number(rules?.durationMs))) return Math.max(0, Number(rules.durationMs));
  if (Number.isFinite(Number(rules?.durationHours))) {
    return Math.max(0, Number(rules.durationHours) * 60 * 60 * 1000);
  }
  return Math.max(0, Number(match?.duration) || 0) * 60 * 60 * 1000;
}

export function getMatchDurationHours(match) {
  return getMatchDurationMs(match) / (60 * 60 * 1000);
}

export function withImmutableMatchSnapshots(match = {}) {
  const createdAt = match.createdAt || new Date().toISOString();
  const rulesSnapshot = match.rulesSnapshot
    || (match.rulesetId === PAIR_MATCH_RULESET_ID
      ? createPairMatchRulesSnapshot({
          createdAt,
          inGameTimestamp: match.inGameTimestamp,
        })
      : createMatchRulesSnapshot({
          durationHours: match.duration,
          createdAt,
          inGameTimestamp: match.inGameTimestamp,
          mode: match.mode,
          ratingMode: match.ratingMode,
          scoreVisibility: match.scoreVisibility,
          checkpointIntervalMs: match.checkpointIntervalMs,
          eligibleGoalUUIDs: match.eligibleGoalUUIDs,
          eligibleMilestoneUUIDs: match.eligibleMilestoneUUIDs,
          eligibleTaskUUIDs: match.eligibleTaskUUIDs,
          allowNewLinkedTasks: match.allowNewLinkedTasks,
          presenceDetail: match.presenceDetail,
          minimumValidActivityMs: match.minimumValidActivityMs,
        }));
  const contextSnapshot = match.contextSnapshot || null;
  const participantSnapshot = match.participantSnapshot
    || createMatchParticipantRoster(match.teams || [], createdAt, { contextSnapshot });
  const teams = teamsFromParticipantSnapshot(participantSnapshot) || match.teams || [];
  const canonical = {
    ...match,
    rulesetId: rulesSnapshot.rulesetId || LEGACY_MATCH_RULESET_ID,
    participantUUIDs: Array.from(new Set(participantSnapshot.participants.map((participant) => participant.UUID))),
    participantSnapshot,
    rulesSnapshot,
    contextSnapshot,
    teams,
  };
  if (rulesSnapshot.rulesetId !== PAIR_MATCH_RULESET_ID) {
    canonical.legacyRules = match.legacyRules || {
      schemaVersion: rulesSnapshot.schemaVersion,
      rulesetId: rulesSnapshot.rulesetId,
      mode: rulesSnapshot.mode,
      ratingMode: rulesSnapshot.ratingMode,
      scoreVisibility: rulesSnapshot.scoreVisibility,
      checkpointIntervalMs: rulesSnapshot.checkpointIntervalMs,
      durationHours: rulesSnapshot.durationHours,
    };
    canonical.duration = rulesSnapshot.durationHours;
    canonical.mode = rulesSnapshot.mode;
    canonical.ratingMode = rulesSnapshot.ratingMode;
    canonical.scoreVisibility = rulesSnapshot.scoreVisibility;
  }
  return canonical;
}

export function matchSnapshotsAreIntact(match = {}) {
  const participant = match.participantSnapshot;
  const rules = match.rulesSnapshot;
  if (!participant?.hash || !rules?.hash) return false;
  const participantBody = { ...participant };
  const rulesBody = { ...rules };
  delete participantBody.hash;
  delete rulesBody.hash;
  const context = match.contextSnapshot;
  const contextBody = context ? { ...context } : null;
  if (contextBody) delete contextBody.hash;
  return snapshotHash(participantBody) === participant.hash
    && snapshotHash(rulesBody) === rules.hash
    && (!context || (context.hash && snapshotHash(contextBody) === context.hash));
}
