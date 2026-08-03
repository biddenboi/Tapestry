import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('Contribution Road is the only UI path that claims milestone cosmetics', async () => {
  const [road, board, contribution, tasks, feed, profileSummary, profileInventory] = await Promise.all([
    read('./pages/ContributionPass/ContributionPass.jsx'),
    read('./pages/ContributionPass/RecognitionBoardV2.jsx'),
    read('../../domain/contribution/Contribution.js'),
    read('../tasks/domain/TaskCompletionProcessors.js'),
    read('../feed/modals/PostComposerModal/PostComposerModal.jsx'),
    read('../../domain/profile/ProfileSummary.js'),
    read('../profile/pages/Profile/ProfileDataController.js'),
  ]);
  assert.match(road, /claimContributionPassReward/);
  assert.match(board, /Claim free classic reward/);
  assert.doesNotMatch(road, /function CollectionPanel/);
  assert.match(contribution, /contributionRewardId: reward\.id/);
  assert.match(contribution, /claimedAt/);
  for (const bypass of [tasks, feed, profileSummary, profileInventory]) {
    assert.doesNotMatch(bypass, /claimContributionPassReward|syncContributionPassRewards|getContributionUnlockedCosmeticIds/);
  }
});

test('Inventory is consumables-only and does not expose cosmetic equip controls', async () => {
  const [inventory, inventoryRepository] = await Promise.all([
    read('../inventory/pages/Inventory/Inventory.jsx'),
    read('../../data/persistence/repositories/InventoryRepository.js'),
  ]);
  assert.match(inventory, /getConsumablesByPlayer/);
  assert.match(inventory, /isConsumableInventoryItem/);
  assert.doesNotMatch(inventory, /BUILT_IN_MINIMALIST|equipCosmetic|activeCosmetics/);
  assert.match(inventoryRepository, /getConsumablesByPlayer/);
});
