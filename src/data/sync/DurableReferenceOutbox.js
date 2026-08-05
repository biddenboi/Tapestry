import {
  RECORD_TYPE_BY_STORE,
  recordTime,
  referenceRecord,
} from './MobileReferenceSync.js';
import { SYNC_ORIGIN } from './SyncContracts.js';

const META_SEEDED_KEY = 'durable-reference-seed-v1';

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function playerId(record = {}) {
  return record.parent || record.playerUUID || record.playerId || null;
}

function workspaceId(record = {}) {
  return record.workspaceId || null;
}

function serialize(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof Blob !== 'undefined' && item instanceof Blob) return undefined;
    if (item instanceof ArrayBuffer) return undefined;
    if (ArrayBuffer.isView(item)) return undefined;
    return item;
  });
}

function outboxStatement({
  recordType,
  recordId,
  store,
  record,
  deleted = false,
  updatedAt,
  createdAt,
}) {
  return {
    sql: `INSERT INTO sync_reference_outbox(
            record_type,record_id,store_name,player_id,workspace_id,payload_json,
            deleted,updated_at,status,attempt_count,last_error_code,last_error_message,created_at
          ) VALUES(?,?,?,?,?,?,?,?,'pending',0,NULL,NULL,?)
          ON CONFLICT(record_type,record_id) DO UPDATE SET
            store_name=excluded.store_name,
            player_id=excluded.player_id,
            workspace_id=excluded.workspace_id,
            payload_json=excluded.payload_json,
            deleted=excluded.deleted,
            updated_at=excluded.updated_at,
            status='pending',
            last_error_code=NULL,
            last_error_message=NULL
          WHERE excluded.updated_at>=sync_reference_outbox.updated_at`,
    bind: [
      recordType,
      String(recordId),
      store,
      playerId(record),
      workspaceId(record),
      serialize(record),
      deleted ? 1 : 0,
      updatedAt,
      createdAt,
    ],
    result: 'changes',
  };
}

function rowToReference(row) {
  let data = {};
  try { data = JSON.parse(String(row.payloadJson || '{}')); } catch { data = {}; }
  return {
    recordType: String(row.recordType),
    recordId: String(row.recordId),
    workspaceId: row.workspaceId == null ? null : String(row.workspaceId),
    playerId: row.playerId == null ? null : String(row.playerId),
    data,
    deleted: Boolean(row.deleted),
    updatedAt: String(row.updatedAt),
  };
}

export class DurableReferenceOutbox {
  constructor(client, { now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) {
      throw new Error('DurableReferenceOutbox requires a SQLite client.');
    }
    this.client = client;
    this.now = now;
  }

  buildMutationStatements(operations = [], { origin = SYNC_ORIGIN.desktop } = {}) {
    if (origin === SYNC_ORIGIN.remote) return [];
    const now = iso(this.now());
    const statements = [];
    for (const operation of operations || []) {
      const recordType = RECORD_TYPE_BY_STORE.get(operation?.store);
      if (!recordType) continue;
      if (operation.type === 'put' && operation.record?.UUID) {
        const timestamp = iso(operation.record.syncUpdatedAt || recordTime(operation.record) || now);
        statements.push(outboxStatement({
          recordType,
          recordId: operation.record.UUID,
          store: operation.store,
          record: operation.record,
          deleted: false,
          updatedAt: timestamp,
          createdAt: now,
        }));
      } else if (operation.type === 'delete' && operation.UUID) {
        const timestamp = now;
        statements.push(outboxStatement({
          recordType,
          recordId: operation.UUID,
          store: operation.store,
          record: {
            UUID: String(operation.UUID),
            __deleted: true,
            deletedAt: timestamp,
            syncUpdatedAt: timestamp,
          },
          deleted: true,
          updatedAt: timestamp,
          createdAt: now,
        }));
      }
    }
    return statements;
  }

