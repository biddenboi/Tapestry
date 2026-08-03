import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const derivedCacheUrl = new URL('../../shared/cache/DerivedCache.js', import.meta.url).href;
let source = await readFile(new URL('./MaterializedLeaderboards.js', import.meta.url), 'utf8');
source = source
  .replace(
    /import \{[\s\S]*?\} from '@domain\/constants\.js';/,
    `const EVENT = { wake: 'wake', end_work: 'end_work', sleep: 'sleep' };
const MATCH_STATUS = { active: 'active', complete: 'complete' };
const SPECIAL_EVENT_IDS = { dojoMultiplier: 'special-dojo-multiplier' };
const STORES = { appSetting: 'appSettings', derivedCache: 'derivedCaches', task: 'tasks', friendship: 'friendships', event: 'events', eventBuff: 'eventBuffs', contribution: 'contributions', match: 'matches', player: 'players' };`,
  )
  .replace(
    "import { getMatchOutcomeForPlayer } from '@domain/matches/Match.js';",
    "const getMatchOutcomeForPlayer = (match, playerUUID) => match.viewerOutcomes?.[playerUUID] || { status: 'pending', playerScore: null, opponentScore: null };",
  )
  .replace(
    "import { withPlayerMatchResult } from '@domain/matches/IGT.js';",
    `const withPlayerMatchResult = (match, playerUUID) => ({
  ...match,
  result: {
    ...(match.result || {}),
    eloChange: match.result?.playerEloChanges?.[playerUUID]?.change ?? match.result?.eloChange ?? 0,
    oldElo: match.result?.playerEloChanges?.[playerUUID]?.oldElo ?? 0,
    newElo: match.result?.playerEloChanges?.[playerUUID]?.newElo ?? 0,
  },
});`,
  )
  .replace("from '@shared/cache/DerivedCache.js';", `from '${derivedCacheUrl}';`);

const leaderboards = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function player(UUID, username, elo) {
  return { UUID, username, elo, profilePicture: null };
}

function completedMatch() {
  return {
    UUID: 'match-1',
    parent: 'a',
    status: 'complete',
    duration: 1,
    createdAt: '2026-01-02T08:00:00.000Z',
    inGameTimestamp: 100,
    completedInGameTimestamp: 200,
    participantUUIDs: ['a', 'b'],
    viewerOutcomes: {
      a: { status: 'win', won: true, playerScore: 120, opponentScore: 90 },
      b: { status: 'loss', won: false, playerScore: 90, opponentScore: 120 },
    },
    result: {
      concludedAt: '2026-01-02T09:00:00.000Z',
      playerEloChanges: {
        a: { oldElo: 1000, newElo: 1025, change: 25 },
        b: { oldElo: 1200, newElo: 1182, change: -18 },
      },
    },
  };
}

test('materialized match data contains stable rankings and compact lobby summaries', () => {
  const snapshot = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('a', 'Ada', 1025), player('b', 'Ben', 1182)],
    matches: [completedMatch(), {
      UUID: 'active-1',
      parent: 'a',
      status: 'active',
      participantUUIDs: ['a', 'b'],
      createdAt: '2026-01-03T08:00:00.000Z',
    }],
    tasks: [
      { UUID: 'task-a', parent: 'a', completedAt: '2026-01-02T10:00:00.000Z', points: 20 },
      { UUID: 'task-b', parent: 'b', completedAt: '2026-01-02T11:00:00.000Z', points: 30 },
    ],
    friendships: [{ UUID: 'friend-1', status: 'accepted', players: ['a', 'b'] }],
    events: [
      { UUID: 'wake-a', parent: 'a', type: 'wake', createdAt: '2026-01-02T07:00:00.000Z' },
      { UUID: 'work-a', parent: 'a', type: 'end_work', createdAt: '2026-01-02T17:00:00.000Z' },
    ],
    eventBuffs: [{ UUID: 'dojo-a', parent: 'a', eventUUID: 'special-dojo-multiplier', multiplierValue: 1.2 }],
    generatedAt: '2026-01-03T00:00:00.000Z',
  });

  assert.deepEqual(snapshot.globalRankedUUIDs, ['b', 'a']);
  assert.deepEqual(snapshot.pointsRankedUUIDs, ['b', 'a']);
  assert.deepEqual(snapshot.friendUUIDsByPlayer.a, ['b']);
  assert.equal(snapshot.activeMatchUUIDByPlayer.a, 'active-1');
  assert.equal(snapshot.scheduleByPlayer.a.type, 'end_work');
  assert.equal(snapshot.dojoMomentumByPlayer.a.multiplierValue, 1.2);
  assert.equal(snapshot.matchSummariesByPlayer.a[0].UUID, 'match-1');
  assert.equal(snapshot.matchSummariesByPlayer.a[0].viewerOutcome.status, 'win');
  assert.equal(snapshot.eloHistoryByPlayer.a.at(-1).elo, 1025);
});

test('contribution rankings use a materialized deterministic snapshot', () => {
  const snapshot = leaderboards.buildContributionLeaderboardSnapshot({
    players: [player('a', 'Ada', 1000), player('b', 'Ben', 1000), player('c', 'Cara', 1000)],
    contributions: [
      { UUID: 'c1', parent: 'a', value: 4 },
      { UUID: 'c2', parent: 'b', value: 9 },
      { UUID: 'c3', parent: 'a', value: 6 },
    ],
    generatedAt: '2026-01-03T00:00:00.000Z',
  });
  assert.deepEqual(snapshot.rankedUUIDs, ['a', 'b', 'c']);
  assert.deepEqual(snapshot.totalsByPlayer, { a: 10, b: 9 });
});

