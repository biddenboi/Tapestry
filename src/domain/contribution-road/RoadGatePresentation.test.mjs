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
      '@domain': alias('../../domain'),
    },
  },
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});

test.after(async () => server.close());

const { describeRoadGate } = await server.ssrLoadModule(
  '/domain/contribution-road/RoadGatePresentation.js',
);
const { CONTRIBUTION_ROAD_NODES } = await server.ssrLoadModule(
  '/domain/contribution-road/ContributionRoadCatalog.js',
);

test('achievement requirements identify the exact evidence instead of saying incomplete', () => {
  const copy = describeRoadGate({
    kind: 'achievement',
    passed: false,
    current: 0,
    target: 1,
    gate: { kind: 'achievement', achievementId: 'wayfinder' },
    alternatives: [],
  });

  assert.match(copy, /Earn Wayfinder/);
  assert.match(copy, /finish condition, milestone, and executable next action/);
  assert.doesNotMatch(copy, /Requirement incomplete/);
});

test('stat and alternative requirements retain names and exact progress', () => {
  const stat = {
    kind: 'stat',
    passed: false,
    current: 12,
    target: 25,
    gate: { kind: 'stat', stat: 'tasks-completed', value: 25 },
    alternatives: [],
  };
  assert.equal(describeRoadGate(stat), 'Tasks completed: 12 / 25');
  assert.match(describeRoadGate({
    kind: 'any',
    passed: false,
    current: 0,
    target: 1,
    alternatives: [
      stat,
      {
        kind: 'contribution',
        passed: false,
        current: 9,
        target: 20,
        gate: { kind: 'contribution', value: 20 },
        alternatives: [],
      },
    ],
  }), /Tasks completed: 12 \/ 25.*OR.*Lifetime Contribution: 9 \/ 20/);
});

test('classic cosmetics are paced as individual Road milestones', () => {
  const classicRewards = CONTRIBUTION_ROAD_NODES.filter((node) => node.kind === 'classic-reward');
  assert.ok(classicRewards.length >= 20);
  assert.equal(classicRewards.every((node) => node.rewards.length === 1), true);
  assert.equal(new Set(classicRewards.map((node) => node.threshold)).size, classicRewards.length);
});
