import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDurableWrite,
  createKeyedSerialQueue,
  isCurrentSaveCompletion,
} from './quickNotesPersistence.js';

test('per-note operations are serialized even when an earlier write rejects', async () => {
  const queue = createKeyedSerialQueue();
  const order = [];
  let releaseFirst;
  let markFirstStarted;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });

  const first = queue.run('note-1', async () => {
    order.push('first-start');
    markFirstStarted();
    await firstBlocked;
    order.push('first-fail');
    throw new Error('write failed');
  });
  const second = queue.run('note-1', async () => {
    order.push('second');
    return 'saved';
  });

  await firstStarted;
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await assert.rejects(first, /write failed/);
  assert.equal(await second, 'saved');
  assert.deepEqual(order, ['first-start', 'first-fail', 'second']);
});

test('an older save completion cannot clear a newer edit', () => {
  assert.equal(isCurrentSaveCompletion({
    activeNoteId: 'note-1',
    noteId: 'note-1',
    currentContent: 'newer',
    savedContent: 'older',
    currentRevision: 2,
    savedRevision: 1,
  }), false);
  assert.equal(isCurrentSaveCompletion({
    activeNoteId: 'note-1',
    noteId: 'note-1',
    currentContent: 'newer',
    savedContent: 'newer',
    currentRevision: 2,
    savedRevision: 2,
  }), true);
});

test('only a confirmed SQLite write counts as durable', () => {
  assert.doesNotThrow(() => assertDurableWrite({ changed: true, direction: 'sqlite' }));
  assert.throws(
    () => assertDurableWrite({ changed: false, reason: 'write-failed' }),
    /write-failed/,
  );
});
