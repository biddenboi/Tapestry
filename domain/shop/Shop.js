import { COSMETIC_TITLES, ITEM_TYPE, ITEM_CLASS } from '@domain/constants.js';
import { expectedRewardCoins } from '@domain/rewards/RewardSchedule.js';

export const SHOP_CATEGORIES = ['Rest', 'Exercise', 'Focus', 'Entertainment', 'Social', 'Food', 'Cosmetics', 'Misc'];
export const SHOP_AVERAGE_WORK_MINUTES = 25;
export const SHOP_QUANTITY_MINUTE_EQUIVALENT = 20;
export const SHOP_PRICE_TIERS = Object.freeze([
  {
    id: 'beneficial',
    level: 1,
    label: 'Beneficial',
    shortLabel: 'Benefit',
    multiplier: 0.9,
    description: 'Creative, restorative, healthful, or skill-building rewards.',
  },
  {
    id: 'neutral',
    level: 2,
    label: 'Neutral',
    shortLabel: 'Neutral',
    multiplier: 1.5,
    description: 'Ordinary leisure, social time, errands, walks, or low-risk breaks.',
  },
  {
    id: 'harmful',
    level: 3,
    label: 'Harmful',
    shortLabel: 'Costly',
    multiplier: 2.4,
    description: 'Rewards likely to drain attention, sleep, money, or momentum.',
  },
]);

const SHOP_TITLE_IDS = new Set(['gold', 'wealthy']);

export const DEFAULT_SHOP_ITEMS = [
  {
    UUID: 'shop-focus-25',
    displayOrder: 100,
    name: 'Focus Sprint',
    description: 'A 25-minute intentional break replacement. Use it to structure a focused off-task reset.',
    type: ITEM_TYPE.duration,
    itemClass: ITEM_CLASS.consumable,
    duration: 25,
    quantity: 1,
    enjoyment: 1,
    priceTier: 'beneficial',
    category: 'Focus',
    bannerImageUrl: null,
  },
  {
    UUID: 'shop-walk-15',
    displayOrder: 200,
    name: 'Walk Break',
    description: 'Short outside reset to clear your head.',
    type: ITEM_TYPE.duration,
    itemClass: ITEM_CLASS.consumable,
    duration: 15,
    quantity: 1,
    enjoyment: 2,
    priceTier: 'neutral',
    category: 'Rest',
    bannerImageUrl: null,
  },
  {
    UUID: 'shop-snack',
    displayOrder: 300,
    name: 'Snack',
    description: 'Simple instant reward. One-time use.',
    type: ITEM_TYPE.quantity,
    itemClass: ITEM_CLASS.consumable,
    duration: 0,
    quantity: 1,
    enjoyment: 1,
    priceTier: 'neutral',
    category: 'Food',
    bannerImageUrl: null,
  },
  {
    UUID: 'shop-game-45',
    displayOrder: 400,
    name: 'Game Session',
    description: 'Longer recharge block. Going over time becomes expensive.',
    type: ITEM_TYPE.duration,
    itemClass: ITEM_CLASS.consumable,
    duration: 45,
    quantity: 1,
    enjoyment: 3,
    priceTier: 'harmful',
    category: 'Entertainment',
    bannerImageUrl: null,
  },
  ...COSMETIC_TITLES
    .filter((title) => SHOP_TITLE_IDS.has(title.id))
    .map((title) => ({
      UUID: 'shop-title-' + title.id,
      displayOrder: 1000 + COSMETIC_TITLES.findIndex((candidate) => candidate.id === title.id),
      name: title.label,
      description: title.description || 'A cosmetic title displayed below your username.',
      type: ITEM_TYPE.cosmetic_title,
      itemClass: ITEM_CLASS.unlock,
      itemId: title.id,
      duration: 0,
      quantity: 1,
      enjoyment: 1,
      category: 'Cosmetics',
      cost: title.cost,
      purchaseLimitPerPlayer: 1,
      bannerImageUrl: null,
    })),
];


const SHOP_CATEGORY_ORDER = new Map(SHOP_CATEGORIES.map((category, index) => [category, index]));

