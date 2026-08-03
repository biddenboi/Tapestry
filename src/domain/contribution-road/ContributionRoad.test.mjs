import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';

const alias = (path) => fileURLToPath(new URL(path, import.meta.url));
const server = await createServer({
  root: alias('../..'),
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: {
      '@app': alias('../../app'),
      '@data': alias('../../data'),
      '@domain': alias('../../domain'),
      '@features': alias('../../features'),
      '@shared': alias('../../shared'),
    },
  },
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});

test.after(async () => server.close());

const {
  commitRoadChapter,
  claimAchievementPackNode,
  deriveRoadStats,
  evaluateRoadGate,
  getContributionBalances,
  getContributionRoadProgress,
  getAchievementPackNodeState,
  previewAchievementPackClaim,
  resolveAchievementPackExclusions,
  reconcileOpeningTrail,
} = await server.ssrLoadModule('/domain/contribution-road/ContributionRoad.js');
const {
  ACHIEVEMENT_PACKS,
  CONTRIBUTION_ROAD_NODES,
  validateAchievementPackCatalog,
} = await server.ssrLoadModule('/domain/contribution-road/ContributionRoadCatalog.js');
const { STORES } = await server.ssrLoadModule('/domain/constants.js');

const completed = (UUID, parent = 'p1') => ({ UUID, parent, status: 'completed', completedAt: '2026-07-28T12:00:00.000Z' });

test('mixed gates compose achievements, stages, stats, contribution, nodes, and authored alternatives', () => {
  const context = {
    achievements: new Set(['focused_work']),
    achievementStages: { focused_work: 2 },
    stats: { 'tasks-completed': 100, 'dojo-advances': 50 },
    balances: { lifetimeContribution: 900 },
    unlockedNodes: new Set(['bearing:forge']),
    chapterChoices: new Map([['bearing', {}]]),
  };
  const result = evaluateRoadGate({
    kind: 'all',
    gates: [
      { kind: 'achievement', achievementId: 'focused_work' },
      { kind: 'achievement-stage', achievementId: 'focused_work', value: 2 },
      { kind: 'contribution', value: 750 },
      { kind: 'node', nodeId: 'bearing:forge' },
      { kind: 'chapter', chapterId: 'bearing' },
      {
        kind: 'any',
        gates: [
          { kind: 'stat', stat: 'tasks-completed', value: 100 },
          { kind: 'stat', stat: 'dojo-advances', value: 1000 },
        ],
      },
      {
        kind: 'min', count: 2,
        gates: [
          { kind: 'stat', stat: 'tasks-completed', value: 100 },
          { kind: 'stat', stat: 'dojo-advances', value: 50 },
          { kind: 'stat', stat: 'matches-completed', value: 1 },
        ],
      },
    ],
  }, context);
  assert.equal(result.passed, true);
  assert.equal(result.current, 7);
});

test('Contribution balance is permanent positive evidence minus Road spending only', () => {
  assert.deepEqual(getContributionBalances([
    { parent: 'p1', value: 80 },
    { parent: 'p1', value: -500 },
    { parent: 'p1', value: 40 },
    { parent: 'p2', value: 900 },
  ], [
    { parent: 'p1', contributionSpent: 50 },
    { parent: 'p1', contributionSpent: -20 },
  ], 'p1'), {
    lifetimeContribution: 120,
    roadSpending: 50,
    spendableContribution: 70,
  });
});

test('100 completed matches satisfy the stat without inventing an unrelated achievement', () => {
  const stats = deriveRoadStats({ matches: Array.from({ length: 100 }, (_, index) => completed(`match-${index}`)) }, 'p1');
  assert.equal(stats['matches-completed'], 100);
  assert.equal(stats['pair-matches'], 0);
  assert.equal(Object.hasOwn(stats, 'achievement'), false);
});

