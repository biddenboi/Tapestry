import { stableJson, textOrNull } from './shadowDomainUtils.js';

export class SqliteChronicleStoryRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteChronicleStoryRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async upsert(story, { operationId } = {}) {
    if (!operationId || !story?.UUID || !story?.parent) throw new Error('Story writes require IDs.');
    const now = this.now().toISOString();
    return this.client.executeAtomic({
      commandId: `chronicle-story:${operationId}`,
      label: 'chronicle-story-write',
      statements: [{
        sql: `INSERT INTO chronicle_stories(
                id,player_id,title,description,cover_json,status,visibility,start_at,end_at,
                resurface_policy,closing_reflection,created_at,updated_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,description=excluded.description,cover_json=excluded.cover_json,
                status=excluded.status,visibility=excluded.visibility,start_at=excluded.start_at,
                end_at=excluded.end_at,resurface_policy=excluded.resurface_policy,
                closing_reflection=excluded.closing_reflection,updated_at=excluded.updated_at`,
        bind: [
          story.UUID, story.parent, story.title, story.description || '',
          stableJson(story.cover || {}), story.status || 'ongoing', story.visibility || 'private',
          textOrNull(story.startAt), textOrNull(story.endAt),
          story.resurfacePolicy || 'normal', story.closingReflection || '',
          story.createdAt || now, now,
        ],
        result: 'changes',
      }],
    });
  }

  async memberships(storyId) {
    return this.client.query({
      sql: `SELECT story_id AS storyUUID,journal_id AS journalUUID,ordinal,role,added_at AS addedAt
            FROM chronicle_story_entries WHERE story_id=? ORDER BY ordinal,journal_id`,
      bind: [storyId],
      result: 'all',
    });
  }

  async replaceOrder(storyId, memberships, { operationId } = {}) {
    if (!operationId) throw new Error('Story reordering requires an operation ID.');
    const statements = [
      { sql: 'DELETE FROM chronicle_story_entries WHERE story_id=?', bind: [storyId], result: 'changes' },
      ...memberships.map((membership, index) => ({
        sql: `INSERT INTO chronicle_story_entries(story_id,journal_id,ordinal,role,added_at)
              VALUES(?,?,?,?,?)`,
        bind: [
          storyId,
          membership.journalUUID,
          index + 1,
          membership.role || 'primary',
          membership.addedAt || this.now().toISOString(),
        ],
        result: 'changes',
      })),
    ];
    return this.client.executeAtomic({
      commandId: `chronicle-story-order:${operationId}`,
      label: 'chronicle-story-reorder',
      statements,
    });
  }

  async deleteStory(storyId, { operationId } = {}) {
    if (!operationId) throw new Error('Story deletion requires an operation ID.');
    return this.client.executeAtomic({
      commandId: `chronicle-story-delete:${operationId}`,
      label: 'chronicle-story-delete',
      statements: [{
        sql: 'DELETE FROM chronicle_stories WHERE id=?',
        bind: [storyId],
        result: 'changes',
      }],
    });
  }
}

export default SqliteChronicleStoryRepository;
