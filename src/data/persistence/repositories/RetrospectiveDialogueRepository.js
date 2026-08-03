import { v4 as uuid } from 'uuid';

function parse(value, fallback = {}) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class RetrospectiveDialogueRepository {
  constructor(facade) {
    this.facade = facade;
    this.adapter = facade?.persistenceRuntime?.sqliteStorageAdapter;
  }

  async listForSource(sourceJournalId) {
    const rows = await this.adapter.query({
      sql: `SELECT id,source_journal_id AS sourceJournalId,target_journal_id AS targetJournalId,
                   player_id AS playerId,action,body,created_at AS createdAt,
                   occurrence_at AS occurrenceAt,metadata_json AS metadata
            FROM chronicle_retrospective_dialogue
            WHERE source_journal_id=? ORDER BY created_at DESC,id`,
      bind: [sourceJournalId],
      result: 'all',
    });
    return rows.map((row) => ({ ...row, metadata: parse(row.metadata) }));
  }

  async record({
    sourceJournalId,
    targetJournalId = null,
    playerId,
    action,
    body = '',
    occurrenceAt = null,
    metadata = {},
  }) {
    const createdAt = new Date().toISOString();
    const id = `retrospective:${sourceJournalId}:${targetJournalId || uuid()}:${action}`;
    await this.adapter.query({
      sql: `INSERT INTO chronicle_retrospective_dialogue(
              id,source_journal_id,target_journal_id,player_id,action,body,
              created_at,occurrence_at,metadata_json
            ) VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              body=excluded.body,metadata_json=excluded.metadata_json`,
      bind: [
        id, sourceJournalId, targetJournalId, playerId, action, body,
        createdAt, occurrenceAt || createdAt, JSON.stringify(metadata),
      ],
      result: 'changes',
    });
    return {
      id, sourceJournalId, targetJournalId, playerId, action, body,
      createdAt, occurrenceAt: occurrenceAt || createdAt, metadata,
    };
  }
}

export default RetrospectiveDialogueRepository;
