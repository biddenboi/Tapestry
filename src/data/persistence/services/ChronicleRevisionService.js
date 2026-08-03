import { STORES } from '../../../domain/constants.js';
import {
  canEditEntry,
  normalizeChronicleAccess,
} from '../../../domain/chronicle/ChronicleAccessPolicy.js';
import { createChronicleRevision } from '../../../domain/chronicle/ChronicleRevision.js';
import ChronicleRevisionRepository from '../repositories/ChronicleRevisionRepository.js';

const facadeQueues = new WeakMap();

async function withEntryLock(facade, entryUUID, command) {
  let queues = facadeQueues.get(facade);
  if (!queues) {
    queues = new Map();
    facadeQueues.set(facade, queues);
  }
  const prior = queues.get(entryUUID) || Promise.resolve();
  const next = prior.catch(() => {}).then(command);
  queues.set(entryUUID, next);
  try {
    return await next;
  } finally {
    if (queues.get(entryUUID) === next) queues.delete(entryUUID);
  }
}

function operationReceipt({ operationId, commandType, actorUUID, entryUUID, revision, now }) {
  return {
    UUID: operationId,
    operationId,
    commandType,
    actorUUID,
    parent: actorUUID,
    entryUUID,
    resultingRevision: revision,
    resultStatus: 'accepted',
    authoritativeAt: now,
    createdAt: now,
    updatedAt: now,
    responseMetadata: { revision },
  };
}

export class ChronicleRevisionConflictError extends Error {
  constructor(conflict) {
    super('This Entry changed after the editor opened. Your text was preserved for review.');
    this.name = 'ChronicleRevisionConflictError';
    this.code = 'chronicle-stale-base';
    this.conflict = conflict;
  }
}

export class ChronicleRevisionService {
  constructor(facade) {
    if (!facade?.commitAtomicMutation) {
      throw new Error('ChronicleRevisionService requires atomic database mutations.');
    }
    this.facade = facade;
    this.revisions = new ChronicleRevisionRepository(facade);
  }

