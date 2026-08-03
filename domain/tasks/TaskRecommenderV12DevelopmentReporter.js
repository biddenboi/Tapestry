const MAX_REPORTS = 40;
const reports = [];

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function taskRecommenderV12ReportTimer() {
  return now();
}

export function taskRecommenderV12PayloadBytes(value) {
  if (value == null) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
  return text.length;
}

function push(entry) {
  reports.push(Object.freeze({
    recordedAt: new Date().toISOString(),
    ...entry,
  }));
  if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS);
  if (typeof window !== 'undefined') {
    window.__tapestryTaskRecommenderV12Reports = reports;
    window.__tapestryTaskRecommenderV12Summary = taskRecommenderV12DevelopmentSummary;
  }
  return reports.at(-1);
}

export function reportTaskRecommenderV12Persistence({
  operation,
  playerUUID = null,
  payload = null,
  recordCount = 0,
} = {}) {
  return push({
    type: 'persistence-size',
    operation: String(operation || 'unknown'),
    playerUUID: playerUUID == null ? null : String(playerUUID),
    bytes: taskRecommenderV12PayloadBytes(payload),
    recordCount: Math.max(0, Number(recordCount) || 0),
  });
}

export function reportTaskRecommenderV12Migration({
  playerUUID,
  startedAt,
  sourcePayload = null,
  convertedPayload = null,
  sourceRecordCount = 0,
  convertedRecordCount = 0,
  status = 'unknown',
} = {}) {
  const started = Number(startedAt);
  return push({
    type: 'migration-time',
    playerUUID: playerUUID == null ? null : String(playerUUID),
    status: String(status || 'unknown'),
    durationMs: Number.isFinite(started) ? Math.max(0, now() - started) : 0,
    sourceBytes: taskRecommenderV12PayloadBytes(sourcePayload),
    convertedBytes: taskRecommenderV12PayloadBytes(convertedPayload),
    sourceRecordCount: Math.max(0, Number(sourceRecordCount) || 0),
    convertedRecordCount: Math.max(0, Number(convertedRecordCount) || 0),
  });
}

export function reportTaskRecommenderV12Inference({
  playerUUID = null,
  source = 'tasks',
  device = null,
} = {}) {
  return push({
    type: 'inference-performance',
    playerUUID: playerUUID == null ? null : String(playerUUID),
    source: String(source || 'tasks'),
    hydrationMs: Math.max(0, Number(device?.hydrationMs) || 0),
    scoringMs: Math.max(0, Number(device?.scoringMs) || 0),
    totalMs: Math.max(0, Number(device?.totalMs) || 0),
    actionCount: Math.max(0, Number(device?.actionCount) || 0),
    protocolEventCount: Math.max(0, Number(device?.protocolEventCount) || 0),
    checkpointBytes: Math.max(0, Number(device?.checkpointBytes) || 0),
  });
}

export function taskRecommenderV12DevelopmentSummary() {
  const persistence = reports.filter((entry) => entry.type === 'persistence-size');
  const migrations = reports.filter((entry) => entry.type === 'migration-time');
  const inferences = reports.filter((entry) => entry.type === 'inference-performance');
  return Object.freeze({
    reportCount: reports.length,
    persistenceOperationCount: persistence.length,
    migrationCount: migrations.length,
    inferenceCount: inferences.length,
    totalPersistenceBytes: persistence.reduce((sum, entry) => sum + entry.bytes, 0),
    latestMigration: migrations.at(-1) || null,
    peakMigrationMs: Math.max(0, ...migrations.map((entry) => entry.durationMs)),
    peakMigrationSourceBytes: Math.max(0, ...migrations.map((entry) => entry.sourceBytes)),
    peakInferenceMs: Math.max(0, ...inferences.map((entry) => entry.totalMs)),
    latestInference: inferences.at(-1) || null,
  });
}

export function getTaskRecommenderV12DevelopmentReports() {
  return Object.freeze([...reports]);
}

export function clearTaskRecommenderV12DevelopmentReports() {
  reports.splice(0, reports.length);
}
