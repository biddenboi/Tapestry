import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampDojoFeedIndex,
  clampDojoFeedScrollTop,
  createDojoVisibilityTracker,
  dojoFeedIndexFromScroll,
  isAtDojoFeedEnd,
  maxDojoFeedScrollTop,
  shouldRequestDojoRecommendation,
} from './dojoFeedPolicy.js';

function fakeVisibilityClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => current,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: current + delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    advance(milliseconds) {
      current += milliseconds;
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= current);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

test('feed indices and scroll offsets use actual browser scroll geometry', () => {
  assert.equal(clampDojoFeedIndex(-4, 5), 0);
  assert.equal(clampDojoFeedIndex(99, 5), 4);
  assert.equal(maxDojoFeedScrollTop(2420, 600), 1820);
  assert.equal(clampDojoFeedScrollTop(9000, 2420, 600), 1820);
  assert.equal(clampDojoFeedScrollTop(-20, 2420, 600), 0);
  assert.equal(clampDojoFeedScrollTop(9000, 500, 600), 0);
});

test('the final generated card is recognized even when card step is smaller than clientHeight', () => {
  // The feed has padding and each card is calc(100% - 16px), so the true
  // browser maximum does not equal (cardCount - 1) * clientHeight.
  assert.equal(isAtDojoFeedEnd(0, 500, 600), true);
  assert.equal(isAtDojoFeedEnd(1680, 2284, 600), false);
  assert.equal(isAtDojoFeedEnd(1682, 2284, 600), true);
  assert.equal(isAtDojoFeedEnd(1684, 2284, 600), true);
});

test('scroll position maps across every generated card using the real maximum', () => {
  const scrollHeight = 2284;
  const clientHeight = 600;
  assert.equal(dojoFeedIndexFromScroll(0, scrollHeight, clientHeight, 4), 0);
  assert.equal(dojoFeedIndexFromScroll(560, scrollHeight, clientHeight, 4), 1);
  assert.equal(dojoFeedIndexFromScroll(1123, scrollHeight, clientHeight, 4), 2);
  assert.equal(dojoFeedIndexFromScroll(1684, scrollHeight, clientHeight, 4), 3);
});

test('the feed automatically requests only the first recommendation', () => {
  const base = { sourceReady: true, requestInFlight: false, failed: false };

  assert.equal(shouldRequestDojoRecommendation({ ...base, cardCount: 0 }), true);
  assert.equal(shouldRequestDojoRecommendation({ ...base, cardCount: 1 }), false);
  assert.equal(shouldRequestDojoRecommendation({ ...base, cardCount: 5 }), false);
});

test('loading, failed, and not-yet-loaded feeds cannot start a request', () => {
  assert.equal(shouldRequestDojoRecommendation({ cardCount: 0, sourceReady: true, requestInFlight: true }), false);
  assert.equal(shouldRequestDojoRecommendation({ cardCount: 0, sourceReady: true, failed: true }), false);
  assert.equal(shouldRequestDojoRecommendation({ cardCount: 0, sourceReady: false }), false);
});

test('rapidly crossed unviewed cards create no presentation or visibility facts', () => {
  const clock = fakeVisibilityClock();
  const presentations = [];
  const segments = [];
  const tracker = createDojoVisibilityTracker({
    ...clock,
    minimumVisibleRatio: 0.6,
    minimumVisibleMs: 500,
    onPresented: (event) => presentations.push(event),
    onVisibilitySegment: (event) => segments.push(event),
  });
  tracker.observe('card-a', 0.8);
  clock.advance(240);
  tracker.observe('card-a', 0);
  clock.advance(1_000);
  tracker.dispose();
  assert.equal(presentations.length, 0);
  assert.equal(segments.length, 0);
});

test('visibility is accumulated across reverse scroll without duplicate presentation', () => {
  const clock = fakeVisibilityClock();
  const presentations = [];
  const segments = [];
  const tracker = createDojoVisibilityTracker({
    ...clock,
    minimumVisibleRatio: 0.6,
    minimumVisibleMs: 500,
    onPresented: (event) => presentations.push(event),
    onVisibilitySegment: (event) => segments.push(event),
  });
  tracker.observe('card-a', 0.8, { position: 0 });
  clock.advance(500);
  clock.advance(200);
  tracker.observe('card-a', 0);
  tracker.observe('card-a', 0.9, { position: 0 });
  clock.advance(300);
  tracker.observe('card-a', 0);
  tracker.resolve('card-a');
  tracker.observe('card-a', 1);
  clock.advance(1_000);
  assert.equal(presentations.length, 1);
  assert.equal(presentations[0].visibleMs, 500);
  assert.deepEqual(segments.map((segment) => segment.visibleMs), [200, 300]);
  assert.equal(tracker.snapshot('card-a').resolved, true);
});
