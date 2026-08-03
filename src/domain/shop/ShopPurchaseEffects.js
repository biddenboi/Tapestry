import { recordAnalyticsEvent } from '@domain/analytics/AnalyticsEvents.js';
import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  ownedCosmeticCount,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';

/**
 * Non-authoritative work runs only after the purchase transaction has committed.
 * Failures remain recoverable and cannot roll back balances, stock, inventory,
 * or the purchase ledger.
 */
export async function processShopPurchaseSecondaryEffects(
  databaseConnection,
  purchase,
  { onAchievementEarned } = {},
) {
  const player = purchase?.player;
  if (!player?.UUID || !purchase?.purchaseBatchUUID) return { processed: false };

  const analytics = await Promise.allSettled((purchase.items || []).map((entry) => (
    recordAnalyticsEvent(databaseConnection, player, {
      surface: 'shop',
      targetType: 'shopItem',
      targetUUID: entry.item?.UUID || entry.item?.name,
      eventName: 'shop_item_purchased',
      metadata: {
        name: entry.item?.name || null,
        category: entry.item?.category || null,
        quantity: entry.qty,
        totalCost: entry.totalCost,
        source: 'shop-purchase',
      },
    })
  )));

  await databaseConnection.ensureDomainLoaded?.('achievements');
  const achievementResult = await queueAchievementEvent(databaseConnection, createAchievementEvent({
    type: ACHIEVEMENT_EVENT_TYPE.inventoryChanged,
    parent: player.UUID,
    sourceUUID: purchase.purchaseBatchUUID,
    occurredAt: purchase.occurredAt,
    payload: { ownedCosmetics: ownedCosmeticCount(purchase.playerInventory || []) },
  }), {
    onEarned: onAchievementEarned,
  });

  return {
    processed: true,
    analyticsFailures: analytics.filter((result) => result.status === 'rejected').length,
    achievementResult,
  };
}

export default processShopPurchaseSecondaryEffects;
