import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./startupPerf.js', import.meta.url), 'utf8');
const previousWindow = globalThis.window;
globalThis.window = {};
const perf = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#startup-perf`);

test.after(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

test.beforeEach(() => {
  perf.resetStartupMarks();
});

test('startup database reads are counted by store until startup settles', () => {
  perf.recordStartupDatabaseRead('players', { operation: 'get', records: 1 });
  perf.recordStartupDatabaseRead('tasks', { operation: 'scan', records: 7 });
  perf.markStartupSettled();
  perf.recordStartupDatabaseRead('journals', { operation: 'scan', records: 3 });

  const summary = perf.summarizeStartupMetrics();
  assert.equal(summary.startupDatabaseReads, 2);
  assert.equal(summary.startupDatabaseRecordsRead, 8);
  assert.equal(summary.startupDatabaseReadsByStore.players.operations.get, 1);
  assert.equal(summary.startupDatabaseReadsByStore.tasks.operations.scan, 1);
  assert.equal(summary.startupDatabaseReadsByStore.journals, undefined);
});

test('hydration snapshots report stores and records without persisting telemetry', () => {
  perf.recordStoreHydration('sqlite-boot', new Map([
    ['players', new Map([['p1', {}], ['p2', {}]])],
    ['settings', new Map()],
  ]));

  const [snapshot] = perf.summarizeStartupMetrics().hydrationSnapshots;
  assert.equal(snapshot.source, 'sqlite-boot');
  assert.equal(snapshot.storeCount, 2);
  assert.equal(snapshot.nonEmptyStoreCount, 1);
  assert.equal(snapshot.recordCount, 2);
  assert.deepEqual(snapshot.stores, { players: 2, settings: 0 });
});

test('dynamic module loads and active-panel readiness are measured separately', async () => {
  perf.markPanelOpenRequested('feed');
  const loaded = await perf.measureDynamicModule('feed', async () => ({ default: 'Feed' }));
  const panel = perf.markActivePanelReady('feed');
  const summary = perf.summarizeStartupMetrics();

  assert.equal(loaded.default, 'Feed');
  assert.equal(summary.dynamicModuleLoads, 1);
  assert.equal(summary.dynamicModules[0].name, 'feed');
  assert.equal(summary.dynamicModules[0].status, 'loaded');
  assert.equal(panel.panel, 'feed');
  assert.ok(panel.loadTime >= 0);
  assert.ok(summary.timeToActivePanelMs >= 0);
});

test('startup summary separates shell time from blocking-work support', () => {
  perf.registerStaticModule('main');
  perf.registerStaticModule('main');
  perf.markShellReady();
  const summary = perf.summarizeStartupMetrics();

  assert.ok(summary.timeToShellMs >= 0);
  assert.equal(summary.staticModulesRegistered, 2); // startupPerf plus main
  assert.equal(typeof summary.longTaskMeasurementSupported, 'boolean');
});


test('startup read budgets reject broad domain reads and excessive records', () => {
  const within = perf.evaluateStartupReadBudget({
    startupDatabaseReads: 3,
    startupDatabaseRecordsRead: 4,
    startupDatabaseReadsByStore: { players: { reads: 1 }, appSettings: { reads: 2 } },
    hydrationSnapshots: [{ stores: { players: 1, appSettings: 3 } }],
  });
  assert.equal(within.passed, true);

  const broad = perf.evaluateStartupReadBudget({
    startupDatabaseReads: 9,
    startupDatabaseRecordsRead: 100,
    startupDatabaseReadsByStore: { tasks: { reads: 9 } },
    hydrationSnapshots: [{ stores: { players: 1, tasks: 99, matches: 1, shop: 1, journals: 1 } }],
  });
  assert.equal(broad.passed, false);
  assert.deepEqual(broad.unexpectedStores, ['tasks']);
  assert.ok(broad.violations.some((entry) => entry.startsWith('reads:')));
});
