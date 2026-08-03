import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./recordVisibility.js', import.meta.url), 'utf8'))
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = { task: 'tasks', match: 'matches', journal: 'journals' };",
  );

const visibility = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('completed task visibility uses completion IGT instead of preview/session start IGT', () => {
  const record = {
    inGameTimestamp: 100,
    completedInGameTimestamp: 250,
  };

  assert.equal(visibility.getRecordVisibilityIGT('tasks', record), 250);
  assert.equal(visibility.isRecordVisibleThroughIGT('tasks', record, 200), false);
  assert.equal(visibility.isRecordVisibleThroughIGT('tasks', record, 250), true);
});

test('match replay visibility prefers completed match IGT', () => {
  const match = {
    inGameTimestamp: 80,
    result: { inGameTimestamp: 120 },
    completedInGameTimestamp: 400,
  };

  assert.equal(visibility.getRecordVisibilityIGT('matches', match), 400);
  assert.equal(visibility.isRecordVisibleThroughIGT('matches', match, 399), false);
  assert.equal(visibility.isRecordVisibleThroughIGT('matches', match, 401), true);
});


test('zero completion sentinels do not move completed records back to IGT zero', () => {
  const task = { inGameTimestamp: 300, completedInGameTimestamp: 0 };
  const match = {
    inGameTimestamp: 200,
    completedInGameTimestamp: 0,
    result: { inGameTimestamp: 450 },
  };
  assert.equal(visibility.getRecordVisibilityIGT('tasks', task), 300);
  assert.equal(visibility.getRecordVisibilityIGT('matches', match), 450);
  assert.equal(visibility.isRecordVisibleThroughIGT('matches', match, 449), false);
});
