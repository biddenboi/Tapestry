export const SOCIAL_WORLD_PERFORMANCE_EVENT = 'tapestry:social-world-performance';

export const SOCIAL_WORLD_PERFORMANCE_OPERATION = Object.freeze({
  sceneQuery: 'scene-query',
  profileDaybookPage: 'profile-daybook-page',
  dynamicCast: 'dynamic-cast',
  encounterDelta: 'encounter-delta',
  dojoAround: 'dojo-around',
  activityRebuild: 'activity-rebuild',
  startupRead: 'startup-read',
  longTask: 'long-task',
});

export const SOCIAL_WORLD_PERFORMANCE_BUDGETS = Object.freeze({
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.sceneQuery]: Object.freeze({ p50Ms: 45, p95Ms: 100, maxRows: 25 }),
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.profileDaybookPage]: Object.freeze({ p50Ms: 45, p95Ms: 100, maxDays: 31 }),
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.dynamicCast]: Object.freeze({ p50Ms: 35, p95Ms: 75, maxCandidates: 200 }),
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.encounterDelta]: Object.freeze({ p50Ms: 45, p95Ms: 100, maxFacts: 24 }),
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.dojoAround]: Object.freeze({ p50Ms: 35, p95Ms: 75, aroundRadius: 5, topLimit: 25 }),
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.activityRebuild]: Object.freeze({ p50Ms: 120, p95Ms: 250, subjectCount: 1 }),
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.startupRead]: Object.freeze({ p50Ms: 45, p95Ms: 100, maxPrimaryReads: 12 }),
  [SOCIAL_WORLD_PERFORMANCE_OPERATION.longTask]: Object.freeze({ p50Ms: 0, p95Ms: 50, maxDurationMs: 50 }),
});

function clockNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function emitSample(sample, onSample) {
  onSample?.(sample);
  if (typeof window === 'undefined'
      || typeof window.dispatchEvent !== 'function'
      || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SOCIAL_WORLD_PERFORMANCE_EVENT, { detail: sample }));
}

export async function measureSocialWorldOperation(operation, work, {
  metadata = null,
  onSample = null,
  now = clockNow,
} = {}) {
  if (!SOCIAL_WORLD_PERFORMANCE_BUDGETS[operation]) {
    throw new Error(`Unknown social-world performance operation: ${operation}`);
  }
  const startedAt = now();
  let status = 'ok';
  try {
    return await work();
  } catch (error) {
    status = 'error';
    throw error;
  } finally {
    const preparedMetadata = typeof metadata === 'function' ? metadata() : metadata;
    emitSample(Object.freeze({
      operation,
      durationMs: Math.max(0, now() - startedAt),
      status,
      budgetP95Ms: SOCIAL_WORLD_PERFORMANCE_BUDGETS[operation].p95Ms,
      metadata: preparedMetadata,
    }), onSample);
  }
}

export function percentile(samples = [], value = 0.95) {
  const sorted = (samples || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1));
  return sorted[index];
}

export function evaluateSocialWorldPerformance(operation, durations = []) {
  const budget = SOCIAL_WORLD_PERFORMANCE_BUDGETS[operation];
  if (!budget) throw new Error(`Unknown social-world performance operation: ${operation}`);
  const p50Ms = percentile(durations, 0.5);
  const p95Ms = percentile(durations, 0.95);
  return Object.freeze({
    operation,
    p50Ms,
    p95Ms,
    passes: p95Ms != null && p95Ms <= budget.p95Ms,
    budget,
  });
}
