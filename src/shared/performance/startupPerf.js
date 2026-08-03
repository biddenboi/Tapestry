const STARTUP_KEY = '__tapestryStartup';
const STARTUP_VERSION = 3;
const LONG_TASK_THRESHOLD_MS = 50;


export const STARTUP_READ_BUDGET = Object.freeze({
  maxReads: 8,
  maxRecords: 64,
  maxHydratedStores: 4,
  allowedStores: Object.freeze(['players', 'appSettings', 'reminders', 'profileSummaries']),
});

export function evaluateStartupReadBudget(input = {}) {
  const totalReads = Number(input.startupDatabaseReads ?? input.databaseReads?.total ?? 0) || 0;
  const recordsRead = Number(input.startupDatabaseRecordsRead ?? input.databaseReads?.records ?? 0) || 0;
  const byStore = input.startupDatabaseReadsByStore || input.databaseReads?.byStore || {};
  const hydrationSnapshots = input.hydrationSnapshots || input.storeHydrations || [];
  const hydratedStores = new Set();
  for (const snapshot of hydrationSnapshots) {
    for (const store of Object.keys(snapshot?.stores || {})) hydratedStores.add(store);
  }
  const unexpectedStores = Object.keys(byStore)
    .filter((store) => !STARTUP_READ_BUDGET.allowedStores.includes(store))
    .sort();
  const violations = [];
  if (totalReads > STARTUP_READ_BUDGET.maxReads) violations.push(`reads:${totalReads}>${STARTUP_READ_BUDGET.maxReads}`);
  if (recordsRead > STARTUP_READ_BUDGET.maxRecords) violations.push(`records:${recordsRead}>${STARTUP_READ_BUDGET.maxRecords}`);
  if (hydratedStores.size > STARTUP_READ_BUDGET.maxHydratedStores) {
    violations.push(`hydrated-stores:${hydratedStores.size}>${STARTUP_READ_BUDGET.maxHydratedStores}`);
  }
  if (unexpectedStores.length) violations.push(`unexpected-stores:${unexpectedStores.join(',')}`);
  return {
    passed: violations.length === 0,
    violations,
    totalReads,
    recordsRead,
    hydratedStoreCount: hydratedStores.size,
    unexpectedStores,
    budget: STARTUP_READ_BUDGET,
  };
}

let longTaskObserver = null;

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function runtimeWindow() {
  return typeof window === 'undefined' ? null : window;
}

function createStartupState(startedAt = now()) {
  return {
    version: STARTUP_VERSION,
    startedAt,
    startedAtEpoch: Date.now(),
    marks: [],
    milestones: {},
    panelLoads: [],
    databaseReads: {
      total: 0,
      records: 0,
      byStore: {},
    },
    storeHydrations: [],
    modules: {
      staticRegistered: [],
      resourceSnapshots: [],
      dynamicLoads: [],
    },
    mainThreadBlocking: {
      supported: false,
      thresholdMs: LONG_TASK_THRESHOLD_MS,
      tasks: [],
    },
  };
}

function ensureStartupState() {
  const target = runtimeWindow();
  if (!target) return null;
  const current = target[STARTUP_KEY];
  if (!current || current.version !== STARTUP_VERSION) {
    target[STARTUP_KEY] = createStartupState();
  }
  return target[STARTUP_KEY];
}

function relativeTime(state, absoluteTime = now()) {
  return Math.max(0, Math.round((absoluteTime - state.startedAt) * 10) / 10);
}

