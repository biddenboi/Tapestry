import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rawSource = await readFile(new URL('./ProfileLifecycleService.js', import.meta.url), 'utf8');
const executableSource = rawSource
  .replace(
    "import { STORES } from '@domain/constants.js';",
    "const STORES = new Proxy({}, { get: (_target, property) => String(property) });",
  )
  .replace(
    /import \{[\s\S]*?\} from '@domain\/time\/Time\.js';/,
    `const activatePlayerIGT = (player) => player;
     const freezePlayerIGT = (player) => player;
     const getCurrentIGT = () => 0;
     const getLocalDate = (value) => new Date(value);`,
  );
const { ProfileLifecycleService } = await import(
  `data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`
);

function createFacade(seed) {
  const stores = new Map(Object.entries(seed).map(([store, rows]) => [
    store,
    new Map(rows.map((row) => [row.UUID, structuredClone(row)])),
  ]));
  const records = (store) => {
    if (!stores.has(store)) stores.set(store, new Map());
    return stores.get(store);
  };
  const facade = {
    ready: Promise.resolve(),
    appState: { activePlayerUUID: 'deleted-profile' },
    _queueAppStateWrite() {},
    async _flushMutationWrite() {},
    async _synchronizePlayerIGTClockRows() {},
    clearBanPending() {},
    clearViolations() {},
    async _ensureStoreLoadedForMutation() {},
    _store: records,
    async get(store, UUID) { return records(store).get(UUID) || null; },
    async getAll(store) { return [...records(store).values()]; },
    async getPlayerStore(store, playerUUID) {
      return [...records(store).values()].filter((row) => String(row.parent) === String(playerUUID));
    },
    async add(store, record) { records(store).set(record.UUID, structuredClone(record)); return record; },
    async remove(store, UUID) { return records(store).delete(UUID); },
    async commitAtomicMutation({ puts = [], deletes = [] }) {
      puts.forEach(({ store, record }) => records(store).set(record.UUID, structuredClone(record)));
      deletes.forEach(({ store, UUID }) => records(store).delete(UUID));
    },
  };
  return { facade, records };
}

test('current player keeps live profile fields and projected rating evidence', () => {
  assert.match(rawSource, /return \{\s*\.\.\.projected,\s*\.\.\.stored,\s*elo: projected\.elo,\s*hasVisibleRating: projected\.hasVisibleRating === true,/s);
  assert.match(rawSource, /cached projection roll back current profile fields/);
});

test('penalty deletion detaches journals, deletes profile progress, and retains universal planning data', async () => {
  const deleted = 'deleted-profile';
  const keeper = 'keeper-profile';
  const universalStores = ['todo', 'task', 'project', 'customEvent', 'reminder', 'actionPlan'];
  const seed = {
    player: [
      { UUID: deleted, username: 'Before', profilePicture: 'portrait.png', activeCosmetics: { frame: 'gold' }, createdAt: '2026-01-01T00:00:00.000Z' },
      { UUID: keeper, username: 'Keeper', createdAt: '2026-02-01T00:00:00.000Z' },
    ],
    journal: [{ UUID: 'journal-1', parent: deleted, text: 'Keep this entry' }],
    journalComment: [{ UUID: 'comment-1', journalUUID: 'journal-1', authorUUID: deleted, text: 'Keep this comment' }],
    match: [{ UUID: 'match-1', parent: 'arena', participantUUIDs: [deleted, keeper] }],
    inventory: [{ UUID: 'cosmetic-1', parent: deleted }],
    transaction: [{ UUID: 'economy-1', parent: deleted }],
    appSetting: [
      { UUID: `task-recommender-v12-checkpoint:${deleted}`, parent: deleted, value: { weights: [1] } },
      { UUID: 'household-setting', parent: null, value: true },
    ],
    friendship: [{ UUID: 'friendship-1', players: [deleted, keeper] }],
    ...Object.fromEntries(universalStores.map((store) => [store, [{
      UUID: `${store}-1`,
      parent: deleted,
      name: `Retained ${store}`,
    }]])),
  };
  const { facade, records } = createFacade(seed);
  const service = new ProfileLifecycleService(facade);

  await service.banProfile(deleted);

  assert.equal(records('journal').get('journal-1').parent, null);
  assert.equal(records('journal').get('journal-1').detachedProfileUUID, deleted);
  assert.equal(records('journalComment').get('comment-1').authorUUID, null);
  for (const store of universalStores) {
    assert.equal(records(store).get(`${store}-1`).parent, keeper, `${store} must survive`);
  }
  assert.equal(records('match').has('match-1'), false);
  assert.equal(records('inventory').has('cosmetic-1'), false);
  assert.equal(records('transaction').has('economy-1'), false);
  assert.equal(records('appSetting').has(`task-recommender-v12-checkpoint:${deleted}`), false);
  assert.equal(records('appSetting').has('household-setting'), true);
  assert.equal(records('friendship').has('friendship-1'), false);
  assert.equal(records('player').get(deleted).username, 'Deleted User');
  assert.equal(records('player').get(deleted).profilePicture, null);
  assert.deepEqual(records('player').get(deleted).activeCosmetics, {});
});
