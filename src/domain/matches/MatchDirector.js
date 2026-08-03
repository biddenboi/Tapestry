import { MINUTE } from '@domain/constants.js';

const BIG_COMPLETION_POINTS = 120;

const toFiniteNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const getPlayerName = (snapshot, uuid) => (
  snapshot?.playersByUUID?.[uuid]?.username
  || snapshot?.playersByUUID?.[uuid]?.name
  || 'A player'
);

const getTeamLabel = (snapshot, teamIdx) => {
  if (teamIdx == null) return 'the match';
  return teamIdx === snapshot.currentPlayerTeamIdx ? 'Your team' : 'Opposition';
};

function hasRecentEvent(events, dedupeKey, cooldownMs, now) {
  return (events || []).some((event) => (
    event?.dedupeKey === dedupeKey
    && now - toFiniteNumber(event.createdAt) < cooldownMs
  ));
}

function makeEvent(payload, now, ordinal) {
  return {
    id: `${payload.type}-${now}-${ordinal}`,
    severity: 'info',
    createdAt: now,
    ttlMs: 60 * 1000,
    ...payload,
  };
}

function timelineFields(snapshot, elapsedMs = snapshot?.elapsedMs) {
  const safeElapsedMs = Math.max(0, toFiniteNumber(elapsedMs));
  const rawStartMs = snapshot?.matchCreatedAtMs;
  const startMs = rawStartMs == null ? null : toFiniteNumber(rawStartMs, null);
  return {
    matchElapsedMs: safeElapsedMs,
    timelineAt: startMs == null ? null : new Date(startMs + safeElapsedMs).toISOString(),
  };
}

function pushEvent(
  events,
  recentEvents,
  now,
  snapshot,
  payload,
  cooldownMs,
  elapsedMs = snapshot?.elapsedMs,
) {
  if (hasRecentEvent([...events, ...recentEvents], payload.dedupeKey, cooldownMs, now)) return;
  events.push(makeEvent({
    ...payload,
    ...timelineFields(snapshot, elapsedMs),
  }, now, events.length));
}

function getGapReduction(previousSnapshot, currentSnapshot) {
  const previousGap = Math.abs(toFiniteNumber(previousSnapshot.scoreDelta));
  const currentGap = Math.abs(toFiniteNumber(currentSnapshot.scoreDelta));
  return previousGap - currentGap;
}

function shouldAnnounceCloseMatch(previousSnapshot, currentSnapshot) {
  if (currentSnapshot.closeness !== 'close' || currentSnapshot.scoreGap <= 0) return false;
  if (previousSnapshot.closeness !== 'close') return true;
  const previousGap = toFiniteNumber(previousSnapshot.scoreGap);
  const currentGap = toFiniteNumber(currentSnapshot.scoreGap);
  return Math.abs(currentGap - previousGap) >= Math.max(75, previousGap * 0.25);
}

