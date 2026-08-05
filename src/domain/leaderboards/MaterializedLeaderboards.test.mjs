import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const derivedCacheUrl = new URL('../../shared/cache/DerivedCache.js', import.meta.url).href;
let source = await readFile(new URL('./MaterializedLeaderboards.js', import.meta.url), 'utf8');
source = source
  .replace(
    /import \{[\s\S]*?\} from '@domain\/constants\.js';/,
    `const EVENT = { wake: 'wake', end_work: 'end_work', sleep: 'sleep' };
const MATCH_STATUS = { active: 'active', complete: 'complete' };
const SPECIAL_EVENT_IDS = { dojoMultiplier: 'special-dojo-multiplier' };
const STORES = { appSetting: 'appSettings', derivedCache: 'derivedCaches', task: 'tasks', friendship: 'friendships', event: 'events', eventBuff: 'eventBuffs', contribution: 'contributions', match: 'matches', player: 'players' };`,
  )
  .replace(
    "import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';",
    "const getMatchOutcomeForPlayer = (match, playerUUID) => match.viewerOutcomes?.[playerUUID] || { status: 'pending', playerScore: null, opponentScore: null };",
  )
  .replace(
    /import \{\s*getMatchTeams,\s*\} from '@domain\/matches\/MatchContracts\.js';/,
    "const getMatchTeams = (match) => Array.isArray(match?.teams) ? match.teams : [];",
  )
  .replace(
    /import \{\s*buildPlayerEloTimeline,\s*getReliableMatchCompletionIGT,\s*projectPlayerEloTimeline,\s*withPlayerMatchResult,\s*\} from '@domain\/matches\/IGT\.js';/,
    `const isRatedMatch = (match) => match?.ratingMode != null ? match.ratingMode === 'rated' : match?.status === 'complete';
const getMatchEloChange = (match, playerUUID) => {
  const projected = match.result?.playerEloChanges?.[playerUUID];
  const optionalNumber = (value) => {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  if (projected) return {
    ...projected,
    oldElo: optionalNumber(projected.oldElo),
    newElo: optionalNumber(projected.newElo),
    change: optionalNumber(projected.change) ?? 0,
  };
  if (String(match.parent) !== String(playerUUID) || match.result?.eloChange == null) return null;
  return {
    oldElo: optionalNumber(match.result.oldElo),
    newElo: optionalNumber(match.result.newElo),
    change: optionalNumber(match.result.eloChange) ?? 0,
  };
};
const getReliableMatchCompletionIGT = (match) => {
  for (const value of [match?.completedInGameTimestamp, match?.result?.inGameTimestamp]) {
    if (value == null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
};
const getHistoricalBaseElo = (player, matches) => {
  const changes = matches
    .filter(isRatedMatch)
    .map((match) => ({
      completedIGT: getReliableMatchCompletionIGT(match),
      change: getMatchEloChange(match, player?.UUID),
    }))
    .filter((entry) => entry.completedIGT != null && entry.change)
    .sort((left, right) => left.completedIGT - right.completedIGT);
  const earliestOldElo = changes[0]?.change?.oldElo;
  if (earliestOldElo != null && Number.isFinite(Number(earliestOldElo))) {
    return Math.max(0, Number(earliestOldElo));
  }
  if (changes.length) {
    const totalChange = changes.reduce((sum, entry) => sum + Number(entry.change.change || 0), 0);
    return Math.max(0, Number(player?.elo || 0) - totalChange);
  }
  return Math.max(0, Number(player?.igtBaseElo ?? player?.elo ?? 0));
};
const resultSort = (left, right) => (
  Number(left.completedIGT || 0) - Number(right.completedIGT || 0)
  || String(left.concludedAt || '').localeCompare(String(right.concludedAt || ''))
  || String(left.matchUUID || '').localeCompare(String(right.matchUUID || ''))
);
const buildPlayerEloTimeline = (player, matches, { reconcileCurrent = true } = {}) => {
  const evidence = matches
    .filter((match) => match?.status === 'complete' && isRatedMatch(match))
    .filter((match) => getReliableMatchCompletionIGT(match) != null)
    .map((match) => ({ match, change: getMatchEloChange(match, player?.UUID) }))
    .filter((entry) => entry.change)
    .sort((left, right) => resultSort({
      completedIGT: getReliableMatchCompletionIGT(left.match),
      concludedAt: left.match.result?.concludedAt,
      matchUUID: left.match.UUID,
    }, {
      completedIGT: getReliableMatchCompletionIGT(right.match),
      concludedAt: right.match.result?.concludedAt,
      matchUUID: right.match.UUID,
    }));
  const baseElo = getHistoricalBaseElo(player, matches);
  let runningElo = baseElo;
  const ratedResults = evidence.map(({ match, change }) => {
    const hasOld = change.oldElo != null && Number.isFinite(Number(change.oldElo));
    const hasNew = change.newElo != null && Number.isFinite(Number(change.newElo));
    const oldElo = hasOld ? Math.max(0, Number(change.oldElo)) : runningElo;
    const newElo = hasNew
      ? Math.max(0, Number(change.newElo))
      : Math.max(0, oldElo + Number(change.change || 0));
    runningElo = newElo;
    return {
      matchUUID: String(match.UUID || ''),
      completedIGT: getReliableMatchCompletionIGT(match),
      concludedAt: match.result?.concludedAt || match.createdAt || null,
      oldElo,
      newElo,
      change: newElo - oldElo,
    };
  });
  const lastResultIGT = ratedResults.length
    ? Math.max(...ratedResults.map((result) => Number(result.completedIGT || 0)))
    : null;
  const playerIGT = player?.inGameTime == null ? null : Number(player.inGameTime);
  const canonicalElo = reconcileCurrent && ratedResults.length
    ? Math.max(0, Number(player?.elo || 0))
    : null;
  return {
    baseElo,
    ratedResults,
    canonicalElo,
    canonicalAtIGT: canonicalElo == null
      ? null
      : Math.max(lastResultIGT || 0, Number.isFinite(playerIGT) ? Math.max(0, playerIGT) : 0),
  };
};
const projectPlayerEloTimeline = (timeline, viewerIGT = Infinity) => {
  const boundary = Number.isFinite(Number(viewerIGT)) ? Math.max(0, Number(viewerIGT)) : Infinity;
  const visibleRatedResults = [...(timeline?.ratedResults || [])]
    .filter((result) => Number(result.completedIGT || 0) <= boundary)
    .sort(resultSort);
  const latest = visibleRatedResults.at(-1) || null;
  const canonicalVisible = timeline?.canonicalAtIGT != null
    && timeline?.canonicalElo != null
    && Number(timeline.canonicalAtIGT) <= boundary
    && visibleRatedResults.length > 0;
  const elo = canonicalVisible
    ? Math.max(0, Number(timeline.canonicalElo))
    : latest ? Math.max(0, Number(latest.newElo || 0)) : Math.max(0, Number(timeline?.baseElo || 0));
  const eloHistory = visibleRatedResults.length ? [
    {
      t: Math.max(0, Number(visibleRatedResults[0].completedIGT || 0) - 1),
      elo: Math.max(0, Number(visibleRatedResults[0].oldElo ?? timeline?.baseElo ?? 0)),
      baseline: true,
    },
    ...visibleRatedResults.map((result) => ({
      t: Number(result.completedIGT || 0),
      elo: Math.max(0, Number(result.newElo || 0)),
      matchUUID: result.matchUUID,
    })),
  ] : [];
  if (canonicalVisible && eloHistory.length && eloHistory.at(-1).elo !== elo) {
    eloHistory.push({ t: Number(timeline.canonicalAtIGT), elo, canonical: true });
  }
  return {
    elo,
    eloHistory,
    visibleRatedResults,
    hasVisibleRating: visibleRatedResults.length > 0,
    firstRatedIGT: visibleRatedResults[0]?.completedIGT ?? null,
  };
};
const withPlayerMatchResult = (match, playerUUID) => {
  const change = getMatchEloChange(match, playerUUID);
  return {
    ...match,
    result: {
      ...(match.result || {}),
      ...(change ? {
        eloChange: change.change,
        oldElo: change.oldElo,
        newElo: change.newElo,
      } : {}),
    },
  };
};`,
  )
  .replace(
    "import { isRatedMatch } from '@domain/matches/RatingMode.js';",
    "const isRatedMatch = (match) => match?.ratingMode != null ? match.ratingMode === 'rated' : match?.status === 'complete';",
  )
  .replace(
    "import { getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';",
    "const getCanonicalTaskPoints = (task = {}) => Math.max(0, Math.floor(Number(task.pointsBase ?? task.points) || 0));",
  )
  .replace("from '@shared/cache/DerivedCache.js';", `from '${derivedCacheUrl}';`);

