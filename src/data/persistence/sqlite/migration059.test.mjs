import assert from 'node:assert/strict';
import test from 'node:test';
import InProcessSqliteClient from './testing/InProcessSqliteClient.js';
import SQLITE_MIGRATIONS from './migrations/index.js';
import MigrationRunner from './MigrationRunner.js';
import SqliteShadowDomainRuntime from './SqliteShadowDomainRuntime.js';
import SqliteDocumentRepository from './SqliteDocumentRepository.js';
import { sanitizeRetiredFeatureRecord } from '../RetiredFeatureData.js';

const at = '2026-01-01T00:00:00.000Z';
const retiredTables = [
  'dojo_session_ranks', 'dojo_session_rollups', 'semantic_presence_intervals',
  'social_cast_assignments', 'social_cast_reviews', 'social_activity_index',
  'social_activity_dirty_subjects', 'social_activity_rebuild_state',
  'social_encounters', 'social_event_receipts',
];

async function setup(t, migrations = SQLITE_MIGRATIONS) {
  const client = new InProcessSqliteClient();
  await client.initialize({ mode: 'memory' });
  t.after(() => client.close());
  await new MigrationRunner({ client, migrations }).run();
  const shadow = new SqliteShadowDomainRuntime({ client });
  await shadow.importers.coreProfiles.import({
    players: [{ UUID: 'p1', username: 'One', createdAt: at }, { UUID: 'p2', username: 'Two', createdAt: at }],
    appState: { activePlayerUUID: 'p1' },
  });
  await shadow.importers.planning.import({ tasks: [{
    UUID: 'work', parent: 'p1', name: 'Completed work', source: 'manual',
    points: 42, sessionDuration: 60000, createdAt: at, completedAt: at,
  }] });
  await shadow.importers.social.import({ friendships: [{
    UUID: 'friends', players: ['p1', 'p2'], requestedBy: 'p1', status: 'accepted',
    createdAt: at, acceptedAt: at,
  }] });
  await shadow.importers.matches.import({ matches: [{
    UUID: 'match', parent: 'p1', status: 'complete', createdAt: at,
    teams: [[{ UUID: 'p1' }], [{ UUID: 'p2' }]], result: { winningTeam: 0 },
  }] });
  return { client, shadow, documents: new SqliteDocumentRepository(client) };
}

function legacyDocument(table, record) {
  return {
    sql: `INSERT INTO ${table}(uuid,record_json,parent_uuid,sort_key,sequence) VALUES(?,?,?,?,1)`,
    bind: [record.UUID, JSON.stringify(record), record.parent || null, record.UUID],
  };
}

