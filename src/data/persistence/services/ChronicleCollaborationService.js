import { STORES } from '../../../domain/constants.js';
import {
  accessPreset,
  canControlEntry,
  normalizeChronicleAccess,
} from '../../../domain/chronicle/ChronicleAccessPolicy.js';
import ChronicleRevisionService from './ChronicleRevisionService.js';
import ChronicleRevisionRepository from '../repositories/ChronicleRevisionRepository.js';

function receipt({ operationId, commandType, actorUUID, entryUUID, revision, now }) {
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
    responseMetadata: {},
  };
}

function syncContext(facade, {
  operationId,
  commandType,
  actorUUID,
  journal,
  metadata,
  access,
  revision,
  baseVersion,
  commandOrigin = 'desktop',
  enqueueSync = true,
  occurredAt,
}) {
  return facade.createSyncCommandContext?.({
    origin: commandOrigin,
    enqueueSync,
    operationId,
    playerId: actorUUID,
    commandType,
    entityType: 'chronicle-entry',
    entityId: journal.UUID,
    baseVersion,
    payload: {
      journal,
      metadata,
      access,
      revision,
      baseContentHash: revision?.contentHash || journal.revisionContentHash || null,
    },
    occurredAt,
  }) || { origin: commandOrigin, enqueueSync: false };
}

export class ChronicleCollaborationService {
  constructor(facade) {
    this.facade = facade;
    this.revisions = new ChronicleRevisionService(facade);
    this.revisionRepository = new ChronicleRevisionRepository(facade);
  }

  async saveLocalContent(command) {
    return this.revisions.saveContent(command);
  }

  async changeAccess({
    entryUUID,
    actorUUID,
    visibility,
    clientOperationId,
    commandOrigin = 'desktop',
    enqueueSync = true,
  }) {
    const [currentAccess, metadata, journal, revision] = await Promise.all([
      this.facade.get(STORES.chronicleEntryAccess, entryUUID),
      this.facade.get(STORES.chronicleEntryMetadata, entryUUID),
      this.facade.get(STORES.journal, entryUUID),
      this.revisionRepository.latest(entryUUID),
    ]);
    const normalized = normalizeChronicleAccess(currentAccess || {}, metadata || {});
    if (!canControlEntry(normalized, actorUUID)) throw new Error('Only the Entry owner can change access.');
    const preset = accessPreset(visibility);
    const prior = await this.facade.get(STORES.chronicleEntryOperationReceipt, clientOperationId);
    if (prior) return { access: normalized, metadata, receipt: prior, idempotent: true };
    const now = new Date().toISOString();
    const nextAccess = {
      ...normalized,
      visibility,
      editPolicy: preset.editPolicy,
      authorityScope: 'local',
      collaborationState: 'local',
      lockedAt: null,
      lockedBy: null,
      updatedAt: now,
    };
    const nextMetadata = { ...metadata, visibility, updatedAt: now };
    const baseVersion = Math.max(0, Number(journal?.syncVersion) || 0);
    const nextJournal = { ...journal, syncVersion: baseVersion + 1 };
    const operationReceipt = receipt({
      operationId: clientOperationId,
      commandType: 'change_access',
      actorUUID,
      entryUUID,
      revision: Number(nextMetadata.currentRevisionNumber) || 1,
      now,
    });
    await this.facade.commitAtomicMutation({
      operationId: clientOperationId,
      label: `chronicle-access:${clientOperationId}`,
      puts: [
        { store: STORES.journal, record: nextJournal },
        { store: STORES.chronicleEntryAccess, record: nextAccess },
        { store: STORES.chronicleEntryMetadata, record: nextMetadata },
        { store: STORES.chronicleEntryOperationReceipt, record: operationReceipt },
      ],
      sync: syncContext(this.facade, {
        operationId: clientOperationId,
        commandType: 'changeChronicleAccess',
        actorUUID,
        journal: nextJournal,
        metadata: nextMetadata,
        access: nextAccess,
        revision,
        baseVersion,
        commandOrigin,
        enqueueSync,
        occurredAt: now,
      }),
    });
    return { access: nextAccess, metadata: nextMetadata, receipt: operationReceipt };
  }

