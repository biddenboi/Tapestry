import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearTaskRecommenderV12DevelopmentReports,
  getTaskRecommenderV12DevelopmentReports,
  reportTaskRecommenderV12Migration,
  reportTaskRecommenderV12Inference,
  reportTaskRecommenderV12Persistence,
  taskRecommenderV12DevelopmentSummary,
  taskRecommenderV12PayloadBytes,
  taskRecommenderV12ReportTimer,
} from './TaskRecommenderV12DevelopmentReporter.js';

test.beforeEach(() => clearTaskRecommenderV12DevelopmentReports());

test('development reporting measures v12 persistence payload size without retaining payloads', () => {
  const payload = { format: 'tapestry-task-recommender-v12-bundle', checkpoint: { updates: 4 } };
  const entry = reportTaskRecommenderV12Persistence({
    operation: 'bundle-export',
    playerUUID: 'player-1',
    payload,
    recordCount: 2,
  });
  assert.equal(entry.type, 'persistence-size');
  assert.equal(entry.operation, 'bundle-export');
  assert.equal(entry.bytes, taskRecommenderV12PayloadBytes(payload));
  assert.equal(entry.recordCount, 2);
  assert.equal('payload' in entry, false);
  assert.equal(taskRecommenderV12DevelopmentSummary().totalPersistenceBytes, entry.bytes);
});

test('development reporting records migration duration and source-to-converted size', async () => {
  const startedAt = taskRecommenderV12ReportTimer();
  await new Promise((resolve) => setTimeout(resolve, 2));
  const entry = reportTaskRecommenderV12Migration({
    playerUUID: 'player-1',
    startedAt,
    sourcePayload: { legacy: ['one', 'two'] },
    convertedPayload: { events: ['one'] },
    sourceRecordCount: 2,
    convertedRecordCount: 1,
    status: 'complete',
  });
  assert.equal(entry.type, 'migration-time');
  assert.equal(entry.status, 'complete');
  assert.ok(entry.durationMs >= 0);
  assert.ok(entry.sourceBytes > entry.convertedBytes);
  assert.equal(entry.sourceRecordCount, 2);
  assert.equal(entry.convertedRecordCount, 1);
  const summary = taskRecommenderV12DevelopmentSummary();
  assert.equal(summary.migrationCount, 1);
  assert.equal(summary.latestMigration, entry);
  assert.equal(summary.peakMigrationMs, entry.durationMs);
});

test('development reporting exposes hydration and scoring bottlenecks without retaining tensors', () => {
  const entry = reportTaskRecommenderV12Inference({
    playerUUID: 'player-1',
    source: 'dojo',
    device: {
      hydrationMs: 12,
      scoringMs: 34,
      totalMs: 46,
      actionCount: 17,
      protocolEventCount: 240,
      checkpointBytes: 120_000,
    },
  });
  assert.equal(entry.type, 'inference-performance');
  assert.equal(entry.source, 'dojo');
  assert.equal(entry.totalMs, 46);
  assert.equal(entry.actionCount, 17);
  assert.equal('device' in entry, false);
  const summary = taskRecommenderV12DevelopmentSummary();
  assert.equal(summary.inferenceCount, 1);
  assert.equal(summary.peakInferenceMs, 46);
  assert.equal(summary.latestInference, entry);
});

test('development reporting remains bounded', () => {
  for (let index = 0; index < 48; index += 1) {
    reportTaskRecommenderV12Persistence({ operation: `write-${index}`, payload: { index } });
  }
  const reports = getTaskRecommenderV12DevelopmentReports();
  assert.equal(reports.length, 40);
  assert.equal(reports[0].operation, 'write-8');
  assert.equal(reports.at(-1).operation, 'write-47');
});
