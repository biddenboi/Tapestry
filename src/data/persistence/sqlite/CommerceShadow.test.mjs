import assert from 'node:assert/strict';
import test from 'node:test';
import { stableJson } from './shadowDomainUtils.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixed = new Date('2026-07-13T00:00:00.000Z');

async function setup({ tokens = 100, money = 50 } = {}) {
  const context = await createShadowTestContext({ now: () => fixed });
  await context.shadow.importers.coreProfiles.import({
    players: [{ UUID: 'p1', username: 'Buyer', elo: 1000, tokens, createdAt: fixed.toISOString() }],
    appState: { activePlayerUUID: 'p1' }, economyState: { globalMoney: money },
  });
  return context;
}

const tokenItem = {
  UUID: 'token-item', itemId: 'token-consumable', name: 'Token Item', type: 'quantity', itemClass: 'consumable',
  quantity: 1, category: 'Rest', currencyType: 'tokens', cost: 10, stockLimit: 5, soldCount: 0,
};
const cashItem = {
  UUID: 'cash-item', itemId: 'cash-duration', name: 'Cash Item', type: 'duration', itemClass: 'consumable',
  duration: 30, category: 'Focus', currencyType: 'dollars', cost: 4, stockLimit: 10, soldCount: 1,
};

test('Batch 20 commits balances, stock, ownership, and ledger inside one idempotent SQL transaction', async (t) => {
  const context = await setup();
  t.after(context.close);
  await context.shadow.importers.commerce.import({
    shop: [tokenItem, cashItem],
    inventory: [{ UUID: 'owned-token', parent: 'p1', itemUUID: 'token-item', itemId: 'token-consumable', name: 'Token Item', type: 'quantity', quantity: 1, purchaseCount: 1 }],
  });
  const purchase = await context.shadow.commerce.commitPurchase({
    playerId: 'p1', purchaseBatchId: 'purchase-1', operationId: 'purchase-op-1', occurredAt: fixed,
    cart: [{ itemId: 'token-item', quantity: 2 }, { itemId: 'cash-item', quantity: 3 }],
  });
  assert.equal(purchase.duplicate, false);
  assert.equal(purchase.tokenCost, 20);
  assert.equal(purchase.dollarCost, 12);
  assert.equal(purchase.player.tokens, 80);
  assert.equal(purchase.globalMoneyAfter, 38);
  assert.equal(purchase.itemCount, 5);
  assert.equal(purchase.playerInventory.find((item) => item.itemUUID === 'token-item').quantity, 3);
  assert.equal(purchase.playerInventory.find((item) => item.itemUUID === 'cash-item').quantity, 3);
  const catalog = await context.shadow.commerce.getCatalog();
  assert.equal(catalog.find((item) => item.UUID === 'token-item').soldCount, 2);
  assert.equal(catalog.find((item) => item.UUID === 'cash-item').soldCount, 4);
  assert.equal(purchase.ledgerRecords.length, 2);
  assert.ok(purchase.ledgerRecords.every((row) => row.purchaseBatchUUID === 'purchase-1'));
  assert.equal(await context.client.query({ sql: "SELECT global_money_minor FROM economy WHERE singleton_id=1", result: 'value' }), 3800);

  const replay = await context.shadow.commerce.commitPurchase({
    playerId: 'p1', purchaseBatchId: 'purchase-1', operationId: 'purchase-op-1', occurredAt: fixed,
    cart: [{ itemId: 'token-item', quantity: 2 }, { itemId: 'cash-item', quantity: 3 }],
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.player.tokens, 80);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM purchase_batches WHERE id='purchase-1'", result: 'value' }), 1);
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 20 validation and injected failures expose no partial authoritative purchase state', async (t) => {
  const context = await setup({ tokens: 10, money: 3 });
  t.after(context.close);
  await context.shadow.importers.commerce.import({ shop: [tokenItem, cashItem] });

  await assert.rejects(context.shadow.commerce.commitPurchase({
    playerId: 'p1', purchaseBatchId: 'too-expensive', operationId: 'too-expensive-op',
    cart: [{ itemId: 'cash-item', quantity: 1 }], occurredAt: fixed,
  }), (error) => error.code === 'insufficient-money');
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).tokens, 10);
  assert.deepEqual(await context.shadow.coreProfiles.getEconomy(), { globalMoney: 3 });
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM purchase_batches WHERE id='too-expensive'", result: 'value' }), 0);

  const cart = stableJson([{ itemId: 'token-item', quantity: 1 }]);
  await assert.rejects(context.client.executeAtomic({
    commandId: 'purchase-forced-rollback', label: 'purchase-forced-rollback',
    statements: [
      { sql: `INSERT INTO purchase_commands(operation_id,purchase_batch_id,player_id,cart_json,occurred_at,metadata_json) VALUES(?,?,?,?,?,?)`, bind: ['forced-op','forced-batch','p1',cart,fixed.toISOString(),'{}'] },
      { sql: 'INSERT INTO missing_purchase_table(id) VALUES(1)' },
    ],
  }));
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).tokens, 10);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM inventory_items WHERE player_id='p1'", result: 'value' }), 0);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM purchase_ledger WHERE purchase_batch_id='forced-batch'", result: 'value' }), 0);
  assert.equal(await context.client.query({ sql: "SELECT sold_count FROM shop_items WHERE id='token-item'", result: 'value' }), 0);
});

