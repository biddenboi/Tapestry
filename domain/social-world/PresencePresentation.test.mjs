import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPresencePresentation } from './PresencePresentation.js';
import { PRESENCE_STATE, SEMANTIC_LOCATION } from './SocialWorldContracts.js';

test('pausable work presents occupancy and productive time as separate facts', () => {
  const view = buildPresencePresentation({
    state: PRESENCE_STATE.current,
    location: SEMANTIC_LOCATION.taskSession,
    elapsedHere: 42 * 60_000,
    activeElapsed: 31 * 60_000,
    paused: true,
  }, 50 * 60_000);
  assert.equal(view.primary, 'Task Session · Here 42m · focused 31m');
  assert.equal(view.statusLabel, 'Paused');
  assert.match(view.secondary, /occupancy continues/);
});

test('ended visits retain a stable total and an IGT-relative recent label', () => {
  const view = buildPresencePresentation({
    state: PRESENCE_STATE.recent,
    location: SEMANTIC_LOCATION.dojo,
    elapsedHere: 34 * 60_000,
    activeElapsed: 20 * 60_000,
    endedIGT: 100 * 60_000,
    paused: false,
  }, 109 * 60_000);
  assert.equal(view.primary, 'Left Dojo 9m ago');
  assert.equal(view.secondary, '34m total');
});
