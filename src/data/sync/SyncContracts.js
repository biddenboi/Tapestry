export const SYNC_ORIGIN = Object.freeze({
  desktop: 'desktop',
  mobile: 'mobile',
  remote: 'remote-sync',
});

export const SYNC_OPERATION_STATUS = Object.freeze({
  pending: 'pending',
  uploading: 'uploading',
  accepted: 'accepted',
  conflict: 'conflict',
  rejected: 'rejected',
});

export const SYNC_CONFLICT_STATUS = Object.freeze({
  open: 'open',
  resolvedLocal: 'resolved-local',
  resolvedServer: 'resolved-server',
  merged: 'merged',
});

const ORIGINS = new Set(Object.values(SYNC_ORIGIN));

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function finiteIntegerOrNull(value, label) {
  if (value == null || value === '') return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new TypeError(`${label} must be a non-negative integer when supplied.`);
  }
  return normalized;
}

function isoTimestamp(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Sync timestamps must be valid dates.');
  return date.toISOString();
}

export function normalizeSyncContext(input = {}, { now = new Date() } = {}) {
  const origin = input.origin || SYNC_ORIGIN.desktop;
  if (!ORIGINS.has(origin)) throw new TypeError(`Unsupported sync command origin: ${origin}`);
  const enqueueSync = input.enqueueSync === true;
  if (origin === SYNC_ORIGIN.remote && enqueueSync) {
    const error = new Error('Remote sync application cannot enqueue an outgoing operation.');
    error.code = 'sync-remote-reenqueue-forbidden';
    throw error;
  }
  if (!enqueueSync) {
    return Object.freeze({
      origin,
      enqueueSync: false,
      cursor: normalizeCursor(input.cursor, { now }),
    });
  }

  const occurredAt = isoTimestamp(input.occurredAt, now);
  return Object.freeze({
    origin,
    enqueueSync: true,
    operationId: requiredText(input.operationId, 'Sync operation ID'),
    ownerId: requiredText(input.ownerId, 'Sync owner ID'),
    playerId: input.playerId == null ? null : String(input.playerId),
    workspaceId: input.workspaceId == null ? null : String(input.workspaceId),
    deviceId: requiredText(input.deviceId, 'Sync device ID'),
    commandType: requiredText(input.commandType, 'Sync command type'),
    entityType: requiredText(input.entityType, 'Sync entity type'),
    entityId: requiredText(input.entityId, 'Sync entity ID'),
    baseVersion: finiteIntegerOrNull(input.baseVersion, 'Sync base version'),
    payload: input.payload == null ? {} : structuredClone(input.payload),
    occurredAt,
    createdAt: isoTimestamp(input.createdAt || occurredAt, now),
    cursor: normalizeCursor(input.cursor, { now }),
  });
}

export function normalizeCursor(cursor, { now = new Date() } = {}) {
  if (!cursor) return null;
  return Object.freeze({
    streamName: requiredText(cursor.streamName, 'Sync cursor stream name'),
    serverSequence: finiteIntegerOrNull(cursor.serverSequence, 'Sync server sequence') ?? 0,
    updatedAt: isoTimestamp(cursor.updatedAt, now),
  });
}

export function syncOperationFromRow(row = {}) {
  let payload = {};
  try { payload = JSON.parse(String(row.payloadJson || '{}')); } catch { payload = {}; }
  return Object.freeze({
    operationId: String(row.operationId),
    ownerId: String(row.ownerId),
    playerId: row.playerId == null ? null : String(row.playerId),
    workspaceId: row.workspaceId == null ? null : String(row.workspaceId),
    deviceId: String(row.deviceId),
    deviceSequence: Number(row.deviceSequence),
    commandType: String(row.commandType),
    entityType: String(row.entityType),
    entityId: String(row.entityId),
    baseVersion: row.baseVersion == null ? null : Number(row.baseVersion),
    payload,
    occurredAt: String(row.occurredAt),
    status: String(row.status),
    attemptCount: Number(row.attemptCount || 0),
    lastErrorCode: row.lastErrorCode || null,
    lastErrorMessage: row.lastErrorMessage || null,
    serverSequence: row.serverSequence == null ? null : Number(row.serverSequence),
    acceptedAt: row.acceptedAt || null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  });
}

export function syncCursorStatement(cursor) {
  if (!cursor) return null;
  return {
    sql: `INSERT INTO sync_cursors(stream_name,server_sequence,updated_at)
          VALUES(?,?,?)
          ON CONFLICT(stream_name) DO UPDATE SET
            server_sequence=MAX(sync_cursors.server_sequence,excluded.server_sequence),
            updated_at=excluded.updated_at`,
    bind: [cursor.streamName, cursor.serverSequence, cursor.updatedAt],
    result: 'changes',
  };
}

export function buildSyncOutboxStatement(context) {
  if (!context?.enqueueSync) return null;
  return {
    sql: `INSERT INTO sync_operations(
            operation_id,owner_id,player_id,workspace_id,device_id,device_sequence,command_type,
            entity_type,entity_id,base_version,payload_json,occurred_at,status,
            attempt_count,created_at,updated_at
          ) VALUES(
            ?,?,?,?,?,
            (SELECT COALESCE(MAX(device_sequence),0)+1 FROM sync_operations WHERE device_id=?),
            ?,?,?,?,?,?,'pending',0,?,?
          )
          ON CONFLICT(operation_id) DO NOTHING`,
    bind: [
      context.operationId,
      context.ownerId,
      context.playerId,
      context.workspaceId,
      context.deviceId,
      context.deviceId,
      context.commandType,
      context.entityType,
      context.entityId,
      context.baseVersion,
      JSON.stringify(context.payload),
      context.occurredAt,
      context.createdAt,
      context.createdAt,
    ],
    result: 'changes',
  };
}
