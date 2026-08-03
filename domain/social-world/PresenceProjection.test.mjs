import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESENCE_CLAIM,
  PRESENCE_INTERRUPTION,
  PRESENCE_STATE,
  RECENT_TRACE_WINDOW_IGT_MS,
  SEMANTIC_LOCATION,
} from './SocialWorldContracts.js';
import {
  closePresenceIntervalAtBoundary,
  deriveLastActiveIGT,
  projectElapsed,
  projectPresence,
} from './PresenceProjection.js';

test('a paused Task Session remains current while occupancy advances and productive time stops', () => {
  const result = projectPresence({
    intervals: [{
      id: 'task-1',
      location: SEMANTIC_LOCATION.taskSession,
      sourceType: 'task',
      sourceId: 'todo-1',
      startedIGT: 1_000,
      activeElapsedMs: 1_200,
      activeAnchorAt: null,
      tracksActiveElapsed: true,
    }],
    viewerIGT: 5_000,
    isActiveProfile: true,
    nowMs: 50_000,
  });

  assert.equal(result.state, PRESENCE_STATE.current);
  assert.equal(result.claim, PRESENCE_CLAIM.exactCurrent);
  assert.equal(result.location, SEMANTIC_LOCATION.taskSession);
  assert.equal(result.elapsedHere, 4_000);
  assert.equal(result.activeElapsed, 1_200);
  assert.equal(result.sourceType, 'task');
  assert.equal(result.sourceId, 'todo-1');
  assert.equal(result.paused, true);
});

test('an unpaused current session adds only injected wall-clock active time', () => {
  const result = projectPresence({
    intervals: [{
      location: SEMANTIC_LOCATION.taskSession,
      startedIGT: 1_000,
      activeElapsedMs: 2_000,
      activeAnchorAt: '1970-01-01T00:00:10.000Z',
      tracksActiveElapsed: true,
    }],
    viewerIGT: 8_000,
    isActiveProfile: true,
    nowMs: 13_000,
  });

  assert.equal(result.elapsedHere, 7_000);
  assert.equal(result.activeElapsed, 5_000);
  assert.equal(result.paused, false);
});

test('a completed Dojo interval is recent at its boundary and never claims current', () => {
  const interval = {
    location: SEMANTIC_LOCATION.dojo,
    startedIGT: 2_000,
    endedIGT: 10_000,
    activeElapsedMs: 6_000,
    tracksActiveElapsed: true,
  };
  const atCompletion = projectPresence({
    intervals: [interval],
    viewerIGT: 10_000,
    isActiveProfile: true,
    nowMs: 20_000,
  });
  const afterRecentWindow = projectPresence({
    intervals: [interval],
    viewerIGT: 10_000 + RECENT_TRACE_WINDOW_IGT_MS + 1,
    isActiveProfile: true,
    nowMs: 20_000,
  });

  assert.equal(atCompletion.state, PRESENCE_STATE.recent);
  assert.equal(atCompletion.claim, PRESENCE_CLAIM.recentInterval);
  assert.equal(atCompletion.elapsedHere, 8_000);
  assert.equal(atCompletion.activeElapsed, 6_000);
  assert.equal(afterRecentWindow.state, PRESENCE_STATE.inactive);
  assert.equal(afterRecentWindow.lastActiveIGT, 10_000);
});

test('viewer-IGT projection clips occupancy and pause segments at the viewer cursor', () => {
  const result = projectPresence({
    intervals: [{
      location: SEMANTIC_LOCATION.taskSession,
      startedIGT: 1_000,
      endedIGT: 10_000,
      activeElapsedMs: 7_000,
      tracksActiveElapsed: true,
      activeSegments: [
        { startedIGT: 1_000, endedIGT: 3_000 },
        { startedIGT: 4_000, endedIGT: 8_000 },
      ],
    }],
    viewerIGT: 5_000,
    isActiveProfile: false,
    nowMs: 20_000,
  });

  assert.equal(result.state, PRESENCE_STATE.projected);
  assert.equal(result.elapsedHere, 4_000);
  assert.equal(result.activeElapsed, 3_000);
  assert.equal(result.lastActiveIGT, 5_000);
});

test('historical productive time stays unknown when final totals would leak beyond viewer IGT', () => {
  const result = projectPresence({
    intervals: [{
      location: SEMANTIC_LOCATION.taskSession,
      startedIGT: 1_000,
      endedIGT: 10_000,
      activeElapsedMs: 8_000,
      tracksActiveElapsed: true,
    }],
    viewerIGT: 5_000,
    isActiveProfile: false,
    nowMs: 20_000,
  });

  assert.equal(result.state, PRESENCE_STATE.projected);
  assert.equal(result.elapsedHere, 4_000);
  assert.equal(result.activeElapsed, null);
});

