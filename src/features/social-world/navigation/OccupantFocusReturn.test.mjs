import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOccupantFocusReturn,
  occupantFocusTargetId,
  occupantGroupHeadingId,
  restoreOccupantFocus,
} from './OccupantFocusReturn.js';

function queuedScheduler() {
  const queue = [];
  return {
    queue,
    schedule(callback) { queue.push(callback); },
    flush() {
      const callback = queue.shift();
      callback?.();
    },
  };
}

test('focus-return IDs are stable, scoped, and safe for unfamiliar profile identifiers', () => {
  assert.equal(occupantFocusTargetId('Lobby Match', 'Profile:1'), 'occupant-Lobby%20Match-Profile%3A1');
  assert.equal(occupantGroupHeadingId('Lobby Match'), 'occupant-group-Lobby%20Match');
  assert.deepEqual(createOccupantFocusReturn({
    surface: 'Lobby Match', profileId: 'Profile:1', groupSurface: 'Social World',
  }), {
    targetId: 'occupant-Lobby%20Match-Profile%3A1',
    groupId: 'occupant-group-Social%20World',
  });
});

test('focus returns to the activating resident control once its surface is visible', () => {
  const scheduler = queuedScheduler();
  const root = { activeElement: null };
  const target = { focus() { root.activeElement = target; } };
  const group = { focus() { root.activeElement = group; } };
  root.getElementById = (id) => ({ target, group }[id] || null);

  assert.equal(restoreOccupantFocus({ targetId: 'target', groupId: 'group' }, {
    root, schedule: scheduler.schedule, maxAttempts: 2,
  }), true);
  scheduler.flush();
  assert.strictEqual(root.activeElement, target);
  assert.equal(scheduler.queue.length, 0);
});

test('a parked target that cannot receive focus retries before using the group heading', () => {
  const scheduler = queuedScheduler();
  const root = { activeElement: null };
  const parkedTarget = { focus() {} };
  const group = { focus() { root.activeElement = group; } };
  root.getElementById = (id) => (id === 'target' ? parkedTarget : id === 'group' ? group : null);

  restoreOccupantFocus({ targetId: 'target', groupId: 'group' }, {
    root, schedule: scheduler.schedule, maxAttempts: 1,
  });
  scheduler.flush();
  assert.equal(scheduler.queue.length, 1);
  scheduler.flush();
  assert.strictEqual(root.activeElement, group);
});
