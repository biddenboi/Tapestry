export const RESIDENT_GUARDRAIL_REASON = Object.freeze({
  capacityViolation: 'capacity-violation',
  dataLeak: 'resident-familiar-data-leak',
  crossTimeViolation: 'aligned-cross-time-violation',
  profileBypass: 'stranger-profile-bypass',
  privacyWithdrawalFailure: 'privacy-withdrawal-failure',
  candidateLatency: 'candidate-latency',
  occupantChurn: 'occupant-churn',
  safetyRate: 'block-report-rate',
});

const CRITICAL_FIELDS = Object.freeze([
  ['confirmedCapacityViolation', RESIDENT_GUARDRAIL_REASON.capacityViolation],
  ['confirmedDataLeak', RESIDENT_GUARDRAIL_REASON.dataLeak],
  ['confirmedCrossTimeViolation', RESIDENT_GUARDRAIL_REASON.crossTimeViolation],
  ['confirmedProfileBypass', RESIDENT_GUARDRAIL_REASON.profileBypass],
  ['confirmedPrivacyWithdrawalFailure', RESIDENT_GUARDRAIL_REASON.privacyWithdrawalFailure],
]);

export function evaluateResidentRolloutGuardrails(metrics = {}, {
  approvedBlockReportRate = 0,
} = {}) {
  const reasons = [];
  let killSwitchRequired = false;
  for (const [field, reason] of CRITICAL_FIELDS) {
    if (metrics[field] === true) {
      reasons.push(reason);
      killSwitchRequired = true;
    }
  }
  if (Number(metrics.candidateP95Ms) > 250
      && Number(metrics.candidateLatencyViolationDurationMs) >= 30 * 60_000) {
    reasons.push(RESIDENT_GUARDRAIL_REASON.candidateLatency);
  }
  if (Number(metrics.maxOccupantChangesPerSlotFiveMinutes) > 2) {
    reasons.push(RESIDENT_GUARDRAIL_REASON.occupantChurn);
  }
  if (Number(metrics.blockReportRate) > Number(approvedBlockReportRate)) {
    reasons.push(RESIDENT_GUARDRAIL_REASON.safetyRate);
  }
  return Object.freeze({
    passes: reasons.length === 0,
    stopAdvancement: reasons.length > 0,
    action: killSwitchRequired ? 'global-kill-switch' : reasons.length ? 'disable-rendering' : 'none',
    reasons: Object.freeze(reasons),
  });
}

export async function enforceResidentRolloutGuardrails(metrics = {}, {
  approvedBlockReportRate = 0,
  applyFlags = null,
  flagStore = null,
  onDiagnostic = null,
  source = 'resident-rollout-guardrail',
} = {}) {
  const evaluation = evaluateResidentRolloutGuardrails(metrics, { approvedBlockReportRate });
  if (!evaluation.stopAdvancement) return Object.freeze({ evaluation, snapshot: null });
  const snapshot = flagStore?.getSnapshot?.() || null;
  const flags = evaluation.action === 'global-kill-switch'
    ? { residentGlobalKillSwitch: true, residentRenderingEnabled: false }
    : { residentRenderingEnabled: false };
  const metadata = {
    version: Math.max(1, Math.trunc(Number(snapshot?.version) || 0) + 1),
    source,
  };
  onDiagnostic?.(Object.freeze({
    severity: evaluation.action === 'global-kill-switch' ? 'critical' : 'high',
    code: 'resident-rollout-halted',
    action: evaluation.action,
    reasons: evaluation.reasons,
  }));
  const applied = typeof applyFlags === 'function'
    ? await applyFlags(flags, metadata)
    : flagStore?.applyRemoteSnapshot?.(flags, metadata) || null;
  return Object.freeze({ evaluation, snapshot: applied?.snapshot || applied });
}
