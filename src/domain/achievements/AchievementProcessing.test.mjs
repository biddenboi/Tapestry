import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const STORES = {
  player: 'players',
  task: 'tasks',
  journal: 'journals',
  event: 'events',
  match: 'matches',
  inventory: 'inventory',
  transaction: 'transactions',
  eventLog: 'eventLogs',
  achievementEvent: 'achievementEvents',
  achievementState: 'achievementStates',
  achievementReceipt: 'achievementReceipts',
};

const thresholds = {
  grinder: [1], scorer: [50], deep_work: [1], consistency: [1], scholar: [1], basket: [1],
  legacy: [100], hobbyist: [1], event_runner: [1], fellowship: [1], treasurer: [1],
  signature: [1], town: [1], long_game: [1], soldier: [1], climber: [100], momentum: [1],
  clutch: [10], overkill: [300], underdog: [1], contributor: [0.5],
};

let source = await readFile(new URL('./AchievementProcessing.js', import.meta.url), 'utf8');
source = source
  .replace(
    "import { SPECIAL_KIND, STORES } from '@domain/constants.js';",
    `const SPECIAL_KIND = { sleep_time: 'sleep_time' }; const STORES = ${JSON.stringify(STORES)};`,
  )
  .replace(
    `import {
  ACHIEVEMENT_THRESHOLDS,
  TOTAL_PAID_COSMETICS,
} from './Achievements.js';`,
    `const ACHIEVEMENT_THRESHOLDS = ${JSON.stringify(thresholds)};
const TOTAL_PAID_COSMETICS = 999;`,
  )
  .replace(
    `import {
  processAchievementV2Event,
  replayAchievementV2Evidence,
} from '@domain/achievements-v2/AchievementV2Processor.js';`,
    `const processAchievementV2Event = async () => ({ earned: ['first_movement'] });
const replayAchievementV2Evidence = async () => ({ earned: ['reconciled'], replayed: 1 });`,
  );

const processing = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class MemoryDatabase {
  constructor(records = {}) {
    this.stores = new Map();
    this.getAllReads = [];
    for (const [store, rows] of Object.entries(records)) {
      this.stores.set(store, new Map(rows.map((row) => [row.UUID, structuredClone(row)])));
    }
  }

  bucket(store) {
    if (!this.stores.has(store)) this.stores.set(store, new Map());
    return this.stores.get(store);
  }

  async get(store, UUID) {
    return structuredClone(this.bucket(store).get(UUID) || null);
  }

  async getAll(store) {
    this.getAllReads.push(store);
    return structuredClone([...this.bucket(store).values()]);
  }

  async add(store, record) {
    this.bucket(store).set(record.UUID, structuredClone(record));
    return record;
  }
}

function player(UUID = 'player-1') {
  return { UUID, elo: 0, achievements: {}, selectedAchievements: [] };
}

function taskEvent(UUID = 'event-1') {
  return processing.createAchievementEvent({
    UUID,
    type: processing.ACHIEVEMENT_EVENT_TYPE.taskCompleted,
    parent: 'player-1',
    sourceUUID: 'completion-1',
    occurredAt: '2026-07-01T12:00:00.000Z',
    payload: {
      completedAt: '2026-07-01T12:00:00.000Z',
      durationMs: 3600000,
      points: 75,
      source: 'tasks',
    },
  });
}

test('ordinary processing reads only the player and compact achievement stores', async () => {
  const db = new MemoryDatabase({
    [STORES.player]: [player()],
    [STORES.achievementState]: [{
      UUID: 'achievement-state:player-1',
      parent: 'player-1',
      counters: { maxJournalWords: 1000 },
      appliedEvents: {},
      eventAwards: {},
      needsReconciliation: false,
    }],
  });

  const result = await processing.processAchievementEvent(db, taskEvent());
  const updated = await db.get(STORES.player, 'player-1');
  const state = await db.get(STORES.achievementState, 'achievement-state:player-1');

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.earned, ['first_movement']);
  assert.equal(updated.achievements.legacy_1, undefined, 'unaffected journal achievements must not be evaluated');
  assert.equal(state.counters.completedTasks, 1);
  assert.deepEqual(db.getAllReads, []);
  for (const broadStore of [
    STORES.task, STORES.journal, STORES.event, STORES.match,
    STORES.inventory, STORES.transaction, STORES.eventLog,
  ]) {
    assert.ok(!db.getAllReads.includes(broadStore), `${broadStore} must not be scanned`);
  }
});