const leaderboards = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function player(UUID, username, elo, igtBaseElo = elo, inGameTime = 0) {
  return {
    UUID,
    username,
    elo,
    igtBaseElo,
    inGameTime,
    profilePicture: null,
  };
}

function completedMatch() {
  return {
    UUID: 'match-1',
    parent: 'a',
    status: 'complete',
    duration: 1,
    createdAt: '2026-01-02T08:00:00.000Z',
    inGameTimestamp: 100,
    completedInGameTimestamp: 200,
    participantUUIDs: ['a', 'b'],
    viewerOutcomes: {
      a: { status: 'win', won: true, playerScore: 120, opponentScore: 90 },
      b: { status: 'loss', won: false, playerScore: 90, opponentScore: 120 },
    },
    result: {
      concludedAt: '2026-01-02T09:00:00.000Z',
      playerEloChanges: {
        a: { oldElo: 1000, newElo: 1025, change: 25 },
        b: { oldElo: 1200, newElo: 1182, change: -18 },
      },
    },
  };
}

test('materialized match data contains stable rankings and compact lobby summaries', () => {
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('a', 'Ada', 1025), player('b', 'Ben', 1182)],
    matches: [completedMatch(), {
      UUID: 'active-1',
      parent: 'a',
      status: 'active',
      participantUUIDs: ['a', 'b'],
      createdAt: '2026-01-03T08:00:00.000Z',
    }],
    tasks: [
      { UUID: 'task-a', parent: 'a', completedAt: '2026-01-02T10:00:00.000Z', points: 20, pointsBase: 20 },
      { UUID: 'task-b', parent: 'b', completedAt: '2026-01-02T11:00:00.000Z', points: 30, pointsBase: 30 },
    ],
    friendships: [{ UUID: 'friend-1', status: 'accepted', players: ['a', 'b'] }],
    events: [
      { UUID: 'wake-a', parent: 'a', type: 'wake', createdAt: '2026-01-02T07:00:00.000Z' },
      { UUID: 'work-a', parent: 'a', type: 'end_work', createdAt: '2026-01-02T17:00:00.000Z' },
    ],
    generatedAt: '2026-01-03T00:00:00.000Z',
  });

  assert.deepEqual(snapshot.globalRankedUUIDs, ['b', 'a']);
  assert.deepEqual(snapshot.pointsRankedUUIDs, ['b', 'a']);
  assert.deepEqual(snapshot.pointsByPlayer, { a: 20, b: 30 });
  assert.deepEqual(snapshot.friendUUIDsByPlayer.a, ['b']);
  assert.equal(snapshot.activeMatchUUIDByPlayer.a, 'active-1');
  assert.equal(snapshot.scheduleByPlayer.a.type, 'end_work');
  assert.equal('dojoMomentumByPlayer' in snapshot, false);
  assert.equal(snapshot.matchSummariesByPlayer.a[0].UUID, 'match-1');
  assert.equal(snapshot.matchSummariesByPlayer.a[0].viewerOutcome.status, 'win');
  assert.equal(snapshot.eloTimelineByPlayer.a.ratedResults.at(-1).newElo, 1025);
});

