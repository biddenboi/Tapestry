import { STORES } from '../../domain/constants.js';
import { revisionUUID } from '../../domain/chronicle/ChronicleRevision.js';

function requiredPayload(entry) {
  const payload = entry?.payload || {};
  if (!payload.journal?.UUID || !payload.metadata?.journalUUID || !payload.access?.journalUUID) {
    throw new Error(`Remote ${entry?.commandType || 'Chronicle command'} is missing its canonical Entry records.`);
  }
  return payload;
}

function content(record = {}) {
  return {
    title: record.title || '',
    subtitle: record.subtitle || '',
    body: record.body ?? record.entry ?? '',
    images: record.images || [],
    entryKind: record.entryKind || 'entry',
  };
}

function alternateRevision(incoming, number, entry) {
  return {
    ...incoming,
    UUID: revisionUUID(incoming.entryUUID, number),
    revisionNumber: number,
    baseRevisionNumber: Math.max(0, number - 1),
    sourceRevisionUUID: incoming.UUID,
    sourceRevisionNumber: incoming.revisionNumber,
    sourceOperationId: entry.operationId,
    sourceServerSequence: Number(entry.serverSequence),
    origin: 'remote-conflict',
  };
}

export async function buildRemoteChronicleMutation(entry, facade) {
  const payload = requiredPayload(entry);
  const entryUUID = payload.journal.UUID;
  const [localJournal, localMetadata, localAccess, revisions] = await Promise.all([
    facade.get(STORES.journal, entryUUID),
    facade.get(STORES.chronicleEntryMetadata, entryUUID),
    facade.get(STORES.chronicleEntryAccess, entryUUID),
    facade.getAll(STORES.chronicleEntryRevision),
  ]);
  const entryRevisions = revisions
    .filter((revision) => String(revision.entryUUID) === String(entryUUID))
    .sort((left, right) => Number(right.revisionNumber) - Number(left.revisionNumber));
  const latest = entryRevisions[0] || null;
  const incomingRevision = payload.revision || null;
  const incomingHash = incomingRevision?.contentHash || payload.journal.revisionContentHash || null;
  const localHash = localJournal?.revisionContentHash || latest?.contentHash || null;
  const baseHash = payload.baseContentHash || null;
  const sameContent = Boolean(localHash && incomingHash && localHash === incomingHash);
  const continuesLocalBase = Boolean(localHash && baseHash && localHash === baseHash);
  const conflicts = Boolean(localJournal && !sameContent && !continuesLocalBase);
  const serverVersion = Number(entry.result?.entity?.version || payload.journal.syncVersion || 1);

  if (!conflicts) {
    return {
      label: `remote-${entry.commandType}`,
      puts: [
        { store: STORES.journal, record: { ...payload.journal, syncVersion: serverVersion } },
        { store: STORES.chronicleEntryMetadata, record: payload.metadata },
        { store: STORES.chronicleEntryAccess, record: payload.access },
        incomingRevision ? { store: STORES.chronicleEntryRevision, record: incomingRevision } : null,
        payload.receipt ? { store: STORES.chronicleEntryOperationReceipt, record: payload.receipt } : null,
      ].filter(Boolean),
      sync: { origin: 'remote-sync', enqueueSync: false },
    };
  }

  const now = entry.acceptedAt || new Date().toISOString();
  const nextRevisionNumber = Math.max(
    Number(localMetadata?.currentRevisionNumber) || 0,
    Number(latest?.revisionNumber) || 0,
  ) + 1;
  const preservedRemote = incomingRevision
    ? alternateRevision(incomingRevision, nextRevisionNumber, entry)
    : {
        UUID: revisionUUID(entryUUID, nextRevisionNumber),
        entryUUID,
        revisionNumber: nextRevisionNumber,
        baseRevisionNumber: Math.max(0, nextRevisionNumber - 1),
        ownerUUID: payload.access.ownerUUID,
        editorUUID: payload.metadata.latestEditorUUID || payload.journal.parent,
        parent: payload.access.ownerUUID,
        ...content({ ...payload.journal, ...payload.metadata }),
        contentHash: incomingHash,
        editSummary: 'Remote conflicting revision',
        clientOperationId: entry.operationId,
        origin: 'remote-conflict',
        createdAt: now,
        authoritativeAt: now,
        updatedAt: now,
      };
  const conflict = {
    UUID: `entry-conflict:remote:${entry.operationId}`,
    entryUUID,
    ownerUUID: localAccess?.ownerUUID || payload.access.ownerUUID,
    editorUUID: payload.metadata.latestEditorUUID || payload.journal.parent,
    parent: localAccess?.ownerUUID || payload.access.ownerUUID,
    baseRevisionNumber: incomingRevision?.baseRevisionNumber ?? null,
    currentRevisionNumber: Number(localMetadata?.currentRevisionNumber || latest?.revisionNumber || 0),
    localRevisionUUID: latest?.UUID || null,
    remoteRevisionUUID: preservedRemote.UUID,
    proposed: content({ ...localJournal, ...localMetadata }),
    received: content({ ...payload.journal, ...payload.metadata }),
    clientOperationId: entry.operationId,
    reason: 'remote-divergent-base',
    serverVersion,
    serverSequence: Number(entry.serverSequence),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
  return {
    label: `remote-${entry.commandType}-conflict`,
    puts: [
      { store: STORES.journal, record: { ...localJournal, syncVersion: serverVersion } },
      { store: STORES.chronicleEntryRevision, record: preservedRemote },
      { store: STORES.chronicleEntryConflict, record: conflict },
      payload.receipt ? { store: STORES.chronicleEntryOperationReceipt, record: payload.receipt } : null,
    ].filter(Boolean),
    sync: { origin: 'remote-sync', enqueueSync: false },
  };
}

export default buildRemoteChronicleMutation;