test('an achievement event increments counters and issues rewards at most once', async () => {
  const db = new MemoryDatabase({ [STORES.player]: [player()] });
  const event = taskEvent('event-idempotent');
  const rewards = [];

  const first = await processing.processAchievementEvent(db, event, { onEarned: (keys) => rewards.push(keys) });
  const second = await processing.processAchievementEvent(db, event, { onEarned: (keys) => rewards.push(keys) });
  const state = await db.get(STORES.achievementState, 'achievement-state:player-1');
  const receipt = await db.get(STORES.achievementReceipt, `achievement-receipt:${event.UUID}`);

  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'already-completed');
  assert.equal(state.counters.completedTasks, 1);
  assert.equal(rewards.length, 1);
  assert.ok(receipt.rewardIssuedAt);
  assert.deepEqual(receipt.issuedKeys, first.earned);
});


test('different events for one player are serialized without losing counter increments', async () => {
  const db = new MemoryDatabase({ [STORES.player]: [player()] });
  const first = taskEvent('event-concurrent-1');
  const second = processing.createAchievementEvent({
    ...taskEvent('event-concurrent-2'),
    UUID: 'event-concurrent-2',
    sourceUUID: 'completion-2',
    occurredAt: '2026-07-02T12:00:00.000Z',
    payload: {
      completedAt: '2026-07-02T12:00:00.000Z',
      durationMs: 60000,
      points: 25,
      source: 'tasks',
    },
  });

  await Promise.all([
    processing.processAchievementEvent(db, first),
    processing.processAchievementEvent(db, second),
  ]);

  const state = await db.get(STORES.achievementState, 'achievement-state:player-1');
  assert.equal(state.counters.completedTasks, 2);
  assert.equal(state.counters.lifetimeTaskPoints, 100);
  assert.equal(Object.keys(state.appliedEvents).length, 2);
});

test('deferred queue persists the authoritative event before scheduling processing', async () => {
  const db = new MemoryDatabase({ [STORES.player]: [player()] });
  const event = taskEvent('event-deferred');
  const originalSetTimeout = globalThis.setTimeout;
  let scheduled = null;
  globalThis.setTimeout = (callback) => {
    scheduled = callback;
    return 1;
  };
  try {
    await processing.queueAchievementEvent(db, event);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.equal(typeof scheduled, 'function');
  assert.deepEqual(await db.get(STORES.achievementEvent, event.UUID), event);
  assert.equal(await db.get(STORES.achievementReceipt, `achievement-receipt:${event.UUID}`), null);
});

test('explicit reconciliation is guarded and can rebuild counters from supplied records', async () => {
  const db = new MemoryDatabase({ [STORES.player]: [player()] });
  await assert.rejects(
    processing.reconcileAchievementState(db, player(), { reason: 'ordinary-action', data: {} }),
    /explicit allowed reason/,
  );

  const result = await processing.reconcileAchievementState(db, player(), {
    reason: 'repair',
    data: {
      tasks: [{ UUID: 'task-1', parent: 'player-1', completedAt: '2026-07-01T12:00:00.000Z', points: 75 }],
      journals: [], events: [], matches: [], inventory: [], friends: [], transactions: [], eventLogs: [], allPlayers: [player()],
    },
  });

  assert.equal(result.state.counters.completedTasks, 1);
  assert.equal(result.state.needsReconciliation, false);
  assert.equal(result.state.reconciliationReason, 'repair');
  assert.deepEqual(result.earned, ['reconciled']);
  assert.deepEqual(
    db.getAllReads,
    [STORES.achievementEvent],
    'supplied repair data should only replay the immutable achievement event log',
  );
});

test('non-leaderboard achievement events do not scan even compact peer states', async () => {
  const db = new MemoryDatabase({ [STORES.player]: [player()] });
  const event = processing.createAchievementEvent({
    UUID: 'event-journal-only',
    type: processing.ACHIEVEMENT_EVENT_TYPE.journalSaved,
    parent: 'player-1',
    sourceUUID: 'journal-1',
    payload: { isNew: true, wordCount: 120 },
  });

  const result = await processing.processAchievementEvent(db, event);

  assert.equal(result.status, 'completed');
  assert.deepEqual(db.getAllReads, []);
});
