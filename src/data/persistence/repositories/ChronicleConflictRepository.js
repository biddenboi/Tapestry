import { STORES } from '../../../domain/constants.js';

export class ChronicleConflictRepository {
  constructor(facade) { this.facade = facade; }

  async unresolved(entryUUID = null) {
    return (await this.facade.getAll(STORES.chronicleEntryConflict))
      .filter((conflict) => !conflict.resolvedAt)
      .filter((conflict) => !entryUUID || String(conflict.entryUUID) === String(entryUUID))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
}

export default ChronicleConflictRepository;

