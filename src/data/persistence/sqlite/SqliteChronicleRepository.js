import { stableJson, textOrNull } from './shadowDomainUtils.js';

function rowToMetadata(row) {
  if (!row) return null;
  return {
    UUID: row.journalId,
    journalUUID: row.journalId,
    entryKind: row.entryKind,
    lifecycleState: row.lifecycleState,
    visibility: row.visibility,
    occurrenceAt: row.occurrenceAt,
    occurrenceIGT: row.occurrenceIGT == null ? null : Number(row.occurrenceIGT),
    publishedAt: row.publishedAt,
    subtitle: row.subtitle || '',
    contextSnapshot: JSON.parse(row.contextSnapshotJson || '{"version":1,"private":{},"shared":{}}'),
    resurfacePolicy: row.resurfacePolicy,
    standaloneInFeed: Boolean(row.standaloneInFeed),
    reactionsEnabled: Boolean(row.reactionsEnabled),
    responsesEnabled: Boolean(row.responsesEnabled),
    updatedAt: row.updatedAt,
  };
}

const SELECT = `
SELECT journal_id AS journalId,entry_kind AS entryKind,lifecycle_state AS lifecycleState,
       visibility,occurrence_at AS occurrenceAt,occurrence_igt AS occurrenceIGT,
       published_at AS publishedAt,subtitle,context_snapshot_json AS contextSnapshotJson,
       resurface_policy AS resurfacePolicy,standalone_in_feed AS standaloneInFeed,
       reactions_enabled AS reactionsEnabled,responses_enabled AS responsesEnabled,
       updated_at AS updatedAt
FROM chronicle_entry_metadata`;

export class SqliteChronicleRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteChronicleRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async get(journalId) {
    return rowToMetadata(await this.client.query({
      sql: `${SELECT} WHERE journal_id=?`,
      bind: [journalId],
      result: 'one',
    }));
  }

  async upsert(metadata, { operationId } = {}) {
    if (!operationId || !metadata?.journalUUID) {
      throw new Error('Chronicle metadata writes require Journal and operation IDs.');
    }
    const updatedAt = metadata.updatedAt || this.now().toISOString();
    return this.client.executeAtomic({
      commandId: `chronicle-entry:${operationId}`,
      label: 'chronicle-entry-metadata-write',
      statements: [{
        sql: `INSERT INTO chronicle_entry_metadata(
                journal_id,entry_kind,lifecycle_state,visibility,occurrence_at,occurrence_igt,
                published_at,subtitle,context_snapshot_json,resurface_policy,standalone_in_feed,
                reactions_enabled,responses_enabled,updated_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(journal_id) DO UPDATE SET
                entry_kind=excluded.entry_kind,lifecycle_state=excluded.lifecycle_state,
                visibility=excluded.visibility,occurrence_at=excluded.occurrence_at,
                occurrence_igt=excluded.occurrence_igt,published_at=excluded.published_at,
                subtitle=excluded.subtitle,context_snapshot_json=excluded.context_snapshot_json,
                resurface_policy=excluded.resurface_policy,
                standalone_in_feed=excluded.standalone_in_feed,
                reactions_enabled=excluded.reactions_enabled,
                responses_enabled=excluded.responses_enabled,updated_at=excluded.updated_at`,
        bind: [
          metadata.journalUUID,
          metadata.entryKind || 'entry',
          metadata.lifecycleState || 'published',
          metadata.visibility || 'private',
          metadata.occurrenceAt,
          Number.isFinite(Number(metadata.occurrenceIGT)) ? Math.trunc(Number(metadata.occurrenceIGT)) : null,
          textOrNull(metadata.publishedAt),
          String(metadata.subtitle || ''),
          stableJson(metadata.contextSnapshot || { version: 1, private: {}, shared: {} }),
          metadata.resurfacePolicy || 'normal',
          metadata.standaloneInFeed ? 1 : 0,
          metadata.reactionsEnabled === false ? 0 : 1,
          metadata.responsesEnabled === false ? 0 : 1,
          updatedAt,
        ],
        result: 'changes',
      }],
    });
  }

  async listRecent({ viewerIGT = Infinity, cursor = null, limit = 24 } = {}) {
    const clauses = [
      "m.visibility IN ('fellows','global')",
      "m.lifecycle_state='published'",
      'm.published_at IS NOT NULL',
      'j.deleted_at IS NULL',
    ];
    const bind = [];
    if (Number.isFinite(Number(viewerIGT))) {
      clauses.push('(m.occurrence_igt IS NULL OR m.occurrence_igt<=?)');
      bind.push(Math.max(0, Math.trunc(Number(viewerIGT))));
    }
    if (cursor?.publishedAt && cursor?.journalUUID) {
      clauses.push('(m.published_at<? OR (m.published_at=? AND m.journal_id<?))');
      bind.push(cursor.publishedAt, cursor.publishedAt, cursor.journalUUID);
    }
    bind.push(Math.max(1, Math.min(100, Math.trunc(Number(limit) || 24))));
    const rows = await this.client.query({
      sql: `SELECT
              m.journal_id AS journalId,m.entry_kind AS entryKind,
              m.lifecycle_state AS lifecycleState,m.visibility,
              m.occurrence_at AS occurrenceAt,m.occurrence_igt AS occurrenceIGT,
              m.published_at AS publishedAt,m.subtitle,
              m.context_snapshot_json AS contextSnapshotJson,
              m.resurface_policy AS resurfacePolicy,
              m.standalone_in_feed AS standaloneInFeed,
              m.reactions_enabled AS reactionsEnabled,
              m.responses_enabled AS responsesEnabled,m.updated_at AS updatedAt
            FROM chronicle_entry_metadata m
            JOIN journals j ON j.id=m.journal_id
            WHERE ${clauses.join(' AND ')}
            ORDER BY m.published_at DESC,m.journal_id DESC LIMIT ?`,
      bind,
      result: 'all',
    });
    return rows.map(rowToMetadata);
  }
}

export default SqliteChronicleRepository;
