import { STORES } from '../../../domain/constants.js';

export class ChronicleRevisionRepository {
  constructor(facade) { this.facade = facade; }

  async get(revisionUUID) {
    return this.facade.get(STORES.chronicleEntryRevision, revisionUUID);
  }

  async findByOperation(clientOperationId) {
    if (!clientOperationId) return null;
    return (await this.facade.getAll(STORES.chronicleEntryRevision))
      .find((revision) => revision.clientOperationId === clientOperationId) || null;
  }

  async listForEntry(entryUUID, { beforeRevision = Infinity, limit = 20 } = {}) {
    return (await this.facade.getAll(STORES.chronicleEntryRevision))
      .filter((revision) => String(revision.entryUUID) === String(entryUUID))
      .filter((revision) => Number(revision.revisionNumber) < Number(beforeRevision))
      .sort((a, b) => Number(b.revisionNumber) - Number(a.revisionNumber))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
  }

  async latest(entryUUID) {
    return (await this.listForEntry(entryUUID, { limit: 1 }))[0] || null;
  }
}

export default ChronicleRevisionRepository;

