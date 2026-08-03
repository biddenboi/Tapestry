import { recordRuntimeWork } from '../performance/RuntimePerformance.js';
export const BACKGROUND_JOB_PRIORITY = Object.freeze({
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  idle: 0,
});

const DEFAULT_MAX_HISTORY = 200;
const DEFAULT_MAX_QUEUE = 128;
const DEFAULT_CONCURRENCY = 2;

const schedulerRegistry = new Set();
let schedulerSequence = 0;
let jobSequence = 0;

function asPriority(value, fallback = BACKGROUND_JOB_PRIORITY.normal) {
  if (typeof value === 'string' && value in BACKGROUND_JOB_PRIORITY) {
    return BACKGROUND_JOB_PRIORITY[value];
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asPositiveInteger(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function abortError(message = 'Background job cancelled.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function terminalState(state) {
  return ['completed', 'failed', 'cancelled'].includes(state);
}

function nowIso() {
  return new Date().toISOString();
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    dedupeKey: job.dedupeKey,
    priority: job.priority,
    state: job.state,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    execution: job.execution,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    retryAt: job.retryAt,
    error: job.error,
    durationMs: job.durationMs,
    metadata: job.metadata,
  };
}

function installDevelopmentVisibility() {
  if (typeof window === 'undefined') return;
  if (!window.__tapestryBackgroundJobs) {
    Object.defineProperty(window, '__tapestryBackgroundJobs', {
      configurable: true,
      value: schedulerRegistry,
    });
  }
  if (!window.__tapestryBackgroundJobSummary) {
    Object.defineProperty(window, '__tapestryBackgroundJobSummary', {
      configurable: true,
      value: () => [...schedulerRegistry].map((scheduler) => scheduler.summary()),
    });
  }
}


export function scheduleBackgroundCallback(callback) {
  if (typeof callback !== 'function') throw new TypeError('Background callback must be a function.');
  const schedulerApi = globalThis?.scheduler;
  if (typeof schedulerApi?.postTask === 'function') {
    const controller = new AbortController();
    schedulerApi.postTask(callback, { priority: 'background', signal: controller.signal })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[BackgroundJobScheduler] postTask failed:', error);
      });
    return () => controller.abort();
  }
  if (typeof globalThis?.requestIdleCallback === 'function') {
    const id = globalThis.requestIdleCallback(callback, { timeout: 1000 });
    return () => globalThis.cancelIdleCallback?.(id);
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

export class BackgroundJobScheduler {
  constructor({
    name = 'background',
    concurrency = DEFAULT_CONCURRENCY,
    maxQueue = DEFAULT_MAX_QUEUE,
    maxHistory = DEFAULT_MAX_HISTORY,
    retryBaseMs = 500,
    schedule = null,
  } = {}) {
    this.id = `${name}-${++schedulerSequence}`;
    this.name = name;
    this.concurrency = asPositiveInteger(concurrency, DEFAULT_CONCURRENCY);
    this.maxQueue = asPositiveInteger(maxQueue, DEFAULT_MAX_QUEUE);
    this.maxHistory = asPositiveInteger(maxHistory, DEFAULT_MAX_HISTORY);
    this.retryBaseMs = Math.max(0, Number(retryBaseMs) || 0);
    this.schedule = typeof schedule === 'function'
      ? schedule
      : scheduleBackgroundCallback;
    this.handlers = new Map();
    this.queue = [];
    this.jobs = new Map();
    this.dedupe = new Map();
    this.history = [];
    this.running = 0;
    this.disposed = false;
    this.drainCancel = null;
    schedulerRegistry.add(this);
    installDevelopmentVisibility();
  }

  register(type, handler, {
    priority = BACKGROUND_JOB_PRIORITY.normal,
    maxAttempts = 3,
    execution = 'main',
  } = {}) {
    if (!type || typeof handler !== 'function') {
      throw new Error('Background job registration requires a type and handler.');
    }
    this.handlers.set(type, {
      handler,
      priority: asPriority(priority),
      maxAttempts: asPositiveInteger(maxAttempts, 3),
      execution: execution === 'worker' ? 'worker' : 'main',
    });
    return this;
  }

  enqueue({
    id = null,
    type,
    payload = null,
    dedupeKey = null,
    priority = null,
    maxAttempts = null,
    metadata = null,
  } = {}) {
    if (this.disposed) throw new Error(`Background scheduler ${this.name} is disposed.`);
    const registration = this.handlers.get(type);
    if (!registration) throw new Error(`No background job handler registered for ${type}.`);

    const normalizedDedupeKey = dedupeKey ? String(dedupeKey) : null;
    const existingId = normalizedDedupeKey ? this.dedupe.get(normalizedDedupeKey) : null;
    const existing = existingId ? this.jobs.get(existingId) : null;
    if (existing && !terminalState(existing.state)) return existing.handle;

    const activeCount = this.queue.length + this.running;
    if (activeCount >= this.maxQueue) {
      throw new Error(`Background scheduler ${this.name} queue limit (${this.maxQueue}) reached.`);
    }

    const jobId = id ? String(id) : `${this.id}:job-${++jobSequence}`;
    if (this.jobs.has(jobId) && !terminalState(this.jobs.get(jobId).state)) {
      return this.jobs.get(jobId).handle;
    }

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    // A queued background task may intentionally be fire-and-forget. Attach a
    // private rejection observer so a failed job does not create an unhandled
    // rejection while the caller can still await the original promise.
    promise.catch(() => undefined);

    const controller = new AbortController();
    const job = {
      id: jobId,
      type,
      payload,
      dedupeKey: normalizedDedupeKey,
      priority: priority == null ? registration.priority : asPriority(priority),
      maxAttempts: maxAttempts == null
        ? registration.maxAttempts
        : asPositiveInteger(maxAttempts, registration.maxAttempts),
      execution: registration.execution,
      metadata: metadata && typeof metadata === 'object' ? { ...metadata } : null,
      state: 'queued',
      attempts: 0,
      createdAt: nowIso(),
      startedAt: null,
      completedAt: null,
      retryAt: null,
      error: null,
      durationMs: null,
      startedMonotonicAt: null,
      controller,
      resolvePromise,
      rejectPromise,
      retryTimer: null,
      handle: null,
      sequence: ++jobSequence,
    };
    const handle = Object.freeze({
      id: job.id,
      promise,
      cancel: (reason) => this.cancel(job.id, reason),
      snapshot: () => publicJob(job),
    });
    job.handle = handle;
    this.jobs.set(job.id, job);
    if (job.dedupeKey) this.dedupe.set(job.dedupeKey, job.id);
    this.queue.push(job);
    this._sortQueue();
    this._scheduleDrain();
    return handle;
  }

  cancel(idOrDedupeKey, reason = 'Background job cancelled.') {
    const direct = this.jobs.get(String(idOrDedupeKey));
    const dedupedId = this.dedupe.get(String(idOrDedupeKey));
    const job = direct || (dedupedId ? this.jobs.get(dedupedId) : null);
    if (!job || terminalState(job.state)) return false;
    job.controller.abort(reason);
    if (job.retryTimer) {
      clearTimeout(job.retryTimer);
      job.retryTimer = null;
    }
    if (job.state !== 'running') {
      this.queue = this.queue.filter((candidate) => candidate !== job);
      this._finish(job, 'cancelled', null, abortError(reason));
    }
    return true;
  }

  cancelWhere(predicate, reason) {
    let cancelled = 0;
    for (const job of this.jobs.values()) {
      if (!terminalState(job.state) && predicate(publicJob(job))) {
        cancelled += this.cancel(job.id, reason) ? 1 : 0;
      }
    }
    return cancelled;
  }

  summary() {
    const active = [...this.jobs.values()].filter((job) => !terminalState(job.state));
    const counts = {};
    for (const job of [...active, ...this.history]) {
      counts[job.state] = (counts[job.state] || 0) + 1;
    }
    return {
      id: this.id,
      name: this.name,
      concurrency: this.concurrency,
      maxQueue: this.maxQueue,
      running: this.running,
      queued: this.queue.length,
      counts,
      active: active.map(publicJob),
      recent: this.history.slice(-25).map(publicJob),
    };
  }

  async whenIdle() {
    while (this.running || this.queue.length || [...this.jobs.values()].some((job) => job.state === 'retrying')) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  dispose(reason = 'Background scheduler disposed.') {
    if (this.disposed) return;
    this.disposed = true;
    this.drainCancel?.();
    this.drainCancel = null;
    this.cancelWhere(() => true, reason);
    schedulerRegistry.delete(this);
  }

  _sortQueue() {
    this.queue.sort((left, right) => (
      right.priority - left.priority
      || left.sequence - right.sequence
    ));
  }

  _scheduleDrain() {
    if (this.drainCancel || this.disposed) return;
    this.drainCancel = this.schedule(() => {
      this.drainCancel = null;
      this._drain();
    });
  }

  _drain() {
    if (this.disposed) return;
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (!job || terminalState(job.state)) continue;
      this._run(job);
    }
  }

  _run(job) {
    const registration = this.handlers.get(job.type);
    if (!registration) {
      this._finish(job, 'failed', null, new Error(`Missing handler for ${job.type}.`));
      return;
    }
    if (job.controller.signal.aborted) {
      this._finish(job, 'cancelled', null, abortError(String(job.controller.signal.reason || 'Cancelled.')));
      return;
    }

    this.running += 1;
    job.state = 'running';
    job.attempts += 1;
    job.startedAt = nowIso();
    job.startedMonotonicAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    job.retryAt = null;
    job.error = null;

    Promise.resolve()
      .then(() => registration.handler(job.payload, {
        signal: job.controller.signal,
        job: publicJob(job),
        scheduler: this,
      }))
      .then((result) => {
        if (job.controller.signal.aborted) {
          this._finish(job, 'cancelled', null, abortError(String(job.controller.signal.reason || 'Cancelled.')));
          return;
        }
        this._finish(job, 'completed', result, null);
      })
      .catch((error) => {
        if (job.controller.signal.aborted || error?.name === 'AbortError') {
          this._finish(job, 'cancelled', null, error || abortError());
          return;
        }
        if (job.attempts < job.maxAttempts) {
          this.running = Math.max(0, this.running - 1);
          job.state = 'retrying';
          job.error = String(error?.message || error);
          const retryDelay = this.retryBaseMs * (2 ** Math.max(0, job.attempts - 1));
          job.retryAt = new Date(Date.now() + retryDelay).toISOString();
          job.retryTimer = setTimeout(() => {
            job.retryTimer = null;
            if (job.controller.signal.aborted) {
              this._finish(job, 'cancelled', null, abortError());
              return;
            }
            job.state = 'queued';
            this.queue.push(job);
            this._sortQueue();
            this._scheduleDrain();
          }, retryDelay);
          this._scheduleDrain();
          return;
        }
        this._finish(job, 'failed', null, error);
      });
  }

  _finish(job, state, result, error) {
    if (job.state === 'running') this.running = Math.max(0, this.running - 1);
    job.state = state;
    job.completedAt = nowIso();
    const completedMonotonicAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    if (job.startedMonotonicAt != null) {
      job.durationMs = Math.max(0, Math.round((completedMonotonicAt - job.startedMonotonicAt) * 10) / 10);
      recordRuntimeWork(`background:${job.type}`, job.durationMs, {
        category: 'background-job',
        background: true,
        metadata: { scheduler: this.name, state, execution: job.execution, attempts: job.attempts },
      });
    }
    job.error = error ? String(error?.message || error) : null;
    if (job.dedupeKey && this.dedupe.get(job.dedupeKey) === job.id) {
      this.dedupe.delete(job.dedupeKey);
    }
    this.history.push(job);
    if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
    if (state === 'completed') job.resolvePromise(result);
    else job.rejectPromise(error || abortError());
    this._scheduleDrain();
  }
}

export function backgroundJobDevelopmentSummary() {
  return [...schedulerRegistry].map((scheduler) => scheduler.summary());
}

export default BackgroundJobScheduler;
