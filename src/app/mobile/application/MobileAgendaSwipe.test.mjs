import assert from 'node:assert/strict';
import test from 'node:test';

import { mobileDaySwipeDirection } from './MobileAgendaPresentation.js';

test('vertical task-list scrolling never changes the selected day', () => {
  assert.equal(mobileDaySwipeDirection({ x: 200, y: 100 }, { x: 142, y: 420 }), 0);
  assert.equal(mobileDaySwipeDirection({ x: 200, y: 100 }, { x: 240, y: 360 }), 0);
});

test('only deliberate horizontal swipes navigate days', () => {
  assert.equal(mobileDaySwipeDirection({ x: 200, y: 100 }, { x: 120, y: 128 }), 1);
  assert.equal(mobileDaySwipeDirection({ x: 120, y: 100 }, { x: 205, y: 122 }), -1);
  assert.equal(mobileDaySwipeDirection({ x: 200, y: 100 }, { x: 150, y: 104 }), 0);
});
