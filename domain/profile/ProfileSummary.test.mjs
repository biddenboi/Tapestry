import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const derivedCacheUrl = new URL('../../shared/cache/DerivedCache.js', import.meta.url).href;

const source = (await readFile(new URL('./ProfileSummary.js', import.meta.url), 'utf8'))
  .replace("from '@shared/cache/DerivedCache.js';", `from '${derivedCacheUrl}';`)
  .replace("import { STORES } from '@domain/constants.js';", `const STORES = ${JSON.stringify({
    player: 'players', task: 'tasks', journal: 'journals', event: 'events', transaction: 'transactions',
    match: 'matches', friendship: 'friendships', inventory: 'inventory', contribution: 'contributions', project: 'projects',
  })};`)
  .replace("import { buildProfileViewModel } from '@domain/profile/Profile.js';", `const buildProfileViewModel = ({ player, history, matches }) => ({
    summaryStats: [
      { id: 'elo', value: String(player.elo || 0) },
      { id: 'achievements', value: String(Object.keys(player.achievements || {}).length) },
    ],
    timelineEntries: history,
    eloSeries: [],
    matchSummary: { recent: matches },
    highlightCards: [],
  });`)
  .replace("import {\n  buildContributionByGoal,\n  getContributionTotal,\n  getContributionUnlockedCosmeticIds,\n} from '@domain/contribution/Contribution.js';", `const buildContributionByGoal = () => [];
const getContributionTotal = (rows) => rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
const getContributionUnlockedCosmeticIds = () => new Set();`);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { applyProfileSummaryOperations, buildProfileSummary } = await import(moduleUrl);

test('materialized profile summary keeps bounded presentation data', () => {
  const player = { UUID: 'p1', username: 'A', elo: 1200, achievements: {} };
  const tasks = Array.from({ length: 20 }, (_, index) => ({
    UUID: `t${index}`, parent: 'p1', completedAt: new Date(2026, 0, index + 1).toISOString(), points: 10,
  }));
  const summary = buildProfileSummary({ player, players: [player], tasks });
  assert.equal(summary.UUID, 'p1');
  assert.equal(summary.sourceCounts.tasks, 20);
  assert.equal(summary.profileView.timelineEntries.length, 12);
  assert.equal(summary.recentTimelineEntries.length, 5);
});

test('incremental task writes update only the affected summary', () => {
  const base = [
    { UUID: 'p1', schemaVersion: 1, player: { UUID: 'p1', elo: 1 }, sourceCounts: { tasks: 0 }, recentTimelineEntries: [], profileView: { timelineEntries: [], summaryStats: [] } },
    { UUID: 'p2', schemaVersion: 1, player: { UUID: 'p2', elo: 1 }, sourceCounts: { tasks: 0 }, recentTimelineEntries: [], profileView: { timelineEntries: [], summaryStats: [] } },
  ];
  const result = applyProfileSummaryOperations(base, [{
    type: 'put', store: 'tasks', record: { UUID: 't1', parent: 'p1', completedAt: '2026-01-01T00:00:00.000Z' }, previousRecord: null,
  }], '2026-01-02T00:00:00.000Z');
  assert.deepEqual(result.touched, ['p1']);
  assert.equal(result.summaries.find((row) => row.UUID === 'p1').sourceCounts.tasks, 1);
  assert.equal(result.summaries.find((row) => row.UUID === 'p2').sourceCounts.tasks, 0);
});

test('player writes refresh direct profile presentation without a history scan', () => {
  const result = applyProfileSummaryOperations([{
    UUID: 'p1', schemaVersion: 1, player: { UUID: 'p1', elo: 10 }, sourceCounts: {}, profileView: { summaryStats: [{ id: 'elo', value: '10' }] },
  }], [{
    type: 'put', store: 'players', record: { UUID: 'p1', elo: 42, username: 'Updated', achievements: {} }, previousRecord: { UUID: 'p1', elo: 10 },
  }]);
  const summary = result.summaries[0];
  assert.equal(summary.player.username, 'Updated');
  assert.equal(summary.profileView.summaryStats[0].value, '42');
});


test('profile creation and deletion materialize without a broad rebuild', () => {
  const created = applyProfileSummaryOperations([], [{
    type: 'put', store: 'players', record: { UUID: 'p3', username: 'New', elo: 0 }, previousRecord: null,
  }]);
  assert.equal(created.summaries.length, 1);
  assert.equal(created.summaries[0].player.username, 'New');
  const removed = applyProfileSummaryOperations(created.summaries, [{
    type: 'delete', store: 'players', UUID: 'p3', previousRecord: { UUID: 'p3', username: 'New' },
  }]);
  assert.equal(removed.summaries.length, 0);
  assert.deepEqual(removed.touched, ['p3']);
});

test('friendship changes update compact relationship state for both profiles', () => {
  const base = ['p1', 'p2'].map((UUID) => ({
    UUID, schemaVersion: 1, player: { UUID }, friendUUIDs: [], relationships: [], sourceCounts: { friends: 0 },
  }));
  const record = { UUID: 'f1', players: ['p1', 'p2'], requestedBy: 'p1', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' };
  const pending = applyProfileSummaryOperations(base, [{ type: 'put', store: 'friendships', record, previousRecord: null }]);
  assert.equal(pending.summaries.every((summary) => summary.relationships[0].UUID === 'f1'), true);
  const accepted = applyProfileSummaryOperations(pending.summaries, [{
    type: 'put', store: 'friendships', record: { ...record, status: 'accepted' }, previousRecord: record,
  }]);
  assert.deepEqual(accepted.summaries.find((summary) => summary.UUID === 'p1').friendUUIDs, ['p2']);
  assert.deepEqual(accepted.summaries.find((summary) => summary.UUID === 'p2').friendUUIDs, ['p1']);
});


test('contribution and goal writes update compact distribution without history scans', () => {
  const base = [{
    UUID: 'p1', schemaVersion: 1, player: { UUID: 'p1' }, contributionTotal: 0, contributionDistribution: [], sourceCounts: {},
  }];
  const contribution = { UUID: 'c1', parent: 'p1', goalUUID: 'g1', goalNameSnapshot: 'Original', value: 7 };
  const added = applyProfileSummaryOperations(base, [{ type: 'put', store: 'contributions', record: contribution, previousRecord: null }]);
  assert.equal(added.summaries[0].contributionTotal, 7);
  assert.deepEqual(added.summaries[0].contributionDistribution[0], {
    goalUUID: 'g1', name: 'Original', value: 7, color: '#4da3ff',
  });
  const renamed = applyProfileSummaryOperations(added.summaries, [{
    type: 'put', store: 'projects', record: { UUID: 'g1', name: 'Renamed', accentColor: '#fff' }, previousRecord: { UUID: 'g1', name: 'Original' },
  }]);
  assert.equal(renamed.summaries[0].contributionDistribution[0].name, 'Renamed');
  assert.equal(renamed.summaries[0].contributionDistribution[0].color, '#fff');
});