test('switching viewer profiles freezes one cursor and excludes the incoming viewer future', () => {
  const sharedInterval = {
    location: SEMANTIC_LOCATION.planning,
    startedIGT: 5_000,
    endedIGT: 9_000,
  };
  const outgoingView = projectPresence({
    intervals: [sharedInterval],
    viewerIGT: 8_000,
    isActiveProfile: false,
    nowMs: 50_000,
  });
  const incomingView = projectPresence({
    intervals: [sharedInterval],
    viewerIGT: 4_000,
    isActiveProfile: false,
    nowMs: 50_000,
  });

  assert.equal(outgoingView.state, PRESENCE_STATE.projected);
  assert.equal(outgoingView.elapsedHere, 3_000);
  assert.equal(incomingView.state, PRESENCE_STATE.inactive);
  assert.equal(incomingView.lastActiveIGT, null);
});

test('an interrupted Planning visit closes at the last known boundary', () => {
  const closed = closePresenceIntervalAtBoundary({
    id: 'planning-1',
    location: SEMANTIC_LOCATION.planning,
    startedIGT: 1_000,
  }, {
    endedIGT: 4_000,
    exitedAt: '1970-01-01T00:00:20.000Z',
    interruption: PRESENCE_INTERRUPTION.appBackground,
    nowMs: 20_000,
  });
  const result = projectPresence({
    intervals: [closed],
    viewerIGT: 4_000,
    isActiveProfile: true,
    nowMs: 20_000,
  });

  assert.equal(closed.endedIGT, 4_000);
  assert.equal(closed.lastObservedIGT, 4_000);
  assert.equal(closed.closeReason, PRESENCE_INTERRUPTION.appBackground);
  assert.equal(result.state, PRESENCE_STATE.recent);
  assert.equal(result.elapsedHere, 3_000);
});

test('legacy evidence can derive a factual recent trace but never duration or current presence', () => {
  const result = projectPresence({
    traces: [{
      kind: 'task-session-completed',
      in_game_timestamp: 9_000,
      source: 'legacy-task',
    }],
    viewerIGT: 10_000,
    isActiveProfile: true,
    nowMs: 20_000,
  });

  assert.equal(result.state, PRESENCE_STATE.recent);
  assert.equal(result.claim, PRESENCE_CLAIM.legacyTrace);
  assert.equal(result.location, SEMANTIC_LOCATION.taskSession);
  assert.equal(result.startedIGT, null);
  assert.equal(result.elapsedHere, null);
  assert.equal(result.activeElapsed, null);
});

test('arbitrary edits and future evidence do not produce last-active or presence claims', () => {
  const result = projectPresence({
    intervals: [{
      location: SEMANTIC_LOCATION.marketplace,
      startedIGT: 20_000,
      endedIGT: 21_000,
    }],
    traces: [{ kind: 'profile-edited', inGameTimestamp: 9_000 }],
    viewerIGT: 10_000,
    isActiveProfile: false,
    nowMs: 20_000,
  });

  assert.equal(result.state, PRESENCE_STATE.inactive);
  assert.equal(result.claim, PRESENCE_CLAIM.none);
  assert.equal(result.lastActiveIGT, null);
});

test('other-profile open intervals require an observed projection boundary', () => {
  const interval = {
    location: SEMANTIC_LOCATION.dojo,
    startedIGT: 1_000,
    lastObservedIGT: 4_000,
  };
  assert.equal(projectPresence({
    intervals: [interval],
    viewerIGT: 3_000,
    isActiveProfile: false,
    nowMs: 20_000,
  }).state, PRESENCE_STATE.projected);
  assert.equal(projectPresence({
    intervals: [interval],
    viewerIGT: 5_000,
    isActiveProfile: false,
    nowMs: 20_000,
  }).state, PRESENCE_STATE.inactive);
});

test('overlapping records resolve deterministically to the newest valid interval', () => {
  const result = projectPresence({
    intervals: [
      { id: 'older', location: SEMANTIC_LOCATION.commons, startedIGT: 1_000, endedIGT: 8_000 },
      { id: 'newer', location: SEMANTIC_LOCATION.planning, startedIGT: 3_000, endedIGT: 7_000 },
    ],
    viewerIGT: 5_000,
    isActiveProfile: false,
    nowMs: 20_000,
  });

  assert.equal(result.state, PRESENCE_STATE.projected);
  assert.equal(result.location, SEMANTIC_LOCATION.planning);
  assert.equal(result.startedIGT, 3_000);
});

test('elapsed projection clamps corrupted active totals to occupancy', () => {
  const result = projectElapsed({
    location: SEMANTIC_LOCATION.taskSession,
    startedIGT: 1_000,
    endedIGT: 2_000,
    tracksActiveElapsed: true,
    activeElapsedMs: 10_000,
  }, 2_000, 20_000, { isExactCurrent: false });
  assert.deepEqual(result, { elapsedHere: 1_000, activeElapsed: 1_000 });
});

test('last-active selects only the latest meaningful evidence at or before viewer IGT', () => {
  assert.equal(deriveLastActiveIGT({
    intervals: [{
      location: SEMANTIC_LOCATION.planning,
      started_igt: 1_000,
      ended_igt: 3_000,
    }],
    traces: [
      { kind: 'dojo-exited', inGameTimestamp: 4_000 },
      { kind: 'match-concluded', inGameTimestamp: 12_000 },
      { kind: 'record-updated', inGameTimestamp: 9_000 },
    ],
    viewerIGT: 10_000,
  }), 4_000);
});
