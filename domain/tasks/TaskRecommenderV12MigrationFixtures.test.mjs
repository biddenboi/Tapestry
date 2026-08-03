import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TASK_RECOMMENDER_V11_FIELD_DISPOSITION,
  buildTaskRecommenderV11MigrationPlan,
  inspectTaskRecommenderV11PersistedArtifact,
} from './TaskRecommenderV12MigrationContract.js';

async function fixture(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

const supportedFixtures = [
  ['./fixtures/v11/weights-export-v11.json', 'v11-weights-export'],
  ['./fixtures/v11/raw-weights-record-v11.json', 'v11-raw-weights'],
  ['./fixtures/v11/training-data-v3.json', 'v11-training-data-v3'],
  ['./fixtures/v11/training-data-v2-mixed.json', 'v11-training-data-v2'],
  ['./fixtures/v11/linked-folder-records-v11.json', 'v11-linked-folder-records'],
];

for (const [fixturePath, sourceFormat] of supportedFixtures) {
  test(`offline migration fixture ${sourceFormat} is detected and stages v12 before discard`, async () => {
    const artifact = await fixture(fixturePath);
    const inspection = inspectTaskRecommenderV11PersistedArtifact(artifact);
    const plan = buildTaskRecommenderV11MigrationPlan(artifact, { targetPlayerUUID: 'player-2' });
    assert.equal(inspection.supported, true);
    assert.equal(inspection.sourceFormat, sourceFormat);
    assert.equal(plan.sourceFormat, sourceFormat);
    assert.equal(plan.writesActiveArtifacts, true);
    assert.equal(plan.stagesV12BeforeLegacyDiscard, true);
    assert.equal(plan.retainsSourceUntilDurableCommit, true);
    assert.equal(plan.retainsSourceAfterSuccessfulCommit, false);
    assert.equal(plan.runtimeFallbackAllowed, false);
  });
}

test('field disposition explicitly covers retained, transformed, and discarded v11 data', () => {
  const dispositions = new Set(TASK_RECOMMENDER_V11_FIELD_DISPOSITION.map((entry) => entry.disposition));
  assert.deepEqual([...dispositions].sort(), ['discarded', 'retained', 'transformed']);
  assert.ok(TASK_RECOMMENDER_V11_FIELD_DISPOSITION.some((entry) => (
    entry.match.includes('outcomeHistory') && entry.disposition === 'transformed'
  )));
  assert.ok(TASK_RECOMMENDER_V11_FIELD_DISPOSITION.some((entry) => (
    entry.match.includes('features') && entry.disposition === 'discarded'
  )));
  assert.ok(TASK_RECOMMENDER_V11_FIELD_DISPOSITION.some((entry) => (
    entry.match.includes('probability') && entry.disposition === 'transformed'
  )));
  assert.ok(TASK_RECOMMENDER_V11_FIELD_DISPOSITION.some((entry) => (
    entry.match.includes('weightControls') && entry.disposition === 'discarded'
  )));
});

test('unknown and unsupported persisted formats fail closed for repair handling', () => {
  const unknown = { format: 'unknown-recommender-data', formatVersion: 1 };
  const unsupported = { format: 'tapestry-task-recommender-training-data', formatVersion: 99 };
  assert.equal(inspectTaskRecommenderV11PersistedArtifact(unknown).supported, false);
  assert.equal(inspectTaskRecommenderV11PersistedArtifact(unsupported).supported, false);
  assert.throws(() => buildTaskRecommenderV11MigrationPlan(unknown), /Unsupported/);
  assert.throws(() => buildTaskRecommenderV11MigrationPlan(unsupported), /Unsupported/);
});
