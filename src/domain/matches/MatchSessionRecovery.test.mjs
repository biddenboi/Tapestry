import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPlayerInMatch,
  isRestorableMatchSession,
  resolveRestorableMatchSession,
} from './MatchSessionRecovery.js';

const session = {
  UUID: 'session-1',
  parent: 'self',
  outcome: 'active',
  matchUUID: 'match-1',
};
const match = {
  UUID: 'match-1',
  status: 'active',
  teams: [[{ UUID: 'self' }], [{ UUID: 'fellow' }]],
};

test('active participant Match sessions are restorable', () => {
  assert.equal(isPlayerInMatch(match, 'self'), true);
  assert.equal(isRestorableMatchSession({ actionSession: session, match, playerUUID: 'self' }), true);
});

test('completed Matches and foreign sessions never steal focus', () => {
  assert.equal(isRestorableMatchSession({
    actionSession: session,
    match: { ...match, status: 'complete' },
    playerUUID: 'self',
  }), false);
  assert.equal(isRestorableMatchSession({
    actionSession: session,
    match,
    playerUUID: 'somebody-else',
  }), false);
});

test('recovery resolves the canonical persisted Match and ignores stale records', async () => {
  const databaseConnection = {
    async get(store, UUID) {
      assert.equal(store, 'matches');
      assert.equal(UUID, 'match-1');
      return match;
    },
  };
  assert.equal(await resolveRestorableMatchSession(databaseConnection, {
    actionSession: session,
    playerUUID: 'self',
  }), match);
  assert.equal(await resolveRestorableMatchSession(databaseConnection, {
    actionSession: { ...session, outcome: 'completed' },
    playerUUID: 'self',
  }), null);
});
