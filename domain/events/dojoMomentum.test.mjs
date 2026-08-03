import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./Events.js', import.meta.url), 'utf8'))
  .replace(
    "import { v4 as uuid } from 'uuid';",
    "let __uuid = 0; const uuid = () => `test-${++__uuid}`;",
  )
  .replace(
    `import {
  EVENT, STORES, SPECIAL_EVENT_IDS, SPECIAL_KIND, SPECIAL_EVENT_TUNING,
  HABIT_STREAK_CAP_DAYS, DAY,
} from '@domain/constants.js';`,
    `const EVENT = { wake: 'wake', end_work: 'end_work', sleep: 'sleep' };
const STORES = { customEvent: 'customEvents', eventBuff: 'eventBuffs', eventLog: 'eventLogs', event: 'events', player: 'players' };
const SPECIAL_EVENT_IDS = { dojoMultiplier: 'special-dojo-multiplier' };
const SPECIAL_KIND = { dojo_multiplier: 'dojo_multiplier', sleep_time: 'sleep_time' };
const SPECIAL_EVENT_TUNING = {};
const HABIT_STREAK_CAP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;`,
  )
  .replace(
    "import { getCurrentIGT } from '@domain/time/Time.js';",
    'const getCurrentIGT = () => Date.now();',
  )
  .replace(
    `import {
  ACHIEVEMENT_EVENT_TYPE,
  createAchievementEvent,
  queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';`,
    `const ACHIEVEMENT_EVENT_TYPE = { eventLogged: 'event-logged', timelineEventCreated: 'timeline-event-created' };
const createAchievementEvent = (event) => event;
const queueAchievementEvent = async () => null;`,
  );

const events = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function makeDb() {
  const stores = {
    customEvents: [{ UUID: 'special-dojo-multiplier', name: 'Dojo Momentum' }],
    eventBuffs: [],
    eventLogs: [],
    events: [],
    players: [],
  };
  return {
    stores,
    async get(store, id) {
      return stores[store].find((row) => row.UUID === id) || null;
    },
    async getPlayerStore(store, playerUUID) {
      return stores[store].filter((row) => row.parent === playerUUID);
    },
    async add(store, row) {
      const index = stores[store].findIndex((entry) => entry.UUID === row.UUID);
      if (index >= 0) stores[store][index] = row;
      else stores[store].push(row);
      return row;
    },
    async remove(store, id) {
      stores[store] = stores[store].filter((row) => row.UUID !== id);
    },
  };
}

test('dojo momentum accumulates by task weight and time, then clears after match', async () => {
  const db = makeDb();
  const player = { UUID: 'player-1', username: 'Demo' };

  const first = await events.applyDojoContribution(db, player, 2, 30 * 60 * 1000);
  assert.equal(first.multiplierValue, 2);

  const second = await events.applyDojoContribution(db, player, 1.5, 20 * 60 * 1000);
  assert.equal(second.multiplierValue, 2.5);
  assert.equal(db.stores.eventLogs.length, 2);

  await events.clearDojoMultiplier(db, player.UUID);
  assert.deepEqual(db.stores.eventBuffs, []);
});

test('dojo momentum is idempotent by completion-event ID even before a processor receipt exists', async () => {
  const db = makeDb();
  const player = { UUID: 'player-1', username: 'Demo' };

  const first = await events.applyDojoContribution(
    db,
    player,
    2,
    30 * 60 * 1000,
    { completionEventUUID: 'completion-1' },
  );
  const replay = await events.applyDojoContribution(
    db,
    player,
    2,
    30 * 60 * 1000,
    { completionEventUUID: 'completion-1' },
  );

  assert.equal(first.multiplierValue, 2);
  assert.equal(replay.multiplierValue, 2);
  assert.deepEqual(replay.appliedCompletionEventUUIDs, ['completion-1']);
  assert.equal(db.stores.eventLogs.length, 1);
  assert.equal(db.stores.eventLogs[0].completionEventUUID, 'completion-1');
});
