import { STORES } from '../../../domain/constants.js';
import {
  conservativeChronicleMetadata,
  normalizeChronicleEntryKind,
} from '../../../domain/chronicle/ChronicleEntryKind.js';

async function commit(facade, { puts = [], deletes = [], label }) {
  if (typeof facade.commitAtomicMutation === 'function') {
    return facade.commitAtomicMutation({ label, puts, deletes });
  }
  for (const item of puts) await facade.add(item.store, item.record);
  for (const item of deletes) await facade.remove(item.store, item.UUID);
  return { committed: true };
}

export class ChronicleRepository {
  constructor(facade) {
    if (!facade?.add || !facade?.getAll) {
      throw new Error('ChronicleRepository requires the canonical database facade.');
    }
    this.facade = facade;
  }

  async getMetadata(journalUUID) {
    return this.facade.get(STORES.chronicleEntryMetadata, journalUUID);
  }

  async metadataFor(journal) {
    return conservativeChronicleMetadata(journal, await this.getMetadata(journal.UUID));
  }

  async listMetadata() {
    return this.facade.getAll(STORES.chronicleEntryMetadata);
  }

  async saveMetadata(metadata) {
    if (!metadata?.journalUUID && !metadata?.UUID) throw new Error('Chronicle metadata requires a Journal ID.');
    const journalUUID = String(metadata.journalUUID || metadata.UUID);
    const record = {
      ...metadata,
      UUID: journalUUID,
      journalUUID,
      entryKind: normalizeChronicleEntryKind(metadata.entryKind),
      updatedAt: metadata.updatedAt || new Date().toISOString(),
    };
    await this.facade.add(STORES.chronicleEntryMetadata, record);
    return record;
  }

  async saveEntry({ journal, metadata }) {
    if (!journal?.UUID || !journal?.parent) throw new Error('Chronicle entries require Journal and author IDs.');
    const now = new Date().toISOString();
    const normalized = {
      ...conservativeChronicleMetadata(journal, metadata),
      ...metadata,
      UUID: journal.UUID,
      journalUUID: journal.UUID,
      parent: journal.parent,
      playerUUID: journal.parent,
      updatedAt: now,
    };
    await commit(this.facade, {
      label: `chronicle-entry:${journal.UUID}`,
      puts: [
        { store: STORES.journal, record: journal },
        { store: STORES.chronicleEntryMetadata, record: normalized },
      ],
    });
    return { journal, metadata: normalized };
  }

  async archive(journalUUID) {
    const current = await this.getMetadata(journalUUID);
    if (!current) return null;
    return this.saveMetadata({
      ...current,
      lifecycleState: 'archived',
      publishedAt: null,
    });
  }

  async setResurfacePolicy(journalUUID, resurfacePolicy) {
    const current = await this.getMetadata(journalUUID);
    if (!current) return null;
    return this.saveMetadata({ ...current, resurfacePolicy });
  }

  async addLink(link) {
    const UUID = link.UUID || [
      link.sourceJournalUUID,
      link.targetType,
      link.targetId,
      link.relationType,
    ].join(':');
    const record = { ...link, UUID, createdAt: link.createdAt || new Date().toISOString() };
    await this.facade.add(STORES.chronicleEntryLink, record);
    return record;
  }

  async linksFor(journalUUID) {
    return (await this.facade.getAll(STORES.chronicleEntryLink))
      .filter((link) => String(link.sourceJournalUUID) === String(journalUUID));
  }
}

export default ChronicleRepository;
