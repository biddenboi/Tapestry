import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';

export class DerivedCacheRepository extends DomainRepository {
  constructor(connection) {
    super(connection, {
      domain: 'derivedCaches',
      domains: ['leaderboards'],
      stores: [STORES.derivedCache, STORES.profileSummary],
    });
  }

  async getDomainCache(UUID) {
    return this.get(STORES.derivedCache, UUID);
  }

  async putDomainCache(record, options) {
    return this.put(STORES.derivedCache, record, options);
  }

  async getProfileSummary(UUID) {
    await this.connection.ensureDomainLoaded('profileSummaries');
    return this.connection.get(STORES.profileSummary, UUID);
  }
}

export default DerivedCacheRepository;
