import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const protocolSource = await readFile(new URL('./TaskRecommenderProtocol.js', import.meta.url), 'utf8');
const protocolUrl = dataUrl(protocolSource);
const protocol = await import(protocolUrl);
const ledgerSource = (await readFile(new URL('./TaskRecommenderLedger.js', import.meta.url), 'utf8'))
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { recommenderEvent: 'taskRecommendations' };")
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`);
const ledgerUrl = dataUrl(ledgerSource);
const ledger = await import(ledgerUrl);
const readerSource = (await readFile(new URL('./TaskRecommenderV11OfflineReader.js', import.meta.url), 'utf8'))
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`);
const readerUrl = dataUrl(readerSource);
const trainingUrl = dataUrl(`
  export const taskRecommenderV12CheckpointId = (playerUUID) => 'task-recommender-v12-checkpoint:' + playerUUID;
  export async function getTaskRecommenderV12Checkpoint() {
    const model = { modelVersion: 2, seed: 'cold-start' };
    return { model, targetModel: model, manifest: { status: 'cold-start' } };
  }
`);
const modelUrl = dataUrl('export const serializeTaskRecommenderV12Model = (model) => JSON.parse(JSON.stringify(model));');
const settingsUrl = dataUrl("export const taskRecommenderV12SettingsId = (playerUUID) => 'task-recommender-v12-settings:' + playerUUID;");