function finiteOrder(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Stable catalog order. `displayOrder` is the canonical configured field;
 * `sortOrder` remains a read-only compatibility alias for older exports.
 */
export function compareShopCatalogItems(left, right) {
  const leftOrder = finiteOrder(left?.displayOrder ?? left?.sortOrder);
  const rightOrder = finiteOrder(right?.displayOrder ?? right?.sortOrder);
  if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;

  const leftCategory = SHOP_CATEGORY_ORDER.get(left?.category) ?? SHOP_CATEGORIES.length;
  const rightCategory = SHOP_CATEGORY_ORDER.get(right?.category) ?? SHOP_CATEGORIES.length;
  if (leftCategory !== rightCategory) return leftCategory - rightCategory;

  const byName = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (byName !== 0) return byName;
  return String(left?.UUID || '').localeCompare(String(right?.UUID || ''));
}

export function sortShopCatalog(items = []) {
  return [...items].sort(compareShopCatalogItems);
}

export function getShopPriceTier(value = 2) {
  if (typeof value === 'string') {
    return SHOP_PRICE_TIERS.find((tier) => tier.id === value)
      || SHOP_PRICE_TIERS.find((tier) => tier.label.toLowerCase() === value.toLowerCase())
      || SHOP_PRICE_TIERS[1];
  }
  const level = Math.min(3, Math.max(1, Math.round(Number(value) || 2)));
  return SHOP_PRICE_TIERS.find((tier) => tier.level === level) || SHOP_PRICE_TIERS[1];
}

export function getShopCoinEarningRate() {
  return expectedRewardCoins('task') / SHOP_AVERAGE_WORK_MINUTES;
}

/**
 * Auto-pricing is anchored to the expected task reward roll, not fixed task
 * coin grants. A neutral 25-minute reward costs about 1.5 average completions;
 * harmful rewards cost more, beneficial/restorative rewards cost less.
 */
export function calculateItemCost(type, duration = 0, quantity = 1, enjoyment = 2) {
  if (type === ITEM_TYPE.cosmetic_title) return Math.max(1, Math.round(Number(quantity || 1) * 1000));
  const tier = getShopPriceTier(enjoyment);
  const coinsPerMinute = getShopCoinEarningRate();
  if (type === ITEM_TYPE.duration) {
    return Math.max(1, Math.round(Number(duration || 0) * coinsPerMinute * tier.multiplier));
  }
  return Math.max(1, Math.round(Number(quantity || 1) * SHOP_QUANTITY_MINUTE_EQUIVALENT * coinsPerMinute * tier.multiplier));
}


export function getShopItemCost(item = {}) {
  const configured = Number(item?.cost);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return calculateItemCost(
    item?.type,
    item?.duration,
    item?.quantity,
    item?.priceTier ?? item?.enjoyment,
  );
}

const asTime = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const hasStockLimit = (item) => (
  item?.stockLimit !== null
  && item?.stockLimit !== undefined
  && item?.stockLimit !== ''
  && Number.isFinite(Number(item.stockLimit))
);

export function isShopItemAvailable(item, now = new Date()) {
  if (hasStockLimit(item) && Number(item.stockLimit) >= 0) {
    return Number(item.soldCount || 0) < Number(item.stockLimit);
  }
  return true;
}

export function getShopItemAvailabilityLabel(item, now = new Date()) {
  if (hasStockLimit(item)) {
    const remaining = Math.max(0, Number(item.stockLimit) - Number(item.soldCount || 0));
    if (remaining === 0) return 'Sold out';
    return `${remaining} in stock`;
  }
  return 'Available';
}

export function canPurchaseShopQuantity(item, inventoryItem, quantity = 1, now = new Date()) {
  const requested = Number(quantity);
  if (!Number.isInteger(requested) || requested <= 0) return false;
  if (!isShopItemAvailable(item, now)) return false;

  if (item?.itemClass === ITEM_CLASS.unlock || String(item?.type || '').startsWith('cosmetic_')) {
    if (inventoryItem && Number(inventoryItem.quantity || 0) > 0) return false;
    if (requested > 1) return false;
  }

  const limit = Number(item?.purchaseLimitPerPlayer);
  if (Number.isFinite(limit) && limit > 0) {
    const purchased = Number(inventoryItem?.purchaseCount || 0) + requested;
    if (purchased > limit) return false;
  }

  const stockLimit = Number(item?.stockLimit);
  if (hasStockLimit(item) && stockLimit >= 0) {
    if (Number(item?.soldCount || 0) + requested > stockLimit) return false;
  }
  return true;
}

export function canPurchaseShopItem(item, inventoryItem, now = new Date(), pendingQuantity = 0) {
  return canPurchaseShopQuantity(item, inventoryItem, Number(pendingQuantity || 0) + 1, now);
}

export function getInventoryItemCooldown(item, now = new Date()) {
  const until = asTime(item?.cooldownUntil);
  const remainingMs = until == null ? 0 : Math.max(0, until - new Date(now).getTime());
  return {
    active: remainingMs > 0,
    remainingMs,
    until: remainingMs > 0 ? new Date(until).toISOString() : null,
  };
}

export function canUseInventoryItem(item, now = new Date()) {
  return Number(item?.quantity || 0) > 0 && !getInventoryItemCooldown(item, now).active;
}

export function applyInventoryUseState(item, now = new Date()) {
  const usedAt = new Date(now);
  const cooldownMs = Math.max(0, Number(item?.cooldownMs || 0));
  return {
    ...item,
    quantity: Math.max(0, Number(item?.quantity || 0) - 1),
    lastUsedAt: usedAt.toISOString(),
    useCount: Number(item?.useCount || 0) + 1,
    cooldownUntil: cooldownMs > 0
      ? new Date(usedAt.getTime() + cooldownMs).toISOString()
      : null,
  };
}
