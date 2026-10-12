import test from 'node:test';
import assert from 'node:assert/strict';
import { STORES } from '@domain/constants.js';
import { createGateState, captureGateItem, openGateWindow, GATE_SETTING_ID } from '@domain/gate/Gate.js';
import { loadGate, saveGate, loadGateInputs, lockItemWithCoins } from './gateCommands.js';
const now = '2026-10-12T12:00:00Z';
function ready(kind) {
  return openGateWindow(captureGateItem(createGateState(now), { kind, text: 'Gate', why: 'Control changes', replaces: 'Old flow' }, { now, id: 'a' }), { conditions: { allMet: true }, now });
}
test('Gate reads only its small local record and task inputs', async () => {
  const state = await loadGate({ get: async (store, id) => { assert.equal(store, STORES.appSetting); assert.equal(id, GATE_SETTING_ID); } }, now);
  assert.equal(state.lastReleaseAt, new Date(now).toISOString());
  await saveGate({ add: async (store, record) => { assert.equal(store, STORES.appSetting); assert.equal(record.value, state); assert.equal('parent' in record, false); } }, state);
  assert.deepEqual(await loadGateInputs({ getAll: async (store) => [store] }), { completedTasks: [STORES.task], todos: [STORES.todo] });
});
test('paid lock commits wallet, ledger and Gate together', async () => {
  const state = ready('add'); const player = { UUID: 'p', tokens: 100 };
  let mutation;
  const result = await lockItemWithCoins({ commitAtomicMutation: async (value) => { mutation = value; } }, player, state, 'a');
  assert.equal(result.price, 60);
  assert.equal(mutation.label, 'gate-lock-item'); assert.equal(mutation.flush, true);
  assert.deepEqual(mutation.puts.map((put) => put.store), [STORES.player, STORES.transaction, STORES.appSetting]);
  assert.equal(mutation.puts[0].record.tokens, 40);
  assert.equal(mutation.puts[1].record.UUID, mutation.operationId);
  assert.equal(mutation.puts[1].record.type, 'gate_item');
  assert.equal(mutation.puts[2].record.value.window.items[0].ledgerUUID, mutation.operationId);
  assert.equal(player.tokens, 100); assert.equal(state.inbox.length, 1);
});
test('free lock writes only Gate and insufficient balance writes nothing', async () => {
  const calls = [];
  const db = { commitAtomicMutation: async (value) => calls.push(value) };
  await lockItemWithCoins(db, { UUID: 'p', tokens: 0 }, ready('bug'), 'a');
  assert.deepEqual(calls[0].puts.map((put) => put.store), [STORES.appSetting]);
  await assert.rejects(lockItemWithCoins(db, { UUID: 'p', tokens: 0 }, ready('add'), 'a'), { code: 'insufficient-coins' });
  assert.equal(calls.length, 1);
});
test('failed atomic lock does not change the caller state', async () => {
  const state = ready('change'); const original = structuredClone(state);
  await assert.rejects(lockItemWithCoins({ commitAtomicMutation: async () => { throw new Error('disk failure'); } }, { UUID: 'p', tokens: 100 }, state, 'a'), /disk failure/);
  assert.deepEqual(state, original);
});
