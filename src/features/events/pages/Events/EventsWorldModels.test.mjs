import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./EventsWorldModels.js', import.meta.url), 'utf8'))
  .replace("import { getGoalTierProgress } from '@domain/goals/GoalTiers.js';", `
    const getGoalTierProgress = (total = 0) => {
      const tiers = [0, 100, 250, 500, 1000, 1600, 2500, 4000, 6500, 10000].map((threshold, index) => ({ tier: index + 1, threshold }));
      const current = [...tiers].reverse().find((tier) => total >= tier.threshold) || tiers[0];
      const next = tiers.find((tier) => tier.threshold > total) || null;
      const span = Math.max(1, (next?.threshold ?? current.threshold) - current.threshold);
      return { total, current, next, progress: next ? ((total - current.threshold) / span) * 100 : 100, isMaxTier: !next };
    };
  `);
const models = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const players = [
  { UUID: 'p1', username: 'Agent' },
  { UUID: 'p2', username: 'Mika' },
];
const currentPlayer = players[0];

test('goal arenas separate active and archived goals and compute player gap', () => {
  const nowMs = new Date('2026-07-05T12:00:00Z').getTime();
  const model = models.buildGoalArenasModel({
    goals: [
      { UUID: 'g1', name: 'Ship Alpha', status: 'active' },
      { UUID: 'g2', name: 'Fitness Sprint', status: 'active' },
      { UUID: 'g3', name: 'Old Season', status: 'archived', archivedAt: '2026-07-01T00:00:00Z' },
    ],
    contributions: [
      { UUID: 'c1', goalUUID: 'g1', parent: 'p1', value: 40, createdAt: '2026-07-04T10:00:00Z' },
      { UUID: 'c2', goalUUID: 'g1', parent: 'p2', value: 55, createdAt: '2026-07-04T11:00:00Z' },
      { UUID: 'c3', goalUUID: 'g2', parent: 'p1', value: 5, createdAt: '2026-07-05T09:00:00Z' },
    ],
    players,
    currentPlayer,
    nowMs,
  });

  assert.equal(model.activeArenas.length, 2);
  assert.deepEqual(model.activeArenas.map((arena) => arena.id), ['g2', 'g1']);
  assert.equal(model.archivedArenas.length, 1);
  const ship = model.arenas.find((arena) => arena.id === 'g1');
  assert.equal(ship.currentPlayerRank, 2);
  assert.equal(ship.gapToNext, 16);
  assert.equal(model.summary.totalContribution, 100);
});
