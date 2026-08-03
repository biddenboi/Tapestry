import { STORES } from '../../../domain/constants.js';
import { normalizeChronicleAccess } from '../../../domain/chronicle/ChronicleAccessPolicy.js';
import { createChronicleRevision } from '../../../domain/chronicle/ChronicleRevision.js';
import { conservativeChronicleMetadata } from '../../../domain/chronicle/ChronicleEntryKind.js';
import { migrateLegacyQuickNotesToEntries } from '../legacy/LegacyQuickNoteEntryMigration.js';

const RECONCILED_STORES = Object.freeze([
  STORES.journal,
  STORES.chronicleEntryMetadata,
  STORES.chronicleEntryAccess,
  STORES.chronicleEntryRevision,
  STORES.chronicleEntryOperationReceipt,
  STORES.chronicleEntryConflict,
  STORES.chronicleLegacyNoteMapping,
]);

function newestRevisionByEntry(revisions) {
  const result = new Map();
  for (const revision of revisions) {
    const current = result.get(String(revision.entryUUID));
    if (Number(revision.revisionNumber) > Number(current?.revisionNumber || 0)) {
      result.set(String(revision.entryUUID), revision);
    }
  }
  return result;
}

function putIfChanged(operations, currentByStore, store, record) {
  const prior = currentByStore.get(store).get(String(record.UUID));
  if (JSON.stringify(prior || null) === JSON.stringify(record)) return;
  operations.push({ store, record });
  currentByStore.get(store).set(String(record.UUID), record);
}

function parseContextSnapshot(value) {
  if (!value) return { version: 1, private: {}, shared: {} };
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return { version: 1, private: {}, shared: {} }; }
}

async function legacyTypedMetadata(facade) {
  const client = facade.persistenceRuntime?.sqliteStorageAdapter?.client;
  if (!client?.query) return [];
  const rows = await client.query({
    sql: `SELECT m.journal_id AS journalId,j.player_id AS playerUUID,
                 m.entry_kind AS entryKind,m.lifecycle_state AS lifecycleState,
                 m.visibility,m.occurrence_at AS occurrenceAt,
                 m.occurrence_igt AS occurrenceIGT,m.published_at AS publishedAt,
                 m.subtitle,m.context_snapshot_json AS contextSnapshotJson,
                 m.resurface_policy AS resurfacePolicy,
                 m.standalone_in_feed AS standaloneInFeed,
                 m.reactions_enabled AS reactionsEnabled,
                 m.responses_enabled AS responsesEnabled,m.updated_at AS updatedAt
          FROM chronicle_entry_metadata m
          JOIN journals j ON j.id=m.journal_id
          WHERE j.deleted_at IS NULL`,
    result: 'all',
  });
  return (rows || []).map((row) => ({
    UUID: row.journalId,
    journalUUID: row.journalId,
    parent: row.playerUUID,
    playerUUID: row.playerUUID,
    entryKind: row.entryKind || 'entry',
    lifecycleState: row.lifecycleState || 'published',
    visibility: row.visibility || 'private',
    occurrenceAt: row.occurrenceAt,
    occurrenceIGT: row.occurrenceIGT == null ? null : Number(row.occurrenceIGT),
    publishedAt: row.publishedAt,
    subtitle: row.subtitle || '',
    contextSnapshot: parseContextSnapshot(row.contextSnapshotJson),
    resurfacePolicy: row.resurfacePolicy || 'normal',
    standaloneInFeed: Boolean(row.standaloneInFeed),
    reactionsEnabled: row.reactionsEnabled !== 0,
    responsesEnabled: row.responsesEnabled !== 0,
    updatedAt: row.updatedAt,
  }));
}

export class ChronicleSchema40ReconciliationService {
  constructor(facade) { this.facade = facade; }

