import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyResidentOccupancyError,
  RESIDENT_OCCUPANCY_FAILURE,
  RESIDENT_OCCUPANCY_FALLBACK,
  resolveResidentOccupancyFailure,
} from './ResidentOccupancyFailurePolicy.js';

test('every Batch 9 failure has one immutable deterministic fallback', () => {
  for (const reason of Object.values(RESIDENT_OCCUPANCY_FAILURE)) {
    const policy = resolveResidentOccupancyFailure(reason);
    assert.equal(Object.isFrozen(policy), true, reason);
    assert.equal(Object.values(RESIDENT_OCCUPANCY_FALLBACK).includes(policy.fallback), true, reason);
  }
  assert.equal(
    resolveResidentOccupancyFailure(RESIDENT_OCCUPANCY_FAILURE.publicProfileUnavailable).controlsRemainEnabled,
    true,
  );
  assert.equal(
    resolveResidentOccupancyFailure(RESIDENT_OCCUPANCY_FAILURE.friendCapacityReached).fallback,
    RESIDENT_OCCUPANCY_FALLBACK.preserveOccupancy,
  );
});

test('gateway failures fail closed while partial supply keeps only resolvable residents', () => {
  for (const reason of [
    RESIDENT_OCCUPANCY_FAILURE.gatewayTimeout,
    RESIDENT_OCCUPANCY_FAILURE.gatewayUnavailable,
    RESIDENT_OCCUPANCY_FAILURE.malformedResponse,
  ]) {
    assert.equal(resolveResidentOccupancyFailure(reason).fallback, RESIDENT_OCCUPANCY_FALLBACK.primaryAll);
    assert.equal(resolveResidentOccupancyFailure(reason).clearVisibleResidents, true);
  }
  assert.equal(
    resolveResidentOccupancyFailure(RESIDENT_OCCUPANCY_FAILURE.partialSupply).fallback,
    RESIDENT_OCCUPANCY_FALLBACK.primaryUnfilled,
  );
});

test('request errors normalize without leaking raw gateway details', () => {
  assert.equal(
    classifyResidentOccupancyError(Object.assign(new Error('late'), { code: 'resident-candidate-timeout' })),
    RESIDENT_OCCUPANCY_FAILURE.gatewayTimeout,
  );
  assert.equal(
    classifyResidentOccupancyError(new TypeError('private malformed detail')),
    RESIDENT_OCCUPANCY_FAILURE.malformedResponse,
  );
  assert.equal(
    classifyResidentOccupancyError(new Error('network address')),
    RESIDENT_OCCUPANCY_FAILURE.gatewayUnavailable,
  );
});
