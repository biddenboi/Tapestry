const RUNTIME_KEY = '__tapestryRuntimePerformance';
const RUNTIME_VERSION = 1;
const LONG_TASK_THRESHOLD_MS = 50;
const MAX_WORK_RECORDS = 200;
const MAX_LONG_TASKS = 100;
let observer = null;
let memoryState = null;

function monotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function createState() {
  return {
    version: RUNTIME_VERSION,
    startedAt: monotonicNow(),
    work: [],
    longTasks: [],
    longTaskSupported: false,
  };
}

function state() {
  if (typeof window === 'undefined') {
    memoryState ||= createState();
    return memoryState;
  }
  if (!window[RUNTIME_KEY] || window[RUNTIME_KEY].version !== RUNTIME_VERSION) {
    window[RUNTIME_KEY] = createState();
  }
  return window[RUNTIME_KEY];
}

function boundedPush(list, value, limit) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function recordObservedLongTasks(entries = []) {
  const current = state();
  for (const entry of entries) {
    const durationMs = Math.max(0, Number(entry.duration || 0));
    boundedPush(current.longTasks, {
      recordedAt: new Date().toISOString(),
      startTimeMs: Number(entry.startTime || 0),
      durationMs: Math.round(durationMs * 10) / 10,
      blockingTimeMs: Math.round(Math.max(0, durationMs - LONG_TASK_THRESHOLD_MS) * 10) / 10,
      name: entry.name || 'longtask',
    }, MAX_LONG_TASKS);
  }
}

export function initializeRuntimePerformance() {
  const current = state();
  if (!observer && typeof PerformanceObserver !== 'undefined') {
    const supported = !Array.isArray(PerformanceObserver.supportedEntryTypes)
      || PerformanceObserver.supportedEntryTypes.includes('longtask');
    current.longTaskSupported = supported;
    if (supported) {
      try {
        observer = new PerformanceObserver((list) => recordObservedLongTasks(list.getEntries()));
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        current.longTaskSupported = false;
        observer = null;
      }
    }
  }
  if (typeof window !== 'undefined') {
    window.__tapestryRuntimePerformanceSummary = () => summarizeRuntimePerformance();
  }
  return current;
}

export function resetRuntimePerformance() {
  observer?.disconnect?.();
  observer = null;
  memoryState = createState();
  if (typeof window !== 'undefined') window[RUNTIME_KEY] = createState();
  return initializeRuntimePerformance();
}

export function recordRuntimeWork(label, durationMs, {
  category = 'runtime',
  background = false,
  metadata = null,
} = {}) {
  const duration = Math.max(0, Number(durationMs) || 0);
  const entry = {
    recordedAt: new Date().toISOString(),
    label: String(label || 'work'),
    category: String(category || 'runtime'),
    background: Boolean(background),
    durationMs: Math.round(duration * 10) / 10,
    exceededLongTaskBudget: duration > LONG_TASK_THRESHOLD_MS,
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : null,
  };
  boundedPush(state().work, entry, MAX_WORK_RECORDS);
  return entry;
}

export async function measureRuntimeWork(label, operation, options = {}) {
  if (typeof operation !== 'function') throw new TypeError('Runtime work measurement requires a function.');
  const startedAt = monotonicNow();
  try {
    return await operation();
  } finally {
    recordRuntimeWork(label, monotonicNow() - startedAt, options);
  }
}

export function summarizeRuntimePerformance(input = state()) {
  const background = input.work.filter((entry) => entry.background);
  const longWork = input.work.filter((entry) => entry.exceededLongTaskBudget);
  return {
    version: input.version,
    measuredWorkCount: input.work.length,
    backgroundWorkCount: background.length,
    longestWorkMs: Math.max(0, ...input.work.map((entry) => Number(entry.durationMs || 0))),
    longMeasuredWorkCount: longWork.length,
    longTaskMeasurementSupported: input.longTaskSupported,
    observedLongTasks: input.longTasks.length,
    observedBlockingTimeMs: Math.round(input.longTasks.reduce((sum, entry) => sum + entry.blockingTimeMs, 0) * 10) / 10,
    recentWork: input.work.slice(-25),
    recentLongTasks: input.longTasks.slice(-25),
  };
}

initializeRuntimePerformance();
