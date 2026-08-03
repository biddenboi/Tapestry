import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAdvanceResidentRollout,
  evaluateResidentRollout,
  RESIDENT_ROLLOUT_STAGE,
} from './ResidentRolloutPolicy.js';
import {
  enforceResidentRolloutGuardrails,
  evaluateResidentRolloutGuardrails,
} from './ResidentRolloutGuardrails.js';

test('shadow resolution never enables rendering and internal rendering stays internal', () => {
  const shadow = evaluateResidentRollout({
    stage: RESIDENT_ROLLOUT_STAGE.shadowInternal,
    accountId: 'internal-1',
    internalAccount: true,
  });
  assert.equal(shadow.flags.residentResolutionEnabled, true);
  assert.equal(shadow.flags.residentRenderingEnabled, false);
  assert.equal(shadow.flags.residentFullLiveEnabled, true);
  assert.equal(shadow.flags.residentAlignedEnabled, true);
  const external = evaluateResidentRollout({
    stage: RESIDENT_ROLLOUT_STAGE.internalRendering,
    accountId: 'external-1',
  });
  assert.equal(external.flags.residentResolutionEnabled, false);
});

test('guardrail enforcement applies a sanitized automatic stop through the rollout boundary', async () => {
  const calls = [];
  const diagnostics = [];
  const result = await enforceResidentRolloutGuardrails({ confirmedProfileBypass: true }, {
    applyFlags: async (...args) => { calls.push(args); return { snapshot: { version: 4 } }; },
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  assert.deepEqual(calls[0][0], {
    residentGlobalKillSwitch: true,
    residentRenderingEnabled: false,
  });
  assert.equal(diagnostics[0].severity, 'critical');
  assert.equal(result.snapshot.version, 4);
});

test('cohort assignment is deterministic and never enables launch-disabled content flags', () => {
  const first = evaluateResidentRollout({ stage: RESIDENT_ROLLOUT_STAGE.betaFivePercent, accountId: 'p1' });
  const second = evaluateResidentRollout({ stage: RESIDENT_ROLLOUT_STAGE.betaFivePercent, accountId: 'p1' });
  assert.deepEqual(first, second);
  assert.equal(first.flags.residentPublicObjectiveEnabled, false);
  assert.equal(first.flags.residentGenericActiveEnabled, false);
});

test('advancement enforces order, dwell time, guardrails, and final sign-off', () => {
  const started = Date.parse('2026-07-10T00:00:00Z');
  assert.equal(canAdvanceResidentRollout({
    currentStage: RESIDENT_ROLLOUT_STAGE.betaFivePercent,
    nextStage: RESIDENT_ROLLOUT_STAGE.cohortTwentyFivePercent,
    stageStartedAt: started,
    now: started + 24 * 60 * 60_000,
    guardrailsPassing: true,
  }), true);
  assert.equal(canAdvanceResidentRollout({
    currentStage: RESIDENT_ROLLOUT_STAGE.cohortTwentyFivePercent,
    nextStage: RESIDENT_ROLLOUT_STAGE.full,
    stageStartedAt: started,
    now: started + 72 * 60 * 60_000,
    guardrailsPassing: true,
    finalSignoff: false,
  }), false);
});

test('critical violations demand the kill switch while sustained operational failures disable rendering', () => {
  assert.equal(evaluateResidentRolloutGuardrails({ confirmedDataLeak: true }).action, 'global-kill-switch');
  const latency = evaluateResidentRolloutGuardrails({
    candidateP95Ms: 251,
    candidateLatencyViolationDurationMs: 30 * 60_000,
  });
  assert.equal(latency.action, 'disable-rendering');
  assert.equal(latency.stopAdvancement, true);
  assert.equal(evaluateResidentRolloutGuardrails({
    candidateP95Ms: 251,
    candidateLatencyViolationDurationMs: 29 * 60_000,
  }).passes, true);
});