test('Dojo advances count distinct recommendations only after presentation, visible dwell, and durable leave', () => {
  const events = [];
  for (let index = 0; index < 1000; index += 1) {
    const decisionUUID = `decision-${index}`;
    events.push(
      { UUID: `${decisionUUID}:present`, parent: 'p1', decisionUUID, type: 'recommendation_presented', payload: {} },
      { UUID: `${decisionUUID}:visible`, parent: 'p1', decisionUUID, type: 'recommendation_visibility_accumulated', payload: { visibleMs: 350 } },
      { UUID: `${decisionUUID}:leave`, parent: 'p1', decisionUUID, type: 'recommendation_skipped', payload: { reason: index % 2 ? 'dojo-next-request' : 'dojo-scroll-skip' } },
      { UUID: `${decisionUUID}:duplicate`, parent: 'p1', decisionUUID, type: 'recommendation_skipped', payload: { reason: 'dojo-scroll-skip' } },
    );
  }
  events.push(
    { UUID: 'invisible:present', parent: 'p1', decisionUUID: 'invisible', type: 'recommendation_presented', payload: {} },
    { UUID: 'invisible:leave', parent: 'p1', decisionUUID: 'invisible', type: 'recommendation_skipped', payload: { reason: 'dojo-next-request' } },
    { UUID: 'retry:present', parent: 'p1', decisionUUID: 'retry', type: 'recommendation_presented', payload: { visibleMs: 100 } },
    { UUID: 'retry:leave', parent: 'p1', decisionUUID: 'retry', type: 'recommendation_skipped', payload: { reason: 'retry' } },
  );
  assert.equal(deriveRoadStats({ taskRecommendations: events }, 'p1')['dojo-advances'], 1000);
});

class MemoryRoadDatabase {
  constructor() {
    this.stores = new Map();
    this.achievementV2 = {
      getEvidence: async () => [],
      getAllProgress: async () => [],
      getStageReceipts: async () => [],
    };
    this.historyReads = 0;
  }

  map(store) {
    if (!this.stores.has(store)) this.stores.set(store, new Map());
    return this.stores.get(store);
  }

  seed(store, records) {
    for (const record of records) this.map(store).set(record.UUID, structuredClone(record));
  }

  async get(store, UUID) {
    return structuredClone(this.map(store).get(UUID) || null);
  }

  async getAll(store) {
    this.historyReads += 1;
    return [...this.map(store).values()].map((record) => structuredClone(record));
  }

  async getPlayerStore(store, profileId) {
    return [...this.map(store).values()]
      .filter((record) => String(record.parent || '') === String(profileId))
      .map((record) => structuredClone(record));
  }

  async add(store, record) {
    this.map(store).set(record.UUID, structuredClone(record));
    return record.UUID;
  }

  async commitAtomicMutation({ puts = [] }) {
    const staged = new Map([...this.stores].map(([store, records]) => [store, new Map(records)]));
    for (const { store, record } of puts) {
      if (!staged.has(store)) staged.set(store, new Map());
      staged.get(store).set(record.UUID, structuredClone(record));
    }
    this.stores = staged;
    return { changed: puts.length > 0 };
  }
}

test('authored Achievement Pack manifests are connected, acyclic, rewarded, and conflict-symmetric', () => {
  const validation = validateAchievementPackCatalog();
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.deepEqual(ACHIEVEMENT_PACKS.map((pack) => pack.name), ['First Weave', 'Long Horizon']);
  assert.equal(ACHIEVEMENT_PACKS.every((pack) => pack.nodeIds.length >= 13), true);
});

test('all Achievement Pack unlock modes resolve their intended price and earned behavior', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.contribution, [{ UUID: 'contribution-pack', parent: 'p1', value: 500 }]);
  database.seed(STORES.contributionRoadStat, [{
    UUID: 'road-stats:p1',
    parent: 'p1',
    stats: {
      'goals-completed': 1,
      'tasks-completed': 25,
      'substantive-entries': 10,
      'matches-completed': 10,
    },
  }]);
  const earned = await previewAchievementPackClaim(database, 'p1', 'bearing:compass');
  const contribution = await previewAchievementPackClaim(database, 'p1', 'bearing:forge');
  const earnedAnd = await previewAchievementPackClaim(database, 'p1', 'bearing:fellowship');
  const earnedOr = await previewAchievementPackClaim(database, 'p1', 'bearing:chronicle');
  assert.deepEqual([
    [earned.unlockMethod, earned.contributionSpent],
    [contribution.unlockMethod, contribution.contributionSpent],
    [earnedAnd.unlockMethod, earnedAnd.contributionSpent],
    [earnedOr.unlockMethod, earnedOr.contributionSpent],
  ], [
    ['earned', 0],
    ['contribution', 50],
    ['earned-and-contribution', 50],
    ['earned', 0],
  ]);
  const free = getAchievementPackNodeState(
    { id: 'free-checkpoint', unlockMode: 'free', parentIds: [], conflictIds: [], cost: 0 },
    { unlockedNodes: new Set(), excludedNodeIds: new Set(), balances: { spendableContribution: 0 } },
  );
  assert.equal(free.state, 'eligible');
});