test('compact lobby summaries preserve Pair Match identity and team cards', () => {
  const match = {
    ...completedMatch(),
    UUID: 'pair-match',
    rulesetId: 'pair_match_v1',
    teams: [
      [player('a', 'Ada', 1025), player('c', 'Cara', 1000)],
      [player('b', 'Ben', 1182), player('d', 'Drew', 990)],
    ],
    participantUUIDs: ['a', 'b', 'c', 'd'],
  };
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [
      player('a', 'Ada', 1025),
      player('b', 'Ben', 1182),
      player('c', 'Cara', 1000),
      player('d', 'Drew', 990),
    ],
    matches: [match],
  });
  const summary = snapshot.matchSummariesByPlayer.a[0];

  assert.equal(summary.rulesetId, 'pair_match_v1');
  assert.equal(summary.teams.length, 2);
  assert.deepEqual(summary.teams[1].map((entry) => entry.UUID), ['b', 'd']);
});

test('Elo journeys include deterministic Match Fellows without adding them to profile rankings', () => {
  const match = {
    ...completedMatch(),
    teams: [
      [player('a', 'Ada', 1000)],
      [{ UUID: 'echo-1', username: 'Ada Echo 1', elo: 940, isGenerated: true }],
    ],
    participantUUIDs: ['a', 'echo-1'],
    result: {
      ...completedMatch().result,
      playerEloChanges: {
        a: { oldElo: 1000, newElo: 1025, change: 25 },
        'echo-1': { oldElo: 940, newElo: 920, change: -20 },
      },
    },
  };
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('a', 'Ada', 1025)],
    matches: [match],
  });
  const projected = leaderboards.projectMatchLeaderboardAtIGT(snapshot, {
    viewerIGT: 200,
    playerUUID: 'a',
  });

  assert.equal(snapshot.fellowSummaries.find((entry) => entry.UUID === 'echo-1').isGenerated, true);
  assert.equal(snapshot.eloTimelineByPlayer['echo-1'].ratedResults.length, 1);
  assert.equal(projected.fellowRatings.find((entry) => entry.UUID === 'echo-1').elo, 920);
  assert.deepEqual(projected.globalRankedUUIDs, ['a']);
});

