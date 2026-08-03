function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function byteLength(payload) {
  if (typeof payload === 'string') return new TextEncoder().encode(payload).byteLength;
  if (typeof Blob !== 'undefined' && payload instanceof Blob) return payload.size;
  if (payload instanceof ArrayBuffer) return payload.byteLength;
  if (ArrayBuffer.isView(payload)) return payload.byteLength;
  return 0;
}


export const PERSISTENCE_SIZE_BUDGET = Object.freeze({
  maxSerializedBytesPerGeneration: 5 * 1024 * 1024,
  maxGenerationBytes: 50 * 1024 * 1024,
  maxGenerationFiles: 128,
  maxHashingMs: 250,
});

function evaluateGenerationBudget(entry) {
  const violations = [];
  if (entry.serializedBytes > PERSISTENCE_SIZE_BUDGET.maxSerializedBytesPerGeneration) {
    violations.push('serialized-bytes');
  }
  if (entry.generationSizeBytes > PERSISTENCE_SIZE_BUDGET.maxGenerationBytes) {
    violations.push('generation-bytes');
  }
  if (entry.generationFileCount > PERSISTENCE_SIZE_BUDGET.maxGenerationFiles) {
    violations.push('generation-files');
  }
  return { passed: violations.length === 0, violations };
}

function summarizeReports(reports) {
  const generations = reports.filter((entry) => entry.type === 'generation');
  const hashes = reports.filter((entry) => entry.type === 'hash');
  const lastGeneration = generations.at(-1) || null;
  return {
    generationCount: generations.length,
    hashCount: hashes.length,
    lastGeneration,
    lastHash: hashes.at(-1) || null,
    totalSerializedBytes: generations.reduce((sum, entry) => sum + entry.serializedBytes, 0),
    totalGenerationBytes: generations.reduce((sum, entry) => sum + entry.generationSizeBytes, 0),
    totalHashingMs: hashes.reduce((sum, entry) => sum + entry.durationMs, 0),
    peakSerializedBytes: Math.max(0, ...generations.map((entry) => entry.serializedBytes)),
    peakGenerationBytes: Math.max(0, ...generations.map((entry) => entry.generationSizeBytes)),
    budgetViolationCount: reports.reduce((sum, entry) => sum + Number(entry.budget?.violations?.length || 0), 0),
    budgets: PERSISTENCE_SIZE_BUDGET,
  };
}

export class PersistenceDevelopmentReporter {
  constructor({ maxReports = 50 } = {}) {
    this.maxReports = Math.max(1, Number(maxReports) || 50);
    this.reports = [];
    if (typeof window !== 'undefined') {
      window.__tapestryPersistence = this.reports;
      window.__tapestryPersistenceSummary = () => this.summary();
    }
  }

  startTimer() {
    return now();
  }

  recordGeneration({
    syncRevision = null,
    files = new Map(),
    committedFiles = files,
    changedDomains = [],
    changedStores = [],
    artifactClasses = [],
    mutationCount = 0,
    serializationMs = 0,
  } = {}) {
    const entry = {
      type: 'generation',
      recordedAt: new Date().toISOString(),
      syncRevision,
      changedDomains: [...new Set(changedDomains)].sort(),
      changedStores: [...new Set(changedStores)].sort(),
      artifactClasses: [...new Set(artifactClasses)].sort(),
      mutationCount: Number(mutationCount) || 0,
      serializedBytes: [...files.values()].reduce((sum, payload) => sum + byteLength(payload), 0),
      serializationMs: Math.max(0, Number(serializationMs) || 0),
      generationSizeBytes: [...committedFiles.values()]
        .reduce((sum, payload) => sum + byteLength(payload), 0),
      generationFileCount: committedFiles.size,
      serializedFileCount: files.size,
    };
    entry.budget = evaluateGenerationBudget(entry);
    this._push(entry);
    return entry;
  }

  recordHash({ durationMs = 0, bytes = 0, fileCount = 0 } = {}) {
    const entry = {
      type: 'hash',
      recordedAt: new Date().toISOString(),
      durationMs: Math.max(0, Number(durationMs) || 0),
      bytes: Math.max(0, Number(bytes) || 0),
      fileCount: Math.max(0, Number(fileCount) || 0),
    };
    entry.budget = {
      passed: entry.durationMs <= PERSISTENCE_SIZE_BUDGET.maxHashingMs,
      violations: entry.durationMs <= PERSISTENCE_SIZE_BUDGET.maxHashingMs ? [] : ['hashing-time'],
    };
    this._push(entry);
    return entry;
  }

  _push(entry) {
    this.reports.push(entry);
    if (this.reports.length > this.maxReports) {
      this.reports.splice(0, this.reports.length - this.maxReports);
    }
  }

  summary() {
    return summarizeReports(this.reports);
  }
}

export { byteLength as persistencePayloadByteLength };
export default PersistenceDevelopmentReporter;