test('Batch 20 concurrent purchase commands serialize against the latest balance', async (t) => {
  const context = await setup({ tokens: 10, money: 0 });
  t.after(context.close);
  await context.shadow.importers.commerce.import({ shop: [{ ...tokenItem, stockLimit: null }] });
  const results = await Promise.allSettled([
    context.shadow.commerce.commitPurchase({ playerId: 'p1', purchaseBatchId: 'batch-a', operationId: 'op-a', cart: [{ itemId: 'token-item', quantity: 1 }], occurredAt: fixed }),
    context.shadow.commerce.commitPurchase({ playerId: 'p1', purchaseBatchId: 'batch-b', operationId: 'op-b', cart: [{ itemId: 'token-item', quantity: 1 }], occurredAt: fixed }),
  ]);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.equal(results[1].reason.code, 'insufficient-tokens');
  assert.equal((await context.shadow.coreProfiles.getPlayer('p1')).tokens, 0);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM purchase_batches', result: 'value' }), 1);
  assert.equal(await context.client.query({ sql: 'SELECT COUNT(*) FROM purchase_ledger', result: 'value' }), 1);
});

test('Batch 20 imports legacy catalog, inventory, and ledgers with integer money and historical retention', async (t) => {
  const context = await setup();
  t.after(context.close);
  const fixture = {
    shop: [{ ...tokenItem, bannerImageUrl: 'data:image/png;base64,AAAA' }, cashItem],
    inventory: [{ UUID: 'legacy-owned', parent: 'p1', itemUUID: 'cash-item', itemId: 'cash-duration', name: 'Cash Item', type: 'duration', quantity: 2, purchaseCount: 2 }],
    transactions: [
      { UUID: 'legacy-tx-1', parent: 'p1', type: 'shop_purchase', purchaseBatchUUID: 'legacy-batch', itemUUID: 'cash-item', name: 'Cash Item', currencyType: 'dollars', quantity: 2, unitCost: 4, totalCost: 8, createdAt: fixed.toISOString() },
      { UUID: 'legacy-tx-2', parent: 'p1', type: 'shop_purchase', purchaseBatchUUID: 'legacy-batch', itemUUID: 'token-item', name: 'Token Item', currencyType: 'tokens', quantity: 1, unitCost: 10, totalCost: 10, createdAt: fixed.toISOString() },
    ],
  };
  const imported = await context.shadow.importers.commerce.import(fixture);
  assert.equal(imported.counts.shopItems, 2);
  assert.equal(imported.counts.inventoryItems, 1);
  assert.equal(imported.counts.purchaseBatches, 1);
  assert.equal(imported.counts.purchaseLedger, 2);
  assert.equal(await context.client.query({ sql: "SELECT money_cost_minor FROM purchase_batches WHERE id='legacy-batch'", result: 'value' }), 800);
  assert.equal(await context.client.query({ sql: "SELECT instr(extra_json,'data:image') FROM shop_items WHERE id='token-item'", result: 'value' }), 0);
  assert.equal((await context.shadow.importers.commerce.import(fixture)).duplicate, true);

  await context.shadow.coreProfiles.wipeProfile('p1', { operationId: 'wipe-commerce-p1', now: fixed });
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM inventory_items WHERE player_id='p1'", result: 'value' }), 0);
  const ledger = await context.client.query({ sql: "SELECT player_id AS playerId,item_name_snapshot AS itemName FROM purchase_ledger WHERE id='legacy-tx-1'", result: 'one' });
  assert.equal(ledger.playerId, null);
  assert.equal(ledger.itemName, 'Cash Item');
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM purchase_batches WHERE id='legacy-batch'", result: 'value' }), 1);
});
