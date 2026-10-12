import test from 'node:test';
import assert from 'node:assert/strict';
import { factsFromTodo } from '@domain/r1/facts.js';
import { normalizeR1TodoFields } from '@domain/tasks/R1TodoFields.js';
import { advanceRecurringTodo } from '@domain/tasks/TaskRecurrence.js';
test('R1 receives only observable scheduling facts, never task content or reward weights', () => {
  const facts = factsFromTodo({ UUID: 't', dueDate: 'due', startDate: 'start', estimatedDuration: 30, name: 'private', title: 'private', description: 'private', aversion: 3, points: 10 }, { toHours: (s) => s === 'due' ? 24 : 0 });
  assert.deepEqual(Object.keys(facts).sort(), ['id', 'q', 'l', 'd', 'start', 'cycle', 'habit', 'category', 'block', 'after', 'completed'].sort());
  assert.equal(facts.q, 0.5);
});
test('old todos default to no start and no habit, and minimum must be integral', () => {
  assert.deepEqual(normalizeR1TodoFields({ UUID: 't' }), { UUID: 't', startDate: null, isHabit: false, habitMinMinutes: null });
  assert.throws(() => normalizeR1TodoFields({ habitMinMinutes: 1.5 }));
});
test('a repeat shifts start by the exact same displacement as due', () => {
  const old = { dueDate: '2026-10-12T18:00:00Z', startDate: '2026-10-12T09:00:00Z', recurrence: { frequency: 'day', interval: 1 } };
  const next = advanceRecurringTodo(old, '2026-10-12T23:00:00Z');
  assert.equal(new Date(next.startDate) - new Date(old.startDate), new Date(next.dueDate) - new Date(old.dueDate));
  assert.equal(next.dueDate, '2026-10-13T18:00:00.000Z');
});
