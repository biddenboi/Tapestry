import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';
import { isConsumableInventoryItem } from '@domain/shop/Shop.js';

export class InventoryRepository extends DomainRepository {
  constructor(connection) {
    super(connection, { domain: 'inventory', stores: [STORES.inventory] });
  }

  async getOwnedByPlayer(playerUUID) {
    await this.ensureLoaded();
    return this.connection.getPlayerStore(STORES.inventory, playerUUID);
  }

  async getConsumablesByPlayer(playerUUID) {
    return (await this.getOwnedByPlayer(playerUUID)).filter(isConsumableInventoryItem);
  }
}
export default InventoryRepository;