  recordTypesForMutations(operations = []) {
    return [...new Set((operations || [])
      .map((operation) => RECORD_TYPE_BY_STORE.get(operation?.store))
      .filter(Boolean))];
  }

  async queueReferences(records = []) {
    const now = iso(this.now());
    const statements = [];
    for (const entry of records || []) {
      if (!entry?.recordType || !entry?.recordId || !entry?.data) continue;
      const store = [...RECORD_TYPE_BY_STORE.entries()]
        .find(([, type]) => type === entry.recordType)?.[0] || entry.recordType;
      statements.push(outboxStatement({
        recordType: String(entry.recordType),
        recordId: String(entry.recordId),
        store,
        record: entry.data,
        deleted: Boolean(entry.deleted || entry.data?.__deleted),
        updatedAt: iso(entry.updatedAt || recordTime(entry.data) || now),
        createdAt: now,
      }));
    }
    if (!statements.length) return { queued: 0 };
    let queued = 0;
    for (let index = 0; index < statements.length; index += 500) {
      // Keep seed transactions bounded so large saves cannot exceed worker or
      // browser message limits. Each row is independently idempotent.
      // eslint-disable-next-line no-await-in-loop
      const result = await this.client.executeAtomic({
        commandId: `reference-seed:${Date.now()}:${index}:${Math.random().toString(36).slice(2)}`,
        label: 'queue-durable-reference-seed',
        statements: statements.slice(index, index + 500),
      });
      queued += result.statementResults.reduce((sum, item) => sum + Number(item?.changes || 0), 0);
    }
    return { queued };
  }

  async isSeeded({ schemaVersion = 0 } = {}) {
    const row = await this.client.query({
      sql: 'SELECT value_json AS valueJson FROM sync_reference_meta WHERE key=?',
      bind: [META_SEEDED_KEY],
      result: 'one',
    });
    if (!row) return false;
    if (!schemaVersion) return true;
    try {
      const details = JSON.parse(String(row.valueJson || '{}'));
      return Number(details.schemaVersion || 0) >= Number(schemaVersion);
    } catch {
      return false;
    }
  }

  async markSeeded(details = {}) {
    const now = iso(this.now());
    return this.client.query({
      sql: `INSERT INTO sync_reference_meta(key,value_json,updated_at)
            VALUES(?,?,?)
            ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
      bind: [META_SEEDED_KEY, serialize(details), now],
      result: 'changes',
    });
  }

  async listPending({ limit = 500, recordTypes = null } = {}) {
    const types = Array.isArray(recordTypes)
      ? [...new Set(recordTypes.map(String).filter(Boolean))]
      : [];
    const typeFilter = types.length
      ? ` AND record_type IN (${types.map(() => '?').join(',')})`
      : '';
    const rows = await this.client.query({
      sql: `SELECT record_type AS recordType,record_id AS recordId,store_name AS storeName,
                   player_id AS playerId,workspace_id AS workspaceId,payload_json AS payloadJson,
                   deleted,updated_at AS updatedAt,attempt_count AS attemptCount
            FROM sync_reference_outbox
            WHERE status='pending'
            ${typeFilter}
            ORDER BY updated_at,record_type,record_id
            LIMIT ?`,
      bind: [...types, Math.max(1, Math.min(1000, Number(limit) || 500))],
      result: 'all',
    });
    return rows.map(rowToReference);
  }

  async reconcileRemote(records = []) {
    const pending = [];
    let offset = 0;
    while (true) {
      // Reconciliation must include every pending tombstone. Limiting this to
      // the first page can resurrect an older server record after a large
      // offline editing session.
      // eslint-disable-next-line no-await-in-loop
      const rows = await this.client.query({
        sql: `SELECT record_type AS recordType,record_id AS recordId,store_name AS storeName,
                     player_id AS playerId,workspace_id AS workspaceId,payload_json AS payloadJson,
                     deleted,updated_at AS updatedAt,attempt_count AS attemptCount
              FROM sync_reference_outbox
              WHERE status='pending'
              ORDER BY updated_at,record_type,record_id
              LIMIT 500 OFFSET ?`,
        bind: [offset],
        result: 'all',
      });
      pending.push(...rows.map(rowToReference));
      if (rows.length < 500) break;
      offset += rows.length;
    }
    const byKey = new Map(pending.map((entry) => [
      `${entry.recordType}:${entry.recordId}`,
      entry,
    ]));
    const localWins = new Set();
    const discard = [];
    for (const remote of records || []) {
      const key = `${String(remote?.recordType || '')}:${String(remote?.recordId || '')}`;
      const local = byKey.get(key);
      if (!local) continue;
      const localTime = new Date(local.updatedAt || 0).getTime() || 0;
      const remoteTime = Math.max(
        new Date(remote?.updatedAt || 0).getTime() || 0,
        recordTime(remote?.data || {}),
      );
      if (localTime > remoteTime) localWins.add(key);
      else discard.push(local);
    }
    if (discard.length) await this.settle(discard);
    return { localWins, discarded: discard.length };
  }

  async settle(records = []) {
    const statements = (records || []).map((entry) => ({
      sql: `DELETE FROM sync_reference_outbox
            WHERE record_type=? AND record_id=? AND updated_at=?`,
      bind: [entry.recordType, entry.recordId, entry.updatedAt],
      result: 'changes',
    }));
    if (!statements.length) return { settled: 0 };
    const result = await this.client.executeAtomic({
      commandId: `reference-settle:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      label: 'settle-durable-reference-outbox',
      statements,
    });
    return {
      settled: result.statementResults.reduce((sum, item) => sum + Number(item?.changes || 0), 0),
    };
  }