test('points leaderboard ranks direct work exclusively from canonical base points', () => {
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('a', 'Ada', 1000), player('b', 'Ben', 1000)],
    tasks: [
      {
        UUID: 'adjusted-a',
        parent: 'a',
        completedAt: '2026-01-02T10:00:00.000Z',
        points: 300,
        pointsBase: 100,
      },
      {
        UUID: 'adjusted-b',
        parent: 'b',
        completedAt: '2026-01-02T11:00:00.000Z',
        points: 150,
        pointsBase: 120,
      },
      {
        UUID: 'base-a',
        parent: 'a',
        completedAt: '2026-01-02T12:00:00.000Z',
        points: 900,
        pointsBase: 5,
      },
      {
        UUID: 'base-b',
        parent: 'b',
        createdAt: '2026-01-02T12:59:50.000Z',
        completedAt: '2026-01-02T13:00:00.000Z',
        points: 500,
        pointsBase: 1,
      },
      {
        UUID: 'legacy-base-b',
        parent: 'b',
        createdAt: '2026-01-02T13:59:50.000Z',
        completedAt: '2026-01-02T14:00:00.000Z',
        points: 9.9,
      },
    ],
  });

  assert.deepEqual(snapshot.pointsByPlayer, { a: 105, b: 130 });
  assert.deepEqual(snapshot.dailyPointsByPlayer, {
    a: { '2026-01-02': 105 },
    b: { '2026-01-02': 130 },
  });
  assert.deepEqual(snapshot.pointsRankedUUIDs, ['b', 'a']);
});

test('viewer-IGT projection gates future and unrated results while base Elo remains internal', () => {
  const future = {
    ...completedMatch(),
    UUID: 'future-rated',
    completedInGameTimestamp: 600,
    ratingMode: 'rated',
    result: {
      ...completedMatch().result,
      concludedAt: '2026-01-03T09:00:00.000Z',
      playerEloChanges: {
        a: { oldElo: 1025, newElo: 1040, change: 15 },
        b: { oldElo: 1182, newElo: 1170, change: -12 },
      },
    },
  };
  const unrated = {
    ...completedMatch(),
    UUID: 'unrated',
    completedInGameTimestamp: 150,
    ratingMode: 'unrated',
  };
  const missingCompletionIGT = {
    ...completedMatch(),
    UUID: 'missing-completion-igt',
    completedInGameTimestamp: 0,
    ratingMode: 'rated',
    result: {
      ...completedMatch().result,
      inGameTimestamp: 0,
      playerEloChanges: {
        a: { oldElo: 0, newElo: 999, change: 999 },
        b: { oldElo: 0, newElo: 999, change: 999 },
      },
    },
  };
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [
      player('a', 'Ada', 1040, 1000),
      player('b', 'Ben', 1170, 1200),
      player('c', 'Cara', 975, 900),
    ],
    matches: [missingCompletionIGT, unrated, completedMatch(), future],
    friendships: [{ UUID: 'friends', status: 'accepted', players: ['a', 'b', 'c'] }],
  });

  const before = leaderboards.projectMatchLeaderboardAtIGT(snapshot, { viewerIGT: 199, playerUUID: 'a' });
  assert.deepEqual(before.globalRankedUUIDs, []);
  assert.deepEqual(before.friendRankedUUIDs, []);
  assert.equal(before.participants.find((entry) => entry.UUID === 'c').elo, 900);
  assert.equal(before.participants.find((entry) => entry.UUID === 'c').hasVisibleRating, false);
  assert.deepEqual(before.eloHistory, []);
  assert.equal(before.matchHistory.some((match) => match.UUID === 'unrated'), true);
  assert.equal(
    snapshot.eloTimelineByPlayer.a.ratedResults.some((result) => result.matchUUID === 'missing-completion-igt'),
    false,
  );
  assert.equal(missingCompletionIGT.completedInGameTimestamp, 0);

  const exact = leaderboards.projectMatchLeaderboardAtIGT(snapshot, { viewerIGT: 200, playerUUID: 'a' });
  assert.equal(exact.viewerHasVisibleRating, true);
  assert.equal(exact.viewerRating, 1025);
  assert.deepEqual(exact.globalRankedUUIDs, ['b', 'a']);
  assert.deepEqual(exact.friendRankedUUIDs, ['b']);
  assert.equal(exact.friendRatings[0].elo, 1182);
  assert.equal(exact.friendRatings[0].eloHistory.length, 2);
  assert.equal(exact.friendRatings[0].eloHistory.at(-1).matchUUID, 'match-1');
  assert.equal(exact.eloHistory.at(-1).matchUUID, 'match-1');

  const futureVisible = leaderboards.projectMatchLeaderboardAtIGT(snapshot, { viewerIGT: 600, playerUUID: 'a' });
  assert.equal(futureVisible.viewerRating, 1040);
  assert.equal(futureVisible.eloHistory.at(-1).matchUUID, 'future-rated');
  const reset = leaderboards.projectMatchLeaderboardAtIGT(snapshot, { viewerIGT: 200, playerUUID: 'a' });
  assert.equal(reset.viewerRating, 1025);
  assert.equal(reset.eloHistory.some((point) => point.matchUUID === 'future-rated'), false);
});

