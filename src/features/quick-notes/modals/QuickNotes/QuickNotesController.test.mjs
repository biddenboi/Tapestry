import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const persistenceSource = await readFile(new URL('./quickNotesPersistence.js', import.meta.url), 'utf8');
const persistenceUrl = `data:text/javascript;base64,${Buffer.from(persistenceSource).toString('base64')}`;
const source = (await readFile(new URL('./QuickNotesController.js', import.meta.url), 'utf8'))
  .replace("import { createKeyedSerialQueue } from './quickNotesPersistence.js';", `import { createKeyedSerialQueue } from '${persistenceUrl}';`);
const { createQuickNotesController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('one controller owns autosave, serialization revision, and undo history', async () => {
  let scheduled = null;
  const controller = createQuickNotesController({
    setTimer(callback) { scheduled = callback; return 1; },
    clearTimer() { scheduled = null; },
  });
  controller.remember([{ UUID: 'n1', content: 'saved' }]);
  controller.activate('n1', 'saved');
  const revision = controller.recordEdit('n1', 'saved', 'draft');
  assert.equal(revision, 1);
  const writes = [];
  controller.schedule('n1', 'draft', (...args) => writes.push(args));
  scheduled();
  assert.deepEqual(writes, [['n1', 'draft', 1]]);
  assert.deepEqual(controller.undo('n1', 'draft'), { content: 'saved', revision: 2 });
  assert.deepEqual(controller.redo('n1', 'saved'), { content: 'draft', revision: 3 });
});

test('per-note operations remain serialized', async () => {
  const controller = createQuickNotesController();
  const order = [];
  const first = controller.run('n1', async () => {
    order.push('first-start');
    await Promise.resolve();
    order.push('first-end');
  });
  const second = controller.run('n1', async () => { order.push('second'); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('a failed folder flush retains the idempotent write for retry', () => {
  const controller = createQuickNotesController();
  controller.rememberPendingWrite('n1', {
    operationId: 'operation-1', content: 'draft', result: { status: 'applied' },
  });
  assert.equal(controller.pendingWrite('n1').operationId, 'operation-1');
  controller.clearPendingWrite('n1', 'another-operation');
  assert.equal(controller.pendingWrite('n1').operationId, 'operation-1');
  controller.clearPendingWrite('n1', 'operation-1');
  assert.equal(controller.pendingWrite('n1'), null);
});
