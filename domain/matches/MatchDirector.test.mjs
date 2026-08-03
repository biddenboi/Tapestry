import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./MatchDirector.js', import.meta.url), 'utf8'))
  .replace(
    "import { MINUTE } from '@domain/constants.js';",
    'const MINUTE = 60 * 1000;',
  );

const director = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function snapshot(overrides = {}) {
  return {
    currentPlayerTeamIdx: 0,
    currentPlayerOpponentTeamIdx: 1,
    leaderTeamIdx: 0,
    scoreGap: 27,
    scoreDelta: 27,
    closeness: 'close',
    phase: 'midgame',
    playersByUUID: {},
    scoresByUUID: {},
    playerStatesByUUID: {},
    playerTeamIdxByUUID: {},
    teamActivity: { 0: { activeCount: 1 }, 1: { activeCount: 1 } },
    ...overrides,
  };
}

test('close match events do not repeat every tick for nearly identical gaps', () => {
  const first = director.deriveMatchEvents(
    snapshot({ closeness: 'moderate', scoreGap: 180, scoreDelta: 180 }),
    snapshot({ scoreGap: 27, scoreDelta: 27 }),
    [],
    { now: 1000 },
  );
  const repeated = director.deriveMatchEvents(
    snapshot({ scoreGap: 27, scoreDelta: 27 }),
    snapshot({ scoreGap: 28, scoreDelta: 28 }),
    first,
    { now: 60 * 1000 },
  );

  assert.equal(first.some((event) => event.type === 'close_match'), true);
  assert.equal(repeated.some((event) => event.type === 'close_match'), false);
});

test('large task completion moving match out of close state does not replay stale close message', () => {
  const events = director.deriveMatchEvents(
    snapshot({ scoreGap: 27, scoreDelta: 27 }),
    snapshot({
      scoreGap: 2200,
      scoreDelta: 2200,
      closeness: 'decisive',
      scoresByUUID: { player: 2200 },
      playerTeamIdxByUUID: { player: 0 },
      playerStatesByUUID: { player: { lastCompletedTaskName: 'Deep Work' } },
      playersByUUID: { player: { username: 'Mika' } },
    }),
    [],
    { now: 2000 },
  );

  assert.equal(events.some((event) => event.type === 'close_match'), false);
  assert.equal(events.some((event) => event.type === 'big_completion'), true);
});

test('estimated score drift is not labeled as a concrete big completion', () => {
  const events = director.deriveMatchEvents(
    snapshot({
      scoresByUUID: { echo: 120 },
      playerTeamIdxByUUID: { echo: 1 },
      playerStatesByUUID: { echo: { confidence: 'estimated', isReplayBased: false, scoreDelta: 120 } },
    }),
    snapshot({
      scoresByUUID: { echo: 260 },
      playerTeamIdxByUUID: { echo: 1 },
      playerStatesByUUID: { echo: { confidence: 'estimated', isReplayBased: false, scoreDelta: 140, taskName: 'estimated push' } },
      playersByUUID: { echo: { username: 'Echo' } },
    }),
    [],
    { now: 2000 },
  );

  assert.equal(events.some((event) => event.type === 'big_completion'), false);
});

test('match events carry match-relative timeline fields', () => {
  const events = director.deriveMatchEvents(
    snapshot({ leaderTeamIdx: 0, scoreGap: 20, scoreDelta: 20 }),
    snapshot({
      leaderTeamIdx: 1,
      scoreGap: 188,
      scoreDelta: -188,
      elapsedMs: 14 * 60 * 1000,
      matchCreatedAtMs: Date.parse('2026-07-10T00:00:00.000Z'),
    }),
    [],
    { now: Date.parse('2026-07-10T02:00:00.000Z') },
  );

  const lead = events.find((event) => event.type === 'lead_change');
  assert.equal(lead.matchElapsedMs, 14 * 60 * 1000);
  assert.equal(lead.timelineAt, '2026-07-10T00:14:00.000Z');
  assert.equal(lead.createdAt, Date.parse('2026-07-10T02:00:00.000Z'));
});
