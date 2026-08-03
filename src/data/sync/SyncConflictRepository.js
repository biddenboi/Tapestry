const operationId = (prefix) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

function parseConflict(row) {
  if (!row) return null;
  const parse = (value) => {
    try { return JSON.parse(String(value || '{}')); } catch { return {}; }
  };
  return Object.freeze({
    id: String(row.id),
    operationId: String(row.operationId),
    entityType: String(row.entityType),
    entityId: String(row.entityId),
    localPayload: parse(row.localPayloadJson),
    serverPayload: parse(row.serverPayloadJson),
    baseVersion: row.baseVersion == null ? null : Number(row.baseVersion),
    serverVersion: row.serverVersion == null ? null : Number(row.serverVersion),
    status: String(row.status),
    createdAt: String(row.createdAt),
    resolvedAt: row.resolvedAt || null,
  });
}

const SELECT = `id,operation_id AS operationId,entity_type AS entityType,
entity_id AS entityId,local_payload_json AS localPayloadJson,
server_payload_json AS serverPayloadJson,base_version AS baseVersion,
server_version AS serverVersion,status,created_at AS createdAt,resolved_at AS resolvedAt`;

export class SyncConflictRepository {
  constructor(client, { now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) throw new Error('SyncConflictRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async listOpen({ limit = 100 } = {}) {
    const rows = await this.client.query({
      sql: `SELECT ${SELECT} FROM sync_conflicts
            WHERE status='open' ORDER BY created_at,id LIMIT ?`,
      bind: [Math.max(1, Math.min(500, Number(limit) || 100))],
      result: 'all',
    });
    return rows.map(parseConflict);
  }

  async get(id) {
    return parseConflict(await this.client.query({
      sql: `SELECT ${SELECT} FROM sync_conflicts WHERE id=?`,
      bind: [String(id)],
      result: 'one',
    }));
  }

  async preserveUnsupportedRemote(entry, { streamName = 'owner' } = {}) {
    const operation = String(entry?.operationId || '').trim();
    const serverSequence = Number(entry?.serverSequence);
    if (!operation || !Number.isInteger(serverSequence) || serverSequence < 1) {
      throw new TypeError('An unsupported remote entry requires an operation ID and server sequence.');
    }
    const createdAt = entry.acceptedAt || this.now().toISOString();
    const id = `unsupported-remote:${operation}`;
    await this.client.executeAtomic({
      commandId: `sync-unsupported-remote:${operation}`,
      label: 'sync-unsupported-remote-preserve',
      statements: [{
        sql: `INSERT INTO sync_conflicts(
                id,operation_id,entity_type,entity_id,local_payload_json,
                server_payload_json,base_version,server_version,status,created_at,resolved_at
              ) VALUES(?,?,?,?,?,?,?,?,?, ?,NULL)
              ON CONFLICT(operation_id) DO NOTHING`,
        bind: [
          id,
          operation,
          String(entry.entityType || 'unknown'),
          String(entry.entityId || operation),
          '{}',
          JSON.stringify({
            commandType: entry.commandType || null,
            payload: entry.payload || {},
            result: entry.result || {},
          }),
          entry.baseVersion == null ? null : Number(entry.baseVersion),
          entry.result?.entity?.version == null ? null : Number(entry.result.entity.version),
          'open',
          String(createdAt),
        ],
        result: 'changes',
      }, {
        sql: `INSERT INTO sync_cursors(stream_name,server_sequence,updated_at)
              VALUES(?,?,?)
              ON CONFLICT(stream_name) DO UPDATE SET
                server_sequence=MAX(sync_cursors.server_sequence,excluded.server_sequence),
                updated_at=excluded.updated_at`,
        bind: [String(streamName), serverSequence, String(createdAt)],
        result: 'changes',
      }],
    });
    return this.get(id);
  }

  async resolve(id, status) {
    if (!['resolved-local', 'resolved-server', 'merged'].includes(status)) {
      throw new TypeError(`Unsupported sync conflict resolution: ${status}`);
    }
    const resolvedAt = this.now().toISOString();
    await this.client.executeAtomic({
      commandId: operationId(`sync-conflict:${id}`),
      label: 'sync-conflict-resolve',
      statements: [{
        sql: `UPDATE sync_conflicts SET status=?,resolved_at=? WHERE id=? AND status='open'`,
        bind: [status, resolvedAt, String(id)],
        result: 'changes',
      }],
    });
    return this.get(id);
  }
}

export default SyncConflictRepository;
