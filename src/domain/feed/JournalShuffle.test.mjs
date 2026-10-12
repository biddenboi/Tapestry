import test from 'node:test';
import assert from 'node:assert/strict';
import { JournalShuffle } from './JournalShuffle.js';

test('scroll batches visit every journal before repeating and do not mutate the source', () => {
  const source = ['a', 'b', 'c', 'd', 'e'].map((UUID) => ({ UUID }));
  const queue = new JournalShuffle(source, () => 0.25);
  const first = queue.next(3);
  const second = queue.next(3);
  assert.equal(second.length, 2);
  assert.equal(new Set([...first, ...second].map((row) => row.UUID)).size, 5);
  assert.deepEqual(source.map((row) => row.UUID), ['a', 'b', 'c', 'd', 'e']);
  assert.notEqual(queue.next(3)[0].UUID, second.at(-1).UUID);
});

test('empty and single-journal archives remain bounded for each scroll request', () => {
  assert.deepEqual(new JournalShuffle().next(), []);
  const queue = new JournalShuffle([{ UUID: 'a' }, { UUID: 'a' }]);
  assert.equal(queue.next().length, 1);
  assert.equal(queue.next().length, 1);
});
