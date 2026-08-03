import assert from 'node:assert/strict';
import test from 'node:test';
import { computePairMatchEloChanges } from './Elo.js';

const teams = [
  [{ UUID: 'a', elo: 1000 }, { UUID: 'b', elo: 1200 }],
  [{ UUID: 'c', elo: 1050 }, { UUID: 'd', elo: 1150 }],
];

test('Pair Match gives both teammates the same delta regardless of point share', () => {
  const result = computePairMatchEloChanges(teams, {
    a: 1000,
    b: 10,
    c: 400,
    d: 300,
  });
  assert.equal(result.teamAverageRatings[0], 1100);
  assert.equal(result.teamAverageRatings[1], 1100);
  assert.equal(result.changes.a.change, 16);
  assert.equal(result.changes.b.change, 16);
  assert.equal(result.changes.c.change, -16);
  assert.equal(result.changes.d.change, -16);
  assert.match(result.changes.a.breakdown[2].label, /Individual point share/);
  assert.equal(result.changes.a.breakdown[2].value, 0);
});

test('Pair Match forfeit forces the forfeiting team loss with one shared team delta', () => {
  const result = computePairMatchEloChanges(teams, {
    a: 5000,
    b: 5000,
    c: 0,
    d: 0,
  }, 0);
  assert.equal(result.winnerTeamIdx, 1);
  assert.equal(result.changes.a.change, result.changes.b.change);
  assert.ok(result.changes.a.change < 0);
  assert.equal(result.changes.c.change, result.changes.d.change);
  assert.ok(result.changes.c.change > 0);
});
