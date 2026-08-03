import { STORES } from '../../../domain/constants.js';

export class ChronicleOutboxRepository {
  constructor(facade) { this.facade = facade; }

  async pending() {
    return (await this.facade.getAll(STORES.chronicleCollaborationOutbox))
      .filter((item) => item.state === 'pending' || item.state === 'retry')
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }
}

export default ChronicleOutboxRepository;

