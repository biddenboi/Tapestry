import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const derivedCacheUrl = new URL('../../shared/cache/DerivedCache.js', import.meta.url).href;

let source = await readFile(new URL('./DojoLeaderboardSnapshots.js', import.meta.url), 'utf8');
source = source
  .replace("from '@shared/cache/DerivedCache.js';", `from '${derivedCacheUrl}';`)
  .replace(
  "import { STORES } from '@domain/constants.js';",
  "const STORES = { appSetting: 'appSettings', derivedCache: 'derivedCaches', task: 'tasks' };",
);
const snapshots = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class MemoryDb {
  constructor(tasks = []) {
    this.stores = new Map([
      ['tasks', new Map(tasks.map((task) => [task.UUID, structuredClone(task)]))],
      ['appSettings', new Map()],
      ['derivedCaches', new Map()],
    ]);
    this.taskReads = 0;
    this.domainLoads = 0;
  }

  bucket(store) {
    if (!this.stores.has(store)) this.stores.set(store, new Map());
    return this.stores.get(store);
  }

  async get(store, id) { return this.bucket(store).get(id) || null; }
  async getAll(store) {
    if (store === 'tasks') this.taskReads += 1;
    return [...this.bucket(store).values()].map((value) => structuredClone(value));
  }
  async add(store, record) { this.bucket(store).set(record.UUID, structuredClone(record)); }
  async getAllPlayers() { return [{ UUID: 'player-1', username: 'Ada', elo: 1000 }]; }
  async ensureDomainLoaded(domain) {
    assert.equal(domain, 'tasks');
    this.domainLoads += 1;
  }
}

test('ordinary snapshot reads never scan tasks; explicit migration rewrites legacy fields once', async () => {
  const db = new MemoryDb([{
    UUID: 'legacy-task',
    parent: 'player-1',
    source: 'dojo',
    sessionUUID: 'legacy-session',
    points: 8,
    completedAt: '2026-01-01T10:00:00.000Z',
  }]);

  const beforeMigration = await snapshots.getDojoLeaderboardSnapshot(db);
  assert.deepEqual(beforeMigration.sessions, []);
  assert.equal(db.taskReads, 0);
  assert.equal(db.domainLoads, 0);

  const first = await snapshots.migrateLegacyDojoRecordsOnce(db);
  const second = await snapshots.migrateLegacyDojoRecordsOnce(db);
  const migratedTask = await db.get('tasks', 'legacy-task');

  assert.equal(first.sessions[0].sessionUUID, 'legacy-session');
  assert.deepEqual(second, first);
  assert.equal(db.taskReads, 1);
  assert.equal(db.domainLoads, 1);
  assert.equal(migratedTask.dojoSessionUUID, 'legacy-session');
  assert.equal(migratedTask.dojoRecordVersion, 1);
  assert.equal('sessionUUID' in migratedTask, false);
});

test('snapshot updates are idempotent by completed-task UUID', async () => {
  const db = new MemoryDb([]);
  const task = {
    UUID: 'dojo-task-1',
    parent: 'player-1',
    source: 'dojo',
    dojoSessionUUID: 'dojo-session-1',
    points: 12,
    completedAt: '2026-01-02T10:00:00.000Z',
  };

  const first = await snapshots.recordDojoCompletionInSnapshot(db, { task });
  const replay = await snapshots.recordDojoCompletionInSnapshot(db, { task });

  assert.equal(first.updated, true);
  assert.equal(replay.updated, false);
  assert.equal(replay.snapshot.sessions.length, 1);
  assert.equal(replay.snapshot.sessions[0].points, 12);
  assert.equal(replay.snapshot.sessions[0].taskCount, 1);
});

test('leaderboard materialization joins cached sessions to profiles without task reads', async () => {
  const db = new MemoryDb([]);
  await db.add('derivedCaches', {
    UUID: snapshots.DOJO_LEADERBOARD_SNAPSHOT_ID,
    value: {
      schemaVersion: 3,
      migrationVersion: 1,
      migratedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      processedTaskUUIDs: ['task-a'],
      participantSummaries: [{ UUID: 'player-a', username: 'Ada', elo: 1000 }],
      sessions: [{ sessionUUID: 'session-a', playerUUID: 'player-a', points: 20, taskCount: 2 }],
    },
  });
  const snapshot = await snapshots.getDojoLeaderboardSnapshot(db);
  const rows = snapshots.materializeDojoLeaderboard(snapshot, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].player.username, 'Ada');
  assert.equal(db.taskReads, 0);
});