test('Poon Chae and Honor Day 16 result does not alter their Day 9 leaderboard values', () => {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const day9Boundary = (9 * day) + (13 * hour);
  const day16MatchIGT = (16 * day) + hour;
  const earlierMatch = {
    ...completedMatch(),
    UUID: 'poon-honor-day-5',
    parent: 'poon-chae',
    ratingMode: 'rated',
    participantUUIDs: ['poon-chae', 'honor'],
    completedInGameTimestamp: (5 * day) + hour,
    result: {
      ...completedMatch().result,
      inGameTimestamp: (5 * day) + hour,
      playerEloChanges: {
        'poon-chae': { oldElo: 90, newElo: 88, change: -2 },
        honor: { oldElo: 60, newElo: 62, change: 2 },
      },
    },
  };
  const day16Match = {
    ...completedMatch(),
    UUID: 'poon-honor-day-16',
    parent: 'poon-chae',
    ratingMode: 'rated',
    participantUUIDs: ['poon-chae', 'honor'],
    completedInGameTimestamp: day16MatchIGT,
    result: {
      ...completedMatch().result,
      inGameTimestamp: day16MatchIGT,
      concludedAt: '2026-01-16T01:00:00.000Z',
      playerEloChanges: {
        'poon-chae': { oldElo: 88, newElo: 74, change: -14 },
        honor: { oldElo: 62, newElo: 84, change: 22 },
      },
    },
  };
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [
      player('poon-chae', 'Poon Chae', 74, 90),
      player('honor', 'Honor', 84, 60),
    ],
    matches: [earlierMatch, day16Match],
  });

  const day9 = leaderboards.projectMatchLeaderboardAtIGT(snapshot, {
    viewerIGT: day9Boundary,
    playerUUID: 'poon-chae',
  });
  assert.deepEqual(
    day9.participants.map(({ UUID, elo }) => [UUID, elo]),
    [['poon-chae', 88], ['honor', 62]],
  );
  assert.equal(day9.eloHistory.some((point) => point.matchUUID === 'poon-honor-day-16'), false);

  const day16 = leaderboards.projectMatchLeaderboardAtIGT(snapshot, {
    viewerIGT: day16MatchIGT,
    playerUUID: 'poon-chae',
  });
  assert.deepEqual(
    day16.participants.map(({ UUID, elo }) => [UUID, elo]),
    [['poon-chae', 74], ['honor', 84]],
  );
  assert.equal(day16.eloHistory.at(-1).matchUUID, 'poon-honor-day-16');
});

test('delta-only legacy matches remain rated without inventing zero-valued receipt fields', () => {
  const match = {
    ...completedMatch(),
    UUID: 'mimosa-delta-only',
    parent: 'mimosa',
    participantUUIDs: ['mimosa'],
    completedInGameTimestamp: 20,
    result: {
      inGameTimestamp: 20,
      concludedAt: '2026-01-02T09:00:00.000Z',
      eloChange: -20,
    },
  };
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('mimosa', 'Mimosa', 31, 31, 20)],
    matches: [match],
  });
  const projection = leaderboards.projectMatchLeaderboardAtIGT(snapshot, {
    viewerIGT: 20,
    playerUUID: 'mimosa',
  });

  assert.equal(snapshot.eloTimelineByPlayer.mimosa.baseElo, 51);
  assert.equal(snapshot.eloTimelineByPlayer.mimosa.ratedResults[0].newElo, 31);
  assert.equal(snapshot.matchSummariesByPlayer.mimosa[0].result.oldElo, null);
  assert.equal(snapshot.matchSummariesByPlayer.mimosa[0].result.newElo, null);
  assert.equal(projection.viewerHasVisibleRating, true);
  assert.equal(projection.viewerRating, 31);
});