  async reconcile() {
    const sourceStores = {};
    for (const store of Object.values(STORES)) {
      sourceStores[store] = typeof this.facade._records === 'function'
        ? this.facade._records(store)
        : await this.facade.getAll(store);
    }
    const migrated = await migrateLegacyQuickNotesToEntries(sourceStores);
    // Some schema-35 through schema-39 saves retained Chronicle metadata only
    // in the typed query projection. Promote those rows back into the canonical
    // document store so access and revision history can be reconstructed.
    const documentMetadataIds = new Set(
      (sourceStores[STORES.chronicleEntryMetadata] || []).map((record) => String(record.UUID)),
    );
    const typedMetadata = await legacyTypedMetadata(this.facade);
    migrated[STORES.chronicleEntryMetadata] = [
      ...(migrated[STORES.chronicleEntryMetadata] || []),
      ...typedMetadata.filter((record) => !documentMetadataIds.has(String(record.UUID))),
    ];
    const currentByStore = new Map(RECONCILED_STORES.map((store) => [
      store,
      new Map((sourceStores[store] || []).map((record) => [String(record.UUID), record])),
    ]));
    const puts = [];
    for (const store of RECONCILED_STORES) {
      for (const record of migrated[store] || []) {
        putIfChanged(puts, currentByStore, store, record);
      }
    }

    const journals = [...currentByStore.get(STORES.journal).values()];
    const metadataByEntry = currentByStore.get(STORES.chronicleEntryMetadata);
    const accessByEntry = currentByStore.get(STORES.chronicleEntryAccess);
    const revisions = [...currentByStore.get(STORES.chronicleEntryRevision).values()];
    const latestByEntry = newestRevisionByEntry(revisions);
    const receipts = currentByStore.get(STORES.chronicleEntryOperationReceipt);

    for (const journal of journals) {
      let metadata = metadataByEntry.get(String(journal.UUID));
      if (!metadata) {
        metadata = conservativeChronicleMetadata(journal);
        putIfChanged(puts, currentByStore, STORES.chronicleEntryMetadata, metadata);
      }
      const ownerUUID = journal.parent || metadata.playerUUID || metadata.parent;
      if (!ownerUUID) continue;
      const now = metadata.updatedAt || journal.editedAt || journal.createdAt || new Date().toISOString();
      let access = accessByEntry.get(String(journal.UUID));
      if (!access) {
        access = normalizeChronicleAccess({
          UUID: journal.UUID,
          journalUUID: journal.UUID,
          ownerUUID,
          parent: ownerUUID,
          visibility: metadata.visibility || 'private',
          editPolicy: metadata.visibility === 'global' ? 'any_profile' : 'owner',
          collaborationState: 'local',
          authorityScope: 'local',
          authorityRevision: 1,
          createdAt: journal.createdAt || metadata.occurrenceAt || now,
          updatedAt: now,
        }, metadata);
        putIfChanged(puts, currentByStore, STORES.chronicleEntryAccess, access);
      }

      let latest = latestByEntry.get(String(journal.UUID));
      if (!latest) {
        const operationId = `migration:040-document:${journal.UUID}`;
        latest = await createChronicleRevision({
          entryUUID: journal.UUID,
          revisionNumber: 1,
          baseRevisionNumber: 0,
          ownerUUID,
          editorUUID: ownerUUID,
          title: journal.title || '',
          subtitle: metadata.subtitle || '',
          body: journal.entry || '',
          images: journal.images || [],
          entryKind: metadata.entryKind || 'entry',
          editSummary: 'Initial revision backfill',
          clientOperationId: operationId,
          origin: 'migration',
          createdAt: now,
          authoritativeAt: now,
        });
        putIfChanged(puts, currentByStore, STORES.chronicleEntryRevision, latest);
        latestByEntry.set(String(journal.UUID), latest);
        if (!receipts.has(operationId)) {
          putIfChanged(puts, currentByStore, STORES.chronicleEntryOperationReceipt, {
            UUID: operationId,
            operationId,
            commandType: 'migration_backfill',
            actorUUID: ownerUUID,
            parent: ownerUUID,
            entryUUID: journal.UUID,
            resultingRevision: 1,
            resultStatus: 'accepted',
            authoritativeAt: now,
            responseMetadata: { schemaVersion: 40, source: 'canonical-document' },
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const revisionNumber = Number(latest.revisionNumber) || 1;
      if (
        journal.revisionContentHash !== latest.contentHash
        || Number(journal.currentRevisionNumber || 0) !== revisionNumber
      ) {
        putIfChanged(puts, currentByStore, STORES.journal, {
          ...journal,
          revisionContentHash: latest.contentHash,
          currentRevisionNumber: revisionNumber,
        });
      }
      if (
        Number(metadata.currentRevisionNumber || 0) !== revisionNumber
        || metadata.latestEditorUUID !== latest.editorUUID
        || metadata.latestRevisedAt !== (latest.authoritativeAt || latest.createdAt)
      ) {
        putIfChanged(puts, currentByStore, STORES.chronicleEntryMetadata, {
          ...metadata,
          currentRevisionNumber: revisionNumber,
          latestEditorUUID: latest.editorUUID,
          latestRevisedAt: latest.authoritativeAt || latest.createdAt,
        });
      }
    }

    if (puts.length) {
      const documents = this.facade.persistenceRuntime?.sqliteStorageAdapter?.documents;
      if (documents?.commitBatch && typeof this.facade._store === 'function') {
        await documents.commitBatch({
          label: 'chronicle-schema-40-document-reconciliation',
          operations: puts.map(({ store, record }) => ({ type: 'put', store, record })),
        });
        for (const { store, record } of puts) {
          this.facade._store(store).set(record.UUID, structuredClone(record));
        }
      } else if (this.facade.commitAtomicMutation) {
        await this.facade.commitAtomicMutation({
          label: 'chronicle-schema-40-document-reconciliation',
          puts,
          queueDerived: false,
        });
      } else {
        throw new Error('Chronicle reconciliation requires atomic document storage.');
      }
    }
    return {
      changed: puts.length > 0,
      operationCount: puts.length,
      entryCount: journals.length,
    };
  }
}

export default ChronicleSchema40ReconciliationService;
