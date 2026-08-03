import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 035 backfills Chronicle metadata without losing legacy votes', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  const targetIndex = SQLITE_MIGRATIONS.findIndex(({ id }) => id === '035_feed_chronicle');
  const earlier = SQLITE_MIGRATIONS.slice(0, targetIndex);
  client.applyMigrations(earlier, { applicationVersion: 'before-chronicle' });

  const now = '2026-07-28T00:00:00.000Z';
  await client.executeAtomic({
    commandId: 'chronicle-migration-seed',
    label: 'chronicle-migration-seed',
    statements: [
      {
        sql: 'INSERT INTO players(id,username,created_at,extra_json) VALUES(?,?,?,?)',
        bind: ['p1', 'Writer', now, '{}'],
      },
      {
        sql: `INSERT INTO journals(
                id,player_id,file_path,content_hash,title_projection,created_at,
                in_game_timestamp,document_state,imported_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        bind: ['j1', 'p1', 'journals/j1.md', 'a'.repeat(64), 'Legacy', now, 4, 'indexed', now, '{}'],
      },
      {
        sql: 'INSERT INTO journal_feed_metadata(journal_id,sort_at,visibility) VALUES(?,?,?)',
        bind: ['j1', '2026-07-28T01:00:00.000Z', 'visible'],
      },
      {
        sql: 'INSERT INTO journal_votes(journal_id,voter_id,value,updated_at) VALUES(?,?,?,?)',
        bind: ['j1', 'p1', 1, now],
      },
    ],
  });

  const migration = SQLITE_MIGRATIONS.find(({ id }) => id === '035_feed_chronicle');
  client.applyMigrations([migration], { applicationVersion: 'chronicle-test' });

  const metadata = await client.query({
    sql: `SELECT entry_kind AS kind,lifecycle_state AS lifecycle,visibility,
                 occurrence_at AS occurrence,published_at AS published
          FROM chronicle_entry_metadata WHERE journal_id='j1'`,
    result: 'one',
  });
  assert.deepEqual(metadata, {
    kind: 'entry',
    lifecycle: 'published',
    visibility: 'fellows',
    occurrence: now,
    published: '2026-07-28T01:00:00.000Z',
  });
  assert.equal(await client.query({
    sql: "SELECT value FROM journal_votes WHERE journal_id='j1' AND voter_id='p1'",
    result: 'value',
  }), 1);
  assert.equal(await client.query({
    sql: `SELECT json_extract(record_json,'$.visibility')
          FROM document_chronicle_entry_metadata WHERE uuid='j1'`,
    result: 'value',
  }), 'fellows');

  const required = [
    'chronicle_stories',
    'chronicle_story_entries',
    'chronicle_drafts',
    'chronicle_reactions',
    'chronicle_feed_view_state',
    'document_chronicle_entry_metadata',
  ];
  const tables = await client.query({
    sql: `SELECT name FROM sqlite_schema WHERE type='table' AND name IN (${required.map(() => '?').join(',')})`,
    bind: required,
    result: 'all',
  });
  assert.deepEqual(new Set(tables.map(({ name }) => name)), new Set(required));
  assert.equal((await client.integrityCheck()).ok, true);
});