test('contribution rankings use a materialized deterministic snapshot', () => {
  const snapshot = leaderboards.buildContributionLeaderboardSnapshot({
    players: [player('a', 'Ada', 1000), player('b', 'Ben', 1000), player('c', 'Cara', 1000)],
    contributions: [
      { UUID: 'c1', parent: 'a', value: 4, inGameTimestamp: 10 },
      { UUID: 'c2', parent: 'b', value: 9, inGameTimestamp: 12 },
      { UUID: 'c3', parent: 'a', value: 6, inGameTimestamp: 30 },
    ],
    generatedAt: '2026-01-03T00:00:00.000Z',
  });
  assert.deepEqual(snapshot.rankedUUIDs, ['a', 'b', 'c']);
  assert.deepEqual(snapshot.totalsByPlayer, { a: 10, b: 9 });
  const historical = leaderboards.projectContributionLeaderboardAtIGT(snapshot, { viewerIGT: 20 });
  assert.deepEqual(historical.totalsByPlayer, { a: 4, b: 9, c: 0 });
  assert.deepEqual(historical.rankedUUIDs, ['b', 'a', 'c']);
});

class MemoryDb {
  constructor() {
    this.records = new Map([
      ['appSettings', new Map()],
      ['derivedCaches', new Map()],
      ['tasks', new Map()],
      ['friendships', new Map()],
      ['events', new Map()],
      ['eventBuffs', new Map()],
      ['contributions', new Map()],
      ['matches', new Map()],
    ]);
    this.domainLoads = [];
    this.commits = [];
    this.players = [player('a', 'Ada', 1025), player('b', 'Ben', 1182)];
    this.matches = [completedMatch()];
    for (const match of this.matches) this.bucket('matches').set(match.UUID, structuredClone(match));
  }

  bucket(store) {
    if (!this.records.has(store)) this.records.set(store, new Map());
    return this.records.get(store);
  }

  async get(store, UUID) { return structuredClone(this.bucket(store).get(UUID) || null); }
  async getAll(store) { return [...this.bucket(store).values()].map((row) => structuredClone(row)); }
  async getAllPlayers() { return structuredClone(this.players); }
  async getEloWorldAtIGT() { throw new Error('Leaderboard rebuild must read raw records.'); }
  async ensureDomainsLoaded(domains) { this.domainLoads.push([...domains]); }
  async commitAtomicMutation({ label, puts }) {
    this.commits.push({ label, puts: structuredClone(puts) });
    for (const put of puts) this.bucket(put.store).set(put.record.UUID, structuredClone(put.record));
    return { changed: true };
  }
}

test('cached lobby standings honor two exact IGT cutoffs inside the same minute', async () => {
  const db = new MemoryDb();
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('a', 'Ada', 1025, 1000), player('b', 'Ben', 1182, 1200)],
    matches: [completedMatch()],
    generatedAt: '2026-01-03T00:00:00.000Z',
  });
  db.bucket('derivedCaches').set(leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID, {
    UUID: leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID,
    value: snapshot,
  });

  const before = await leaderboards.readLobbyMaterializedData(db, 'a', 199);
  const exact = await leaderboards.readLobbyMaterializedData(db, 'a', 200);

  assert.deepEqual(before.globalRankedUUIDs, []);
  assert.equal(before.viewerHasVisibleRating, false);
  assert.deepEqual(exact.globalRankedUUIDs, ['b', 'a']);
  assert.equal(exact.viewerRating, 1025);
});

test('opening readers never aggregate source stores and queued rebuild keeps the old snapshot until commit', async () => {
  const db = new MemoryDb();
  const old = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('a', 'Old Ada', 900)],
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  db.bucket('derivedCaches').set(leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID, {
    UUID: leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID,
    value: old,
  });

  const before = await leaderboards.readLobbyMaterializedData(db, 'a');
  assert.equal(before.participants[0].username, 'Old Ada');
  assert.equal(db.domainLoads.length, 0);

  const pending = leaderboards.queueMaterializedLeaderboardRebuild(db, {
    scopes: ['match'],
    reason: 'match-committed',
  });
  const whilePending = await leaderboards.readLobbyMaterializedData(db, 'a');
  assert.equal(whilePending.participants[0].username, 'Old Ada');

  await pending;
  const after = await leaderboards.readLobbyMaterializedData(db, 'a');
  assert.equal(after.participants.find((entry) => entry.UUID === 'a').username, 'Ada');
  assert.equal(db.commits.length, 1);
  assert.equal(db.commits[0].label, 'materialized-leaderboard-rebuild');
  assert.ok(db.domainLoads[0].includes('matches'));
  assert.ok(db.domainLoads[0].includes('leaderboards'));
});

test('only relevant committed stores schedule leaderboard scopes', () => {
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForStores(['matches'])),
    new Set(['match', 'lobby']),
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForStores(['contributions'])),
    new Set(['contribution']),
  );
  assert.deepEqual(leaderboards.leaderboardScopesForStores(['inventory']), []);
});

