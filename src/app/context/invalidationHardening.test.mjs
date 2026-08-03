import assert from 'node:assert/strict';
import test from 'node:test';
import { DATA_DOMAIN, DOMAIN_INVALIDATION } from './domainRevisions.js';

test('high-value invalidation policies remain isolated after cache consolidation', () => {
  assert.equal(DOMAIN_INVALIDATION.taskWrite.includes(DATA_DOMAIN.shop), false);
  assert.equal(DOMAIN_INVALIDATION.shopPurchaseCommit.includes(DATA_DOMAIN.feed), false);
  assert.equal(DOMAIN_INVALIDATION.socialWrite.includes(DATA_DOMAIN.matches), false);
  assert.equal(DOMAIN_INVALIDATION.reminderWrite.includes(DATA_DOMAIN.profiles), false);
  assert.deepEqual(DOMAIN_INVALIDATION.shopCatalogWrite, [DATA_DOMAIN.shop]);
});
