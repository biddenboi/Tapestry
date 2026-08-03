import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';

export class ShopRepository extends DomainRepository {
  constructor(connection) {
    super(connection, { domain: 'shop', stores: [STORES.shop, STORES.transaction] });
  }

  async getCatalog() {
    return this.getAll(STORES.shop);
  }

  async getLedgerForPlayer(playerUUID) {
    await this.ensureLoaded();
    return this.connection.getPlayerStore(STORES.transaction, playerUUID);
  }
}

export default ShopRepository;
