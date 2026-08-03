import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';

test('migration 040 adds revision authority and privately imports legacy Quick Notes once', async (t) => {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  const targetIndex = SQLITE_MIGRATIONS.findIndex(({ id }) => id === '040_global_collaborative_feed');
  const earlier = SQLITE_MIGRATIONS.slice(0, targetIndex);
  const migration = SQLITE_MIGRATIONS[targetIndex];
  client.applyMigrations(earlier, { applicationVersion: 'before-global-feed' });

  const now = '2026-07-28T12:00:00.000Z';
  const noteContent = 'A private legacy note that must survive intact.';
  await client.executeAtomic({
    commandId: 'global-feed-migration-seed',
    label: 'global-feed-migration-seed',
    statements: [
      {
        sql: 'INSERT INTO players(id,username,created_at,extra_json) VALUES(?,?,?,?)',
        bind: ['p1', 'Writer', now, '{}'],
      },
      {
        sql: `INSERT INTO journals(
                id,player_id,file_path,content_hash,title_projection,created_at,updated_at,
                document_state,imported_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        bind: ['j1', 'p1', 'journals/j1.md', 'a'.repeat(64), 'Existing Entry', now, now, 'indexed', now, '{}'],
      },
      {
        sql: `INSERT INTO document_journals(
                uuid,record_json,parent_uuid,created_at,updated_at,sort_key,sequence
              ) VALUES(?,?,?,?,?,?,?)`,
        bind: ['j1', JSON.stringify({
          UUID: 'j1', parent: 'p1', title: 'Existing Entry', entry: 'Existing body', images: [], createdAt: now,
        }), 'p1', now, now, now, 1],
      },
      {
        sql: `INSERT INTO chronicle_entry_metadata(
                journal_id,entry_kind,lifecycle_state,visibility,occurrence_at,published_at,updated_at
              ) VALUES(?,?,?,?,?,?,?)`,
        bind: ['j1', 'entry', 'published', 'fellows', now, now, now],
      },
      {
        sql: `INSERT INTO document_chronicle_entry_metadata(
                uuid,record_json,parent_uuid,created_at,updated_at,sort_key,sequence
              ) VALUES(?,?,?,?,?,?,?)`,
        bind: ['j1', JSON.stringify({
          UUID: 'j1', journalUUID: 'j1', parent: 'p1', entryKind: 'entry', lifecycleState: 'published',
          visibility: 'fellows', occurrenceAt: now, publishedAt: now, updatedAt: now,
        }), 'p1', now, now, now, 1],
      },
      {
        sql: `INSERT INTO notes(
                id,player_id,content,revision,content_hash,created_at,updated_at,last_operation_id,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?)`,
        bind: ['n1', 'p1', noteContent, 3, 'b'.repeat(64), now, now, 'legacy-note-op', '{}'],
      },
      {
        sql: `INSERT INTO note_conflicts(
                id,note_id,based_on_revision,attempted_revision,canonical_revision,
                attempted_content,attempted_hash,canonical_hash,operation_id,action,
                reason,source,detected_at,metadata_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [
          'nc1', 'n1', 2, 3, 3, 'Recovered alternate text', 'c'.repeat(64), 'b'.repeat(64),
          'legacy-conflict-op', 'update', 'same-revision-different-content', 'import', now, '{}',
        ],
      },
    ],
  });

  client.applyMigrations([migration], { applicationVersion: 'global-feed-test' });

  assert.equal(await client.query({
    sql: "SELECT visibility FROM chronicle_entry_metadata WHERE journal_id='j1'",
    result: 'value',
  }), 'fellows');
  await client.query({
    sql: "UPDATE chronicle_entry_metadata SET visibility='global' WHERE journal_id='j1'",
    result: 'changes',
  });
  assert.throws(() => client.query({
    sql: "UPDATE chronicle_entry_metadata SET visibility='public' WHERE journal_id='j1'",
    result: 'changes',
  }));

  const imported = await client.query({
    sql: `SELECT json_extract(record_json,'$.entry') AS body
          FROM document_journals WHERE uuid='legacy-note:n1'`,
    result: 'one',
  });
  assert.equal(imported.body, noteContent);
  assert.equal(await client.query({
    sql: "SELECT visibility FROM chronicle_entry_metadata WHERE journal_id='legacy-note:n1'",
    result: 'value',
  }), 'private');
  assert.equal(await client.query({
    sql: "SELECT journal_id FROM chronicle_legacy_note_mapping WHERE legacy_note_id='n1'",
    result: 'value',
  }), 'legacy-note:n1');
  assert.equal(await client.query({
    sql: 'SELECT COUNT(*) FROM document_chronicle_entry_access',
    result: 'value',
  }), 2);
  assert.equal(await client.query({
    sql: 'SELECT COUNT(*) FROM document_chronicle_entry_revisions',
    result: 'value',
  }), 2);
  assert.equal(await client.query({
    sql: `SELECT json_extract(record_json,'$.origin')
          FROM document_chronicle_entry_revisions
          WHERE json_extract(record_json,'$.entryUUID')='j1'`,
    result: 'value',
  }), 'migration');
  assert.equal(await client.query({
    sql: 'SELECT COUNT(*) FROM document_chronicle_entry_conflicts',
    result: 'value',
  }), 1);

  client.applyMigrations([migration], { applicationVersion: 'global-feed-test-replay' });
  assert.equal(await client.query({
    sql: 'SELECT COUNT(*) FROM document_chronicle_entry_revisions',
    result: 'value',
  }), 2);
  assert.equal((await client.integrityCheck()).ok, true);
});