test('059 upgrades a populated workspace, removes feature data, and keeps work and relationships usable', async (t) => {
  const { client, shadow, documents } = await setup(t, SQLITE_MIGRATIONS.filter((migration) => migration.id < '059'));
  const legacyWork = {
    UUID: 'work', parent: 'p1', name: 'Completed work', points: 42, sessionDuration: 60000,
    source: 'dojo', dojoSessionUUID: 'training', nested: { dojoMomentum: { multiplierValue: 2 } },
  };
  const legacyPlayer = {
    UUID: 'p1', username: 'One', tokens: 25, presenceVisibilityPolicy: 'task',
    achievements: { peace_1: at, peace_2: at, legacy_1: at },
    selectedAchievements: ['peace_1', 'legacy_1', 'peace_2'],
    counters: { completedTasks: 1, dojoSessionPointsByDay: { day: 42 } },
  };
  await client.executeAtomic({ commandId: 'legacy-feature-seed', label: 'test-fixture', statements: [
    legacyDocument('document_tasks', legacyWork),
    legacyDocument('document_players', legacyPlayer),
    legacyDocument('document_custom_events', { UUID: 'special-dojo-multiplier', specialKind: 'dojo_multiplier' }),
    legacyDocument('document_event_buffs', { UUID: 'old-buff', parent: 'p1', eventUUID: 'special-dojo-multiplier' }),
    legacyDocument('document_app_settings', { UUID: 'dojoLeaderboardSnapshot:current', standings: [legacyWork] }),
    legacyDocument('document_events', { UUID: 'wake', parent: 'p1', type: 'wake', location: { latitude: 32, longitude: -96, accuracy: 4 } }),
    { sql: "UPDATE tasks SET source='dojo',extra_json=? WHERE id='work'", bind: [JSON.stringify({ dojoSessionUUID: 'training', sessionDuration: 60000 })] },
    { sql: 'UPDATE players SET extra_json=? WHERE id=?', bind: [JSON.stringify(legacyPlayer), 'p1'] },
    { sql: "INSERT INTO semantic_presence_intervals(id,player_id,location,started_igt,entered_at,created_at,updated_at) VALUES('presence','p1','dojo',0,?,?,?)", bind: [at, at, at] },
    { sql: "INSERT INTO dojo_session_rollups(session_id,player_id,presence_interval_id,points,task_count,status,boundary_claim) VALUES('training','p1','presence',42,1,'provisional','exact')" },
    { sql: "INSERT INTO dojo_session_ranks(session_id,position,source_version,computed_at) VALUES('training',1,1,?)", bind: [at] },
    { sql: "INSERT INTO social_encounters(id,viewer_player_id,subject_player_id,surface,viewer_igt,operation_id,encountered_at) VALUES('encounter','p1','p2','profile-drawer',0,'saw-two',?)", bind: [at] },
    { sql: "INSERT INTO lifecycle_events(id,player_id,event_type,created_at,latitude,longitude) VALUES('wake','p1','wake',?,32,-96)", bind: [at] },
    { sql: "INSERT INTO custom_events(id,event_type,special_kind,name,created_at) VALUES('special-dojo-multiplier','special','dojo_multiplier','Training',?)", bind: [at] },
    { sql: "INSERT INTO event_buffs(id,player_id,event_id,multiplier_value,created_at) VALUES('old-buff','p1','special-dojo-multiplier',2,?)", bind: [at] },
    { sql: "INSERT INTO achievement_legacy_awards(profile_id,legacy_key,title_snapshot,earned_at,migration_source) VALUES('p1','peace_1','Peace',?,'test')", bind: [at] },
  ] });
  await new MigrationRunner({ client, migrations: SQLITE_MIGRATIONS }).run();

  assert.deepEqual(await client.query({
    sql: `SELECT name FROM sqlite_schema WHERE name IN (${retiredTables.map(() => '?').join(',')}) OR name IN ('event_map_points','friend_residency') OR name LIKE 'social_activity_%' OR name LIKE 'social_cast_%'`,
    bind: retiredTables, result: 'values',
  }), []);
  for (const table of ['lifecycle_events', 'event_logs', 'contributions', 'action_sessions']) {
    const columns = await client.query({ sql: `PRAGMA table_info(${table})`, result: 'all' });
    assert.equal(columns.some((column) => ['latitude','longitude','location_accuracy','location_captured_at','dojo_session_id'].includes(column.name)), false);
  }
  const cleanWork = await documents.get('tasks', 'work');
  assert.equal(cleanWork.source, 'manual');
  assert.equal(cleanWork.points, 42);
  assert.equal(cleanWork.sessionDuration, 60000);
  assert.equal('dojoSessionUUID' in cleanWork, false);
  assert.deepEqual(cleanWork.nested, {});
  const player = await documents.get('players', 'p1');
  assert.equal(player.tokens, 25);
  assert.deepEqual(player.achievements, { legacy_1: at });
  assert.deepEqual(player.selectedAchievements, ['legacy_1']);
  assert.deepEqual(player.counters, { completedTasks: 1 });
  assert.equal('presenceVisibilityPolicy' in player, false);
  assert.equal('location' in await documents.get('events', 'wake'), false);
  assert.equal(await documents.get('customEvents', 'special-dojo-multiplier'), null);
  assert.equal(await documents.get('eventBuffs', 'old-buff'), null);
  assert.equal(await documents.get('appSettings', 'dojoLeaderboardSnapshot:current'), null);
  assert.equal(await client.query({ sql: 'SELECT COUNT(*) FROM achievement_legacy_awards', result: 'value' }), 0);
  const outbox = await client.query({ sql: 'SELECT record_id AS id,deleted,payload_json AS payload FROM sync_reference_outbox', result: 'all' });
  assert.equal(outbox.find((row) => row.id === 'old-buff').deleted, 1);
  assert.equal(outbox.find((row) => row.id === 'work').payload.includes('dojoSessionUUID'), false);
  assert.equal((await shadow.social.listFriendshipsForPlayer('p1')).length, 1);
  assert.equal(await client.query({ sql: 'SELECT COUNT(*) FROM matches', result: 'value' }), 1);
  assert.equal(await client.query({ sql: "SELECT source FROM tasks WHERE id='work'", result: 'value' }), 'manual');

  const switched = await shadow.coreProfiles.switchProfile({ fromPlayerId: 'p1', toPlayerId: 'p2', operationId: 'after-upgrade', now: new Date(at) });
  assert.equal(switched.status, 'switched');
  await shadow.planning.upsertTask({ ...cleanWork, name: 'Updated retained work' }, { operationId: 'edit-after-upgrade' });
  await shadow.coreProfiles.wipeProfile('p2', { operationId: 'wipe-after-upgrade', now: new Date(at) });
  assert.equal((await shadow.planning.getTask('work')).points, 42);
  assert.equal((await client.integrityCheck()).ok, true);
});

test('legacy document restore and typed imports cannot recreate retired records or coordinates', async (t) => {
  const { client, shadow, documents } = await setup(t);
  const oldTask = { UUID: 'import-work', parent: 'p1', name: 'Imported work', source: 'dojo', points: 12, dojoSessionUUID: 'old-session' };
  await documents.replaceAll(new Map([
    ['tasks', [oldTask]],
    ['eventBuffs', [{ UUID: 'import-buff', parent: 'p1', eventUUID: 'special-dojo-multiplier' }]],
    ['players', [{ UUID: 'p1', username: 'One', achievements: { peace_3: at, legacy_1: at } }]],
  ]));
  await shadow.importers.planning.import({ tasks: [oldTask] });
  await shadow.importers.events.import({
    events: [{ UUID: 'import-event', parent: 'p1', type: 'wake', location: { latitude: 1, longitude: 2 } }],
    customEvents: [{ UUID: 'special-dojo-multiplier', specialKind: 'dojo_multiplier', name: 'Retired' }],
    eventBuffs: [{ UUID: 'import-buff', parent: 'p1', eventUUID: 'special-dojo-multiplier' }],
  });
  const { dojoSessionUUID: _retired, ...expected } = oldTask;
  assert.deepEqual(await documents.get('tasks', 'import-work'), { ...expected, source: 'manual' });
  assert.equal(await documents.get('eventBuffs', 'import-buff'), null);
  assert.equal((await shadow.planning.getTask('import-work')).source, 'manual');
  assert.equal(await client.query({ sql: "SELECT COUNT(*) FROM custom_events WHERE id='special-dojo-multiplier'", result: 'value' }), 0);
  assert.equal((await client.integrityCheck()).ok, true);
  assert.deepEqual(sanitizeRetiredFeatureRecord({ UUID: 'context', audience: 'cast', sourceVisibility: 'fellows' }), { UUID: 'context', audience: 'collaborators', sourceVisibility: 'private' });
});