test('rebuild requests arriving during a running job are deduplicated and drained before resolution', async () => {
  let releaseFirst;
  let enteredFirst;
  const firstEntered = new Promise((resolve) => { enteredFirst = resolve; });
  const firstRelease = new Promise((resolve) => { releaseFirst = resolve; });
  class BlockingDb extends MemoryDb {
    blocked = false;
    async commitAtomicMutation(input) {
      if (input.label === 'materialized-leaderboard-rebuild' && !this.blocked) {
        this.blocked = true;
        enteredFirst();
        await firstRelease;
      }
      return super.commitAtomicMutation(input);
    }
  }
  const db = new BlockingDb();
  const first = leaderboards.queueMaterializedLeaderboardRebuild(db, {
    scopes: ['match'],
    reason: 'match-committed',
  });
  await firstEntered;
  const second = leaderboards.queueMaterializedLeaderboardRebuild(db, {
    scopes: ['contribution'],
    reason: 'contribution-committed',
  });
  assert.equal(first, second);
  releaseFirst();
  await second;
  assert.equal(db.commits.length, 2);
  assert.ok(db.commits[0].puts.some((put) => put.record.UUID === leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID));
  assert.ok(db.commits[1].puts.some((put) => put.record.UUID === leaderboards.CONTRIBUTION_LEADERBOARD_SNAPSHOT_ID));
});


test('operation-aware invalidation ignores unrelated writes inside shared stores', () => {
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'tasks',
      record: { UUID: 'draft', name: 'Draft', completedAt: null },
      previousRecord: null,
    }]),
    [],
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'tasks',
      record: { UUID: 'done', completedAt: '2026-01-01T00:00:00.000Z' },
      previousRecord: { UUID: 'done', completedAt: null },
    }])),
    new Set(['match', 'lobby']),
  );
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'players',
      record: { UUID: 'a', username: 'Ada', elo: 1000, tokens: 10 },
      previousRecord: { UUID: 'a', username: 'Ada', elo: 1000, tokens: 20 },
    }]),
    [],
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'players',
      record: { UUID: 'a', username: 'Ada', elo: 1015 },
      previousRecord: { UUID: 'a', username: 'Ada', elo: 1000 },
    }])),
    new Set(['match', 'lobby', 'contribution']),
  );
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'events',
      record: { UUID: 'item-use', type: 'item_use' },
    }]),
    [],
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'events',
      record: { UUID: 'wake', type: 'wake' },
    }])),
    new Set(['match', 'lobby']),
  );
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'eventBuffs',
      record: { UUID: 'habit-buff', eventUUID: 'habit-water' },
    }]),
    [],
  );
});

