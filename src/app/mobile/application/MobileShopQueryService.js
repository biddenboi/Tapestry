import { STORES } from '../../../domain/constants.js';

/**
 * Shop definitions belong to the workspace. Inventory remains owned by the
 * active profile. Keeping those reads together makes the scope boundary
 * explicit and prevents profile switches from filtering catalog items.
 */
export async function queryMobileShopState(databaseConnection, { playerUUID } = {}) {
  if (!databaseConnection || !playerUUID) {
    throw new TypeError('The mobile Shop query requires a database connection and active player.');
  }

  const shopRepository = databaseConnection.getRepository?.('shop');
  const inventoryRepository = databaseConnection.getRepository?.('inventory');
  const catalogQuery = shopRepository?.getCatalog
    ? shopRepository.getCatalog()
    : databaseConnection.getAll?.(STORES.shop);
  const inventoryQuery = inventoryRepository?.getOwnedByPlayer
    ? inventoryRepository.getOwnedByPlayer(playerUUID)
    : databaseConnection.getPlayerStore?.(STORES.inventory, playerUUID);

  if (!catalogQuery || !inventoryQuery) {
    throw new Error('The Shop catalog or profile inventory query is unavailable.');
  }

  const [catalog, inventory] = await Promise.all([catalogQuery, inventoryQuery]);
  return Object.freeze({
    catalog: Object.freeze([...(catalog || [])]),
    inventory: Object.freeze([...(inventory || [])]),
    money: Math.max(0, Number(databaseConnection.getGlobalMoney?.() || 0)),
  });
}

export default queryMobileShopState;
