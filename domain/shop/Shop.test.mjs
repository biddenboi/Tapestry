import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./Shop.js', import.meta.url), 'utf8');
source = source
  .replace(
    "import { COSMETIC_TITLES, ITEM_TYPE, ITEM_CLASS } from '@domain/constants.js';",
    "const COSMETIC_TITLES = []; const ITEM_TYPE = { duration: 'duration', quantity: 'quantity', cosmetic_title: 'cosmetic_title' }; const ITEM_CLASS = { unlock: 'unlock' };",
  )
  .replace(
    "import { expectedRewardCoins } from '@domain/rewards/RewardSchedule.js';",
    'const expectedRewardCoins = () => 100;',
  );
const shop = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('catalog ordering is deterministic and honors configured display order', () => {
  const input = [
    { UUID: 'z', name: 'Zulu', category: 'Misc' },
    { UUID: 'b', name: 'Beta', category: 'Rest', displayOrder: 20 },
    { UUID: 'a', name: 'Alpha', category: 'Rest', displayOrder: 10 },
    { UUID: 'legacy', name: 'Legacy', category: 'Focus', sortOrder: 15 },
    { UUID: 'a2', name: 'Alpha', category: 'Rest' },
  ];
  const ordered = shop.sortShopCatalog(input);

  assert.deepEqual(ordered.map((item) => item.UUID), ['a', 'legacy', 'b', 'a2', 'z']);
  assert.deepEqual(input.map((item) => item.UUID), ['z', 'b', 'a', 'legacy', 'a2']);
});

test('quantity validation allows the configured limit and rejects only overflow', () => {
  const item = { UUID: 'limited', type: 'quantity', purchaseLimitPerPlayer: 3, stockLimit: 4, soldCount: 1 };
  const owned = { quantity: 1, purchaseCount: 1 };
  assert.equal(shop.canPurchaseShopQuantity(item, owned, 2), true);
  assert.equal(shop.canPurchaseShopQuantity(item, owned, 3), false);
});
