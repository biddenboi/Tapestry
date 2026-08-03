import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ITEM_TYPE = {
  duration: 'duration', quantity: 'quantity', cosmetic_title: 'cosmetic_title',
};
const ITEM_CLASS = { consumable: 'consumable', unlock: 'unlock' };
const STORES = {
  player: 'players', shop: 'shop', inventory: 'inventory', transaction: 'transactions',
};

let shopSource = await readFile(new URL('./Shop.js', import.meta.url), 'utf8');
shopSource = shopSource
  .replace(
    "import { COSMETIC_TITLES, ITEM_TYPE, ITEM_CLASS } from '@domain/constants.js';",
    `const COSMETIC_TITLES = []; const ITEM_TYPE = ${JSON.stringify(ITEM_TYPE)}; const ITEM_CLASS = ${JSON.stringify(ITEM_CLASS)};`,
  )
  .replace(
    "import { expectedRewardCoins } from '@domain/rewards/RewardSchedule.js';",
    'const expectedRewardCoins = () => 100;',
  );
const shopUrl = `data:text/javascript;base64,${Buffer.from(shopSource).toString('base64')}`;

let serviceSource = await readFile(new URL('./ShopPurchaseService.js', import.meta.url), 'utf8');
serviceSource = serviceSource
  .replace(
    "import { ITEM_CLASS, STORES } from '@domain/constants.js';",
    `const ITEM_CLASS = ${JSON.stringify(ITEM_CLASS)}; const STORES = ${JSON.stringify(STORES)};`,
  )
  .replace("from '@domain/shop/Shop.js';", `from '${shopUrl}';`);
const service = await import(`data:text/javascript;base64,${Buffer.from(serviceSource).toString('base64')}`);

class MemoryDatabase {
  constructor({ player, catalog = [], inventory = [], money = 0, failCommit = false }) {
    this.stores = new Map([
      [STORES.player, new Map([[player.UUID, structuredClone(player)]])],
      [STORES.shop, new Map(catalog.map((item) => [item.UUID, structuredClone(item)]))],
      [STORES.inventory, new Map(inventory.map((item) => [item.UUID, structuredClone(item)]))],
      [STORES.transaction, new Map()],
    ]);
    this.money = money;
    this.failCommit = failCommit;
    this.atomicCommits = [];
    this.domainLoads = [];
  }

  bucket(store) {
    if (!this.stores.has(store)) this.stores.set(store, new Map());
    return this.stores.get(store);
  }

  async ensureDomainsLoaded(domains) { this.domainLoads.push([...domains]); }
  async get(store, UUID) { return structuredClone(this.bucket(store).get(UUID) || null); }
  async getAll(store) { return structuredClone([...this.bucket(store).values()]); }
  async getPlayerStore(store, parent) {
    return structuredClone([...this.bucket(store).values()].filter((record) => record.parent === parent));
  }
  getGlobalMoney() { return this.money; }

  async commitAtomicMutation(input) {
    if (this.failCommit) throw new Error('commit failed');
    this.atomicCommits.push(structuredClone(input));
    for (const { store, record } of input.puts) {
      this.bucket(store).set(record.UUID, structuredClone(record));
    }
    this.money = input.globalMoney;
    return { changed: true, operationCount: input.puts.length };
  }
}