test('earned-or-Contribution falls back to a paid bypass and insufficient balances stay locked', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.contribution, [{ UUID: 'small-balance', parent: 'p1', value: 50 }]);
  database.seed(STORES.contributionRoadStat, [{ UUID: 'road-stats:p1', parent: 'p1', stats: {} }]);
  const bypass = await previewAchievementPackClaim(database, 'p1', 'bearing:chronicle');
  assert.equal(bypass.unlockMethod, 'contribution-bypass');
  assert.equal(bypass.contributionSpent, 50);
  await claimAchievementPackNode(database, 'p1', 'bearing:chronicle');
  await assert.rejects(
    previewAchievementPackClaim(database, 'p1', 'bearing:forge'),
    { code: 'achievement-pack-route-closed' },
  );
});

test('pack claim receipts serialize duplicate clicks and atomically store rewards and exclusions', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.contribution, [{ UUID: 'pack-balance', parent: 'p1', value: 500 }]);
  database.seed(STORES.contributionRoadStat, [{ UUID: 'road-stats:p1', parent: 'p1', stats: { 'goals-completed': 1 } }]);
  const preview = await previewAchievementPackClaim(database, 'p1', 'bearing:compass');
  assert.deepEqual(preview.excludedNodeIds, ['bearing:fellowship']);
  const outcomes = await Promise.allSettled([
    claimAchievementPackNode(database, 'p1', 'bearing:compass'),
    claimAchievementPackNode(database, 'p1', 'bearing:compass'),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
  const receipts = await database.getPlayerStore(STORES.contributionRoadUnlock, 'p1');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].packId, 'first-weave');
  assert.equal(receipts[0].unlockMethod, 'earned');
  assert.deepEqual(receipts[0].excludedNodeIds, ['bearing:fellowship']);
  assert.equal((await database.getPlayerStore(STORES.inventory, 'p1')).length, 3);
  const progress = await getContributionRoadProgress(database, 'p1');
  assert.equal(progress.packs[0].nodes.find((node) => node.id === 'bearing:compass').state, 'claimed');
  assert.equal(progress.packs[0].nodes.find((node) => node.id === 'bearing:fellowship').state, 'excluded');
});

test('preview closures propagate only through routes made unreachable by authored parents', () => {
  const firstWeave = ACHIEVEMENT_PACKS[0];
  const nodes = firstWeave.nodeIds.map((id) => CONTRIBUTION_ROAD_NODES.find((node) => node.id === id));
  const closed = resolveAchievementPackExclusions(nodes, 'bearing:compass', new Set());
  assert.equal(closed.includes('bearing:fellowship'), true);
  assert.equal(closed.includes('workshop:compass'), false, 'Surveyor remains reachable from True North');
});

test('legacy chapter claims remain pack-readable without changing historical spending or inventory', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.contribution, [{ UUID: 'legacy-balance', parent: 'p1', value: 500 }]);
  database.seed(STORES.contributionRoadUnlock, [{
    UUID: 'road-unlock:p1:bearing',
    parent: 'p1',
    chapterId: 'bearing',
    nodeIds: ['bearing:compass', 'bearing:forge'],
    contributionSpent: 100,
  }]);
  database.seed(STORES.inventory, [{ UUID: 'legacy-item', parent: 'p1', itemId: 'bearing-compass-title', quantity: 1 }]);
  const progress = await getContributionRoadProgress(database, 'p1');
  assert.equal(progress.balances.roadSpending, 100);
  assert.equal(progress.packs[0].nodes.find((node) => node.id === 'bearing:compass').state, 'claimed');
  assert.equal(progress.packs[0].nodes.find((node) => node.id === 'bearing:forge').state, 'claimed');
  assert.equal((await database.getPlayerStore(STORES.inventory, 'p1')).length, 1);
});

