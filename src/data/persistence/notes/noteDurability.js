export const NOTE_RECORD_KIND = Object.freeze({
  note: 'note',
  conflict: 'note-conflict',
});

const MAX_OPERATION_RECEIPTS = 64;

function utf8Bytes(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  return Uint8Array.from(unescape(encodeURIComponent(text)), (character) => character.charCodeAt(0));
}

export function noteContentHash(content = '') {
  let hash = 2166136261;
  for (const byte of utf8Bytes(content)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function isNoteConflict(record) {
  return record?.recordKind === NOTE_RECORD_KIND.conflict || Boolean(record?.conflictOf);
}

export function isNoteTombstone(record) {
  return !isNoteConflict(record) && Boolean(record?.deletedAt);
}

function normalizeReceipts(receipts = [], lastOperationId = null, record = null) {
  const normalized = [];
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (!receipt?.operationId) continue;
    if (normalized.some((candidate) => candidate.operationId === receipt.operationId)) continue;
    normalized.push({
      operationId: String(receipt.operationId),
      action: receipt.action || 'update',
      revision: Math.max(1, Number(receipt.revision) || Number(record?.revision) || 1),
      contentHash: receipt.contentHash || record?.contentHash || noteContentHash(record?.content || ''),
      committedAt: receipt.committedAt || record?.updatedAt || record?.createdAt || null,
    });
  }
  if (lastOperationId && !normalized.some((receipt) => receipt.operationId === lastOperationId)) {
    normalized.push({
      operationId: String(lastOperationId),
      action: isNoteTombstone(record) ? 'delete' : 'update',
      revision: Math.max(1, Number(record?.revision) || 1),
      contentHash: record?.contentHash || noteContentHash(record?.content || ''),
      committedAt: record?.updatedAt || record?.deletedAt || record?.createdAt || null,
    });
  }
  return normalized.slice(-MAX_OPERATION_RECEIPTS);
}

export function normalizeNoteRecord(record, { now = null } = {}) {
  if (!record?.UUID) return null;
  if (isNoteConflict(record)) {
    const content = String(record.content || '');
    return {
      ...record,
      UUID: String(record.UUID),
      recordKind: NOTE_RECORD_KIND.conflict,
      content,
      contentHash: record.contentHash || noteContentHash(content),
      conflictDetectedAt: record.conflictDetectedAt || record.createdAt || now || null,
    };
  }

  const content = String(record.content || '');
  const revision = Math.max(1, Number(record.revision) || 1);
  const normalized = {
    ...record,
    UUID: String(record.UUID),
    recordKind: NOTE_RECORD_KIND.note,
    content,
    revision,
    contentHash: noteContentHash(content),
    lastOperationId: record.lastOperationId ? String(record.lastOperationId) : null,
    deletedAt: record.deletedAt || null,
  };
  normalized.operationReceipts = normalizeReceipts(
    record.operationReceipts,
    normalized.lastOperationId,
    normalized,
  );
  return normalized;
}

function appendReceipt(record, { operationId, action, committedAt }) {
  const receipt = {
    operationId: String(operationId),
    action,
    revision: record.revision,
    contentHash: record.contentHash,
    committedAt,
  };
  return {
    ...record,
    lastOperationId: receipt.operationId,
    operationReceipts: normalizeReceipts([
      ...(record.operationReceipts || []),
      receipt,
    ], receipt.operationId, record),
  };
}

function safeId(value) {
  return String(value || 'unknown').replaceAll(/[^0-9A-Za-z_-]/g, '-').slice(0, 80);
}

export function createNoteConflict({
  noteUUID,
  operationId = null,
  action = 'update',
  attemptedRecord = null,
  canonicalRecord = null,
  reason = 'stale',
  detectedAt = new Date().toISOString(),
  source = 'protected-write',
  suffix = null,
} = {}) {
  const attempted = normalizeNoteRecord(attemptedRecord || {
    UUID: noteUUID,
    content: '',
    revision: 1,
  });
  const conflictUUID = `note-conflict-${safeId(noteUUID)}-${safeId(
    suffix || operationId || `${reason}-${attempted?.revision || 1}`,
  )}`;
  return {
    UUID: conflictUUID,
    recordKind: NOTE_RECORD_KIND.conflict,
    conflictOf: String(noteUUID || attempted?.UUID || ''),
    conflictReason: reason,
    conflictSource: source,
    conflictDetectedAt: detectedAt,
    operationId: operationId ? String(operationId) : null,
    attemptedAction: action,
    baseRevision: Math.max(0, Number(attemptedRecord?.baseRevision) || 0),
    baseHash: attemptedRecord?.baseHash || null,
    canonicalRevision: Math.max(0, Number(canonicalRecord?.revision) || 0),
    canonicalHash: canonicalRecord?.contentHash || null,
    content: String(attemptedRecord?.content ?? attempted?.content ?? ''),
    contentHash: noteContentHash(attemptedRecord?.content ?? attempted?.content ?? ''),
    createdAt: detectedAt,
    updatedAt: detectedAt,
    resolvedAt: null,
  };
}

function receiptForOperation(record, operationId) {
  return (record?.operationReceipts || []).find((receipt) => (
    receipt?.operationId === operationId
  )) || null;
}

function findConflictForOperation(store, operationId) {
  if (!operationId) return null;
  for (const record of store.values()) {
    if (isNoteConflict(record) && record.operationId === operationId) return record;
  }
  return null;
}

function basesMatch(record, expectedRevision, expectedHash) {
  return Number(record?.revision) === Number(expectedRevision)
    && String(record?.contentHash || '') === String(expectedHash || '');
}

export function buildProtectedNoteMutation({
  action,
  current = null,
  note = null,
  noteUUID = note?.UUID,
  content = note?.content,
  expectedRevision = null,
  expectedHash = null,
  operationId,
  now = new Date().toISOString(),
} = {}) {
  if (!['create', 'update', 'delete'].includes(action)) {
    throw new Error(`Unsupported protected note action: ${action || 'missing'}.`);
  }
  if (!noteUUID) throw new Error('Protected note writes require a note UUID.');
  if (!operationId) throw new Error('Protected note writes require an idempotent operation ID.');

  const previousRecord = normalizeNoteRecord(current);
  if (action === 'create') {
    const created = normalizeNoteRecord({
      ...note,
      UUID: noteUUID,
      content: String(content || ''),
      revision: 1,
      createdAt: note?.createdAt || now,
      updatedAt: note?.updatedAt || now,
      deletedAt: null,
    });
    const record = appendReceipt(created, { operationId, action, committedAt: now });
    return {
      type: 'note-cas', action, store: 'notes', noteUUID: String(noteUUID), operationId: String(operationId),
      expectedRevision: 0, expectedHash: null, previousRecord: null, record,
    };
  }

  if (!Number.isFinite(Number(expectedRevision)) || Number(expectedRevision) < 1 || !expectedHash) {
    throw new Error('Protected note updates and deletes require the durable base revision and hash.');
  }
  const nextRevision = Number(expectedRevision) + 1;
  const deleted = action === 'delete';
  const nextContent = deleted ? '' : String(content || '');
  const next = normalizeNoteRecord({
    ...(previousRecord || {}),
    UUID: noteUUID,
    content: nextContent,
    revision: nextRevision,
    createdAt: previousRecord?.createdAt || note?.createdAt || now,
    updatedAt: now,
    deletedAt: deleted ? now : null,
    deletedContentHash: deleted ? previousRecord?.contentHash || expectedHash : null,
  });
  const record = appendReceipt(next, { operationId, action, committedAt: now });
  return {
    type: 'note-cas', action, store: 'notes', noteUUID: String(noteUUID), operationId: String(operationId),
    expectedRevision: Number(expectedRevision), expectedHash: String(expectedHash),
    previousRecord, record,
  };
}

export function applyProtectedNoteMutation(store, mutation, { clone = (value) => value } = {}) {
  const operationId = String(mutation?.operationId || '');
  if (!operationId) throw new Error('Protected note replay requires an operation ID.');
  const noteUUID = String(mutation.noteUUID || mutation.record?.UUID || '');
  if (!noteUUID) throw new Error('Protected note replay requires a note UUID.');

  const existingConflict = findConflictForOperation(store, operationId);
  if (existingConflict) return { status: 'conflict', conflict: clone(existingConflict) };

  const current = normalizeNoteRecord(store.get(noteUUID) || null);
  const receipt = receiptForOperation(current, operationId);
  if (receipt) return { status: 'applied', idempotent: true, record: clone(current), receipt: clone(receipt) };

  const action = mutation.action;
  const canApply = action === 'create'
    ? current == null
    : current != null && !isNoteConflict(current) && !isNoteTombstone(current)
      && basesMatch(current, mutation.expectedRevision, mutation.expectedHash);

  if (canApply) {
    const next = normalizeNoteRecord(mutation.record);
    store.set(noteUUID, clone(next));
    return { status: isNoteTombstone(next) ? 'deleted' : 'applied', record: clone(next) };
  }

  const reason = isNoteTombstone(current)
    ? 'deleted'
    : current == null
      ? 'missing'
      : Number(current.revision) === Number(mutation.expectedRevision)
        ? 'same-revision-different-hash'
        : 'stale';
  const conflict = createNoteConflict({
    noteUUID,
    operationId,
    action,
    attemptedRecord: {
      ...mutation.record,
      baseRevision: mutation.expectedRevision,
      baseHash: mutation.expectedHash,
    },
    canonicalRecord: current,
    reason,
    detectedAt: mutation.recordedAt || mutation.record?.updatedAt,
    source: 'protected-write',
  });
  store.set(conflict.UUID, clone(conflict));
  return { status: 'conflict', conflict: clone(conflict), record: clone(current) };
}

function canonicalNotes(records = []) {
  return (records || []).map((record) => normalizeNoteRecord(record)).filter((record) => (
    record && !isNoteConflict(record)
  ));
}

export function reconcileProtectedNotes({
  current = [],
  incoming = [],
  source = 'import',
  authoritativeMembership = false,
} = {}) {
  const currentRows = (current || []).map((record) => normalizeNoteRecord(record)).filter(Boolean);
  const incomingRows = (incoming || []).map((record) => normalizeNoteRecord(record)).filter(Boolean);
  const currentById = new Map(canonicalNotes(currentRows).map((record) => [record.UUID, record]));
  const incomingById = new Map(canonicalNotes(incomingRows).map((record) => [record.UUID, record]));
  const result = new Map();

  for (const conflict of [...currentRows, ...incomingRows].filter(isNoteConflict)) {
    result.set(conflict.UUID, conflict);
  }
  for (const UUID of new Set([...currentById.keys(), ...incomingById.keys()])) {
    const local = currentById.get(UUID) || null;
    const external = incomingById.get(UUID) || null;
    if (!local || !external) {
      if (local && !external && authoritativeMembership) continue;
      result.set(UUID, external || local);
      continue;
    }
    const equivalent = local.revision === external.revision
      && local.contentHash === external.contentHash
      && Boolean(local.deletedAt) === Boolean(external.deletedAt);
    if (equivalent) {
      result.set(UUID, external);
      continue;
    }
    const externalWins = Number(external.revision) > Number(local.revision);
    const winner = externalWins ? external : local;
    const loser = externalWins ? local : external;
    result.set(UUID, winner);
    const conflict = createNoteConflict({
      noteUUID: UUID,
      attemptedRecord: loser,
      canonicalRecord: winner,
      action: source,
      reason: Number(local.revision) === Number(external.revision)
        ? 'same-revision-different-hash'
        : 'stale-source',
      source,
      detectedAt: winner.updatedAt || winner.deletedAt || winner.createdAt || null,
      suffix: `${source}-${loser.revision}-${loser.contentHash}`,
    });
    result.set(conflict.UUID, conflict);
  }
  return [...result.values()];
}

export function noteOperationResult(records = [], operationId) {
  if (!operationId) return null;
  for (const record of records || []) {
    const normalized = normalizeNoteRecord(record);
    if (isNoteConflict(normalized) && normalized.operationId === operationId) {
      return { status: 'conflict', conflict: normalized };
    }
    const receipt = receiptForOperation(normalized, operationId);
    if (receipt) {
      return {
        status: isNoteTombstone(normalized) ? 'deleted' : 'applied',
        record: normalized,
        receipt,
      };
    }
  }
  return null;
}
