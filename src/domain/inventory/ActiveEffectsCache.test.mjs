import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./ActiveEffectsCache.js', import.meta.url), 'utf8');
const cacheModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('normalized active effects are cached by player and event revision', async () => {
  let reads = 0;
  const databaseConnection = {
    async getActiveEventBuffsForPlayer() {
      reads += 1;
      return [{
        UUID: 'buff-1',
        parent: 'player-1',
        eventUUID: 'event-1',
        multiplierValue: '1.25',
        metadata: { source: 'test' },
      }];
    },
  };

  const first = await cacheModule.getNormalizedActiveEffects(databaseConnection, 'player-1', 7);
  const replay = await cacheModule.getNormalizedActiveEffects(databaseConnection, 'player-1', 7);
  const nextRevision = await cacheModule.getNormalizedActiveEffects(databaseConnection, 'player-1', 8);

  assert.equal(reads, 2);
  assert.strictEqual(first, replay);
  assert.notStrictEqual(first, nextRevision);
  assert.equal(first[0].multiplierValue, 1.25);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first[0]));
  assert.ok(Object.isFrozen(first[0].metadata));
});

test('explicit cache clearing forces a fresh read', async () => {
  let reads = 0;
  const databaseConnection = {
    async getActiveEventBuffsForPlayer() {
      reads += 1;
      return [];
    },
  };
  await cacheModule.getNormalizedActiveEffects(databaseConnection, 'player-2', 3);
  cacheModule.clearActiveEffectsCache(databaseConnection, 'player-2');
  await cacheModule.getNormalizedActiveEffects(databaseConnection, 'player-2', 3);
  assert.equal(reads, 2);
});
