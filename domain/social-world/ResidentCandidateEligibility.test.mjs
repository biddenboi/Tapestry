import assert from 'node:assert/strict';
import test from 'node:test';
import { RESIDENT_TIME_BASIS } from './ResidentSubstitutionContracts.js';
import {
  RESIDENT_CANDIDATE_REJECTION,
  evaluateResidentCandidate,
} from './ResidentCandidateEligibility.js';

const NOW = new Date('2026-07-14T21:00:00.000Z').getTime();

function baseEnvelope(patch = {}) {
  return {
    profileId: 'candidate',
    identity: {
      profileId: 'candidate', username: 'Avery', profilePicture: null,
      title: null, frame: null, theme: null,
    },
    eligibilityDecision: 'allow',
    eligibilityVersion: 'eligibility-v1',
    outboundConsent: true,
    safetyDecision: 'allow',
    evidenceId: 'evidence-1',
    activity: {
      category: 'task-session',
      startedAt: new Date(NOW - 19 * 60_000).toISOString(),
    },
    timeBasis: RESIDENT_TIME_BASIS.liveWallClock,
    observedAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + 10_000).toISOString(),
    validFromIGT: null,
    validThroughIGT: null,
    provenance: 'exact',
    profileAccessToken: 'opaque-token',
    ...patch,
  };
}

function evaluate(patch = {}) {
  return evaluateResidentCandidate({
    envelope: baseEnvelope(),
    viewerId: 'viewer',
    primaryFamiliarIds: [],
    selectedProfileIds: [],
    ordinaryPublicProfileAvailable: true,
    outboundEnabled: true,
    canonicalSafetyDecision: 'allow',
    blockedEitherDirection: false,
    account: {},
    expectedTimeBasis: RESIDENT_TIME_BASIS.liveWallClock,
    nowMs: NOW,
    ...patch,
  });
}

test('eligible envelopes reduce to the activity-only internal candidate model', () => {
  const result = evaluate({ envelope: baseEnvelope({
    objective: 'secret objective',
    taskName: 'secret task',
    projectName: 'secret project',
    sourceId: 'secret source',
  }) });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.diagnostics.map((item) => item.field), [
    'objective', 'taskName', 'projectName', 'sourceId',
  ]);
  assert.equal(result.diagnostics.every((item) => item.redacted), true);
  assert.equal(result.candidate.activity.category, 'task-session');
  assert.equal(result.candidate.elapsedHere, 19 * 60_000);
  for (const field of ['objective', 'taskName', 'projectName', 'sourceId']) {
    assert.equal(Object.hasOwn(result.candidate, field), false);
  }
  assert.equal(Object.isFrozen(result.candidate), true);
});

test('hard eligibility checks fail closed in the documented order', () => {
  const cases = [
    ['identity', { envelope: baseEnvelope({ identity: null }) }, RESIDENT_CANDIDATE_REJECTION.identityUnavailable],
    ['profile', { ordinaryPublicProfileAvailable: false }, RESIDENT_CANDIDATE_REJECTION.profileUnavailable],
    ['self', { viewerId: 'candidate' }, RESIDENT_CANDIDATE_REJECTION.viewerIdentity],
    ['familiar', { primaryFamiliarIds: ['candidate'] }, RESIDENT_CANDIDATE_REJECTION.primaryFamiliar],
    ['duplicate', { selectedProfileIds: ['candidate'] }, RESIDENT_CANDIDATE_REJECTION.duplicateOccupant],
    ['consent', { outboundEnabled: false }, RESIDENT_CANDIDATE_REJECTION.outboundDisabled],
    ['safety', { canonicalSafetyDecision: 'deny' }, RESIDENT_CANDIDATE_REJECTION.safetyDenied],
    ['block', { blockedEitherDirection: true }, RESIDENT_CANDIDATE_REJECTION.blocked],
    ['account', { account: { suspended: true } }, RESIDENT_CANDIDATE_REJECTION.accountIneligible],
    ['activity', { envelope: baseEnvelope({ activity: { category: 'commons' } }) }, RESIDENT_CANDIDATE_REJECTION.activityIneligible],
    ['time basis', { expectedTimeBasis: RESIDENT_TIME_BASIS.viewerIGT }, RESIDENT_CANDIDATE_REJECTION.timeBasisMismatch],
    ['expiry', { envelope: baseEnvelope({ expiresAt: new Date(NOW).toISOString() }) }, RESIDENT_CANDIDATE_REJECTION.evidenceExpired],
    ['provenance', { envelope: baseEnvelope({ evidenceId: '' }) }, RESIDENT_CANDIDATE_REJECTION.provenanceMissing],
  ];
  for (const [label, patch, reason] of cases) {
    assert.equal(evaluate(patch).reasonCode, reason, label);
  }
});

test('aligned evidence must exactly cover the viewer in-game time', () => {
  const aligned = baseEnvelope({
    timeBasis: RESIDENT_TIME_BASIS.viewerIGT,
    observedAt: null,
    validFromIGT: 100,
    validThroughIGT: 200,
  });
  assert.equal(evaluate({
    envelope: aligned,
    expectedTimeBasis: RESIDENT_TIME_BASIS.viewerIGT,
    viewerIGT: 150,
  }).eligible, true);
  assert.equal(evaluate({
    envelope: aligned,
    expectedTimeBasis: RESIDENT_TIME_BASIS.viewerIGT,
    viewerIGT: 200,
  }).reasonCode, RESIDENT_CANDIDATE_REJECTION.evidenceExpired);
  assert.equal(evaluate({
    envelope: aligned,
    expectedTimeBasis: RESIDENT_TIME_BASIS.viewerIGT,
    viewerIGT: 201,
  }).reasonCode, RESIDENT_CANDIDATE_REJECTION.evidenceExpired);
});
