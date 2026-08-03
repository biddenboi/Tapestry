import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./TodoList.jsx', import.meta.url), 'utf8');

test('the interactive Tasks surface does not run model inference during reloads', () => {
  assert.doesNotMatch(source, /buildTaskRecommenderRecommendation|requestIdleCallback|loadTaskRecommender/);
  assert.match(source, /setNextTodo\(selectNowTask\(recommendableTodos\)\)/);
});

test('the Now suggestion is deterministic and uses the existing priority projection', () => {
  const start = source.indexOf('function selectNowTask');
  const end = source.indexOf('\n}\n\nexport default function TodoList', start);
  const selector = source.slice(start, end);
  assert.match(selector, /Number\(right\.weight \|\| 0\) - Number\(left\.weight \|\| 0\)/);
  assert.match(selector, /highest-priority available task/);
});

test('the Tasks reload effect has a stable empty seed dependency', () => {
  assert.match(source, /const EMPTY_SEED_TODOS = Object\.freeze\(\[\]\)/);
  assert.match(source, /seedTodos = EMPTY_SEED_TODOS/);
  assert.doesNotMatch(source, /seedTodos = \[\]/);
});
