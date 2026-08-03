import { syncOperationFromRow } from './SyncContracts.js';

const operationId = (prefix) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

function placeholders(values) {
  return values.map(() => '?').join(',');
}

const SELECT_COLUMNS = `
operation_id AS operationId,
owner_id AS ownerId,
player_id AS playerId,
workspace_id AS workspaceId,
device_id AS deviceId,
device_sequence AS deviceSequence,
command_type AS commandType,
entity_type AS entityType,
entity_id AS entityId,
base_version AS baseVersion,
payload_json AS payloadJson,
occurred_at AS occurredAt,
status,
attempt_count AS attemptCount,
last_error_code AS lastErrorCode,
last_error_message AS lastErrorMessage,
server_sequence AS serverSequence,
accepted_at AS acceptedAt,
created_at AS createdAt,
updated_at AS updatedAt
`.trim();

export class SyncOperationRepository {
  constructor(client, { now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) {
      throw new Error('SyncOperationRepository requires a SQLite client.');
    }
    this.client = client;
    this.now = now;
  }

  _timestamp() { return this.now().toISOString(); }

  async get(operationIdValue) {
    const row = await this.client.query({
      sql: `SELECT ${SELECT_COLUMNS} FROM sync_operations WHERE operation_id=?`,
      bind: [String(operationIdValue)],
      result: 'one',
    });
    return row ? syncOperationFromRow(row) : null;
  }

  async listPending({ limit = 100 } = {}) {
    const rows = await this.client.query({
      sql: `SELECT ${SELECT_COLUMNS}
            FROM sync_operations
            WHERE status='pending'
            ORDER BY device_id,device_sequence
            LIMIT ?`,
      bind: [Math.max(1, Math.min(500, Number(limit) || 100))],
      result: 'all',
    });
    return rows.map(syncOperationFromRow);
  }

  async claimPending(operationIds = []) {
    const ids = [...new Set(operationIds.map(String).filter(Boolean))];
    if (!ids.length) return [];
    const timestamp = this._timestamp();
    await this.client.executeAtomic({
      commandId: operationId('sync-claim'),
      label: 'sync-claim-pending',
      statements: [{
        sql: `UPDATE sync_operations
              SET status='uploading',attempt_count=attempt_count+1,updated_at=?,
                  last_error_code=NULL,last_error_message=NULL
              WHERE status='pending' AND operation_id IN (${placeholders(ids)})`,
        bind: [timestamp, ...ids],
        result: 'changes',
      }],
    });
    const rows = await this.client.query({
      sql: `SELECT ${SELECT_COLUMNS}
            FROM sync_operations
            WHERE status='uploading' AND operation_id IN (${placeholders(ids)})
            ORDER BY device_id,device_sequence`,
      bind: ids,
      result: 'all',
    });
    return rows.map(syncOperationFromRow);
  }

  async recoverUploading({ reason = 'interrupted-upload' } = {}) {
    const timestamp = this._timestamp();
    return this.client.executeAtomic({
      commandId: operationId('sync-recover-uploading'),
      label: 'sync-recover-uploading',
      statements: [{
        sql: `UPDATE sync_operations
              SET status='pending',last_error_code=?,last_error_message=?,updated_at=?
              WHERE status='uploading'`,
        bind: [reason, 'A previous upload stopped before acknowledgement.', timestamp],
        result: 'changes',
      }],
    });
  }

  async returnToPending(operationIds = [], error = null) {
    const ids = [...new Set(operationIds.map(String).filter(Boolean))];
    if (!ids.length) return { changed: 0 };
    const timestamp = this._timestamp();
    const result = await this.client.executeAtomic({
      commandId: operationId('sync-return-pending'),
      label: 'sync-return-pending',
      statements: [{
        sql: `UPDATE sync_operations
              SET status='pending',last_error_code=?,last_error_message=?,updated_at=?
              WHERE status='uploading' AND operation_id IN (${placeholders(ids)})`,
        bind: [
          String(error?.code || 'sync-upload-failed').slice(0, 120),
          String(error?.message || error || 'Upload failed.').slice(0, 1000),
          timestamp,
          ...ids,
        ],
        result: 'changes',
      }],
    });
    return { changed: Number(result.statementResults?.[0]?.changes || 0) };
  }

