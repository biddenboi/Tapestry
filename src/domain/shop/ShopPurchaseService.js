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
  const purchaseBatchUUID = options.purchaseBatchUUID || defaultUUID();
  const [player, catalog, inventory, ledger] = await Promise.all([
    databaseConnection.get(STORES.player, playerUUID),
    databaseConnection.getAll(STORES.shop),
    databaseConnection.getPlayerStore(STORES.inventory, playerUUID),
    databaseConnection.getPlayerStore(STORES.transaction, playerUUID),
  ]);
  const existingLedger = ledger.filter((record) => record.purchaseBatchUUID === purchaseBatchUUID);
  if (existingLedger.length) {
    const itemCount = existingLedger.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
    return {
      purchaseBatchUUID,
      occurredAt: existingLedger[0].createdAt || null,
      player,
      globalMoneyAfter: databaseConnection.getGlobalMoney(),
      tokenCost: existingLedger
        .filter((record) => record.currencyType !== 'dollars')
        .reduce((sum, record) => sum + Number(record.totalCost || record.cost || 0), 0),
      dollarCost: existingLedger
        .filter((record) => record.currencyType === 'dollars')
        .reduce((sum, record) => sum + Number(record.totalCost || record.cost || 0), 0),
      itemCount,
      items: existingLedger.map((record) => ({
        item: catalog.find((item) => item.UUID === record.itemUUID) || null,
        qty: Number(record.quantity || 0),
        unitCost: Number(record.unitCost || 0),
        totalCost: Number(record.totalCost || record.cost || 0),
        currencyType: record.currencyType || 'tokens',
        ledgerUUID: record.UUID,
      })),
      inventoryRecords: inventory.filter((record) => (
        existingLedger.some((entry) => entry.itemUUID === record.itemUUID)
      )),
      playerInventory: inventory,
      catalogRecords: [],
      ledgerRecords: existingLedger,
      puts: [],
      commit: { changed: false, duplicate: true, operationId: purchaseBatchUUID },
      duplicate: true,
    };
  }
  if (databaseConnection.syncRuntime && options.requireOnlineAuthority !== false) {
    const transport = databaseConnection.syncRuntime.transport;
    const device = databaseConnection.syncRuntime.device;
    if (!transport?.prepareShopAuthority || !transport?.purchaseShopItems || !device?.id) {
      throw new ShopPurchaseError(
        'connection-required',
        'Connection and private account sign-in are required for Shop purchases.',
      );
    }
    const occurredAt = (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString();
    await transport.prepareShopAuthority({
      player,
      catalog: catalog.map((item) => ({ ...item, cost: getShopItemCost(item) })),
      // Legacy inventory can contain decorative/non-Shop records without a
      // canonical catalog UUID. Those records remain local and must not poison
      // the authoritative Shop seed.
      inventory: inventory.filter((record) => (
        record?.UUID && record?.parent === playerUUID && record?.itemUUID
      )),
      globalMoney: databaseConnection.getGlobalMoney(),
    });
    const canonical = await transport.purchaseShopItems({
      operationId: purchaseBatchUUID,
      deviceId: device.id,
      playerId: playerUUID,
      cart: normalizeCart(catalog, options.cart).map(({ item, qty }) => ({
        itemId: item.UUID,
        quantity: qty,
      })),
      occurredAt,
    });
    if (!canonical?.player?.UUID || !Array.isArray(canonical.inventoryRecords)
        || !Array.isArray(canonical.ledgerRecords)) {
      throw new ShopPurchaseError('invalid-server-result', 'The Shop server returned an incomplete purchase receipt.');
    }
    const puts = [
      { store: STORES.player, record: canonical.player },
      ...canonical.inventoryRecords.map((record) => ({ store: STORES.inventory, record })),
      ...(canonical.catalogRecords || []).map((record) => ({ store: STORES.shop, record })),
      ...canonical.ledgerRecords.map((record) => ({ store: STORES.transaction, record })),
    ];
    const commit = await databaseConnection.commitAtomicMutation({
      operationId: purchaseBatchUUID,
      label: 'shop-purchase-authoritative-result',
      puts,
      globalMoney: Number(canonical.globalMoneyAfter || 0),
      flush: true,
      sync: { origin: options.origin || 'desktop', enqueueSync: false },
    });
    return { ...canonical, commit, duplicate: Boolean(canonical.duplicate || commit?.duplicate) };
  }
  const transaction = buildShopPurchaseTransaction({
    ...options,
    purchaseBatchUUID,
    player,
    catalog,
    inventory,
    globalMoney: databaseConnection.getGlobalMoney(),
  });

  const sync = databaseConnection.createSyncCommandContext?.({
    origin: options.origin || 'desktop',
    // Constrained purchases remain online-authoritative. Phase 7 replaces
    // this local command with the server purchase RPC before enabling sync.
    enqueueSync: false,
    operationId: purchaseBatchUUID,
    playerId: playerUUID,
    commandType: 'purchaseShopItems',
    entityType: 'purchase',
    entityId: purchaseBatchUUID,
    payload: {
      purchaseBatchUUID,
      cart: transaction.items.map(({ item, qty }) => ({ itemId: item.UUID, quantity: qty })),
    },
    occurredAt: transaction.occurredAt,
  }) || { origin: options.origin || 'desktop', enqueueSync: false };
  const commit = await databaseConnection.commitAtomicMutation({
    operationId: purchaseBatchUUID,
    label: 'shop-purchase',
    puts: transaction.puts,
    globalMoney: transaction.globalMoneyAfter,
    flush: true,
    sync,
  });
  return { ...transaction, commit, duplicate: Boolean(commit?.duplicate) };
}

export async function reconcileShopAuthority(databaseConnection, playerUUID, {
  origin = 'remote-sync',
} = {}) {
  const transport = databaseConnection?.syncRuntime?.transport;
  if (!transport?.getShopAuthority || !playerUUID) return null;
  const canonical = await transport.getShopAuthority(playerUUID);
  if (!canonical?.player?.UUID || !Array.isArray(canonical.catalogRecords)
      || !Array.isArray(canonical.inventoryRecords)) {
    throw new ShopPurchaseError('invalid-server-result', 'The Shop server returned an incomplete authority snapshot.');
  }
  await databaseConnection.commitAtomicMutation({
    operationId: `shop-reconcile:${playerUUID}:${canonical.reconciledAt || Date.now()}`,
    label: 'shop-authority-reconciliation',
    puts: [
      { store: STORES.player, record: canonical.player },
      ...canonical.catalogRecords.map((record) => ({ store: STORES.shop, record })),
      ...canonical.inventoryRecords.map((record) => ({ store: STORES.inventory, record })),
    ],
    globalMoney: Number(canonical.globalMoneyAfter || 0),
    flush: true,
    sync: { origin, enqueueSync: false },
  });
  return canonical;
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
