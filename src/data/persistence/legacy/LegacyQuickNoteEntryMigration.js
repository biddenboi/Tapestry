import { STORES } from '../../../domain/constants.js';
import { createChronicleRevision } from '../../../domain/chronicle/ChronicleRevision.js';
import {
  isNoteConflict,
  isNoteTombstone,
  normalizeNoteRecord,
} from '../notes/noteDurability.js';

function upsert(records, record) {
  const index = records.findIndex((item) => String(item.UUID) === String(record.UUID));
  if (index >= 0) records[index] = record;
  else records.push(record);
}

export async function migrateLegacyQuickNotesToEntries(sourceStores = {}) {
  const stores = Object.fromEntries(
    Object.entries(sourceStores).map(([store, records]) => [store, [...(records || [])]]),
  );
  const notes = (stores[STORES.notes] || []).map(normalizeNoteRecord).filter(Boolean);
  const fallbackOwnerUUID = stores[STORES.player]?.[0]?.UUID || null;
  const mappings = stores[STORES.chronicleLegacyNoteMapping] ||= [];
  const mapped = new Set(mappings.map((record) => String(record.legacyNoteUUID || record.UUID)));

  for (const note of notes) {
    if (isNoteConflict(note) || mapped.has(String(note.UUID))) continue;
    const now = note.updatedAt || note.createdAt || new Date().toISOString();
    if (isNoteTombstone(note)) {
      upsert(mappings, {
        UUID: note.UUID,
        legacyNoteUUID: note.UUID,
        journalUUID: null,
        migrationState: 'tombstone',
        legacyRevision: note.revision,
        legacyContentHash: note.deletedContentHash || note.contentHash,
        parent: note.parent || note.playerUUID || null,
        migratedAt: now,
        createdAt: note.createdAt || now,
        updatedAt: now,
      });
      continue;
    }

    const entryUUID = `legacy-note:${note.UUID}`;
    const ownerUUID = note.parent || note.playerUUID || fallbackOwnerUUID;
    if (!ownerUUID) {
      upsert(mappings, {
        UUID: note.UUID,
        legacyNoteUUID: note.UUID,
        journalUUID: null,
        migrationState: 'conflict',
        legacyRevision: note.revision,
        legacyContentHash: note.contentHash,
        parent: null,
        migratedAt: now,
        createdAt: note.createdAt || now,
        updatedAt: now,
      });
      upsert(stores[STORES.chronicleEntryConflict] ||= [], {
        UUID: `legacy-note-conflict:unowned:${note.UUID}`,
        entryUUID: null,
        legacyNoteUUID: note.UUID,
        proposedBody: note.content || '',
        proposedContentHash: note.contentHash,
        reason: 'missing-owner',
        source: 'legacy-quick-notes',
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      });
      continue;
    }
    const revision = await createChronicleRevision({
      entryUUID,
      revisionNumber: 1,
      baseRevisionNumber: 0,
      ownerUUID,
      editorUUID: ownerUUID,
      body: note.content || '',
      entryKind: 'moment',
      editSummary: 'Imported from Quick Notes',
      clientOperationId: `migration:legacy-note:${note.UUID}`,
      origin: 'migration',
      createdAt: now,
      authoritativeAt: now,
    });
    const journal = {
      UUID: entryUUID,
      parent: ownerUUID,
      title: '',
      entry: note.content || '',
      images: [],
      tags: [],
      createdAt: note.createdAt || now,
      editedAt: now,
      currentRevisionNumber: 1,
      revisionContentHash: revision.contentHash,
      migrationMetadata: {
        source: 'quick-notes',
        legacyNoteUUID: note.UUID,
        legacyRevision: note.revision,
        legacyContentHash: note.contentHash,
      },
    };
    const metadata = {
      UUID: entryUUID,
      journalUUID: entryUUID,
      parent: ownerUUID,
      playerUUID: ownerUUID,
      entryKind: 'moment',
      lifecycleState: 'published',
      visibility: 'private',
      occurrenceAt: note.createdAt || now,
      occurrenceIGT: null,
      publishedAt: note.createdAt || now,
      subtitle: '',
      contextSnapshot: {
        version: 1,
        private: { legacyNoteUUID: note.UUID },
        shared: {},
      },
      resurfacePolicy: 'normal',
      standaloneInFeed: false,
      reactionsEnabled: true,
      responsesEnabled: true,
      currentRevisionNumber: 1,
      latestEditorUUID: ownerUUID,
      latestRevisedAt: now,
      updatedAt: now,
    };
    const access = {
      UUID: entryUUID,
      journalUUID: entryUUID,
      ownerUUID,
      parent: ownerUUID,
      visibility: 'private',
      editPolicy: 'owner',
      collaborationState: 'local',
      authorityRevision: 1,
      authorityScope: 'local',
      lockedAt: null,
      lockedBy: null,
      createdAt: note.createdAt || now,
      updatedAt: now,
    };
    const receipt = {
      UUID: `migration:legacy-note:${note.UUID}`,
      operationId: `migration:legacy-note:${note.UUID}`,
      commandType: 'migration_backfill',
      actorUUID: ownerUUID,
      parent: ownerUUID,
      entryUUID,
      resultingRevision: 1,
      resultStatus: 'accepted',
      authoritativeAt: now,
      responseMetadata: { source: 'quick-notes', legacyRevision: note.revision },
      createdAt: now,
      updatedAt: now,
    };
    upsert(stores[STORES.journal] ||= [], journal);
    upsert(stores[STORES.chronicleEntryMetadata] ||= [], metadata);
    upsert(stores[STORES.chronicleEntryAccess] ||= [], access);
    upsert(stores[STORES.chronicleEntryRevision] ||= [], revision);
    upsert(stores[STORES.chronicleEntryOperationReceipt] ||= [], receipt);
    upsert(mappings, {
      UUID: note.UUID,
      legacyNoteUUID: note.UUID,
      journalUUID: entryUUID,
      migrationState: 'imported',
      legacyRevision: note.revision,
      legacyContentHash: note.contentHash,
      parent: ownerUUID,
      migratedAt: now,
      createdAt: note.createdAt || now,
      updatedAt: now,
    });
  }

  for (const conflict of notes.filter(isNoteConflict)) {
    const entryUUID = conflict.conflictOf ? `legacy-note:${conflict.conflictOf}` : null;
    const now = conflict.updatedAt || conflict.createdAt || new Date().toISOString();
    upsert(stores[STORES.chronicleEntryConflict] ||= [], {
      UUID: `legacy-note-conflict:${conflict.UUID}`,
      entryUUID,
      legacyConflictUUID: conflict.UUID,
      parent: conflict.parent || null,
      baseRevisionNumber: conflict.baseRevision || null,
      currentRevisionNumber: conflict.canonicalRevision || null,
      proposedBody: conflict.content || '',
      proposedContentHash: conflict.contentHash || null,
      currentContentHash: conflict.canonicalHash || null,
      clientOperationId: conflict.operationId || null,
      reason: conflict.reason || 'legacy-note-conflict',
      source: 'legacy-quick-notes',
      createdAt: conflict.createdAt || now,
      updatedAt: now,
      resolvedAt: conflict.resolvedAt || null,
      resolution: conflict.resolution || null,
    });
  }
  return stores;
}

export default migrateLegacyQuickNotesToEntries;
