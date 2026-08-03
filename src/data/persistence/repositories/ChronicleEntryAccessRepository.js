import { STORES } from '../../../domain/constants.js';
import { normalizeChronicleAccess } from '../../../domain/chronicle/ChronicleAccessPolicy.js';

export class ChronicleEntryAccessRepository {
  constructor(facade) { this.facade = facade; }

  async get(entryUUID) {
    const record = await this.facade.get(STORES.chronicleEntryAccess, entryUUID);
    return record ? normalizeChronicleAccess(record) : null;
  }

  async list() {
    return (await this.facade.getAll(STORES.chronicleEntryAccess)).map((record) => (
      normalizeChronicleAccess(record)
    ));
  }
}

export default ChronicleEntryAccessRepository;