class MemoryDb {
  constructor() {
    this.records = new Map([
      ['appSettings', new Map()],
      ['derivedCaches', new Map()],
      ['tasks', new Map()],
      ['friendships', new Map()],
      ['events', new Map()],
      ['eventBuffs', new Map()],
      ['contributions', new Map()],
    ]);
    this.domainLoads = [];
    this.commits = [];
    this.players = [player('a', 'Ada', 1025), player('b', 'Ben', 1182)];
    this.matches = [completedMatch()];
  }

  bucket(store) {
    if (!this.records.has(store)) this.records.set(store, new Map());
    return this.records.get(store);
  }

  async get(store, UUID) { return structuredClone(this.bucket(store).get(UUID) || null); }
  async getAll(store) { return [...this.bucket(store).values()].map((row) => structuredClone(row)); }
  async getAllPlayers() { return structuredClone(this.players); }
  async getEloWorldAtIGT() { return { players: structuredClone(this.players), matches: structuredClone(this.matches) }; }
  async ensureDomainsLoaded(domains) { this.domainLoads.push([...domains]); }
  async commitAtomicMutation({ label, puts }) {
    this.commits.push({ label, puts: structuredClone(puts) });
    for (const put of puts) this.bucket(put.store).set(put.record.UUID, structuredClone(put.record));
    return { changed: true };
  }
}

test('opening readers never aggregate source stores and queued rebuild keeps the old snapshot until commit', async () => {
  const db = new MemoryDb();
  const old = leaderboards.buildMatchLeaderboardSnapshot({
    players: [player('a', 'Old Ada', 900)],
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  db.bucket('derivedCaches').set(leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID, {
    UUID: leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID,
    value: old,
  });

  const before = await leaderboards.readLobbyMaterializedData(db, 'a');
  assert.equal(before.participants[0].username, 'Old Ada');
  assert.equal(db.domainLoads.length, 0);

  const pending = leaderboards.queueMaterializedLeaderboardRebuild(db, {
    scopes: ['match'],
    reason: 'match-committed',
  });
  const whilePending = await leaderboards.readLobbyMaterializedData(db, 'a');
  assert.equal(whilePending.participants[0].username, 'Old Ada');

  await pending;
  const after = await leaderboards.readLobbyMaterializedData(db, 'a');
  assert.equal(after.participants.find((entry) => entry.UUID === 'a').username, 'Ada');
  assert.equal(db.commits.length, 1);
  assert.equal(db.commits[0].label, 'materialized-leaderboard-rebuild');
  assert.ok(db.domainLoads[0].includes('matches'));
  assert.ok(db.domainLoads[0].includes('leaderboards'));
});

test('only relevant committed stores schedule leaderboard scopes', () => {
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForStores(['matches'])),
    new Set(['match', 'lobby']),
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForStores(['contributions'])),
    new Set(['contribution']),
  );
  assert.deepEqual(leaderboards.leaderboardScopesForStores(['inventory']), []);
});

test('rebuild requests arriving during a running job are deduplicated and drained before resolution', async () => {
  let releaseFirst;
  let enteredFirst;
  const firstEntered = new Promise((resolve) => { enteredFirst = resolve; });
  const firstRelease = new Promise((resolve) => { releaseFirst = resolve; });
  class BlockingDb extends MemoryDb {
    blocked = false;
    async commitAtomicMutation(input) {
      if (input.label === 'materialized-leaderboard-rebuild' && !this.blocked) {
        this.blocked = true;
        enteredFirst();
        await firstRelease;
      }
      return super.commitAtomicMutation(input);
    }
  }
  const db = new BlockingDb();
  const first = leaderboards.queueMaterializedLeaderboardRebuild(db, {
    scopes: ['match'],
    reason: 'match-committed',
  });
  await firstEntered;
  const second = leaderboards.queueMaterializedLeaderboardRebuild(db, {
    scopes: ['contribution'],
    reason: 'contribution-committed',
  });
  assert.equal(first, second);
  releaseFirst();
  await second;
  assert.equal(db.commits.length, 2);
  assert.ok(db.commits[0].puts.some((put) => put.record.UUID === leaderboards.MATCH_LEADERBOARD_SNAPSHOT_ID));
  assert.ok(db.commits[1].puts.some((put) => put.record.UUID === leaderboards.CONTRIBUTION_LEADERBOARD_SNAPSHOT_ID));
});


test('operation-aware invalidation ignores unrelated writes inside shared stores', () => {
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'tasks',
      record: { UUID: 'draft', name: 'Draft', completedAt: null },
      previousRecord: null,
    }]),
    [],
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'tasks',
      record: { UUID: 'done', completedAt: '2026-01-01T00:00:00.000Z' },
      previousRecord: { UUID: 'done', completedAt: null },
    }])),
    new Set(['match', 'lobby']),
  );
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'players',
      record: { UUID: 'a', username: 'Ada', elo: 1000, tokens: 10 },
      previousRecord: { UUID: 'a', username: 'Ada', elo: 1000, tokens: 20 },
    }]),
    [],
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'players',
      record: { UUID: 'a', username: 'Ada', elo: 1015 },
      previousRecord: { UUID: 'a', username: 'Ada', elo: 1000 },
    }])),
    new Set(['match', 'lobby', 'contribution']),
  );
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'events',
      record: { UUID: 'item-use', type: 'item_use' },
    }]),
    [],
  );
  assert.deepEqual(
    new Set(leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'events',
      record: { UUID: 'wake', type: 'wake' },
    }])),
    new Set(['match', 'lobby']),
  );
  assert.deepEqual(
    leaderboards.leaderboardScopesForOperations([{
      type: 'put',
      store: 'eventBuffs',
      record: { UUID: 'habit-buff', eventUUID: 'habit-water' },
    }]),
    [],
  );
});