test('chapter commitment selects exactly two, spends once, grants rewards atomically, and serializes duplicate clicks', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.contribution, [{ UUID: 'contribution-1', parent: 'p1', value: 250 }]);
  database.seed(STORES.contributionRoadStat, [{
    UUID: 'road-stats:p1', parent: 'p1', stats: { 'goals-completed': 1, 'tasks-completed': 25 },
  }]);
  const outcomes = await Promise.allSettled([
    commitRoadChapter(database, 'p1', 'bearing', ['bearing:compass', 'bearing:forge']),
    commitRoadChapter(database, 'p1', 'bearing', ['bearing:compass', 'bearing:forge']),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
  assert.equal((await database.getPlayerStore(STORES.contributionRoadChoice, 'p1')).length, 1);
  const unlocks = await database.getPlayerStore(STORES.contributionRoadUnlock, 'p1');
  assert.equal(unlocks[0].contributionSpent, 100);
  assert.deepEqual(unlocks[0].nodeIds, ['bearing:compass', 'bearing:forge']);
  assert.equal((await database.getPlayerStore(STORES.inventory, 'p1')).length, 8);
});

test('completed Opening Trail receipts avoid a full-history scan on normal loading', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.interfaceRevealReceipt, Array.from({ length: 10 }, (_, index) => ({
    UUID: `interface-reveal:p1:${index + 1}`,
    parent: 'p1',
    step: index + 1,
    revealed: true,
    milestoneSatisfied: true,
    reveals: [`capability-${index + 1}`],
  })));
  const result = await reconcileOpeningTrail(database, 'p1');
  assert.equal(result.complete, true);
  assert.equal(result.revealedCapabilities.size, 10);
  assert.equal(database.historyReads, 0);
});

test('Opening Trail remembers out-of-order milestones and cascades once prior reveals are satisfied', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.contributionRoadStat, [{ UUID: 'road-stats:p1', parent: 'p1', stats: {} }]);
  database.seed(STORES.reminder, [{ UUID: 'reminder-early', parent: 'p1' }]);
  const early = await reconcileOpeningTrail(database, 'p1');
  assert.equal(early.steps[3].milestoneSatisfied, true);
  assert.equal(early.steps[3].revealed, false);

  database.seed(STORES.task, [completed('task-1'), completed('task-2')]);
  database.seed(STORES.contributionRoadStat, [{ UUID: 'road-stats:p1', parent: 'p1', stats: { 'tasks-completed': 2 } }]);
  const cascaded = await reconcileOpeningTrail(database, 'p1');
  assert.equal(cascaded.steps.slice(0, 4).every((step) => step.revealed), true);
  assert.equal(cascaded.steps[4].revealed, false);
});

test('substantial imported profiles infer the complete interface without branch choices or spending', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.contributionRoadStat, [{ UUID: 'road-stats:p1', parent: 'p1', stats: { 'tasks-completed': 25, 'substantive-entries': 10, 'matches-completed': 10 } }]);
  const imported = await reconcileOpeningTrail(database, 'p1', { imported: true });
  assert.equal(imported.complete, true);
  assert.equal((await database.getPlayerStore(STORES.contributionRoadChoice, 'p1')).length, 0);
  assert.equal((await database.getPlayerStore(STORES.contributionRoadUnlock, 'p1')).length, 0);
});

test('normal Road loading stays projection-only with 100,000 mixed historical records', async () => {
  const database = new MemoryRoadDatabase();
  database.seed(STORES.task, Array.from({ length: 100000 }, (_, index) => completed(`historical-${index}`)));
  database.seed(STORES.contributionRoadStat, [{
    UUID: 'road-stats:p1', parent: 'p1', projectionVersion: 1,
    stats: { 'tasks-completed': 100000, 'matches-completed': 100, 'dojo-advances': 1000 },
  }]);
  database.seed(STORES.contribution, [{ UUID: 'contribution-scale', parent: 'p1', value: 12000 }]);
  const startedAt = Date.now();
  const progress = await getContributionRoadProgress(database, 'p1');
  assert.equal(progress.stats['tasks-completed'], 100000);
  assert.equal(progress.balances.lifetimeContribution, 12000);
  assert.equal(database.historyReads, 0);
  assert.ok(Date.now() - startedAt < 250, 'Road loading should not scale with historical source records');
});
