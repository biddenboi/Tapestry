import { STORES } from '@domain/constants.js';
import { getShopItemCost } from '@domain/shop/Shop.js';

function operationId(itemUUID) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  return `activate-shop-item:${itemUUID}:${suffix}`;
}

export function effectIntervalStatement(effect) {
  if (!effect?.id) return null;
  return {
    sql: `INSERT INTO effect_intervals(
            id,player_id,source_type,source_id,effect_scope,multiplier,stacking_rule,
            starts_at,ends_at,policy_version,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    bind: [
      effect.id,
      effect.playerId,
      effect.sourceType,
      effect.sourceId,
      effect.effectScope,
      Number(effect.multiplier),
      effect.stackingRule,
      effect.startsAt,
      effect.endsAt,
      Number(effect.policyVersion),
      effect.createdAt,
    ],
    result: 'changes',
  };
}

export function effectCancellationStatement(receipt) {
  if (!receipt?.id || !receipt?.intervalId || !receipt?.operationId) return null;
  return {
    sql: `INSERT INTO effect_cancellation_receipts(
            id,interval_id,player_id,device_id,operation_id,cancelled_at,created_at
          ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(interval_id) DO NOTHING`,
    bind: [
      receipt.id,
      receipt.intervalId,
      receipt.playerId,
      receipt.deviceId,
      receipt.operationId,
      receipt.cancelledAt,
      receipt.createdAt || receipt.cancelledAt,
    ],
    result: 'changes',
  };
}

export function remoteShopActivationMutation(payload = {}) {
  if (!payload.inventoryRecord?.UUID || !payload.timelineEvent?.UUID) {
    throw new Error('Remote Shop activation is missing its canonical inventory records.');
  }
  return {
    label: 'remote-shop-item-activation',
    puts: [
      { store: STORES.inventory, record: payload.inventoryRecord },
      { store: STORES.event, record: payload.timelineEvent },
    ],
    additionalStatements: [effectIntervalStatement(payload.effectInterval)].filter(Boolean),
    sync: { origin: 'remote-sync', enqueueSync: false },
  };
}

export function remoteShopEffectCancellationMutation(payload = {}) {
  const receipt = payload.cancellationReceipt;
  if (!receipt?.id || !receipt?.intervalId) {
    throw new Error('Remote effect cancellation is missing its immutable receipt.');
  }
  return {
    label: 'remote-shop-effect-cancellation',
    additionalStatements: [effectCancellationStatement(receipt)],
    sync: { origin: 'remote-sync', enqueueSync: false },
  };
}

export async function cancelShopEffectCommand(databaseConnection, effect, {
  requestedOperationId = null,
} = {}) {
  const transport = databaseConnection?.syncRuntime?.transport;
  const device = databaseConnection?.syncRuntime?.device;
  if (!effect?.id || !effect?.playerId || !transport?.cancelShopEffect || !device?.id) {
    const error = new Error('Connection and private account sign-in are required to end this effect.');
    error.code = 'connection-required';
    throw error;
  }
  const id = requestedOperationId || `cancel-shop-effect:${effect.id}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  const canonical = await transport.cancelShopEffect({
    operationId: id,
    deviceId: device.id,
    playerId: effect.playerId,
    intervalId: effect.id,
  });
  const mutation = remoteShopEffectCancellationMutation(canonical);
  const commit = await databaseConnection.commitAtomicMutation({
    ...mutation,
    operationId: id,
    label: 'shop-effect-cancellation-authoritative-result',
    sync: { origin: 'mobile', enqueueSync: false },
  });
  return { ...canonical, commit };
}

export async function activateShopItemCommand(databaseConnection, item, {
  requestedOperationId = null,
} = {}) {
  if (!databaseConnection?.syncRuntime || !item?.UUID || !item?.parent) {
    throw new Error('Using a constrained inventory item requires its canonical record.');
  }
  const transport = databaseConnection.syncRuntime.transport;
  const device = databaseConnection.syncRuntime.device;
  if (!transport?.prepareShopAuthority || !transport?.activateShopItem || !device?.id) {
    const error = new Error('Connection and private account sign-in are required to use this item.');
    error.code = 'connection-required';
    throw error;
  }
  const [player, catalog, inventory] = await Promise.all([
    databaseConnection.get(STORES.player, item.parent),
    databaseConnection.getAll(STORES.shop),
    databaseConnection.getPlayerStore(STORES.inventory, item.parent),
  ]);
  await transport.prepareShopAuthority({
    player,
    catalog: catalog.map((record) => ({ ...record, cost: getShopItemCost(record) })),
    inventory: inventory.filter((record) => (
      record?.UUID && record?.parent === item.parent && record?.itemUUID
    )),
    globalMoney: databaseConnection.getGlobalMoney(),
  });
  const id = requestedOperationId || operationId(item.UUID);
  const canonical = await transport.activateShopItem({
    operationId: id,
    deviceId: device.id,
    playerId: item.parent,
    inventoryId: item.UUID,
  });
  const mutation = remoteShopActivationMutation(canonical);
  const commit = await databaseConnection.commitAtomicMutation({
    ...mutation,
    operationId: id,
    label: 'shop-item-activation-authoritative-result',
    sync: { origin: 'mobile', enqueueSync: false },
  });
  return { ...canonical, commit };
}

export default activateShopItemCommand;