export function deriveMatchEvents(previousSnapshot, currentSnapshot, recentEvents = [], options = {}) {
  if (!previousSnapshot || !currentSnapshot) return [];

  const now = toFiniteNumber(options.now, Date.now());
  const events = [];
  const myTeamIdx = currentSnapshot.currentPlayerTeamIdx;
  const enemyTeamIdx = currentSnapshot.currentPlayerOpponentTeamIdx;

  if (
    previousSnapshot.leaderTeamIdx !== currentSnapshot.leaderTeamIdx
    && currentSnapshot.leaderTeamIdx != null
  ) {
    const leadingTeam = getTeamLabel(currentSnapshot, currentSnapshot.leaderTeamIdx);
    const severity = currentSnapshot.leaderTeamIdx === myTeamIdx ? 'success' : 'warning';
    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'lead_change',
      severity,
      message: `${leadingTeam} took the lead by ${currentSnapshot.scoreGap.toLocaleString()}.`,
      teamIdx: currentSnapshot.leaderTeamIdx,
      playerUUID: null,
      dedupeKey: `lead-change-${currentSnapshot.leaderTeamIdx}`,
      ttlMs: 45 * 1000,
    }, 20 * 1000);
  }

  if (shouldAnnounceCloseMatch(previousSnapshot, currentSnapshot)) {
    const gapBucket = Math.max(1, Math.round(currentSnapshot.scoreGap / 100));
    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'close_match',
      severity: currentSnapshot.phase === 'endgame' ? 'warning' : 'info',
      message: currentSnapshot.phase === 'endgame'
        ? `Final stretch. Match is within ${currentSnapshot.scoreGap.toLocaleString()} points.`
        : `Close match. Only ${currentSnapshot.scoreGap.toLocaleString()} points separate the teams.`,
      teamIdx: null,
      playerUUID: null,
      dedupeKey: `close-match-${currentSnapshot.phase}-${gapBucket}`,
      ttlMs: 50 * 1000,
    }, currentSnapshot.phase === 'endgame' ? 5 * MINUTE : 12 * MINUTE);
  }

  const gapReduction = getGapReduction(previousSnapshot, currentSnapshot);
  if (
    currentSnapshot.leaderTeamIdx != null
    && previousSnapshot.leaderTeamIdx === currentSnapshot.leaderTeamIdx
    && gapReduction >= Math.max(100, Math.abs(previousSnapshot.scoreDelta) * 0.35)
  ) {
    const trailingTeamIdx = currentSnapshot.leaderTeamIdx === 0 ? 1 : 0;
    const severity = trailingTeamIdx === myTeamIdx ? 'success' : 'warning';
    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'comeback_warning',
      severity,
      message: `${getTeamLabel(currentSnapshot, trailingTeamIdx)} cut the deficit by ${Math.round(gapReduction).toLocaleString()}.`,
      teamIdx: trailingTeamIdx,
      playerUUID: null,
      dedupeKey: `comeback-${trailingTeamIdx}`,
      ttlMs: 55 * 1000,
    }, 3 * MINUTE);
  }

  Object.keys(currentSnapshot.scoresByUUID || {}).forEach((uuid) => {
    const delta = toFiniteNumber(currentSnapshot.scoresByUUID[uuid])
      - toFiniteNumber(previousSnapshot.scoresByUUID?.[uuid]);
    if (delta < BIG_COMPLETION_POINTS) return;

    const teamIdx = currentSnapshot.playerTeamIdxByUUID?.[uuid];
    const name = getPlayerName(currentSnapshot, uuid);
    const currentActivity = currentSnapshot.playerStatesByUUID?.[uuid];
    const previousActivity = previousSnapshot.playerStatesByUUID?.[uuid];
    if (currentActivity?.confidence === 'estimated' && !currentActivity?.isReplayBased) return;
    const taskName = currentActivity?.lastCompletedTaskName
      || previousActivity?.taskName
      || currentActivity?.taskName
      || null;
    const severity = teamIdx === myTeamIdx ? 'success' : 'warning';
    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'big_completion',
      severity,
      message: `${name} completed a big task for +${Math.floor(delta).toLocaleString()}.`,
      teamIdx,
      playerUUID: uuid,
      points: Math.floor(delta),
      taskName,
      dedupeKey: `big-completion-${uuid}-${Math.round(toFiniteNumber(currentSnapshot.scoresByUUID[uuid]))}`,
      ttlMs: 65 * 1000,
    }, 30 * 1000, currentActivity?.lastCompletedOffsetMs ?? currentSnapshot.elapsedMs);
  });

  Object.entries(currentSnapshot.playerStatesByUUID || {}).forEach(([uuid, activity]) => {
    const teamIdx = currentSnapshot.playerTeamIdxByUUID?.[uuid];
    if (teamIdx !== enemyTeamIdx) return;
    const eta = Number(activity?.timeToCompletionMs);
    if (
      activity?.status !== 'charging'
      || toFiniteNumber(activity.pendingPoints) < 140
      || !Number.isFinite(eta)
      || eta > 14 * MINUTE
    ) return;

    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'enemy_pending_score',
      severity: 'warning',
      message: `${getPlayerName(currentSnapshot, uuid)} is close to a +${Math.floor(activity.pendingPoints).toLocaleString()} task.`,
      teamIdx,
      playerUUID: uuid,
      dedupeKey: `enemy-pending-${uuid}`,
      ttlMs: 55 * 1000,
    }, 8 * MINUTE);
  });

  const myActivity = currentSnapshot.teamActivity?.[myTeamIdx];
  if (
    myActivity
    && currentSnapshot.leaderTeamIdx === enemyTeamIdx
    && myActivity.activeCount === 0
    && currentSnapshot.scoreGap >= 100
  ) {
    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'team_idle_warning',
      severity: 'critical',
      message: `Your team is behind by ${currentSnapshot.scoreGap.toLocaleString()} with no active teammates.`,
      teamIdx: myTeamIdx,
      playerUUID: null,
      dedupeKey: 'team-idle-warning',
      ttlMs: 55 * 1000,
    }, 5 * MINUTE);
  }

  if (
    previousSnapshot.mvpUUID
    && currentSnapshot.mvpUUID
    && previousSnapshot.mvpUUID !== currentSnapshot.mvpUUID
    && toFiniteNumber(currentSnapshot.mvpScore) >= 100
  ) {
    const teamIdx = currentSnapshot.playerTeamIdxByUUID?.[currentSnapshot.mvpUUID];
    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'mvp_shift',
      severity: teamIdx === myTeamIdx ? 'success' : 'info',
      message: `${getPlayerName(currentSnapshot, currentSnapshot.mvpUUID)} is now the top scorer.`,
      teamIdx,
      playerUUID: currentSnapshot.mvpUUID,
      dedupeKey: `mvp-shift-${currentSnapshot.mvpUUID}`,
      ttlMs: 50 * 1000,
    }, 2 * MINUTE);
  }

  if (
    previousSnapshot.phase !== 'endgame'
    && currentSnapshot.phase === 'endgame'
    && currentSnapshot.closeness !== 'decisive'
  ) {
    pushEvent(events, recentEvents, now, currentSnapshot, {
      type: 'endgame_pressure',
      severity: currentSnapshot.closeness === 'close' ? 'critical' : 'warning',
      message: 'Endgame pressure. A single completion can swing the result.',
      teamIdx: null,
      playerUUID: null,
      dedupeKey: 'endgame-pressure',
      ttlMs: 75 * 1000,
    }, 30 * MINUTE);
  }

  return events;
}
