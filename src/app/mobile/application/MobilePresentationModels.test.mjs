import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDateSlideDirection,
  mobileDaySwipeDirection,
  mobileDateKey,
  nearestApplicableReminder,
} from './MobileAgendaPresentation.js';
import {
  mobileFeedbackHapticPattern,
  simpleMobileFeedback,
  taskCompletionFeedback,
} from './MobileFeedback.js';
import {
  reminderPresetTime,
  resolveReminderSnooze,
} from '../../../features/reminders/mobile/MobileReminderTime.js';
import {
  detectMobileCompanion,
  setMobileSurfaceOverride,
} from '../useMobileCompanion.js';

function mobileWindow({ search = '', width = 1000, coarse = false, standalone = false } = {}) {
  const storage = new Map();
  return {
    location: { search },
    navigator: { standalone },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    dispatchEvent() {},
    matchMedia(query) {
      return {
        matches: query.includes('display-mode')
          ? standalone
          : query.includes('pointer')
            ? coarse
            : width <= Number(query.match(/(\d+)px/)?.[1] || 0),
      };
    },
  };
}

test('Today selects only the nearest applicable reminder and honors snooze', () => {
  const reminders = [
    { UUID: 'later', remindAt: '2026-08-02T18:00:00.000Z' },
    { UUID: 'completed', remindAt: '2026-08-02T08:00:00.000Z', completedAt: '2026-08-02T08:01:00.000Z' },
    { UUID: 'snoozed-nearest', remindAt: '2026-08-02T07:00:00.000Z', snoozedUntil: '2026-08-02T10:00:00.000Z' },
    { UUID: 'past', remindAt: '2026-08-01T17:00:00.000Z' },
    { UUID: 'tomorrow', remindAt: '2026-08-03T09:00:00.000Z' },
  ];
  assert.equal(nearestApplicableReminder(reminders, '2026-08-02', '2026-08-02').UUID, 'past');
  assert.equal(nearestApplicableReminder(reminders, '2026-08-03', '2026-08-02').UUID, 'tomorrow');
  assert.equal(nearestApplicableReminder([{ ...reminders[0], dismissedAt: 'x' }], '2026-08-02', '2026-08-02'), null);
});

test('date presentation uses calendar-local keys and directional transitions', () => {
  assert.equal(mobileDateKey(new Date(2026, 7, 2, 12)), '2026-08-02');
  assert.equal(getDateSlideDirection('2026-08-02', '2026-08-03'), 'forward');
  assert.equal(getDateSlideDirection('2026-08-02', '2026-08-01'), 'backward');
  assert.equal(getDateSlideDirection('2026-08-02', '2026-08-02'), 'none');
});

test('day swipes ignore vertical scrolling and require a dominant horizontal gesture', () => {
  assert.equal(mobileDaySwipeDirection({ x: 200, y: 100 }, { x: 142, y: 420 }), 0);
  assert.equal(mobileDaySwipeDirection({ x: 200, y: 100 }, { x: 120, y: 128 }), 1);
  assert.equal(mobileDaySwipeDirection({ x: 120, y: 100 }, { x: 205, y: 122 }), -1);
  assert.equal(mobileDaySwipeDirection({ x: 200, y: 100 }, { x: 150, y: 104 }), 0);
});

test('mobile reminder presets and snooze choices resolve exact future instants', () => {
  const now = new Date('2026-08-02T12:00:00.000Z');
  assert.equal(resolveReminderSnooze('10m', { now }), '2026-08-02T12:10:00.000Z');
  assert.equal(resolveReminderSnooze('30m', { now }), '2026-08-02T12:30:00.000Z');
  assert.equal(resolveReminderSnooze('1h', { now }), '2026-08-02T13:00:00.000Z');
  assert.equal(resolveReminderSnooze('custom', { now, customAt: '2026-08-02T14:35:00.000Z' }), '2026-08-02T14:35:00.000Z');
  assert.throws(() => resolveReminderSnooze('custom', { now, customAt: '2026-08-02T11:59:00.000Z' }), /future/);
  assert.equal(reminderPresetTime('30m', now), '2026-08-02T12:30:00.000Z');
  const tomorrow = new Date(reminderPresetTime('tomorrow', now));
  assert.equal(tomorrow.getHours(), 9);
  assert.equal(tomorrow.getDate(), new Date(2026, 7, 3).getDate());
});

test('mobile feedback is driven by canonical outcomes and omits zero deltas', () => {
  const feedback = taskCompletionFeedback({ UUID: 'task-1', name: 'Write test' }, {
    pointsBase: 25,
    tokensGained: 4,
    goalProgressDelta: 0,
    matchContribution: 8,
    completionEvent: { UUID: 'event-1' },
  });
  assert.equal(feedback.id, 'task-completed:event-1');
  assert.equal(feedback.significance, 'meaningful');
  assert.deepEqual(feedback.deltas.map(({ key }) => key), ['points', 'coins', 'match']);
  assert.equal(Object.isFrozen(feedback), true);

  const simple = simpleMobileFeedback('saved', 'Saved', { sourceId: 'one', deltas: [null] });
  assert.equal(simple.id, 'saved:one');
  assert.deepEqual(simple.deltas, []);

  assert.equal(mobileFeedbackHapticPattern('routine'), 10);
  assert.equal(mobileFeedbackHapticPattern('meaningful'), 18);
  assert.deepEqual(mobileFeedbackHapticPattern('major'), [24, 40, 36]);
  assert.equal(mobileFeedbackHapticPattern('major', { reducedMotion: true }), null);
});

test('mobile surface detection respects explicit, installed, touch, and persisted device identity', () => {
  assert.equal(detectMobileCompanion(mobileWindow({ search: '?mobile=1', width: 1200 })), true);
  assert.equal(detectMobileCompanion(mobileWindow({ search: '?desktop=1', width: 320, coarse: true })), false);
  assert.equal(detectMobileCompanion(mobileWindow({ width: 800, standalone: true })), true);
  assert.equal(detectMobileCompanion(mobileWindow({ width: 800, coarse: true })), true);
  assert.equal(detectMobileCompanion(mobileWindow({ width: 800 })), false);
  assert.equal(detectMobileCompanion(mobileWindow({ width: 500 })), true);

  const device = mobileWindow({ width: 320, coarse: true });
  setMobileSurfaceOverride('desktop', device);
  assert.equal(detectMobileCompanion(device), false);
  setMobileSurfaceOverride('auto', device);
  assert.equal(detectMobileCompanion(device), true);
});
