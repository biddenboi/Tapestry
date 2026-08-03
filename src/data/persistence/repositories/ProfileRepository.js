import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';

export class ProfileRepository extends DomainRepository {
  constructor(connection) {
    super(connection, { domain: 'profiles', stores: [STORES.player] });
  }
}
export default ProfileRepository;