  async archive({
    entryUUID,
    actorUUID,
    clientOperationId,
    commandOrigin = 'desktop',
    enqueueSync = true,
  }) {
    const [access, metadata, journal, revision] = await Promise.all([
      this.facade.get(STORES.chronicleEntryAccess, entryUUID),
      this.facade.get(STORES.chronicleEntryMetadata, entryUUID),
      this.facade.get(STORES.journal, entryUUID),
      this.revisionRepository.latest(entryUUID),
    ]);
    const normalized = normalizeChronicleAccess(access || {}, metadata || {});
    if (!canControlEntry(normalized, actorUUID)) throw new Error('Only the Entry owner can archive it.');
    const now = new Date().toISOString();
    const nextMetadata = { ...metadata, lifecycleState: 'archived', publishedAt: null, updatedAt: now };
    const baseVersion = Math.max(0, Number(journal?.syncVersion) || 0);
    const nextJournal = { ...journal, syncVersion: baseVersion + 1 };
    const operationReceipt = receipt({
      operationId: clientOperationId,
      commandType: 'archive',
      actorUUID,
      entryUUID,
      revision: Number(metadata?.currentRevisionNumber) || 1,
      now,
    });
    await this.facade.commitAtomicMutation({
      operationId: clientOperationId,
      label: `chronicle-archive:${clientOperationId}`,
      puts: [
        { store: STORES.journal, record: nextJournal },
        { store: STORES.chronicleEntryMetadata, record: nextMetadata },
        { store: STORES.chronicleEntryOperationReceipt, record: operationReceipt },
      ],
      sync: syncContext(this.facade, {
        operationId: clientOperationId,
        commandType: 'archiveChronicleEntry',
        actorUUID,
        journal: nextJournal,
        metadata: nextMetadata,
        access: normalized,
        revision,
        baseVersion,
        commandOrigin,
        enqueueSync,
        occurredAt: now,
      }),
    });
    return { metadata: nextMetadata, receipt: operationReceipt };
  }

  async setLock({
    entryUUID,
    actorUUID,
    locked = true,
    clientOperationId,
    commandOrigin = 'desktop',
    enqueueSync = true,
  }) {
    const [access, metadata, journal, revision] = await Promise.all([
      this.facade.get(STORES.chronicleEntryAccess, entryUUID),
      this.facade.get(STORES.chronicleEntryMetadata, entryUUID),
      this.facade.get(STORES.journal, entryUUID),
      this.revisionRepository.latest(entryUUID),
    ]);
    const normalized = normalizeChronicleAccess(access || {}, metadata || {});
    if (!canControlEntry(normalized, actorUUID)) throw new Error('Only the Entry owner can lock it.');
    const prior = await this.facade.get(STORES.chronicleEntryOperationReceipt, clientOperationId);
    if (prior) return { access: normalized, metadata, receipt: prior, idempotent: true };
    const now = new Date().toISOString();
    const nextAccess = {
      ...normalized,
      collaborationState: locked ? 'locked' : 'local',
      lockedAt: locked ? now : null,
      lockedBy: locked ? actorUUID : null,
      updatedAt: now,
    };
    const baseVersion = Math.max(0, Number(journal?.syncVersion) || 0);
    const nextJournal = { ...journal, syncVersion: baseVersion + 1 };
    const operationReceipt = receipt({
      operationId: clientOperationId,
      commandType: locked ? 'lock' : 'unlock',
      actorUUID,
      entryUUID,
      revision: Number(metadata?.currentRevisionNumber) || 1,
      now,
    });
    await this.facade.commitAtomicMutation({
      operationId: clientOperationId,
      label: `chronicle-lock:${clientOperationId}`,
      puts: [
        { store: STORES.journal, record: nextJournal },
        { store: STORES.chronicleEntryAccess, record: nextAccess },
        { store: STORES.chronicleEntryOperationReceipt, record: operationReceipt },
      ],
      sync: syncContext(this.facade, {
        operationId: clientOperationId,
        commandType: 'setChronicleLock',
        actorUUID,
        journal: nextJournal,
        metadata,
        access: nextAccess,
        revision,
        baseVersion,
        commandOrigin,
        enqueueSync,
        occurredAt: now,
      }),
    });
    return { access: nextAccess, metadata, receipt: operationReceipt };
  }

  async restore({ entryUUID, revisionUUID, actorUUID, clientOperationId }) {
    const [journal, metadata, access, target, latest] = await Promise.all([
      this.facade.get(STORES.journal, entryUUID),
      this.facade.get(STORES.chronicleEntryMetadata, entryUUID),
      this.facade.get(STORES.chronicleEntryAccess, entryUUID),
      this.revisionRepository.get(revisionUUID),
      this.revisionRepository.latest(entryUUID),
    ]);
    const normalized = normalizeChronicleAccess(access || {}, metadata || {});
    if (!canControlEntry(normalized, actorUUID)) throw new Error('Only the Entry owner can restore a revision.');
    if (!target || String(target.entryUUID) !== String(entryUUID)) throw new Error('Revision not found.');
    return this.revisions.saveContent({
      actorUUID,
      journal: {
        ...journal,
        title: target.title,
        entry: target.body,
        images: target.images,
      },
      metadata: {
        ...metadata,
        subtitle: target.subtitle,
        entryKind: target.entryKind,
      },
      access: normalized,
      expectedRevisionNumber: latest?.revisionNumber || 1,
      clientOperationId,
      editSummary: `Restored revision ${target.revisionNumber}`,
      origin: 'restore',
    });
  }
}

export default ChronicleCollaborationService;
