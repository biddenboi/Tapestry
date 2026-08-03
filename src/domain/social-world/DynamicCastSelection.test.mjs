import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DYNAMIC_CAST_ALGORITHM_VERSION,
  DYNAMIC_CAST_RESIDENCE_IGT_MS,
  MAX_HORIZON_BAND_GAP,
  buildDynamicCastReview,
  inspectDynamicCastIncumbents,
  isDynamicCastReviewDue,
} from './DynamicCastSelection.js';

const viewer = {
  id: 'viewer', elo: 500, completedTaskCount: 4,
  explicitGoals: ['Writing'], actionKinds: ['manual'],
};

function candidate(id, elo, overrides = {}) {
  return {
    id,
    elo,
    completedTaskCount: 4,
    completedMatchCount: 0,
    explicitGoals: ['Writing'],
    actionKinds: ['manual'],
    ...overrides,
  };
}

test('selects distinct Near-peer and Horizon roles through ordered constraints', () => {
  const result = buildDynamicCastReview({
    viewer,
    candidates: [
      candidate('near-behind', 490),
      candidate('near-ahead', 510),
      candidate('horizon', 550, { explicitGoals: ['Fitness'], actionKinds: ['dojo', 'match'] }),
    ],
    viewerIGT: 1_000,
    reviewReason: 'initial',
  });
  assert.deepEqual(result.assignments.map(({ role, subjectId }) => [role, subjectId]), [
    ['near-peer', 'near-ahead'],
    ['horizon', 'horizon'],
  ]);
  assert.equal(result.review.reviewAfterIGT, 1_000 + DYNAMIC_CAST_RESIDENCE_IGT_MS);
  assert.equal(result.review.diagnostics.policy, 'ordered-role-constraints-no-composite-score');
  assert.equal(result.assignments[1].evidence.reasonCodes.includes('action-mix-broadens-cast'), true);
});

test('valid incumbents survive a small rank change and retain their original assignment boundary', () => {
  const candidates = [
    candidate('near', 510),
    candidate('horizon', 610, { explicitGoals: ['Fitness'], actionKinds: ['dojo', 'match'] }),
    candidate('new-near', 535),
  ];
  const incumbents = [
    { role: 'near-peer', subjectId: 'near', algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION, assignedAtIGT: 10, reviewAfterIGT: 20 },
    { role: 'horizon', subjectId: 'horizon', algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION, assignedAtIGT: 10, reviewAfterIGT: 20 },
  ];
  const result = buildDynamicCastReview({
    viewer: { ...viewer, elo: 530 },
    candidates,
    incumbents,
    viewerIGT: 20,
  });
  assert.deepEqual(result.assignments.map(({ subjectId }) => subjectId), ['near', 'horizon']);
  assert.deepEqual(result.assignments.map(({ assignedAtIGT }) => assignedAtIGT), [10, 10]);
  assert.equal(result.assignments.every((entry) => entry.evidence.decision === 'incumbent-retained'), true);
});

test('friends, unavailable profiles, and candidates without interpretable history are excluded', () => {
  const result = buildDynamicCastReview({
    viewer,
    friendIds: ['friend'],
    candidates: [
      candidate('friend', 510),
      candidate('empty-history', 505, { completedTaskCount: 0, explicitGoals: [], actionKinds: [] }),
      candidate('archived', 510, { archivedAt: '2026-07-14T00:00:00.000Z' }),
      candidate('eligible-near', 500),
    ],
    viewerIGT: 5,
  });
  assert.deepEqual(result.assignments.map(({ subjectId }) => subjectId), ['eligible-near']);
  assert.equal(result.review.diagnostics.excluded.friend, 1);
  assert.equal(result.review.diagnostics.excluded['insufficient-history'], 1);
  assert.equal(result.review.diagnostics.excluded['unavailable-profile'], 1);
  assert.deepEqual(result.review.diagnostics.vacantRoles, ['horizon']);
});

test('stable identity ordering resolves otherwise identical ties', () => {
  const result = buildDynamicCastReview({
    viewer,
    candidates: [candidate('zeta', 510), candidate('alpha', 510)],
    viewerIGT: 5,
  });
  assert.equal(result.assignments.find((entry) => entry.role === 'near-peer').subjectId, 'alpha');
});

test('a far-away high-Elo profile cannot fill Horizon outside the attainable band', () => {
  const result = buildDynamicCastReview({
    viewer,
    candidates: [
      candidate('near', 510),
      candidate('far-horizon', 3_500, { completedMatchCount: 100, actionKinds: ['match', 'dojo'] }),
    ],
    viewerIGT: 5,
  });
  assert.equal(MAX_HORIZON_BAND_GAP, 3);
  assert.equal(result.assignments.some((entry) => entry.role === 'horizon'), false);
});

test('incumbent inspection identifies friendship and role invalidation without choosing replacements', () => {
  const inspection = inspectDynamicCastIncumbents({
    viewer,
    friendIds: ['near'],
    candidates: [candidate('near', 510), candidate('too-far', 900)],
    incumbents: [
      { role: 'near-peer', subjectId: 'near', algorithmVersion: 1 },
      { role: 'horizon', subjectId: 'too-far', algorithmVersion: 1 },
    ],
  });
  assert.deepEqual(inspection.invalid.map(({ role, reason }) => [role, reason]), [
    ['near-peer', 'friend'],
    ['horizon', 'role-invalid'],
  ]);
});

test('review cadence is versioned and uses an inclusive boundary', () => {
  const review = { algorithmVersion: DYNAMIC_CAST_ALGORITHM_VERSION, reviewAfterIGT: 100 };
  assert.equal(isDynamicCastReviewDue(review, 99), false);
  assert.equal(isDynamicCastReviewDue(review, 100), true);
  assert.equal(isDynamicCastReviewDue({ ...review, algorithmVersion: 99 }, 1), true);
  assert.equal(isDynamicCastReviewDue(null, 1), true);
});
