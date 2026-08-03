import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./Tasks.js', import.meta.url), 'utf8');
source = source
  .replace("import { DAY, HOUR } from '@domain/constants.js';", "const DAY = 86400000; const HOUR = 3600000;")
  .replace("import { getLocalDate } from '@domain/time/Time.js';", "const getLocalDate = (value) => new Date(value);")
  .replace("import { normalizeTaskPlanningMetadata } from '@domain/planning/TaskPlanningEligibility.js';", "const normalizeTaskPlanningMetadata = (value) => value;")
  .replace("import { hashTaskRevision } from '@domain/planning/TaskPlanReceipt.js';", "const hashTaskRevision = () => 'test-revision';");
const tasks = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('ordinary task Points are exact and time-proportional without reward multipliers', () => {
  const ten = tasks.getTimeBasedTaskPoints(10 * 60_000, 'same-seed');
  const twenty = tasks.getTimeBasedTaskPoints(20 * 60_000, 'same-seed');
  assert.equal(ten.basePoints, 60);
  assert.equal(twenty.basePoints, 120);
  assert.equal(ten.randomFactor, 1);
  assert.equal(twenty.randomFactor, 1);
  assert.equal(twenty.points, ten.points * 2);
  assert.deepEqual(tasks.getTimeBasedTaskPoints(10 * 60_000, 'same-seed'), ten);
  assert.deepEqual(tasks.getTimeBasedTaskPoints(9_999), {
    points: 0,
    basePoints: 0,
    randomFactor: 1,
  });
  assert.deepEqual(tasks.getTimeBasedTaskPoints(19_999), {
    points: 1,
    basePoints: 1,
    randomFactor: 1,
  });
  assert.equal(tasks.getCanonicalTaskPoints({ points: 7.9, pointsBase: 4.8 }), 4);
  assert.equal(tasks.getCanonicalTaskPoints({ points: 7.9, pointsBase: 0 }), 7);
  assert.equal(tasks.getCanonicalTaskPoints({ points: 0, pointsBase: 0 }), 0);
});

test('task reward multiplier APIs are absent outside Match scoring', () => {
  assert.equal('getTaskMultiplier' in tasks, false);
  assert.equal('getCommitmentWeight' in tasks, false);
  assert.equal('getEffortTokenFactor' in tasks, false);
  assert.equal('getTokensFromTask' in tasks, false);
});
