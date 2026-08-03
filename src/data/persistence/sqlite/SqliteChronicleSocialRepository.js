export class SqliteChronicleSocialRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteChronicleSocialRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async replaceReaction({ journalId, reactorId, type, operationId }) {
    if (!operationId) throw new Error('Reaction writes require an operation ID.');
    const now = this.now().toISOString();
    return this.client.executeAtomic({
      commandId: `chronicle-reaction:${operationId}`,
      label: 'chronicle-reaction-replace',
      statements: [{
        sql: `INSERT INTO chronicle_reactions(
                journal_id,reactor_id,reaction_type,created_at,updated_at
              ) VALUES(?,?,?,?,?)
              ON CONFLICT(journal_id,reactor_id) DO UPDATE SET
                reaction_type=excluded.reaction_type,updated_at=excluded.updated_at`,
        bind: [journalId, reactorId, type, now, now],
        result: 'changes',
      }],
    });
  }

  async clearReaction({ journalId, reactorId, operationId }) {
    if (!operationId) throw new Error('Reaction writes require an operation ID.');
    return this.client.executeAtomic({
      commandId: `chronicle-reaction-clear:${operationId}`,
      label: 'chronicle-reaction-clear',
      statements: [{
        sql: 'DELETE FROM chronicle_reactions WHERE journal_id=? AND reactor_id=?',
        bind: [journalId, reactorId],
        result: 'changes',
      }],
    });
  }

  async saveFeedCursor({ viewerId, publishedAt, journalId, operationId }) {
    if (!operationId) throw new Error('Feed cursor writes require an operation ID.');
    return this.client.executeAtomic({
      commandId: `chronicle-feed-cursor:${operationId}`,
      label: 'chronicle-feed-cursor-write',
      statements: [{
        sql: `INSERT INTO chronicle_feed_view_state(
                viewer_id,last_seen_published_at,last_seen_journal_id,updated_at
              ) VALUES(?,?,?,?)
              ON CONFLICT(viewer_id) DO UPDATE SET
                last_seen_published_at=excluded.last_seen_published_at,
                last_seen_journal_id=excluded.last_seen_journal_id,
                updated_at=excluded.updated_at`,
        bind: [viewerId, publishedAt, journalId, this.now().toISOString()],
        result: 'changes',
      }],
    });
  }
}

export default SqliteChronicleSocialRepository;
