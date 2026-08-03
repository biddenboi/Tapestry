import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, HOUR, MINUTE } from '../constants.js';
import {
  buildDaybookChapters,
  buildDaybookPage,
  daybookDayIndex,
  formatDaybookEntryTime,
  mergeDaybookPages,
  resolveDaybookIGT,
} from './ProfileDaybook.js';

test('IGT day and time formatting use the shared zero-based coordinate', () => {
  const value = 11 * DAY + 7 * HOUR + 43 * MINUTE;
  assert.equal(daybookDayIndex(value), 11);
  assert.equal(formatDaybookEntryTime(value), '07:43 IGT');
});

test('completion IGT takes precedence so future completed work stays hidden', () => {
  const task = {
    UUID: 'future-task',
    type: 'task',
    inGameTimestamp: 2 * HOUR,
    completedInGameTimestamp: 2 * DAY,
    completedAt: '2026-07-12T12:00:00.000Z',
  };
  assert.equal(resolveDaybookIGT(task), 2 * DAY);
  assert.deepEqual(buildDaybookChapters([task], DAY), []);
});

test('active day is Today so far while earlier days are completed with stable totals', () => {
  const entries = [
    {
      UUID: 'today-task',
      type: 'task',
      completedInGameTimestamp: DAY + 3 * HOUR,
      points: 120,
      durationMs: 25 * MINUTE,
      dojoSessionUUID: 'dojo-1',
      completedAt: '2026-07-12T10:00:00.000Z',
    },
    {
      UUID: 'earlier-task',
      type: 'task',
      completedInGameTimestamp: 5 * HOUR,
      points: 80,
      durationMs: 15 * MINUTE,
      completedAt: '2026-07-11T10:00:00.000Z',
    },
    {
      UUID: 'earlier-match',
      type: 'match',
      completedInGameTimestamp: 8 * HOUR,
      result: { concludedAt: '2026-07-11T13:00:00.000Z' },
    },
  ];
  const chapters = buildDaybookChapters(entries, DAY + 6 * HOUR);

  assert.equal(chapters[0].label, 'Today so far');
  assert.equal(chapters[0].status, 'active');
  assert.deepEqual(chapters[0].totals, {
    points: 120,
    activeMs: 25 * MINUTE,
    tasks: 1,
    matches: 0,
    contribution: 0,
    dojoSessions: 1,
  });
  assert.equal(chapters[1].label, 'Day 1');
  assert.equal(chapters[1].status, 'completed');
  assert.equal(chapters[1].totals.tasks, 1);
  assert.equal(chapters[1].totals.matches, 1);
});

test('filters, search, pins, and deterministic ordering are preserved inside IGT chapters', () => {
  const entries = [
    { UUID: 'b', type: 'journal', title: 'Focus note', inGameTimestamp: 20, pinned: false },
    { UUID: 'a', type: 'journal', title: 'Focus plan', inGameTimestamp: 10, pinned: true },
    { UUID: 'task', type: 'task', name: 'Focus work', inGameTimestamp: 30 },
  ];
  const page = buildDaybookPage(entries, 100, {
    type: 'journal',
    search: 'focus',
    pinnedOnly: false,
  });
  assert.deepEqual(page.entries.map((entry) => entry.UUID), ['a', 'b']);
  assert.deepEqual(buildDaybookPage(entries, 100, {
    type: 'journal',
    pinnedOnly: true,
  }).entries.map((entry) => entry.UUID), ['a']);
});

test('bounded pages expose explicit cursors in newest and oldest directions', () => {
  const entries = Array.from({ length: 7 }, (_, dayIndex) => ({
    UUID: `day-${dayIndex}`,
    type: 'task',
    inGameTimestamp: dayIndex * DAY,
  }));
  const newest = buildDaybookPage(entries, 8 * DAY, { dayLimit: 3 });
  assert.deepEqual(newest.chapters.map((chapter) => chapter.dayIndex), [6, 5, 4]);
  assert.equal(newest.hasMore, true);
  assert.equal(newest.nextBeforeDay, 4);
  assert.deepEqual(buildDaybookPage(entries, 8 * DAY, {
    dayLimit: 3,
    beforeDay: newest.nextBeforeDay,
  }).chapters.map((chapter) => chapter.dayIndex), [3, 2, 1]);

  const oldest = buildDaybookPage(entries, 8 * DAY, { dayLimit: 3, sort: 'oldest' });
  assert.deepEqual(oldest.chapters.map((chapter) => chapter.dayIndex), [0, 1, 2]);
  assert.equal(oldest.nextAfterDay, 2);
});

test('page merging remains a pure, deduplicated domain operation', () => {
  const entries = Array.from({ length: 6 }, (_, dayIndex) => ({
    UUID: `day-${dayIndex}`,
    type: 'task',
    inGameTimestamp: dayIndex * DAY,
  }));
  const first = buildDaybookPage(entries, 7 * DAY, { dayLimit: 3 });
  const second = buildDaybookPage(entries, 7 * DAY, {
    dayLimit: 3,
    beforeDay: first.nextBeforeDay,
  });
  const merged = mergeDaybookPages(first, second);
  assert.deepEqual(merged.chapters.map((chapter) => chapter.dayIndex), [5, 4, 3, 2, 1, 0]);
  assert.equal(new Set(merged.chapters.map((chapter) => chapter.key)).size, 6);
});

test('legacy entries remain accessible without pretending their IGT was recorded', () => {
  const chapters = buildDaybookChapters([{
    UUID: 'legacy',
    type: 'journal',
    createdAt: '2020-01-01T00:00:00.000Z',
  }], DAY);
  assert.equal(chapters[0].dayIndex, 0);
  assert.equal(chapters[0].entries[0].igtProvenance, 'legacy-origin');
});

test('chapters expose factual project continuity, daily deltas, and receipt-backed rank movement', () => {
  const chapters = buildDaybookChapters([
    {
      UUID: 'day-one-task', type: 'task', projectId: 'project-1', projectName: 'World pass',
      projectState: 'active', completedInGameTimestamp: HOUR, points: 40,
    },
    {
      UUID: 'day-two-task', type: 'task', projectId: 'project-1', projectName: 'World pass',
      projectState: 'active', completedInGameTimestamp: DAY + HOUR, points: 70,
    },
    {
      UUID: 'day-two-match', type: 'match', completedInGameTimestamp: DAY + (2 * HOUR),
      result: { eloChange: 12 },
    },
  ], 2 * DAY);
  const latest = chapters.find((chapter) => chapter.dayIndex === 1);
  assert.equal(latest.threadReferences[0].state, 'continuing');
  assert.equal(latest.deltas.points, 30);
  assert.equal(latest.deltas.rank, 12);
});
