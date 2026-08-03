import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';

export class RecommenderRepository extends DomainRepository {
  constructor(connection) {
    super(connection, {
      domain: 'recommender',
      stores: [STORES.recommenderEvent, STORES.appSetting],
    });
  }
}
export default RecommenderRepository;
