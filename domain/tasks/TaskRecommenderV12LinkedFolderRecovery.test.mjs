import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { replayLinkedFolderMutations } from '../../data/db/linkedFolderSafety.js';

async function loadFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/v12-cutover/${name}`, import.meta.url), 'utf8'));
}

function toStores(value = {}) {
  return new Map(Object.entries(value).map(([store, records]) => [
    store,
    new Map((records || []).map((record) => [record.UUID, structuredClone(record)])),
  ]));
}

function fromStores(stores) {
  return Object.fromEntries([...stores.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([store, records]) => [store, [...records.values()].sort((left, right) => String(left.UUID).localeCompare(String(right.UUID)))],
  ));
}

test('a journaled v12-native import replays atomically after linked-folder interruption', async () => {
  const fixture = await loadFixture('linked-folder-interrupted-import.json');
  const recovered = replayLinkedFolderMutations({
    stores: toStores(fixture.baseStores), appState: {}, economyState: {}, mutations: [fixture.pendingMutation],
  });
  assert.deepEqual(fromStores(recovered.stores), fromStores(toStores(fixture.expectedRecoveredStores)));
  const settings = recovered.stores.get('appSettings');
  assert.ok(settings.has('task-recommender-v12-checkpoint:player-1'));
  assert.ok(settings.has('task-recommender-v12-import-recovery:player-1:fixture'));
  assert.ok(settings.has('task-recommender-v12-import:player-1:fixture'));
  assert.equal([...settings.keys()].some((key) => key.startsWith('taskRecommenderWeights')), false);
});

test('replaying the same v12 recovery generation is idempotent by record UUID', async () => {
  const fixture = await loadFixture('linked-folder-interrupted-import.json');
  const once = replayLinkedFolderMutations({
    stores: toStores(fixture.baseStores), appState: {}, economyState: {}, mutations: [fixture.pendingMutation],
  });
  const twice = replayLinkedFolderMutations({
    stores: once.stores, appState: once.appState, economyState: once.economyState, mutations: [fixture.pendingMutation],
  });
  assert.deepEqual(fromStores(twice.stores), fromStores(once.stores));
});

test('a truncated v12 import batch is rejected without mutating active v12 records', async () => {
  const fixture = await loadFixture('linked-folder-truncated-import.json');
  const base = toStores(fixture.baseStores);
  const before = fromStores(base);
  assert.throws(() => replayLinkedFolderMutations({
    stores: base, appState: {}, economyState: {}, mutations: [fixture.pendingMutation],
  }), /Unsupported linked-folder store mutation/);
  assert.deepEqual(fromStores(base), before);
  assert.equal(base.get('appSettings').get('task-recommender-v12-checkpoint:player-1').value.model.marker, 'previous');
});
