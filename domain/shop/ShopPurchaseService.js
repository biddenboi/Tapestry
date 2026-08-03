import { ITEM_CLASS, STORES } from '@domain/constants.js';
import {
  canPurchaseShopQuantity,
  getShopItemCost,
} from '@domain/shop/Shop.js';

const purchaseQueues = new WeakMap();

export class ShopPurchaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShopPurchaseError';
    this.code = code;
  }
}

function defaultUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `shop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findCatalogItem(catalog, requested) {
  if (!requested) return null;
  if (requested.UUID) {
    const byUUID = catalog.find((item) => item.UUID === requested.UUID);
    if (byUUID) return byUUID;
  }
  if (requested.itemId) {
    const byItemId = catalog.find((item) => (
      item.itemId === requested.itemId && item.type === requested.type
    ));
    if (byItemId) return byItemId;
  }
  return catalog.find((item) => item.name === requested.name && item.type === requested.type) || null;
}

function findOwnedInventory(inventory, playerUUID, item) {
  return inventory.find((entry) => entry.parent === playerUUID && entry.itemUUID === item.UUID)
    || inventory.find((entry) => (
      entry.parent === playerUUID
      && item.itemId
      && entry.type === item.type
      && entry.itemId === item.itemId
    ))
    || inventory.find((entry) => (
      entry.parent === playerUUID
      && entry.type === item.type
      && entry.name === item.name
    ))
    || null;
}

function hasConfiguredStockLimit(item) {
  return item?.stockLimit !== null
    && item?.stockLimit !== undefined
    && item?.stockLimit !== ''
    && Number.isFinite(Number(item.stockLimit));
}

function normalizeCart(catalog, cart) {
  const merged = new Map();
  for (const entry of Array.isArray(cart) ? cart : []) {
    const item = findCatalogItem(catalog, entry?.item);
    const quantity = Number(entry?.qty);
    if (!item) throw new ShopPurchaseError('catalog-item-missing', 'A cart item is no longer in the shop catalog.');
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ShopPurchaseError('invalid-quantity', 'Shop purchase quantities must be positive integers.');
    }
    const key = item.UUID || `${item.type || ''}:${item.itemId || item.name || ''}`;
    const existing = merged.get(key);
    merged.set(key, {
      item,
      qty: quantity + Number(existing?.qty || 0),
    });
  }
  const entries = [...merged.values()];
  if (!entries.length) throw new ShopPurchaseError('empty-cart', 'The shop cart is empty.');
  return entries;
}

function inventoryRecordForPurchase({ existing, item, playerUUID, quantity, nowISO, uuidFactory }) {
  if (existing) {
    return {
      ...existing,
      quantity: Number(existing.quantity || 0) + quantity,
      bannerImageUrl: item.bannerImageUrl || existing.bannerImageUrl || null,
      itemClass: item.itemClass || existing.itemClass || null,
      itemId: item.itemId || existing.itemId || null,
      icon: null,
      cooldownMs: Number(item.cooldownMs || existing.cooldownMs || 0),
      purchaseCount: Number(existing.purchaseCount || 0) + quantity,
      purchasedAt: nowISO,
    };
  }

  return {
    UUID: uuidFactory(),
    parent: playerUUID,
    itemUUID: item.UUID,
    name: item.name,
    description: item.description,
    icon: null,
    bannerImageUrl: item.bannerImageUrl || null,
    type: item.type,
    itemClass: item.itemClass || null,
    itemId: item.itemId || null,
    duration: item.duration,
    quantity,
    enjoyment: item.enjoyment,
    cost: getShopItemCost(item),
    category: item.category,
    cooldownMs: Number(item.cooldownMs || 0),
    lastUsedAt: null,
    useCount: 0,
    purchasedAt: nowISO,
    purchaseCount: quantity,
    cooldownUntil: null,
  };
}

export function buildShopPurchaseTransaction({
  player,
  catalog = [],
  inventory = [],
  cart = [],
  globalMoney = 0,
  purchaseBatchUUID = defaultUUID(),
  now = new Date(),
  uuidFactory = defaultUUID,
} = {}) {
  if (!player?.UUID) throw new ShopPurchaseError('player-missing', 'An active player is required to purchase shop items.');
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(nowDate.getTime())) throw new ShopPurchaseError('invalid-time', 'The purchase time is invalid.');
  const nowISO = nowDate.toISOString();
  const entries = normalizeCart(catalog, cart);
  const inventoryByUUID = new Map(inventory.filter((record) => record?.UUID).map((record) => [record.UUID, record]));
  const itemResults = [];
  const inventoryPuts = [];
  const catalogPuts = [];
  const ledgerPuts = [];
  let tokenCost = 0;
  let dollarCost = 0;

  for (const entry of entries) {
    const { item, qty } = entry;
    const existing = findOwnedInventory([...inventoryByUUID.values()], player.UUID, item);
    if (!canPurchaseShopQuantity(item, existing, qty, nowDate)) {
      throw new ShopPurchaseError('item-unavailable', `${item.name || 'This item'} is no longer available in the requested quantity.`);
    }

    const unitCost = getShopItemCost(item);
    const totalCost = unitCost * qty;
    const currencyType = item.currencyType === 'dollars' ? 'dollars' : 'tokens';
    if (currencyType === 'dollars') dollarCost += totalCost;
    else tokenCost += totalCost;

    const inventoryRecord = inventoryRecordForPurchase({
      existing,
      item,
      playerUUID: player.UUID,
      quantity: qty,
      nowISO,
      uuidFactory,
    });
    inventoryByUUID.set(inventoryRecord.UUID, inventoryRecord);
    inventoryPuts.push(inventoryRecord);

    if (hasConfiguredStockLimit(item)) {
      catalogPuts.push({
        ...item,
        soldCount: Number(item.soldCount || 0) + qty,
      });
    }

    const ledgerRecord = {
      UUID: uuidFactory(),
      parent: player.UUID,
      type: 'shop_purchase',
      purchaseBatchUUID,
      name: item.name,
      description: item.description || '',
      itemUUID: item.UUID,
      category: item.category || 'Other',
      currencyType,
      quantity: qty,
      unitCost,
      totalCost,
      cost: totalCost,
      createdAt: nowISO,
      completedAt: nowISO,
    };
    ledgerPuts.push(ledgerRecord);
    itemResults.push({ item, qty, unitCost, totalCost, currencyType, ledgerUUID: ledgerRecord.UUID });
  }

  const availableTokens = Number(player.tokens || 0);
  const availableMoney = Number(globalMoney || 0);
  if (availableTokens < tokenCost) {
    throw new ShopPurchaseError('insufficient-tokens', 'The player does not have enough tokens for this purchase.');
  }
  if (availableMoney < dollarCost) {
    throw new ShopPurchaseError('insufficient-money', 'The shared cash balance is too low for this purchase.');
  }

  const updatedPlayer = {
    ...player,
    tokens: availableTokens - tokenCost,
  };
  const globalMoneyAfter = availableMoney - dollarCost;
  const puts = [
    { store: STORES.player, record: updatedPlayer },
    ...inventoryPuts.map((record) => ({ store: STORES.inventory, record })),
    ...catalogPuts.map((record) => ({ store: STORES.shop, record })),
    ...ledgerPuts.map((record) => ({ store: STORES.transaction, record })),
  ];

  return {
    purchaseBatchUUID,
    occurredAt: nowISO,
    player: updatedPlayer,
    globalMoneyAfter,
    tokenCost,
    dollarCost,
    itemCount: itemResults.reduce((sum, entry) => sum + entry.qty, 0),
    items: itemResults,
    inventoryRecords: inventoryPuts,
    playerInventory: [...inventoryByUUID.values()].filter((record) => record.parent === player.UUID),
    catalogRecords: catalogPuts,
    ledgerRecords: ledgerPuts,
    puts,
  };
}

async function performPurchase(databaseConnection, options) {
  const playerUUID = options?.playerUUID;
  if (!playerUUID) throw new ShopPurchaseError('player-missing', 'An active player is required to purchase shop items.');

  await databaseConnection.ensureDomainsLoaded?.(['shop', 'inventory', 'profiles']);
  const [player, catalog, inventory] = await Promise.all([
    databaseConnection.get(STORES.player, playerUUID),
    databaseConnection.getAll(STORES.shop),
    databaseConnection.getPlayerStore(STORES.inventory, playerUUID),
  ]);
  const transaction = buildShopPurchaseTransaction({
    ...options,
    player,
    catalog,
    inventory,
    globalMoney: databaseConnection.getGlobalMoney(),
  });

  const commit = await databaseConnection.commitAtomicMutation({
    label: 'shop-purchase',
    puts: transaction.puts,
    globalMoney: transaction.globalMoneyAfter,
    flush: true,
  });
  return { ...transaction, commit };
}

/**
 * Purchases are serialized per connection so validation and commit observe the
 * latest balance, stock, and inventory state.
 */
export function commitShopPurchase(databaseConnection, options = {}) {
  if (!databaseConnection) return Promise.reject(new ShopPurchaseError('database-missing', 'A database connection is required.'));
  const previous = purchaseQueues.get(databaseConnection) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => performPurchase(databaseConnection, options));
  purchaseQueues.set(databaseConnection, current);
  current.finally(() => {
    if (purchaseQueues.get(databaseConnection) === current) purchaseQueues.delete(databaseConnection);
  }).catch(() => undefined);
  return current;
}

export function isShopUnlock(item) {
  return item?.itemClass === ITEM_CLASS.unlock || String(item?.type || '').startsWith('cosmetic_');
}
