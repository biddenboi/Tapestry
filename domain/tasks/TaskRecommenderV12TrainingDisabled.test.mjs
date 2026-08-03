import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const protocolUrl = new URL('./TaskRecommenderProtocol.js', import.meta.url).href;
const settingsSource = (await readFile(new URL('./TaskRecommenderV12Settings.js', import.meta.url), 'utf8'))
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { appSetting: 'appSettings' };");
const settings = await import(dataUrl(settingsSource));
const ledgerSource = (await readFile(new URL('./TaskRecommenderLedger.js', import.meta.url), 'utf8'))
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { recommenderEvent: 'taskRecommendations' };")
  .replace("from './TaskRecommenderProtocol.js';", `from '${protocolUrl}';`);
const ledger = await import(dataUrl(ledgerSource));

class MemoryDb {
  records = new Map();
  key(store, UUID) { return `${store}:${UUID}`; }
  async get(store, UUID) { return this.records.get(this.key(store, UUID)) || null; }
  async add(store, record) { this.records.set(this.key(store, record.UUID), structuredClone(record)); return record; }
  async getPlayerStore(store, parent) {
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(`${store}:`))
      .map(([, record]) => structuredClone(record))
      .filter((record) => String(record.parent) === String(parent));
  }
  async commitAtomicMutation(mutation) {
    for (const entry of mutation.puts || []) await this.add(entry.store, entry.record);
    return { changed: true };
  }
}

test('training-disabled settings remain normalized and authoritative', async () => {
  const db = new MemoryDb();
  const saved = await settings.saveTaskRecommenderV12Settings(db, 'player-1', {
    continuousTraining: false,
    minimumEventsBeforeTraining: 20,
  });
  const loaded = await settings.getTaskRecommenderV12Settings(db, 'player-1');
  assert.equal(saved.continuousTraining, false);
  assert.equal(loaded.continuousTraining, false);
  assert.equal(settings.isTaskRecommenderV12AutomaticTrainingEnabled(loaded), false);
  assert.equal(saved.minimumResolvedDecisionsBeforeTraining, 20);
  assert.equal('minimumEventsBeforeTraining' in saved, false);
  assert.equal(settings.isTaskRecommenderV12TrainingEvidenceSufficient(loaded, 19), false);
  assert.equal(settings.isTaskRecommenderV12TrainingEvidenceSufficient(loaded, 20), true);
});

test('authoritative outcomes persist while automatic training is disabled', async () => {
  const db = new MemoryDb();
  await settings.saveTaskRecommenderV12Settings(db, 'player-1', { continuousTraining: false });
  const written = await ledger.appendTaskRecommenderProtocolEvents(db, [{
    playerUUID: 'player-1',
    decisionUUID: 'decision-1',
    type: 'task_session_finished',
    eventKey: 'completed-session',
    occurredAt: '2026-07-11T12:00:00.000Z',
    source: 'tasks',
    taskUUID: 'task-1',
    payload: { productiveSeconds: 900, committedSeconds: 900 },
  }]);
  assert.equal(written.length, 1);
  const persisted = await ledger.getTaskRecommenderProtocolEvents(db, 'player-1');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].payload.productiveSeconds, 900);
  assert.equal((await settings.getTaskRecommenderV12Settings(db, 'player-1')).continuousTraining, false);
});

test('decision, presentation, visibility, and skip facts persist through the local ledger offline', async () => {
  const db = new MemoryDb();
  db.networkAvailable = false;
  const common = {
    playerUUID: 'player-1',
    decisionUUID: 'offline-decision',
    occurredAt: '2026-07-11T12:00:00.000Z',
    source: 'dojo',
    taskUUID: 'task-1',
  };
  const written = await ledger.appendTaskRecommenderProtocolEvents(db, [
    {
      ...common,
      type: 'recommendation_decision_created',
      eventKey: 'offline-created',
      payload: { taskSnapshot: { UUID: 'task-1' }, proposedDurationSeconds: 900 },
    },
    {
      ...common,
      type: 'recommendation_presented',
      eventKey: 'offline-presented',
      payload: { minimumVisibleRatio: 0.6 },
    },
    {
      ...common,
      type: 'recommendation_visibility_accumulated',
      eventKey: 'offline-visible-1',
      payload: { segmentId: 'offline-segment', visibleMs: 750 },
    },
    {
      ...common,
      type: 'recommendation_skipped',
      eventKey: 'offline-skipped',
      payload: { reason: 'dojo-scroll-skip' },
    },
  ]);
  assert.equal(written.length, 4);
  const persisted = await ledger.getTaskRecommenderProtocolEvents(db, 'player-1');
  assert.deepEqual(persisted.map((entry) => entry.type), [
    'recommendation_decision_created',
    'recommendation_presented',
    'recommendation_visibility_accumulated',
    'recommendation_skipped',
  ]);
  assert.equal(persisted[2].payload.visibleMs, 750);
});

test('outcome persistence precedes the optional automatic-training schedule', async () => {
  const source = await readFile(new URL('./TaskRecommender.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function recordTaskRecommendationOutcome');
  const end = source.indexOf('export async function recordTaskRecommendationSessionResult', start);
  const outcomeSource = source.slice(start, end);
  assert.ok(outcomeSource.indexOf('appendTaskRecommenderProtocolEvents') < outcomeSource.indexOf('scheduleTaskRecommenderTraining'));
  assert.match(outcomeSource, /normalized !== 'accepted'/);
  const scheduleStart = source.indexOf('function scheduleTaskRecommenderTraining');
  const scheduleEnd = source.indexOf('export async function launchRecommendedTask', scheduleStart);
  const scheduleSource = source.slice(scheduleStart, scheduleEnd);
  assert.match(scheduleSource, /isTaskRecommenderV12AutomaticTrainingEnabled\(settings\)/);
  assert.match(scheduleSource, /isTaskRecommenderV12TrainingEvidenceSufficient\(settings, resolvedDecisionCount\)/);
  assert.ok(scheduleSource.indexOf('isTaskRecommenderV12AutomaticTrainingEnabled') < scheduleSource.indexOf('trainTaskRecommender(databaseConnection'));
  assert.ok(scheduleSource.indexOf('isTaskRecommenderV12TrainingEvidenceSufficient') < scheduleSource.indexOf('trainTaskRecommender(databaseConnection'));
});