  async saveContent({
    actorUUID,
    journal,
    metadata,
    access: suppliedAccess = null,
    expectedRevisionNumber = null,
    clientOperationId,
    editSummary = '',
    origin = 'local',
    commandOrigin = 'desktop',
    enqueueSync = true,
    deleteDraftUUID = null,
  } = {}) {
    if (!journal?.UUID || !journal?.parent || !actorUUID || !clientOperationId) {
      throw new Error('Saving an Entry requires Entry, owner, actor, and operation identity.');
    }
    return withEntryLock(this.facade, journal.UUID, async () => {
      const priorReceipt = await this.facade.get(
        STORES.chronicleEntryOperationReceipt,
        clientOperationId,
      );
      if (priorReceipt) {
        const [revision, storedJournal, storedMetadata, storedAccess] = await Promise.all([
          this.revisions.findByOperation(clientOperationId),
          this.facade.get(STORES.journal, journal.UUID),
          this.facade.get(STORES.chronicleEntryMetadata, journal.UUID),
          this.facade.get(STORES.chronicleEntryAccess, journal.UUID),
        ]);
        return {
          journal: storedJournal || journal,
          metadata: storedMetadata || metadata,
          access: storedAccess || suppliedAccess,
          revision,
          receipt: priorReceipt,
          idempotent: true,
        };
      }

      const existingMetadata = await this.facade.get(STORES.chronicleEntryMetadata, journal.UUID);
      const existingJournal = await this.facade.get(STORES.journal, journal.UUID);
      const existingAccess = await this.facade.get(STORES.chronicleEntryAccess, journal.UUID);
      const latest = await this.revisions.latest(journal.UUID);
      const currentRevision = Number(latest?.revisionNumber) || 0;
      const access = normalizeChronicleAccess(suppliedAccess || existingAccess || {}, {
        ...(existingMetadata || metadata),
        UUID: journal.UUID,
        journalUUID: journal.UUID,
        ownerUUID: journal.parent,
        parent: journal.parent,
      });
      if (currentRevision > 0 && !canEditEntry(access, { actorUUID })) {
        throw new Error('This participant cannot edit the Entry.');
      }
      if (expectedRevisionNumber != null && Number(expectedRevisionNumber) !== currentRevision) {
        const now = new Date().toISOString();
        const conflict = {
          UUID: `entry-conflict:${clientOperationId}`,
          entryUUID: journal.UUID,
          ownerUUID: access.ownerUUID,
          editorUUID: actorUUID,
          parent: access.ownerUUID,
          baseRevisionNumber: Number(expectedRevisionNumber),
          currentRevisionNumber: currentRevision,
          proposed: {
            title: journal.title || '',
            subtitle: metadata.subtitle || '',
            body: journal.entry || '',
            images: journal.images || [],
            entryKind: metadata.entryKind || 'entry',
          },
          clientOperationId,
          reason: 'stale-base',
          createdAt: now,
          updatedAt: now,
          resolvedAt: null,
        };
        await this.facade.add(STORES.chronicleEntryConflict, conflict);
        throw new ChronicleRevisionConflictError(conflict);
      }

      const now = new Date().toISOString();
      const revisionNumber = currentRevision + 1;
      const revision = await createChronicleRevision({
        entryUUID: journal.UUID,
        revisionNumber,
        baseRevisionNumber: currentRevision,
        ownerUUID: access.ownerUUID,
        editorUUID: actorUUID,
        title: journal.title,
        subtitle: metadata.subtitle,
        body: journal.entry,
        images: journal.images,
        entryKind: metadata.entryKind,
        editSummary,
        clientOperationId,
        origin,
        createdAt: now,
        authoritativeAt: now,
      });
      const nextJournal = {
        ...journal,
        editedAt: now,
        currentRevisionNumber: revisionNumber,
        revisionContentHash: revision.contentHash,
        syncVersion: Math.max(0, Number(existingJournal?.syncVersion) || 0) + 1,
      };
      const nextMetadata = {
        ...metadata,
        UUID: journal.UUID,
        journalUUID: journal.UUID,
        parent: journal.parent,
        playerUUID: journal.parent,
        visibility: access.visibility,
        currentRevisionNumber: revisionNumber,
        latestEditorUUID: actorUUID,
        latestRevisedAt: now,
        updatedAt: now,
      };
      const nextAccess = {
        ...access,
        UUID: journal.UUID,
        journalUUID: journal.UUID,
        authorityRevision: Math.max(revisionNumber, Number(access.authorityRevision) || 1),
        updatedAt: now,
      };
      const receipt = operationReceipt({
        operationId: clientOperationId,
        commandType: currentRevision ? (origin === 'restore' ? 'restore' : 'edit') : 'create',
        actorUUID,
        entryUUID: journal.UUID,
        revision: revisionNumber,
        now,
      });
      const baseVersion = Math.max(0, Number(existingJournal?.syncVersion) || 0);
      const commandType = baseVersion > 0 ? 'updateChronicleEntry' : 'createChronicleEntry';
      const syncContext = this.facade.createSyncCommandContext?.({
        origin: commandOrigin,
        enqueueSync,
        operationId: clientOperationId,
        playerId: journal.parent,
        commandType,
        entityType: 'chronicle-entry',
        entityId: journal.UUID,
        baseVersion,
        payload: {
          journal: nextJournal,
          metadata: nextMetadata,
          access: nextAccess,
          revision,
          receipt,
          baseContentHash: latest?.contentHash || null,
        },
        occurredAt: now,
      }) || { origin: commandOrigin, enqueueSync: false };
      await this.facade.commitAtomicMutation({
        operationId: clientOperationId,
        label: `chronicle-revision:${clientOperationId}`,
        puts: [
          { store: STORES.journal, record: nextJournal },
          { store: STORES.chronicleEntryMetadata, record: nextMetadata },
          { store: STORES.chronicleEntryAccess, record: nextAccess },
          { store: STORES.chronicleEntryRevision, record: revision },
          { store: STORES.chronicleEntryOperationReceipt, record: receipt },
        ],
        deletes: deleteDraftUUID
          ? [{ store: STORES.chronicleDraft, UUID: deleteDraftUUID }]
          : [],
        sync: syncContext,
      });
      return {
        journal: nextJournal,
        metadata: nextMetadata,
        access: nextAccess,
        revision,
        receipt,
        idempotent: false,
      };
    });
  }
}

export default ChronicleRevisionService;
