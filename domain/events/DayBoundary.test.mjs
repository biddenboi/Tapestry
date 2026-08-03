import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./DayBoundary.js', import.meta.url), 'utf8');
const boundary = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test('end-of-day state is shared across profiles for one calendar day', () => {
  const storage = new MemoryStorage();

  boundary.setEndOfDayState('player-a', '2026-06-13', 'shown', storage);

  assert.equal(boundary.getEndOfDayState('player-a', '2026-06-13', storage), 'shown');
  assert.equal(boundary.getEndOfDayState('player-b', '2026-06-13', storage), 'shown');
});

test('legacy per-profile state remains readable', () => {
  const storage = new MemoryStorage();
  storage.setItem('tapestry_eod_player-a_2026-06-12', 'chosen');

  assert.equal(boundary.getEndOfDayState('player-a', '2026-06-12', storage), 'chosen');
  assert.equal(boundary.getEndOfDayState('player-b', '2026-06-12', storage), null);
});

test('durable end-of-day state survives an empty provided cache', async () => {
  const storage = new MemoryStorage();
  const records = new Map();
  const databaseConnection = {
    get: async (_store, UUID) => records.get(UUID) || null,
    add: async (_store, record) => records.set(record.UUID, record),
  };

  await boundary.setDurableEndOfDayState(
    databaseConnection,
    'player-a',
    '2026-06-13',
    'shown',
    storage,
  );
  storage.values.clear();

  assert.equal(
    await boundary.getDurableEndOfDayState(
      databaseConnection,
      'player-a',
      '2026-06-13',
      storage,
    ),
    'shown',
  );
});

test('chosen state wins while migrating an older shown setting', async () => {
  const storage = new MemoryStorage();
  storage.setItem('tapestry_eod_2026-06-13', 'chosen');
  const databaseConnection = {
    get: async () => ({ state: 'shown' }),
  };

  assert.equal(
    await boundary.getDurableEndOfDayState(
      databaseConnection,
      'player-a',
      '2026-06-13',
      storage,
    ),
    'chosen',
  );
});

test('wake shown state survives an empty provided cache', async () => {
  const storage = new MemoryStorage();
  const records = new Map();
  const databaseConnection = {
    get: async (_store, UUID) => records.get(UUID) || null,
    add: async (_store, record) => records.set(record.UUID, record),
  };

  await boundary.setDurableWakeState(
    databaseConnection,
    'player-a',
    '2026-06-13',
    'shown',
    storage,
  );
  storage.values.clear();

  assert.equal(
    await boundary.getDurableWakeState(
      databaseConnection,
      'player-a',
      '2026-06-13',
      storage,
    ),
    'shown',
  );
});

test('completed wake clears pending state and wins after reload', async () => {
  const storage = new MemoryStorage();
  const records = new Map();
  const databaseConnection = {
    get: async (_store, UUID) => records.get(UUID) || null,
    add: async (_store, record) => records.set(record.UUID, record),
  };

  await boundary.setDurableWakeState(
    databaseConnection,
    'player-a',
    '2026-06-13',
    'shown',
    storage,
  );
  await boundary.setDurableWakeState(
    databaseConnection,
    'player-a',
    '2026-06-13',
    'completed',
    storage,
  );

  assert.equal(
    await boundary.getDurableWakeState(
      databaseConnection,
      'player-a',
      '2026-06-13',
      storage,
    ),
    'completed',
  );
});

test('wake is shown when the calendar day has not been entered or prompted', () => {
  assert.equal(boundary.shouldShowWakePrompt(), true);
});

test('a shown wake prompt is recoverable on reload', () => {
  assert.equal(
    boundary.shouldShowWakePrompt({ wakeState: 'shown' }),
    true,
  );
});

test('a completed wake is not reopened even without a local prompt marker', () => {
  assert.equal(boundary.shouldShowWakePrompt({ completedToday: true }), false);
});

test('a submitting wake prompt is not duplicated', () => {
  assert.equal(boundary.shouldShowWakePrompt({ wakeState: 'submitting' }), false);
});

test('prior sleep waits while profile selection is open', () => {
  assert.equal(boundary.shouldAdvancePastPriorSleep('shown'), false);
});

test('prior sleep advances after profile selection or after state loss', () => {
  assert.equal(boundary.shouldAdvancePastPriorSleep('chosen'), true);
  assert.equal(boundary.shouldAdvancePastPriorSleep(null), true);
});

test('legacy profile without createdAt is still an existing profile', () => {
  assert.equal(boundary.needsInitialProfile({ UUID: 'player-a' }), false);
});

test('profile creation opens only when no profile identity exists', () => {
  assert.equal(boundary.needsInitialProfile(null), true);
  assert.equal(boundary.needsInitialProfile({}), true);
});
