import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';

export class FeedRepository extends DomainRepository {
  constructor(connection) {
    super(connection, { domain: 'feed', domains: ['journals', 'feed'], stores: [STORES.journal, STORES.journalComment] });
  }
}
export default FeedRepository;
