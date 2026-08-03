import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, MINUTE, STORES } from '../../../domain/constants.js';
import ProfileDaybookQueryService from './ProfileDaybookQueryService.js';

function makeFacade(records = {}, loadedDomains = new Set()) {
  return {
    ready: Promise.resolve(),
    loadedDomains,
    _recordValues(store) {
      return records[store] || [];
    },
  };
}

test('prepared Daybook query returns one bounded, viewer-IGT-safe profile page', async () => {
  const records = {
    [STORES.task]: [
      {
        UUID: 'visible-task', parent: 'p1', name: 'Visible work', completedAt: '2026-07-10T10:00:00Z',
        inGameTimestamp: 10, completedInGameTimestamp: DAY + 20, points: 100,
      },
      {
        UUID: 'future-task', parent: 'p1', name: 'Future work', completedAt: '2026-07-12T10:00:00Z',
        inGameTimestamp: 20, completedInGameTimestamp: 3 * DAY, points: 999,
      },
      {
        UUID: 'other-task', parent: 'p2', name: 'Other profile', completedAt: '2026-07-10T10:00:00Z',
        completedInGameTimestamp: DAY + 30,
      },
    ],
    [STORES.taskCompletionEvent]: [{
      UUID: 'completion-1', parent: 'p1', taskUUID: 'visible-task', durationMs: 25 * MINUTE,
    }],
    [STORES.journal]: [{
      UUID: 'journal-1', parent: 'p1', title: 'Recorded note', inGameTimestamp: DAY + 10,
    }],
    [STORES.event]: [],
    [STORES.transaction]: [],
    [STORES.contribution]: [],
    [STORES.match]: [],
    [STORES.profileSummary]: [{
      UUID: 'p1',
      recentMatches: [{
        UUID: 'match-1', status: 'complete', participantUUIDs: ['p1'], completedInGameTimestamp: DAY + 30,
      }],
    }],
  };
  const service = new ProfileDaybookQueryService(makeFacade(records));
  const page = await service.getProfileDaybookPage({
    profileId: 'p1',
    viewerIGT: 2 * DAY,
    dayLimit: 1,
  });

  assert.equal(page.chapters.length, 1);
  assert.deepEqual(page.entries.map((entry) => entry.UUID), [
    'match-1',
    'visible-task',
    'journal-1',
  ]);
  assert.equal(page.entries.some((entry) => entry.UUID === 'future-task'), false);
  assert.equal(page.entries.find((entry) => entry.UUID === 'visible-task').durationMs, 25 * MINUTE);
  assert.equal(page.chapters[0].totals.points, 100);
  assert.equal(page.chapters[0].totals.activeMs, 25 * MINUTE);
  assert.equal(page.chapters[0].totals.matches, 1);
});

test('query uses loaded match history when available but deduplicates summary matches', async () => {
  const match = {
    UUID: 'match-1',
    status: 'complete',
    participantSnapshot: { participants: [{ UUID: 'p1' }] },
    completedInGameTimestamp: 100,
  };
  const emptyStores = {
    [STORES.task]: [],
    [STORES.taskCompletionEvent]: [],
    [STORES.journal]: [],
    [STORES.event]: [],
    [STORES.transaction]: [],
    [STORES.contribution]: [],
    [STORES.match]: [match],
    [STORES.profileSummary]: [{ UUID: 'p1', recentMatches: [match] }],
  };
  const service = new ProfileDaybookQueryService(makeFacade(emptyStores, new Set(['matches'])));
  const page = await service.getProfileDaybookPage({ profileId: 'p1', viewerIGT: 1_000 });
  assert.deepEqual(page.entries.map((entry) => entry.UUID), ['match-1']);
});

test('query adds one explicit rank-change entry without double-counting chapter movement', async () => {
  const match = {
    UUID: 'match-ranked',
    parent: 'p1',
    status: 'complete',
    participantSnapshot: { participants: [{ UUID: 'p1' }] },
    completedInGameTimestamp: 100,
    result: { eloChange: 25, oldElo: 900, newElo: 925 },
  };
  const stores = {
    [STORES.task]: [], [STORES.taskCompletionEvent]: [], [STORES.journal]: [],
    [STORES.event]: [], [STORES.transaction]: [], [STORES.contribution]: [],
    [STORES.match]: [match], [STORES.profileSummary]: [],
  };
  const service = new ProfileDaybookQueryService(makeFacade(stores, new Set(['matches'])));
  const page = await service.getProfileDaybookPage({ profileId: 'p1', viewerIGT: 1_000 });
  const rank = page.entries.find((entry) => entry.type === 'rank');
  assert.equal(rank.rankDelta, 25);
  assert.equal(rank.oldElo, 900);
  assert.equal(rank.newElo, 925);
  assert.equal(page.chapters[0].rankMovement, 25);
});
