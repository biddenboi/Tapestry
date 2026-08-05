import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '@domain/constants.js';
import {
  readDayPenalty,
  reportDayPenalty,
  sampleDayPenaltyThreshold,
} from './DayPenalty.js';

function penaltyDatabase() {
  let saved = null;
  let banPending = false;
  return {
    getViolations(_playerUUID, igtDay) {
      return saved?.igtDay === igtDay ? { ...saved } : { strikes: 0, igtDay };
    },
    setViolations(_playerUUID, value) { saved = { ...value }; },
    setBanPending() { banPending = true; },
    snapshot() { return { saved, banPending }; },
  };
}

test('day penalty threshold sampling covers the complete hidden distribution', () => {
  assert.equal(sampleDayPenaltyThreshold(() => 0), 1);
  assert.equal(sampleDayPenaltyThreshold(() => 0.039999), 1);
  assert.equal(sampleDayPenaltyThreshold(() => 0.04), 2);
  assert.equal(sampleDayPenaltyThreshold(() => 0.919999), 7);
  assert.equal(sampleDayPenaltyThreshold(() => 0.999999), 8);
});

test('a penalty keeps one threshold for an IGT day and marks the limit atomically', () => {
  const databaseConnection = penaltyDatabase();
  const player = { UUID: 'player-1', inGameTime: (4 * DAY) + 500, igtActive: false };
  const initial = readDayPenalty(databaseConnection, player, { random: () => 0.04 });
  assert.deepEqual(initial, { strikes: 0, igtDay: 4, threshold: 2 });

  const first = reportDayPenalty(databaseConnection, player, { random: () => 0.999 });
  assert.equal(first.strikes, 1);
  assert.equal(first.threshold, 2);
  assert.equal(first.limitReached, false);

  const second = reportDayPenalty(databaseConnection, player);
  assert.equal(second.strikes, 2);
  assert.equal(second.limitReached, true);
  assert.equal(databaseConnection.snapshot().banPending, true);
});

test('penalty strikes reset on the next IGT day', () => {
  const databaseConnection = penaltyDatabase();
  const firstDay = { UUID: 'player-1', inGameTime: DAY + 1, igtActive: false };
  reportDayPenalty(databaseConnection, firstDay, { random: () => 0.99 });
  const nextDay = readDayPenalty(databaseConnection, {
    ...firstDay,
    inGameTime: (2 * DAY) + 1,
  }, { random: () => 0 });
  assert.deepEqual(nextDay, { strikes: 0, igtDay: 2, threshold: 1 });
});