  async settle(results = []) {
    const timestamp = this._timestamp();
    const statements = [];
    for (const result of results) {
      const id = String(result?.operationId || '').trim();
      const status = String(result?.status || '').trim();
      if (!id || !['accepted', 'conflict', 'rejected'].includes(status)) continue;
      statements.push({
        sql: `UPDATE sync_operations
              SET status=?,server_sequence=?,accepted_at=?,last_error_code=?,
                  last_error_message=?,updated_at=?
              WHERE operation_id=? AND status IN ('pending','uploading')`,
        bind: [
          status,
          result.serverSequence == null ? null : Number(result.serverSequence),
          status === 'accepted' ? String(result.acceptedAt || timestamp) : null,
          status === 'accepted' ? null : String(result.errorCode || `sync-${status}`).slice(0, 120),
          status === 'accepted' ? null : String(result.errorMessage || result.message || '').slice(0, 1000) || null,
          timestamp,
          id,
        ],
        result: 'changes',
      });
      if (status === 'conflict') {
        statements.push({
          sql: `INSERT INTO sync_conflicts(
                  id,operation_id,entity_type,entity_id,local_payload_json,
                  server_payload_json,base_version,server_version,status,created_at,resolved_at
                )
                SELECT ?,operation_id,entity_type,entity_id,payload_json,?,base_version,?,'open',?,NULL
                FROM sync_operations WHERE operation_id=?
                ON CONFLICT(operation_id) DO UPDATE SET
                  server_payload_json=excluded.server_payload_json,
                  server_version=excluded.server_version`,
          bind: [
            String(result.conflictId || `sync-conflict:${id}`),
            JSON.stringify(result.serverPayload ?? result.result ?? {}),
            result.serverVersion == null ? null : Number(result.serverVersion),
            timestamp,
            id,
          ],
          result: 'changes',
        });
      }
    }
    if (!statements.length) return { changed: 0 };
    const settled = await this.client.executeAtomic({
      commandId: operationId('sync-settle'),
      label: 'sync-settle-results',
      statements,
    });
    return {
      changed: settled.statementResults.reduce(
        (sum, item) => sum + Number(item?.changes || 0),
        0,
      ),
    };
  }

  async markAcceptedFromPull(operationIdValue, entry = {}) {
    const timestamp = this._timestamp();
    await this.client.query({
      sql: `UPDATE sync_operations
            SET status='accepted',server_sequence=COALESCE(?,server_sequence),
                accepted_at=COALESCE(?,accepted_at),last_error_code=NULL,
                last_error_message=NULL,updated_at=?
            WHERE operation_id=?`,
      bind: [
        entry.serverSequence == null ? null : Number(entry.serverSequence),
        entry.acceptedAt || timestamp,
        timestamp,
        String(operationIdValue),
      ],
      result: 'changes',
    });
  }

  async pruneAccepted({ olderThan, keepNewest = 250 } = {}) {
    const cutoff = olderThan instanceof Date ? olderThan.toISOString() : String(olderThan || '');
    if (!cutoff) return { removed: 0 };
    const result = await this.client.query({
      sql: `DELETE FROM sync_operations
            WHERE status='accepted' AND accepted_at IS NOT NULL AND accepted_at<?
              AND operation_id NOT IN (
                SELECT operation_id FROM sync_operations
                WHERE status='accepted'
                ORDER BY accepted_at DESC,device_sequence DESC
                LIMIT ?
              )`,
      bind: [cutoff, Math.max(0, Math.min(5000, Number(keepNewest) || 0))],
      result: 'changes',
    });
    return { removed: Number(result?.changes || 0) };
  }

  async diagnostics() {
    const [counts, oldest, latestError] = await Promise.all([
      this.client.query({
        sql: 'SELECT status,COUNT(*) AS count FROM sync_operations GROUP BY status',
        result: 'all',
      }),
      this.client.query({
        sql: `SELECT operation_id AS operationId,occurred_at AS occurredAt,attempt_count AS attemptCount
              FROM sync_operations WHERE status IN ('pending','uploading')
              ORDER BY occurred_at,device_sequence LIMIT 1`,
        result: 'one',
      }),
      this.client.query({
        sql: `SELECT operation_id AS operationId,last_error_code AS code,last_error_message AS message,
                     updated_at AS updatedAt
              FROM sync_operations
              WHERE last_error_code IS NOT NULL OR status='rejected'
              ORDER BY updated_at DESC LIMIT 1`,
        result: 'one',
      }),
    ]);
    return {
      counts: Object.fromEntries(counts.map(({ status, count }) => [status, Number(count)])),
      oldestPending: oldest || null,
      latestError: latestError || null,
    };
  }
}

export default SyncOperationRepository;