function isJavaScriptResource(entry) {
  const name = String(entry?.name || '');
  return /\.(?:[cm]?js|jsx|tsx?)(?:$|[?#])/.test(name)
    || entry?.initiatorType === 'script';
}

function moduleResourceNames() {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return [];
  }
  return [...new Set(
    performance.getEntriesByType('resource')
      .filter(isJavaScriptResource)
      .map((entry) => entry.name)
      .filter(Boolean),
  )].sort();
}

function recordLongTasks(entries = []) {
  const state = ensureStartupState();
  if (!state) return;
  for (const entry of entries) {
    const duration = Math.round(Number(entry.duration || 0) * 10) / 10;
    state.mainThreadBlocking.tasks.push({
      t: relativeTime(state, Number(entry.startTime || now())),
      duration,
      blockingTime: Math.max(0, Math.round((duration - LONG_TASK_THRESHOLD_MS) * 10) / 10),
      name: entry.name || 'longtask',
    });
  }
}

function stopLongTaskObserver() {
  if (!longTaskObserver) return;
  try {
    recordLongTasks(longTaskObserver.takeRecords?.() || []);
    longTaskObserver.disconnect();
  } finally {
    longTaskObserver = null;
  }
}

function installLongTaskObserver() {
  const state = ensureStartupState();
  if (!state || longTaskObserver || typeof PerformanceObserver === 'undefined') return;
  const supported = !Array.isArray(PerformanceObserver.supportedEntryTypes)
    || PerformanceObserver.supportedEntryTypes.includes('longtask');
  state.mainThreadBlocking.supported = supported;
  if (!supported) return;

  try {
    longTaskObserver = new PerformanceObserver((list) => recordLongTasks(list.getEntries()));
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    state.mainThreadBlocking.supported = false;
    longTaskObserver = null;
  }
}

export function initializeStartupMeasurement() {
  const state = ensureStartupState();
  if (!state) return null;
  installLongTaskObserver();
  const target = runtimeWindow();
  target.__tapestryStartupSummary = () => summarizeStartupMetrics(target[STARTUP_KEY]);
  return state;
}

export function resetStartupMarks() {
  const target = runtimeWindow();
  if (!target) return;
  stopLongTaskObserver();
  target[STARTUP_KEY] = createStartupState();
  installLongTaskObserver();
  registerStaticModule('shared/performance/startupPerf');
  markStartup('reset');
}

export function markStartup(name, detail = {}) {
  const state = ensureStartupState();
  if (!state || !name) return;
  const t = relativeTime(state);
  state.marks.push({ name, t, detail });
  try {
    performance?.mark?.(`tapestry:${name}`);
  } catch {
    // Performance marks are diagnostic only.
  }
}

export function markStartupMilestone(name, detail = {}) {
  const state = ensureStartupState();
  if (!state || !name || state.milestones[name]) return state?.milestones?.[name] || null;
  const milestone = { t: relativeTime(state), detail };
  state.milestones[name] = milestone;
  markStartup(`${name}-ready`, detail);
  return milestone;
}

export function registerStaticModule(name) {
  const state = ensureStartupState();
  if (!state || !name || state.modules.staticRegistered.includes(name)) return;
  state.modules.staticRegistered.push(name);
}

export function captureModuleResources(stage) {
  const state = ensureStartupState();
  if (!state || !stage) return null;
  const resources = moduleResourceNames();
  const snapshot = {
    stage,
    t: relativeTime(state),
    count: resources.length,
    resources,
  };
  const existingIndex = state.modules.resourceSnapshots.findIndex((entry) => entry.stage === stage);
  if (existingIndex >= 0) state.modules.resourceSnapshots[existingIndex] = snapshot;
  else state.modules.resourceSnapshots.push(snapshot);
  return snapshot;
}

export async function measureDynamicModule(name, loader) {
  if (typeof loader !== 'function') throw new TypeError('Dynamic module loader must be a function.');
  const state = ensureStartupState();
  const startedAt = now();
  const before = new Set(moduleResourceNames());
  const record = state ? {
    name: String(name || 'dynamic-module'),
    requestedAt: relativeTime(state, startedAt),
    status: 'loading',
    duration: null,
    newResourceCount: 0,
    resources: [],
  } : null;
  if (record) state.modules.dynamicLoads.push(record);

  try {
    const loaded = await loader();
    if (record) {
      const resources = moduleResourceNames().filter((resource) => !before.has(resource));
      record.status = 'loaded';
      record.duration = Math.round((now() - startedAt) * 10) / 10;
      record.newResourceCount = resources.length;
      record.resources = resources;
    }
    return loaded;
  } catch (error) {
    if (record) {
      record.status = 'failed';
      record.duration = Math.round((now() - startedAt) * 10) / 10;
      record.error = error?.message || String(error);
    }
    throw error;
  }
}

export function recordStartupDatabaseRead(store, {
  operation = 'scan',
  records = 0,
  startedAt = now(),
} = {}) {
  const state = ensureStartupState();
  if (!state || !store) return;
  const settledAt = state.milestones.startupSettled?.t;
  const relativeStartedAt = relativeTime(state, startedAt);
  if (Number.isFinite(settledAt) && relativeStartedAt > settledAt) return;

  const storeName = String(store);
  const recordCount = Math.max(0, Number(records) || 0);
  const bucket = state.databaseReads.byStore[storeName] || {
    reads: 0,
    records: 0,
    operations: {},
  };
  bucket.reads += 1;
  bucket.records += recordCount;
  bucket.operations[operation] = (bucket.operations[operation] || 0) + 1;
  state.databaseReads.byStore[storeName] = bucket;
  state.databaseReads.total += 1;
  state.databaseReads.records += recordCount;
}

export function recordStoreHydration(source, stores) {
  const state = ensureStartupState();
  if (!state || !stores) return null;
  const entries = stores instanceof Map ? [...stores.entries()] : Object.entries(stores);
  const counts = {};
  for (const [store, value] of entries) {
    if (!store) continue;
    if (value instanceof Map || Array.isArray(value)) counts[store] = value.size ?? value.length;
    else counts[store] = Math.max(0, Number(value) || 0);
  }
  const values = Object.values(counts);
  const snapshot = {
    source: String(source || 'unknown'),
    t: relativeTime(state),
    storeCount: values.length,
    nonEmptyStoreCount: values.filter((count) => count > 0).length,
    recordCount: values.reduce((sum, count) => sum + count, 0),
    stores: counts,
  };
  state.storeHydrations.push(snapshot);
  return snapshot;
}

export function markShellReady(detail = {}) {
  const milestone = markStartupMilestone('shell', detail);
  captureModuleResources('shell');
  return milestone;
}


export function markStartupSettled(detail = {}) {
  const milestone = markStartupMilestone('startupSettled', detail);
  captureModuleResources('startup-settled');
  stopLongTaskObserver();
  return milestone;
}

export function markPanelOpenRequested(panel) {
  const state = ensureStartupState();
  if (!state || !panel) return null;
  if (!state.milestones.startupSettled) {
    markStartupSettled({ reason: 'panel-open' });
  }
  const request = {
    panel: String(panel),
    requestedAt: relativeTime(state),
    readyAt: null,
    loadTime: null,
  };
  state.panelLoads.push(request);
  markStartup('panel-open-request', { panel: request.panel });
  return request;
}

export function markActivePanelReady(panel) {
  const state = ensureStartupState();
  if (!state || !panel) return null;
  const panelName = String(panel);
  const readyAt = relativeTime(state);
  const request = [...state.panelLoads]
    .reverse()
    .find((entry) => entry.panel === panelName && entry.readyAt == null)
    || { panel: panelName, requestedAt: null, readyAt: null, loadTime: null };
  if (!state.panelLoads.includes(request)) state.panelLoads.push(request);
  request.readyAt = readyAt;
  request.loadTime = request.requestedAt == null
    ? null
    : Math.max(0, Math.round((readyAt - request.requestedAt) * 10) / 10);
  markStartupMilestone('activePanel', {
    panel: panelName,
    requestToReadyMs: request.loadTime,
  });
  captureModuleResources(`panel:${panelName}`);
  return request;
}

export function summarizeStartupMetrics(inputState = ensureStartupState()) {
  if (!inputState) return null;
  const shellMs = inputState.milestones.shell?.t ?? null;
  const settledMs = inputState.milestones.startupSettled?.t ?? shellMs;
  const startupTasks = inputState.mainThreadBlocking.tasks.filter((task) => (
    settledMs == null || task.t <= settledMs
  ));
  const shellModules = inputState.modules.resourceSnapshots.find((entry) => entry.stage === 'shell');
  const settledModules = inputState.modules.resourceSnapshots.find((entry) => entry.stage === 'startup-settled');
  const summary = {
    version: inputState.version,
    timeToShellMs: shellMs,
    startupSettledMs: settledMs,
    timeToActivePanelMs: inputState.milestones.activePanel?.t ?? null,
    activePanelRequestToReadyMs: inputState.milestones.activePanel?.detail?.requestToReadyMs ?? null,
    startupDatabaseReads: inputState.databaseReads.total,
    startupDatabaseRecordsRead: inputState.databaseReads.records,
    startupDatabaseReadsByStore: inputState.databaseReads.byStore,
    hydrationSnapshots: inputState.storeHydrations,
    staticModulesRegistered: inputState.modules.staticRegistered.length,
    staticModuleResourcesAtShell: shellModules?.count ?? null,
    moduleResourcesAtStartupSettled: settledModules?.count ?? shellModules?.count ?? null,
    dynamicModuleLoads: inputState.modules.dynamicLoads.length,
    dynamicModules: inputState.modules.dynamicLoads,
    longTaskMeasurementSupported: inputState.mainThreadBlocking.supported,
    startupLongTasks: startupTasks.length,
    startupLongTaskTimeMs: Math.round(startupTasks.reduce((sum, task) => sum + task.duration, 0) * 10) / 10,
    startupBlockingTimeMs: Math.round(startupTasks.reduce((sum, task) => sum + task.blockingTime, 0) * 10) / 10,
  };
  summary.startupReadBudget = evaluateStartupReadBudget(summary);
  return summary;
}

initializeStartupMeasurement();
registerStaticModule('shared/performance/startupPerf');
