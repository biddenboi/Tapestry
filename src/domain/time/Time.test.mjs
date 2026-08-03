import assert from 'node:assert/strict';
import test from 'node:test';
import * as time from './Time.js';

process.env.TZ = 'America/Chicago';

test('active IGT uses the real local clock within the saved profile day', () => {
  const player = {
    inGameTime: 2 * 86_400_000,
    igtActive: true,
    igtLastActiveDate: '2026-07-16',
  };
  const now = Date.parse('2026-07-16T22:35:42.123Z');
  assert.equal(
    time.getCurrentIGT(player, now),
    2 * 86_400_000 + 17 * 3_600_000 + 35 * 60_000 + 42_123,
  );
});

test('an active profile advances across real-world day boundaries', () => {
  const player = {
    inGameTime: 12 * 3_600_000,
    igtActive: true,
    igtLastActiveDate: '2026-07-14',
  };
  const beforeClose = Date.parse('2026-07-14T17:00:00.000Z');
  const afterReopen = Date.parse('2026-07-15T17:00:00.000Z');
  assert.equal(time.getCurrentIGT(player, afterReopen) - time.getCurrentIGT(player, beforeClose), 86_400_000);
});

test('inactive profiles remain frozen while the active profile advances', () => {
  const now = Date.parse('2026-07-26T22:00:00.000Z');
  const inactive = { inGameTime: 7 * 86_400_000 + 9 * 3_600_000, igtActive: false };
  const active = {
    inGameTime: 2 * 86_400_000,
    igtActive: true,
    igtLastActiveDate: '2026-07-26',
  };
  assert.equal(time.getCurrentIGT(inactive, now), inactive.inGameTime);
  assert.equal(time.getCurrentIGT(active, now), 2 * 86_400_000 + 17 * 3_600_000);
});

test('switching back on a later date adds one profile day rather than elapsed inactive dates', () => {
  const player = {
    inGameTime: 4 * 86_400_000 + 21 * 3_600_000,
    igtActive: false,
    igtLastActiveDate: '2026-02-10',
    igtClockVersion: 2,
  };
  const activated = time.activatePlayerIGT(player, Date.parse('2026-07-26T22:00:00.000Z'));
  assert.equal(activated.inGameTime, 5 * 86_400_000 + 17 * 3_600_000);
  assert.equal(activated.igtLastActiveDate, '2026-07-26');
});

test('player writes snapshot the active profile without changing its day index', () => {
  const prepared = time.preparePlayerIGTWrite({
    UUID: 'profile-write-clock',
    createdAt: '2026-07-14T05:00:00.000Z',
    inGameTime: 86_400_000 + 1,
    igtActive: true,
    igtLastActiveDate: '2026-07-15',
    tokens: 5,
  }, null, Date.parse('2026-07-15T17:00:00.000Z'));
  assert.equal(prepared.inGameTime, 86_400_000 + 12 * 3_600_000);
  assert.equal(prepared.tokens, 5);
});

test('legacy wall-time profiles resume from their persisted cursor instead of creation age', () => {
  const migrated = time.migratePlayerIGTClock({
    UUID: 'legacy-profile',
    createdAt: '2026-02-16T06:00:00.000Z',
    inGameTime: 0,
  }, {
    active: true,
    nowMs: Date.parse('2026-07-29T22:15:00.000Z'),
  });
  assert.equal(migrated.inGameTime, 17 * 3_600_000 + 15 * 60_000);
  assert.equal(migrated.igtActive, true);
  assert.equal(migrated.igtLastActiveDate, '2026-07-29');
});

test('legacy recovery rebuilds only the real dates spent in each active profile', () => {
  const now = Date.parse('2026-07-05T17:00:00.000Z');
  const recovered = time.buildLegacyProfileIGTRecovery([
    {
      UUID: 'profile-a',
      createdAt: '2026-07-01T13:00:00.000Z',
      inGameTime: 0,
    },
    {
      UUID: 'profile-b',
      createdAt: '2026-07-02T13:00:00.000Z',
      inGameTime: 0,
    },
  ], {
    activityEvents: [
      {
        playerUUID: 'profile-a',
        eventType: 'wake',
        createdAt: '2026-07-04T13:00:00.000Z',
      },
      {
        playerUUID: 'profile-b',
        eventType: 'sleep',
        createdAt: '2026-07-05T13:00:00.000Z',
      },
    ],
    activePlayerUUID: 'profile-a',
    nowMs: now,
  });

  assert.equal(recovered.get('profile-a').recoveredActiveDays, 4);
  assert.equal(
    recovered.get('profile-a').inGameTime,
    3 * 86_400_000 + 12 * 3_600_000,
  );
  assert.equal(recovered.get('profile-a').igtActive, true);
  assert.equal(recovered.get('profile-b').recoveredActiveDays, 3);
  assert.equal(
    recovered.get('profile-b').inGameTime,
    2 * 86_400_000 + 8 * 3_600_000,
  );
  assert.equal(recovered.get('profile-b').igtActive, false);
});

test('legacy recovery never moves a valid saved profile-day backward', () => {
  const recovered = time.buildLegacyProfileIGTRecovery([{
    UUID: 'profile-saved',
    createdAt: '2026-07-05T13:00:00.000Z',
    inGameTime: 4 * 86_400_000 + 21 * 3_600_000,
  }], {
    activePlayerUUID: 'profile-saved',
    nowMs: Date.parse('2026-07-05T17:00:00.000Z'),
  }).get('profile-saved');

  assert.equal(recovered.recoveredActiveDays, 5);
  assert.equal(recovered.inGameTime, 4 * 86_400_000 + 12 * 3_600_000);
});

test('activity recovery runs for legacy and prematurely versioned clocks exactly once', () => {
  assert.equal(time.needsProfileIGTActivityRecovery({}), true);
  assert.equal(time.needsProfileIGTActivityRecovery({ igtClockVersion: 2 }), true);
  assert.equal(time.needsProfileIGTActivityRecovery({
    igtClockVersion: 2,
    igtActivityRecoveryVersion: 1,
  }), false);
});

test('world clock uses the exact uppercase DAY N · HH:MM product format', () => {
  assert.equal(time.formatWorldIGT(11 * 86_400_000 + 7 * 3_600_000 + 43 * 60_000), 'DAY 12 · 07:43');
  assert.equal(time.formatWorldIGT(Number.NaN), 'DAY 1 · 00:00');
});