  async fail(records = [], error = null) {
    const statements = (records || []).map((entry) => ({
      sql: `UPDATE sync_reference_outbox
            SET status='pending',attempt_count=attempt_count+1,last_error_code=?,last_error_message=?
            WHERE record_type=? AND record_id=? AND updated_at=?`,
      bind: [
        String(error?.code || 'reference-upload-failed').slice(0, 120),
        String(error?.message || error || 'Reference upload failed.').slice(0, 1000),
        entry.recordType,
        entry.recordId,
        entry.updatedAt,
      ],
      result: 'changes',
    }));
    if (!statements.length) return { failed: 0 };
    const result = await this.client.executeAtomic({
      commandId: `reference-fail:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      label: 'fail-durable-reference-outbox',
      statements,
    });
    return {
      failed: result.statementResults.reduce((sum, item) => sum + Number(item?.changes || 0), 0),
    };
  }

  async diagnostics() {
    const [pending, oldest, latestError] = await Promise.all([
      this.client.query({
        sql: "SELECT COUNT(*) FROM sync_reference_outbox WHERE status='pending'",
        result: 'value',
      }),
      this.client.query({
        sql: `SELECT record_type AS recordType,record_id AS recordId,updated_at AS updatedAt
              FROM sync_reference_outbox WHERE status='pending'
              ORDER BY updated_at,record_type,record_id LIMIT 1`,
        result: 'one',
      }),
      this.client.query({
        sql: `SELECT record_type AS recordType,record_id AS recordId,last_error_code AS code,
                     last_error_message AS message
              FROM sync_reference_outbox WHERE last_error_code IS NOT NULL
              ORDER BY updated_at DESC LIMIT 1`,
        result: 'one',
      }),
    ]);
    return { pending: Number(pending || 0), oldest: oldest || null, latestError: latestError || null };
  }
}

export function mutationReferenceRecords(operations = []) {
  const records = [];
  for (const operation of operations || []) {
    const recordType = RECORD_TYPE_BY_STORE.get(operation?.store);
    if (!recordType) continue;
    if (operation.type === 'put' && operation.record?.UUID) {
      records.push(referenceRecord(recordType, operation.record.UUID, operation.record));
    }
  }
  return records;
}

export default DurableReferenceOutbox;
