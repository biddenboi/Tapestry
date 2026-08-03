import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./economyState.js', import.meta.url), 'utf8');
const economy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('global money is normalized and round-trips through economy state', () => {
  const state = {};

  assert.equal(economy.writeGlobalMoney(125.5, state), 125.5);
  assert.equal(economy.readGlobalMoney(state), 125.5);
  assert.equal(economy.writeGlobalMoney(-10, state), 0);
  assert.equal(economy.readGlobalMoney(state), 0);
});

test('economy save state preserves global money', () => {
  const saved = economy.createEconomyState(420);

  assert.deepEqual(saved, { globalMoney: 420 });
  assert.deepEqual(economy.parseEconomyState(saved, 'economy.json'), saved);
  assert.equal(economy.parseEconomyState(null), null);
});

test('invalid economy payloads fail before restore', () => {
  assert.throws(
    () => economy.parseEconomyState({ globalMoney: -1 }, 'economy.json'),
    /invalid globalMoney/,
  );
  assert.throws(
    () => economy.parseEconomyState([], 'economy.json'),
    /JSON object/,
  );
});
