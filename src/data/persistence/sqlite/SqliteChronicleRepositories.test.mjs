import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import SqliteChronicleRepository from './SqliteChronicleRepository.js';
import SqliteChronicleStoryRepository from './SqliteChronicleStoryRepository.js';
import SqliteChronicleSocialRepository from './SqliteChronicleSocialRepository.js';

async function setup(t) {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  client.applyMigrations(SQLITE_MIGRATIONS, { applicationVersion: 'chronicle-repositories' });
  const now = '2026-07-28T00:00:00.000Z';
  await client.executeAtomic({
    commandId: 'chronicle-repository-seed',
    label: 'chronicle-repository-seed',
    statements: [
      { sql: 'INSERT INTO players(id,username,created_at,extra_json) VALUES(?,?,?,?)', bind: ['p1', 'Writer', now, '{}'] },
      { sql: 'INSERT INTO players(id,username,created_at,extra_json) VALUES(?,?,?,?)', bind: ['p2', 'Reader', now, '{}'] },
      {
        sql: `INSERT INTO journals(
                id,player_id,file_path,content_hash,title_projection,created_at,
                in_game_timestamp,document_state,imported_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        bind: ['j1', 'p1', 'journals/j1.md', 'b'.repeat(64), 'One', now, 4, 'indexed', now, '{}'],
      },
      {
        sql: `INSERT INTO journals(
                id,player_id,file_path,content_hash,title_projection,created_at,
                in_game_timestamp,document_state,imported_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        bind: ['j2', 'p1', 'journals/j2.md', 'c'.repeat(64), 'Two', now, 4, 'indexed', now, '{}'],
      },
    ],
  });
  return { client, now };
}

test('typed Chronicle cursor, reaction replacement, and Story deletion preserve Journals', async (t) => {
  const { client, now } = await setup(t);
  const entries = new SqliteChronicleRepository({ client, now: () => new Date(now) });
  const stories = new SqliteChronicleStoryRepository({ client, now: () => new Date(now) });
  const social = new SqliteChronicleSocialRepository({ client, now: () => new Date(now) });

  for (const [journalUUID, publishedAt] of [['j1', '2026-07-28T02:00:00.000Z'], ['j2', '2026-07-28T01:00:00.000Z']]) {
    await entries.upsert({
      journalUUID,
      entryKind: 'entry',
      lifecycleState: 'published',
      visibility: 'fellows',
      occurrenceAt: publishedAt,
      publishedAt,
    }, { operationId: `metadata-${journalUUID}` });
  }
  const first = await entries.listRecent({ limit: 1 });
  assert.deepEqual(first.map(({ journalUUID }) => journalUUID), ['j1']);
  const second = await entries.listRecent({
    cursor: { publishedAt: first[0].publishedAt, journalUUID: first[0].journalUUID },
    limit: 2,
  });
  assert.deepEqual(second.map(({ journalUUID }) => journalUUID), ['j2']);

  await social.replaceReaction({
    journalId: 'j1', reactorId: 'p2', type: 'acknowledge', operationId: 'reaction-1',
  });
  await social.replaceReaction({
    journalId: 'j1', reactorId: 'p2', type: 'support', operationId: 'reaction-2',
  });
  assert.deepEqual((await client.query({
    sql: 'SELECT reaction_type AS type FROM chronicle_reactions WHERE journal_id=? AND reactor_id=?',
    bind: ['j1', 'p2'],
    result: 'all',
  })).map((row) => ({ ...row })), [{ type: 'support' }]);

  await stories.upsert({
    UUID: 's1', parent: 'p1', title: 'A Story', visibility: 'fellows', createdAt: now,
  }, { operationId: 'story-1' });
  await stories.replaceOrder('s1', [
    { journalUUID: 'j1' },
    { journalUUID: 'j2' },
  ], { operationId: 'story-order' });
  assert.deepEqual((await stories.memberships('s1')).map(({ journalUUID, ordinal }) => ({
    journalUUID, ordinal,
  })), [
    { journalUUID: 'j1', ordinal: 1 },
    { journalUUID: 'j2', ordinal: 2 },
  ]);
  await stories.deleteStory('s1', { operationId: 'story-delete' });
  assert.equal(await client.query({ sql: 'SELECT count(*) FROM journals', result: 'value' }), 2);
  assert.equal((await client.integrityCheck()).ok, true);
});
