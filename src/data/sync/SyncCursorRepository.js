import { normalizeCursor, syncCursorStatement } from './SyncContracts.js';

const operationId = (prefix) => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

export class SyncCursorRepository {
  constructor(client, { now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) throw new Error('SyncCursorRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async get(streamName = 'owner') {
    const row = await this.client.query({
      sql: `SELECT stream_name AS streamName,server_sequence AS serverSequence,updated_at AS updatedAt
            FROM sync_cursors WHERE stream_name=?`,
      bind: [String(streamName)],
      result: 'one',
    });
    return row ? { ...row, serverSequence: Number(row.serverSequence) } : {
      streamName: String(streamName),
      serverSequence: 0,
      updatedAt: null,
    };
  }

  async advance(streamName, serverSequence, updatedAt = this.now()) {
    const cursor = normalizeCursor({ streamName, serverSequence, updatedAt });
    const result = await this.client.executeAtomic({
      commandId: operationId(`sync-cursor:${cursor.streamName}`),
      label: 'sync-cursor-advance',
      statements: [syncCursorStatement(cursor)],
    });
    return { ...cursor, changed: Number(result.statementResults?.[0]?.changes || 0) };
  }

  async list() {
    const rows = await this.client.query({
      sql: `SELECT stream_name AS streamName,server_sequence AS serverSequence,updated_at AS updatedAt
            FROM sync_cursors ORDER BY stream_name`,
      result: 'all',
    });
    return rows.map((row) => ({ ...row, serverSequence: Number(row.serverSequence) }));
  }
}

export default SyncCursorRepository;
