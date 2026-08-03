import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';

export class MatchRepository extends DomainRepository {
  constructor(connection) {
    super(connection, { domain: 'matches', stores: [STORES.match, STORES.eventBuff, STORES.backgroundJob, STORES.backgroundJobReceipt] });
  }
}
export default MatchRepository;
