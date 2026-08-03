import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatchHighlights } from './MatchHighlights.js';

test('match highlights preserve and order recorded match-relative event times', () => {
  const highlights = buildMatchHighlights({
    match: {
      createdAt: '2026-07-10T00:00:00.000Z',
      teams: [[{ UUID: 'p1', username: 'Sophia' }], [{ UUID: 'p2', username: 'Quinten' }]],
    },
    finalScores: { p1: 300, p2: 100 },
    currentPlayerUUID: 'p1',
    eventHistory: [
      {
        id: 'older',
        type: 'endgame_pressure',
        severity: 'warning',
        message: 'Endgame.',
        matchElapsedMs: 90_000,
        timelineAt: '2026-07-10T00:01:30.000Z',
      },
      {
        id: 'newer',
        type: 'lead_change',
        severity: 'success',
        message: 'Lead changed.',
        matchElapsedMs: 135_250,
        timelineAt: '2026-07-10T00:02:15.250Z',
      },
      {
        id: 'legacy',
        type: 'match_update',
        message: 'No recorded match time.',
      },
    ],
  });

  assert.deepEqual(
    highlights.notableEvents.map((event) => event.id),
    ['newer', 'older', 'legacy'],
  );
  assert.equal(highlights.notableEvents[0].matchElapsedMs, 135_250);
  assert.equal(highlights.notableEvents[0].timelineAt, '2026-07-10T00:02:15.250Z');
  assert.equal(highlights.notableEvents[2].matchElapsedMs, null);
});
