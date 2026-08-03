import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./IGT.js', import.meta.url), 'utf8');
source = source
  .replace(
    "import { getRankGroupFloor } from '@domain/rank/Rank.js';",
    'const getRankGroupFloor = () => 0;',
  )
  .replace(
    "import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';",
    "const getMatchOutcomeForPlayer = () => ({ won: false, playerTeamIdx: -1, status: 'pending' });",
  )
  .replace(
    "import { getMatchTeams } from '@domain/matches/MatchContracts.js';",
    "const getMatchTeams = (match) => match?.teams || [];",
  )
  .replace(
    "import { isRatedMatch } from '@domain/matches/RatingMode.js';",
    "const isRatedMatch = (match) => match?.ratingMode !== 'unrated' && match?.status === 'complete';",
  );

const igt = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function player(UUID, elo, igtBaseElo = elo) {
  return { UUID, username: UUID, elo, igtBaseElo };
}

test('replay uses recorded Elo evidence without double-counting inherited baselines', () => {
  const players = [
    player('honor', 88),
    player('terenry', 157),
  ];
  const legacyOwnerOnly = {
    UUID: 'honor-owner-only',
    parent: 'honor',
    status: 'complete',
    ratingMode: 'rated',
    participantUUIDs: ['honor', 'terenry'],
    completedInGameTimestamp: 10,
    teams: [
      [{ UUID: 'honor', elo: 88 }],
      [{ UUID: 'terenry', elo: 157 }],
    ],
    result: {
      inGameTimestamp: 10,
      oldElo: 0,
      newElo: 36,
      eloChange: 36,
      playerScores: { honor: 100, terenry: 90 },
    },
  };

  const replayed = igt.replayEloTimeline(players, [legacyOwnerOnly]);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'honor').elo, 36);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'terenry').elo, 157);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'honor').hasVisibleRating, true);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'terenry').hasVisibleRating, false);
  assert.deepEqual(
    Object.keys(replayed.matches[0].result.playerEloChanges),
    ['honor'],
  );
});

test('replay applies full persisted participant changes when they exist', () => {
  const players = [
    player('alpha', 50, 0),
    player('beta', 25, 0),
  ];
  const match = {
    UUID: 'full-result',
    parent: 'alpha',
    status: 'complete',
    ratingMode: 'rated',
    participantUUIDs: ['alpha', 'beta'],
    completedInGameTimestamp: 20,
    teams: [
      [{ UUID: 'alpha', elo: 0 }],
      [{ UUID: 'beta', elo: 0 }],
    ],
    result: {
      inGameTimestamp: 20,
      playerEloChanges: {
        alpha: { oldElo: 0, newElo: 50, change: 50 },
        beta: { oldElo: 0, newElo: 25, change: 25 },
      },
    },
  };

  const replayed = igt.replayEloTimeline(players, [match]);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'alpha').elo, 50);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'beta').elo, 25);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'alpha').hasVisibleRating, true);
  assert.equal(replayed.players.find((entry) => entry.UUID === 'beta').hasVisibleRating, true);
  assert.deepEqual(
    Object.keys(replayed.matches[0].result.playerEloChanges).sort(),
    ['alpha', 'beta'],
  );
});

test('delta-only legacy receipts retain their inferred Elo instead of becoming zero', () => {
  const players = [player('mimosa', 31, 31)];
  const match = {
    UUID: 'legacy-delta-only',
    parent: 'mimosa',
    status: 'complete',
    completedInGameTimestamp: 10,
    teams: [[{ UUID: 'mimosa', elo: 51 }], []],
    result: {
      inGameTimestamp: 10,
      eloChange: -20,
    },
  };

  assert.deepEqual(igt.getMatchEloChange(match, 'mimosa'), {
    oldElo: null,
    newElo: null,
    change: -20,
    breakdown: [],
  });
  const replayed = igt.replayEloTimeline(players, [match]);
  assert.equal(replayed.matches[0].result.playerEloChanges.mimosa.oldElo, 51);
  assert.equal(replayed.matches[0].result.playerEloChanges.mimosa.newElo, 31);
  assert.equal(replayed.players[0].elo, 31);
});

test('canonical profile Elo reconciles only at its own terminal IGT', () => {
  const maxim = {
    ...player('maxim', 72, 72),
    inGameTime: 40,
  };
  const match = {
    UUID: 'legacy-maxim-result',
    parent: 'maxim',
    status: 'complete',
    completedInGameTimestamp: 30,
    result: {
      inGameTimestamp: 30,
      oldElo: 80,
      newElo: 124,
      eloChange: 44,
    },
  };
  const timeline = igt.buildPlayerEloTimeline(maxim, [match]);

  assert.equal(igt.projectPlayerEloTimeline(timeline, 39).elo, 124);
  const current = igt.projectPlayerEloTimeline(timeline, 40);
  assert.equal(current.elo, 72);
  assert.equal(current.canonicalVisible, true);
  assert.deepEqual(current.eloHistory.at(-1), {
    t: 40,
    elo: 72,
    canonical: true,
  });
});

test('competition identities expose the replayed pre-match rank without using live Elo', () => {
  const match = {
    UUID: 'historical',
    parent: 'honor',
    status: 'complete',
    ratingMode: 'rated',
    createdAt: '2026-04-24T18:34:26.951Z',
    result: {
      oldElo: 84,
      newElo: 122,
      eloChange: 38,
    },
  };

  assert.deepEqual(
    igt.buildCompetitionRankIdentity(match, { UUID: 'honor', username: 'Honor', elo: 84 }),
    {
      UUID: 'honor',
      username: 'Honor',
      elo: 84,
      hasVisibleRating: true,
      snapshotAt: '2026-04-24T18:34:26.951Z',
    },
  );
});

test('competition identities prefer recorded old Elo over a legacy placeholder roster value', () => {
  const match = {
    UUID: 'legacy-placeholder',
    parent: 'sophia',
    status: 'complete',
    ratingMode: 'rated',
    createdAt: '2026-04-25T12:00:00.000Z',
    result: {
      playerEloChanges: {
        quinten: { oldElo: 26, newElo: 31, change: 5 },
      },
    },
  };

  assert.equal(
    igt.buildCompetitionRankIdentity(match, { UUID: 'quinten', username: 'Quinten', elo: 0 }).elo,
    26,
  );
});


test('completed records use their canonical completion IGT', () => {
  assert.equal(igt.getRecordIGT({
    inGameTimestamp: 100,
    completedInGameTimestamp: 250,
  }, { completed: true }), 250);
});
