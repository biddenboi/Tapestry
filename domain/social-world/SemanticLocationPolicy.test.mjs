import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESENCE_INTERRUPTION,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';
import {
  getLocationContinuityPolicy,
  resolveSemanticLocation,
  shouldClosePresence,
} from './SemanticLocationPolicy.js';

test('semantic location precedence keeps nested work inside Match and Dojo', () => {
  const scenarios = [
    {
      name: 'match wins over dojo, task, planning, shop, and the idle world',
      input: {
        gameState: 'match',
        activeTask: { createdAt: 'now' },
        activePanel: 'shop',
        worldVisible: true,
      },
      expected: SEMANTIC_LOCATION.matchArena,
    },
    {
      name: 'dojo wins over a task',
      input: { gameState: 'dojo', activeTask: { createdAt: 'now' }, worldVisible: true },
      expected: SEMANTIC_LOCATION.dojo,
    },
    {
      name: 'task session wins over planning',
      input: { activeTask: { createdAt: 'now' }, activePanel: 'tasks', worldVisible: true },
      expected: SEMANTIC_LOCATION.taskSession,
    },
    {
      name: 'queue is planning',
      input: { activePanel: 'queue', worldVisible: true },
      expected: SEMANTIC_LOCATION.planning,
    },
    {
      name: 'shop is marketplace',
      input: { activePanel: 'shop', worldVisible: true },
      expected: SEMANTIC_LOCATION.marketplace,
    },
    {
      name: 'visible semantic world without stronger context is Commons',
      input: { worldVisible: true },
      expected: SEMANTIC_LOCATION.commons,
    },
    { name: 'no evidence means no location', input: {}, expected: null },
  ];

  scenarios.forEach(({ name, input, expected }) => {
    assert.equal(resolveSemanticLocation(input), expected, name);
  });
});

test('ordinary locations close on lifecycle boundaries while pause preserves occupancy', () => {
  const ordinaryLocations = [
    SEMANTIC_LOCATION.planning,
    SEMANTIC_LOCATION.taskSession,
    SEMANTIC_LOCATION.dojo,
    SEMANTIC_LOCATION.marketplace,
    SEMANTIC_LOCATION.commons,
  ];

  ordinaryLocations.forEach((location) => {
    assert.equal(shouldClosePresence({
      location,
      interruption: PRESENCE_INTERRUPTION.appBackground,
    }), true, location);
    assert.equal(shouldClosePresence({
      location,
      interruption: PRESENCE_INTERRUPTION.pause,
    }), false, location);
  });
  assert.equal(getLocationContinuityPolicy(SEMANTIC_LOCATION.taskSession).tracksActiveElapsed, true);
  assert.equal(
    getLocationContinuityPolicy(SEMANTIC_LOCATION.taskSession).recoverableAfterReload,
    false,
  );
});

test('a Match may cross a background boundary only with domain recovery evidence', () => {
  assert.equal(shouldClosePresence({
    location: SEMANTIC_LOCATION.matchArena,
    interruption: PRESENCE_INTERRUPTION.appBackground,
    domainSupportsRecovery: false,
  }), true);
  assert.equal(shouldClosePresence({
    location: SEMANTIC_LOCATION.matchArena,
    interruption: PRESENCE_INTERRUPTION.appBackground,
    domainSupportsRecovery: true,
  }), false);
  assert.equal(shouldClosePresence({
    location: SEMANTIC_LOCATION.matchArena,
    interruption: PRESENCE_INTERRUPTION.profileSwitch,
    domainSupportsRecovery: true,
  }), true);
  assert.equal(shouldClosePresence({
    location: SEMANTIC_LOCATION.matchArena,
    interruption: PRESENCE_INTERRUPTION.completed,
    domainSupportsRecovery: true,
  }), true);
});
