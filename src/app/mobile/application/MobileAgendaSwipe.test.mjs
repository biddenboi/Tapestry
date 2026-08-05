import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('the scrollable task page does not own the day-swipe gesture', async () => {
  const source = await readFile(new URL('../MobileTasksPage.jsx', import.meta.url), 'utf8');
  const pageStart = source.indexOf('className="mobile-page mobile-today-page"');
  const pageOpeningTag = source.slice(pageStart, source.indexOf('<header', pageStart));
  const railStart = source.indexOf('className="mobile-date-rail"');
  const dateRailOpeningTag = source.slice(railStart, source.indexOf('{dateRail.map', railStart));
  assert.doesNotMatch(pageOpeningTag, /onTouchStart|onTouchEnd/);
  assert.match(dateRailOpeningTag, /onTouchStart/);
  assert.match(dateRailOpeningTag, /onTouchEnd=\{finishSwipe\}/);
});