function uuidSequence(prefix = 'generated') {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

const tokenItem = {
  UUID: 'token-item',
  name: 'Token Item',
  type: ITEM_TYPE.quantity,
  itemClass: ITEM_CLASS.consumable,
  quantity: 1,
  category: 'Rest',
  cost: 10,
  stockLimit: 5,
  soldCount: 0,
};
const cashItem = {
  UUID: 'cash-item',
  name: 'Cash Item',
  type: ITEM_TYPE.duration,
  itemClass: ITEM_CLASS.consumable,
  duration: 30,
  category: 'Focus',
  currencyType: 'dollars',
  cost: 4,
  stockLimit: 10,
  soldCount: 1,
};


test('one atomic purchase commits balances, owned inventory, stock, and ledger together', async () => {
  const player = { UUID: 'player-1', tokens: 100 };
  const existingInventory = {
    UUID: 'owned-token', parent: player.UUID, itemUUID: tokenItem.UUID,
    name: tokenItem.name, type: tokenItem.type, quantity: 1, purchaseCount: 1,
  };
  const db = new MemoryDatabase({
    player,
    catalog: [tokenItem, cashItem],
    inventory: [existingInventory],
    money: 50,
  });

  const result = await service.commitShopPurchase(db, {
    playerUUID: player.UUID,
    purchaseBatchUUID: 'purchase-1',
    now: '2026-07-11T10:00:00.000Z',
    uuidFactory: uuidSequence(),
    cart: [
      { item: { ...tokenItem, cost: 1 }, qty: 2, totalCost: 2 },
      { item: cashItem, qty: 3, totalCost: 12 },
    ],
  });

  assert.equal(db.atomicCommits.length, 1);
  assert.equal(db.atomicCommits[0].label, 'shop-purchase');
  assert.equal(db.atomicCommits[0].flush, true);
  assert.deepEqual(new Set(db.domainLoads[0]), new Set(['shop', 'inventory', 'profiles']));
  assert.equal(result.tokenCost, 20, 'canonical catalog cost must win over stale cart totals');
  assert.equal(result.dollarCost, 12);
  assert.equal((await db.get(STORES.player, player.UUID)).tokens, 80);
  assert.equal(db.getGlobalMoney(), 38);
  assert.equal((await db.get(STORES.inventory, existingInventory.UUID)).quantity, 3);
  assert.equal((await db.get(STORES.shop, tokenItem.UUID)).soldCount, 2);
  assert.equal((await db.get(STORES.shop, cashItem.UUID)).soldCount, 4);
  assert.equal((await db.getAll(STORES.transaction)).length, 2);
  assert.ok((await db.getAll(STORES.transaction)).every((row) => row.purchaseBatchUUID === 'purchase-1'));
});

test('a failed atomic commit exposes no partial purchase state', async () => {
  const player = { UUID: 'player-1', tokens: 20 };
  const db = new MemoryDatabase({ player, catalog: [tokenItem], inventory: [], money: 0, failCommit: true });

  await assert.rejects(service.commitShopPurchase(db, {
    playerUUID: player.UUID,
    purchaseBatchUUID: 'purchase-failed',
    uuidFactory: uuidSequence(),
    cart: [{ item: tokenItem, qty: 1 }],
  }), /commit failed/);

  assert.equal((await db.get(STORES.player, player.UUID)).tokens, 20);
  assert.equal((await db.getAll(STORES.inventory)).length, 0);
  assert.equal((await db.getAll(STORES.transaction)).length, 0);
  assert.equal(db.getGlobalMoney(), 0);
});

test('concurrent purchases serialize validation against the latest balance', async () => {
  const player = { UUID: 'player-1', tokens: 10 };
  const item = { ...tokenItem, stockLimit: null };
  const db = new MemoryDatabase({ player, catalog: [item], inventory: [], money: 0 });
  const options = {
    playerUUID: player.UUID,
    uuidFactory: uuidSequence('concurrent'),
    cart: [{ item, qty: 1 }],
  };

  const results = await Promise.allSettled([
    service.commitShopPurchase(db, { ...options, purchaseBatchUUID: 'purchase-a' }),
    service.commitShopPurchase(db, { ...options, purchaseBatchUUID: 'purchase-b' }),
  ]);

  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.code, 'insufficient-tokens');
  assert.equal(db.atomicCommits.length, 1);
  assert.equal(results[0].value.catalogRecords.length, 0, 'unlimited items must not create stock mutations');
  assert.equal((await db.get(STORES.player, player.UUID)).tokens, 0);
  assert.equal((await db.get(STORES.shop, item.UUID)).soldCount, item.soldCount);
});