test('production rebuild uses raw evidence and projects the exact 24-hour standings', async () => {
  const db = new MemoryDb();
  const players = [
    player('maxim', 'Maxim.', 72, 72, 108_513_673),
    player('honor', 'Honor', 88, 88, 47_992_837),
    player('sophia', 'Sophia', 74, 26),
    player('guest', 'Guest', 51, 26),
    player('profit', 'Profit Maximizing Firm', 51, 26),
    player('oko', 'OkO', 6, 26),
    player('quinten', 'Quinten', 6, 26),
    player('inertia', 'Inertia', 5, 25),
    player('marika', 'Marika Aoki', 20, 20, 165_186_991),
    player('mimosa', 'Mimosa', 31, 31),
    player('oatstakes', 'Oatstakes', 0, 0, 43_008_063),
    player('terenry', 'Terenry', 157, 157, 59_007_174),
    player('mahiro', 'Mahiro Plushie', 130, 130, 88_260_636),
  ];
  const rated = ({
    UUID,
    parent,
    completedIGT,
    result,
    participantUUIDs = [parent],
    ratingMode = 'rated',
  }) => ({
    UUID,
    parent,
    status: 'complete',
    ratingMode,
    participantUUIDs,
    completedInGameTimestamp: completedIGT,
    result: {
      concludedAt: `2026-01-01T00:00:${String(completedIGT % 60).padStart(2, '0')}.000Z`,
      inGameTimestamp: completedIGT,
      ...result,
    },
  });
  const matches = [
    rated({
      UUID: 'sophia-shared',
      parent: 'sophia',
      completedIGT: 4_891_248,
      participantUUIDs: ['sophia', 'guest', 'profit', 'oko', 'quinten', 'inertia'],
      result: {
        playerEloChanges: {
          sophia: { oldElo: 26, newElo: 74, change: 48 },
          guest: { oldElo: 26, newElo: 51, change: 25 },
          profit: { oldElo: 26, newElo: 51, change: 25 },
          oko: { oldElo: 26, newElo: 6, change: -20 },
          quinten: { oldElo: 26, newElo: 6, change: -20 },
          inertia: { oldElo: 25, newElo: 5, change: -20 },
        },
      },
    }),
    rated({
      UUID: 'marika-owner-only',
      parent: 'marika',
      completedIGT: 7_966_074,
      participantUUIDs: ['marika', 'mahiro'],
      result: { eloChange: -20 },
    }),
    rated({
      UUID: 'honor-1',
      parent: 'honor',
      completedIGT: 14_955_568,
      participantUUIDs: ['honor', 'terenry'],
      result: { oldElo: 0, newElo: 36, eloChange: 36 },
    }),
    rated({
      UUID: 'mimosa-owner-only',
      parent: 'mimosa',
      completedIGT: 16_039_843,
      participantUUIDs: ['mimosa', 'mahiro'],
      result: { eloChange: -20 },
    }),
    rated({
      UUID: 'honor-2',
      parent: 'honor',
      completedIGT: 42_942_644,
      result: { oldElo: 36, newElo: 81, eloChange: 45 },
    }),
    rated({
      UUID: 'maxim-1',
      parent: 'maxim',
      completedIGT: 43_961_980,
      result: { oldElo: 0, newElo: 35, eloChange: 35 },
    }),
    rated({
      UUID: 'maxim-2',
      parent: 'maxim',
      completedIGT: 58_052_855,
      result: { oldElo: 35, newElo: 80, eloChange: 45 },
    }),
    rated({
      UUID: 'maxim-3',
      parent: 'maxim',
      completedIGT: 66_788_718,
      result: { oldElo: 80, newElo: 124, eloChange: 44 },
    }),
    rated({
      UUID: 'oatstakes-boundary',
      parent: 'oatstakes',
      completedIGT: 86_400_000,
      result: { oldElo: 0, newElo: 0, eloChange: 0 },
    }),
    rated({
      UUID: 'terenry-future',
      parent: 'terenry',
      completedIGT: 236_275_277,
      result: { oldElo: 0, newElo: 0, eloChange: 0 },
    }),
    rated({
      UUID: 'mahiro-unrated',
      parent: 'mahiro',
      completedIGT: 1_000,
      ratingMode: 'unrated',
      result: { oldElo: 0, newElo: 999, eloChange: 999 },
    }),
  ];
  db.players = players;
  db.bucket('matches').clear();
  for (const match of matches) db.bucket('matches').set(match.UUID, structuredClone(match));
  db.bucket('derivedCaches').set(leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID, {
    UUID: leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID,
    value: {
      schemaVersion: leaderboards.MATERIALIZED_LEADERBOARD_SCHEMA_VERSION - 1,
      participantSummaries: players,
      globalRankedUUIDs: ['maxim', 'honor', 'terenry'],
      eloTimelineByPlayer: {},
    },
  });

  const stale = await leaderboards.readMaterializedLeaderboardSnapshots(db);
  assert.deepEqual(stale.match.globalRankedUUIDs, []);

  await leaderboards.rebuildMaterializedLeaderboards(db, {
    scopes: ['match'],
    reason: 'schema-migration',
  });
  const snapshots = await leaderboards.readMaterializedLeaderboardSnapshots(db);
  const projected = leaderboards.projectMatchLeaderboardAtIGT(snapshots.match, {
    viewerIGT: 86_400_000,
  });
  assert.equal(snapshots.match.schemaVersion, leaderboards.MATERIALIZED_LEADERBOARD_SCHEMA_VERSION);
  assert.deepEqual(
    projected.globalRankedUUIDs.map((UUID) => {
      const row = projected.participants.find((participant) => participant.UUID === UUID);
      return [row.username, row.elo];
    }),
    [
      ['Maxim.', 124],
      ['Honor', 88],
      ['Sophia', 74],
      ['Guest', 51],
      ['Profit Maximizing Firm', 51],
      ['Mimosa', 31],
      ['Marika Aoki', 20],
      ['OkO', 6],
      ['Quinten', 6],
      ['Inertia', 5],
      ['Oatstakes', 0],
    ],
  );
  assert.equal(projected.globalRankedUUIDs.includes('terenry'), false);
  assert.equal(projected.globalRankedUUIDs.includes('mahiro'), false);

  const day18 = leaderboards.projectMatchLeaderboardAtIGT(snapshots.match, {
    viewerIGT: (18 * 86_400_000) + (9 * 3_600_000) + (12 * 60_000),
  });
  const day18Ratings = Object.fromEntries(
    day18.participants.map(({ username, elo }) => [username, elo]),
  );
  assert.deepEqual(
    Object.fromEntries([
      'Terenry',
      'Honor',
      'Sophia',
      'Maxim.',
      'Mimosa',
      'Marika Aoki',
      'Oatstakes',
    ].map((username) => [username, day18Ratings[username]])),
    {
      Terenry: 157,
      Honor: 88,
      Sophia: 74,
      'Maxim.': 72,
      Mimosa: 31,
      'Marika Aoki': 20,
      Oatstakes: 0,
    },
  );
});
