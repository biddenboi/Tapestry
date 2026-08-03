import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./Contribution.js', import.meta.url), 'utf8'))
  .replace(
    "import { v4 as uuid } from 'uuid';",
    "const uuid = () => 'test-uuid';",
  )
  .replace(
    "import { CONTRIBUTION_PASS_REWARDS, STORES } from '@domain/constants.js';",
    "const CONTRIBUTION_PASS_REWARDS = []; const STORES = { contribution: 'contributions', project: 'projects' };",
  )
  .replace(
    "import { buildActionReward } from '@domain/rewards/RewardSchedule.js';",
    'const buildActionReward = () => ({ contribution: 0, coins: 0 });',
  )
  .replace(
    `import {
  GOAL_TIERS,
  getGoalTier,
  getGoalTierProgress,
  getUnlockedGoalTierPerks,
} from '@domain/goals/GoalTiers.js';`,
    `const GOAL_TIERS = [{ tier: 1, threshold: 0, label: 'Foundation', perks: [] }];
     const getGoalTier = () => GOAL_TIERS[0];
     const getGoalTierProgress = (total = 0) => ({ total, current: GOAL_TIERS[0], next: null, progress: 100, isMaxTier: true });
     const getUnlockedGoalTierPerks = () => [];`,
  );

const contribution = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('goal leaderboard and trend include legacy projectId contribution rows', () => {
  const createdAt = new Date().toISOString();
  const rows = [
    { UUID: 'c1', projectId: 'goal-1', parent: 'p1', value: 2, createdAt },
    { UUID: 'c2', goalUUID: 'goal-1', parent: 'p2', value: 3, createdAt },
    { UUID: 'c3', projectId: 'goal-2', parent: 'p1', value: 9, createdAt },
  ];
  const players = [
    { UUID: 'p1', username: 'Agent' },
    { UUID: 'p2', username: 'Mika' },
  ];

  const leaderboard = contribution.buildGoalLeaderboard(rows, players, 'goal-1');
  assert.deepEqual(leaderboard.map((entry) => [entry.playerUUID, entry.value]), [
    ['p2', 3],
    ['p1', 2],
  ]);

  const trend = contribution.buildContributionTrend(rows, 'goal-1', 1);
  assert.equal(trend[0].value, 5);
});

test('task contribution is idempotent by completion-event ID', async () => {
  const rows = [];
  const db = {
    async getAll(store) { return store === 'contributions' ? rows : []; },
    async get() { return null; },
    async getContributionForTask() { return null; },
    async add(store, row) { if (store === 'contributions') rows.push(row); },
    async flushLinkedFolderWrite() { throw new Error('flush should be disabled'); },
  };
  const player = { UUID: 'player-1', username: 'Demo' };
  const task = { UUID: 'task-1', name: 'Task', completedAt: new Date().toISOString() };

  const first = await contribution.recordTaskContribution(
    db,
    player,
    task,
    { contribution: 3, coins: 1 },
    { completionEventUUID: 'completion-1', flush: false },
  );
  const replay = await contribution.recordTaskContribution(
    db,
    player,
    task,
    { contribution: 3, coins: 1 },
    { completionEventUUID: 'completion-1', flush: false },
  );

  assert.equal(rows.length, 1);
  assert.equal(first.UUID, 'task-completion:completion-1:contribution');
  assert.equal(replay.UUID, first.UUID);
});

test('contribution totals are exported, finite, and optionally scoped to a player', () => {
  const rows = [
    { parent: 'p1', value: 3 },
    { parent: 'p1', value: '2.5' },
    { parent: 'p2', value: 7 },
    { parent: 'p1', value: 'not-a-number' },
  ];
  assert.equal(contribution.getContributionTotal(rows), 12.5);
  assert.equal(contribution.getContributionTotal(rows, 'p1'), 5.5);
  assert.equal(contribution.getContributionTotal(null, 'p1'), 0);
});

test('goal status helper is exported and recognizes every archived representation', () => {
  assert.equal(contribution.getGoalStatus(null), 'active');
  assert.equal(contribution.getGoalStatus({ status: 'active' }), 'active');
  assert.equal(contribution.getGoalStatus({ status: 'archived' }), 'archived');
  assert.equal(contribution.getGoalStatus({ archivedAt: '2026-07-11T00:00:00.000Z' }), 'archived');
  assert.equal(contribution.getGoalStatus({ completedAt: '2026-07-11T00:00:00.000Z' }), 'archived');
});

test('goal task selectors receive active, visible goals including legacy records', () => {
  const legacy = { UUID: 'legacy', name: 'Legacy goal' };
  assert.equal(contribution.isGoalActive(legacy), true);
  assert.equal(contribution.isGoalTaskCategory(legacy), true);
  assert.equal(contribution.isGoalActive({ ...legacy, status: 'archived' }), false);
  assert.equal(contribution.isGoalTaskCategory({ ...legacy, taskCategoryEnabled: false }), false);
  assert.equal(contribution.isGoalTaskCategory({ ...legacy, hideFromTasks: true }), false);
  assert.equal(contribution.isGoalActive(null), false);
  assert.equal(contribution.isGoalTaskCategory(null), false);
});