const runtimeUrl = dataUrl(`
  export const TASK_RECOMMENDER_V12_MIGRATION_SCHEMA_VERSION = 2;
  export const taskRecommenderV12MigrationId = (playerUUID) => 'task-recommender-v12-migration:' + playerUUID;
  export const taskRecommenderV12RepairId = (playerUUID) => 'task-recommender-v12-repair:' + playerUUID;
  export async function getTaskRecommenderV12MigrationState(db, playerUUID) {
    return (await db.get('appSettings', taskRecommenderV12MigrationId(playerUUID)).catch(() => null))?.value || null;
  }
  export async function assertTaskRecommenderV12RuntimeReady(db, playerUUID) {
    const state = await getTaskRecommenderV12MigrationState(db, playerUUID);
    if (state?.status === 'repair-required') {
      const error = new Error('repair required'); error.code = 'TASK_RECOMMENDER_V12_REPAIR_REQUIRED'; throw error;
    }
    if (state?.status === 'converted' || state?.cleanupPending || state?.recoveryRequired) {
      const error = new Error('migration pending'); error.code = 'TASK_RECOMMENDER_V12_MIGRATION_PENDING'; throw error;
    }
    return state;
  }
`);
const reporterUrl = dataUrl(`
  export const taskRecommenderV12ReportTimer = () => 0;
  export const reportTaskRecommenderV12Migration = () => null;
`);
const migrationSource = (await readFile(new URL('./TaskRecommenderV12Migration.js', import.meta.url), 'utf8'))
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { recommenderEvent: 'taskRecommendations', appSetting: 'appSettings' };")
  .replace("from './TaskRecommenderLedger.js';", `from '${ledgerUrl}';`)
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`)
  .replace("return import('./TaskRecommenderV11OfflineReader.js');", `return import('${readerUrl}');`)
  .replace("from './TaskRecommenderV12Training.js';", `from '${trainingUrl}';`)
  .replace("from './TaskRecommenderV12Model.js';", `from '${modelUrl}';`)
  .replace("from './TaskRecommenderV12Settings.js';", `from '${settingsUrl}';`)
  .replace("from './TaskRecommenderV12RuntimeState.js';", `from '${runtimeUrl}';`)
  .replace("from './TaskRecommenderV12DevelopmentReporter.js';", `from '${reporterUrl}';`);
const migration = await import(dataUrl(migrationSource));

class MemoryDb {
  records = new Map();
  commits = [];
  flushResults = [];

  key(store, UUID) { return `${store}:${UUID}`; }
  async get(store, UUID) { return this.records.get(this.key(store, UUID)) || null; }
  async add(store, record) { this.records.set(this.key(store, record.UUID), structuredClone(record)); return record; }
  async getPlayerStore(store, parent) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([, record]) => structuredClone(record))
      .filter((record) => String(record.parent || '') === String(parent));
  }
  async commitAtomicMutation(mutation) {
    this.commits.push(structuredClone(mutation));
    for (const entry of mutation.puts || []) await this.add(entry.store, entry.record);
    for (const entry of mutation.deletes || []) this.records.delete(this.key(entry.store, entry.UUID));
    return { changed: true, label: mutation.label };
  }
  async flushLinkedFolderWrite() {
    return this.flushResults.length ? this.flushResults.shift() : { changed: true, reason: 'flushed' };
  }
}

async function seedLegacy(db, { corrupt = false } = {}) {
  await db.add('appSettings', {
    UUID: 'taskRecommenderSettings',
    value: { continuousTraining: false, minimumEventsBeforeTraining: 12 },
  });
  await db.add('appSettings', {
    UUID: 'taskRecommenderWeights:player-1', parent: 'player-1',
    value: { modelVersion: corrupt ? 10 : 11, weights: { bias: 0.4 } },
  });
  await db.add('taskRecommendations', {
    UUID: 'legacy-decision-1', parent: 'player-1', type: 'next-task-impression',
    source: 'tasks', taskUUID: 'task-1', probability: 0.4,
    taskSnapshot: { UUID: 'task-1', parent: 'player-1', name: 'Write', requiredTimerMinutes: 20, semanticFeatures: [1], planningScore: 9, durationLadder: [5, 20] },
    decisionContext: { raw: { proxyHeads: { accept: 1 }, syntheticWeights: [0.4], durationCandidates: [300] } },
    createdAt: '2026-07-01T12:00:00.000Z',
    outcomeHistory: [{
      occurredAt: '2026-07-01T12:19:00.000Z', normalizedOutcome: 'completed',
      acceptedMinutes: 20, committedMs: 1_200_000, actualMs: 1_140_000,
      completedTaskUUID: 'task-1', completionEventUUID: 'completion-1',
    }],
  });
}

test('one-time migration writes v12 facts before discarding v11 and is idempotent', async () => {
  const db = new MemoryDb();
  await seedLegacy(db);
  const result = await migration.migrateTaskRecommenderV11Offline(db, 'player-1');
  assert.equal(result.status, 'complete');
  assert.deepEqual(db.commits.map((entry) => entry.label), [
    'task-recommender-v12-migration-convert',
    'task-recommender-v12-migration-cleanup',
  ]);
  const convert = db.commits[0];
  const cleanup = db.commits[1];
  assert.equal(convert.deletes?.length || 0, 0);
  assert.ok(convert.puts.some((entry) => entry.record.UUID === 'task-recommender-v12-checkpoint:player-1'));
  assert.ok(convert.puts.some((entry) => entry.record.UUID === 'task-recommender-v12-settings:player-1'));
  assert.ok(cleanup.deletes.some((entry) => entry.UUID === 'legacy-decision-1'));
  assert.equal(await db.get('appSettings', 'taskRecommenderSettings'), null);
  assert.equal(await db.get('appSettings', 'taskRecommenderWeights:player-1'), null);
  const settings = await db.get('appSettings', 'task-recommender-v12-settings:player-1');
  assert.equal(settings.value.continuousTraining, false);
  assert.equal(settings.value.minimumResolvedDecisionsBeforeTraining, 12);

  const events = await ledger.getTaskRecommenderProtocolEvents(db, 'player-1');
  assert.ok(events.some((event) => event.type === protocol.TASK_RECOMMENDER_EVENT_TYPES.taskSessionFinished
    && event.payload.productiveSeconds === 1140));
  assert.ok(events.some((event) => event.type === protocol.TASK_RECOMMENDER_EVENT_TYPES.taskRecordedComplete
    && event.payload.completionEventUUID === 'completion-1'));
  const serializedEvents = JSON.stringify(events);
  for (const removed of ['proxyHeads', 'syntheticWeights', 'semanticFeatures', 'planningScore', 'durationLadder', 'durationCandidates']) {
    assert.equal(serializedEvents.includes(removed), false, `${removed} was rewritten`);
  }
  const commitCount = db.commits.length;
  const repeated = await migration.migrateTaskRecommenderV11Offline(db, 'player-1');
  assert.equal(repeated.status, 'complete');
  assert.equal(db.commits.length, commitCount);
});

test('interrupted linked-folder migration retains v11 until the converted generation recovers', async () => {
  const db = new MemoryDb();
  await seedLegacy(db);
  db.flushResults.push({ reason: 'pending-retry' });
  const interrupted = await migration.migrateTaskRecommenderV11Offline(db, 'player-1');
  assert.equal(interrupted.status, 'converted');
  assert.equal(interrupted.recoveryRequired, true);
  assert.ok(await db.get('taskRecommendations', 'legacy-decision-1'));
  assert.ok(await db.get('appSettings', 'task-recommender-v12-checkpoint:player-1'));
  assert.equal(db.commits.some((entry) => entry.deletes?.length), false);

  db.flushResults.push({ reason: 'flushed' });
  const recovered = await migration.recoverTaskRecommenderV12Migration(db, 'player-1');
  assert.equal(recovered.status, 'complete');
  assert.equal(await db.get('taskRecommendations', 'legacy-decision-1'), null);
  assert.equal(db.commits.at(-1).label, 'task-recommender-v12-migration-cleanup');
});

test('unsupported or corrupt v11 data creates an explicit repair state without fallback or deletion', async () => {
  const db = new MemoryDb();
  await seedLegacy(db, { corrupt: true });
  const state = await migration.migrateTaskRecommenderV11Offline(db, 'player-1');
  assert.equal(state.status, 'repair-required');
  assert.equal(state.runtimeFallbackAllowed, false);
  assert.equal(state.legacyArtifactsRetained, true);
  assert.ok(await db.get('taskRecommendations', 'legacy-decision-1'));
  assert.ok(await db.get('appSettings', 'taskRecommenderWeights:player-1'));
  await assert.rejects(
    migration.ensureTaskRecommenderV12Cutover(db, 'player-1'),
    (error) => error.code === 'TASK_RECOMMENDER_V12_REPAIR_REQUIRED',
  );
});
