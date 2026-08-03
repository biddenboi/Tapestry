import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const encodingSource = await readFile(new URL('./TaskRecommenderV12Encoding.js', import.meta.url), 'utf8');
const encodingUrl = dataUrl(encodingSource);
let source = await readFile(new URL('./TaskRecommenderV12CandidateEvidence.js', import.meta.url), 'utf8');
source = source
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { appSetting: 'appSettings' };")
  .replace("from './TaskRecommenderV12Encoding.js';", `from '${encodingUrl}';`);
const evidence = await import(dataUrl(source));
const encoding = await import(encodingUrl);

test('candidate evidence deduplicates immutable task snapshots and retains exact actions', () => {
  const actions = encoding.buildTaskRecommenderV12ActionSet([
    { UUID: 'task-1', parent: 'player-1', name: 'Draft', estimatedDuration: 25 },
    { UUID: 'task-2', parent: 'player-1', name: 'Review', estimatedDuration: 15 },
  ], { minDurationSeconds: 300, maxDurationSeconds: 1200, durationPointCount: 3 });
  const built = evidence.buildTaskRecommenderV12CandidateEvidence({
    playerUUID: 'player-1',
    candidateActions: actions,
    occurredAt: '2026-07-11T12:00:00.000Z',
    source: 'dojo',
    constraints: { minDurationSeconds: 300, targetDurationSeconds: 900 },
  });
  assert.equal(built.records.length, 2);
  assert.equal(built.manifest.taskCount, 2);
  assert.equal(built.manifest.actionCount, actions.length);
  assert.deepEqual(
    built.manifest.actions.map((action) => action.actionKey),
    actions.map((action) => action.actionKey),
  );
  assert.equal(built.manifest.constraints.targetDurationSeconds, 900);
  assert.ok(built.manifest.actions.every((action) => (
    built.records.some((put) => put.record.UUID === action.snapshotUUID)
  )));
});

test('candidate evidence refuses a stored content-address collision', async () => {
  const actions = encoding.buildTaskRecommenderV12ActionSet([
    { UUID: 'task-1', parent: 'player-1', name: 'Draft', estimatedDuration: 25 },
  ], { minDurationSeconds: 300, maxDurationSeconds: 600, durationPointCount: 2 });
  const built = evidence.buildTaskRecommenderV12CandidateEvidence({
    playerUUID: 'player-1', candidateActions: actions,
    occurredAt: '2026-07-11T12:00:00.000Z', source: 'tasks',
  });
  const db = {
    async get() {
      return {
        ...built.records[0].record,
        value: { ...built.records[0].record.value, snapshot: { UUID: 'different' } },
      };
    },
  };
  await assert.rejects(
    evidence.validateTaskRecommenderV12CandidateEvidenceRecords(db, built),
    /content address/,
  );
});
