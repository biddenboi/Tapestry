import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PersistenceDevelopmentReporter,
  PERSISTENCE_SIZE_BUDGET,
  persistencePayloadByteLength,
} from './PersistenceDevelopmentReporter.js';

test('development reporting records scoped generation size and changed domains', () => {
  const reporter = new PersistenceDevelopmentReporter();
  const source = new Map([
    ['.system-data/tasks.json', '[{"UUID":"task-1"}]'],
  ]);
  const committed = new Map([
    ['.generations/rev-1/.system-data/tasks.json', '[{"UUID":"task-1"}]'],
    ['.system-data/manifest.json', '{"syncRevision":"rev-1"}'],
  ]);
  const report = reporter.recordGeneration({
    syncRevision: 'rev-1',
    files: source,
    committedFiles: committed,
    changedDomains: ['tasks'],
    changedStores: ['tasks'],
    artifactClasses: ['authoritative-data'],
    mutationCount: 1,
    serializationMs: 2.5,
  });

  assert.deepEqual(report.changedDomains, ['tasks']);
  assert.equal(report.serializedBytes, persistencePayloadByteLength(source.values().next().value));
  assert.ok(report.generationSizeBytes > report.serializedBytes);
  assert.equal(reporter.summary().lastGeneration.syncRevision, 'rev-1');
});

test('hash timing is reported independently from serialization', () => {
  const reporter = new PersistenceDevelopmentReporter();
  const report = reporter.recordHash({ durationMs: 3.25, bytes: 2048, fileCount: 4 });
  assert.equal(report.durationMs, 3.25);
  assert.equal(report.bytes, 2048);
  assert.equal(reporter.summary().totalHashingMs, 3.25);
});


test('persistence size budgets remain visible in generation reports', () => {
  const reporter = new PersistenceDevelopmentReporter();
  const oversized = 'x'.repeat(PERSISTENCE_SIZE_BUDGET.maxSerializedBytesPerGeneration + 1);
  const report = reporter.recordGeneration({
    files: new Map([['large.json', oversized]]),
    committedFiles: new Map([['large.json', oversized]]),
  });
  assert.equal(report.budget.passed, false);
  assert.ok(report.budget.violations.includes('serialized-bytes'));
  assert.equal(reporter.summary().budgetViolationCount, 1);
});
