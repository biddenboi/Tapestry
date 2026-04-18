/**
 * Worker pool for parallel match execution.
 *
 * ── Why this exists ───────────────────────────────────────────────
 *
 * Each breach training match is independent: one map, two policies, no
 * shared state. That makes them embarrassingly parallel — running N matches
 * on N cores gives a near-linear speedup up to CPU count, and beyond that
 * runs into memory/GC contention.
 *
 * The pool owns W workers, each a long-lived node Worker thread. It accepts
 * match jobs via `runMatch()` (which returns a Promise) and dispatches them
 * to whichever worker is idle. If every worker is busy, new jobs queue until
 * one frees up — simple FIFO, no priority because every match is equivalent.
 *
 * ── Performance notes ─────────────────────────────────────────────
 *
 * Weights serialized via postMessage are cloned with V8's structured-clone
 * algorithm. For a 128-hidden MLP (~33K floats) this costs a few hundred
 * microseconds per job — negligible next to the 100-500ms match runtime.
 * If that ever becomes a bottleneck (e.g. with a 4-layer 512-wide net), the
 * fix is to switch weights to a SharedArrayBuffer once per generation and
 * send only IDs per-job. Not needed at current scale.
 *
 * First-match warmup is the other hidden cost. Node + V8 take ~100-200ms
 * per worker on the first match to JIT the hot loops. The pool pre-warms
 * every worker in parallel at startup (see `warmup()`), so the main loop's
 * first real measurement isn't skewed. Pre-warming all 8 workers on an
 * 8-core laptop takes roughly the same wall time as warming one.
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';

export class MatchPool {
  constructor({ workerCount, workerPath } = {}) {
    const cpu = os.cpus()?.length || 4;
    this.workerCount = workerCount ?? Math.max(1, cpu - 1);

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    this.workerPath = workerPath ?? path.join(__dirname, 'worker.js');

    this.workers = [];       // { id, worker, busy }
    this.queue = [];         // pending jobs waiting for an idle worker
    this.pending = new Map(); // jobId → { resolve, reject, startedAt, workerId }
    this.nextJobId = 1;

    this.stats = {
      matchesRun: 0,
      matchesFailed: 0,
      totalMatchDurationMs: 0,
      perWorkerMatchCounts: [],
      perWorkerBusyMs: [],
    };

    for (let i = 0; i < this.workerCount; i += 1) this._spawn(i);
  }

  _spawn(id) {
    const worker = new Worker(this.workerPath);
    const entry = { id, worker, busy: false, currentJobId: null, busyStartMs: 0 };

    worker.on('message', (msg) => this._onMessage(entry, msg));
    worker.on('error',   (err) => this._onError(entry, err));
    worker.on('exit',    (code) => this._onExit(entry, code));

    this.workers.push(entry);
    this.stats.perWorkerMatchCounts.push(0);
    this.stats.perWorkerBusyMs.push(0);
  }

  _onMessage(entry, msg) {
    if (msg?.type === 'match-result' || msg?.type === 'warmup-done') {
      const pending = this.pending.get(msg.jobId);
      if (pending) {
        this.pending.delete(msg.jobId);
        if (msg.type === 'match-result') {
          this.stats.matchesRun += 1;
          this.stats.totalMatchDurationMs += msg.durationMs || 0;
          this.stats.perWorkerMatchCounts[entry.id] += 1;
        }
        const wall = Date.now() - entry.busyStartMs;
        this.stats.perWorkerBusyMs[entry.id] += wall;
        pending.resolve(msg);
      }
      entry.busy = false;
      entry.currentJobId = null;
      this._pump();
      return;
    }
    if (msg?.type === 'error') {
      const pending = this.pending.get(msg.jobId);
      if (pending) {
        this.pending.delete(msg.jobId);
        this.stats.matchesFailed += 1;
        pending.reject(new Error(`worker ${entry.id}: ${msg.message}`));
      }
      entry.busy = false;
      entry.currentJobId = null;
      this._pump();
    }
  }

  _onError(entry, err) {
    // Uncaught in the worker — reject any in-flight job on this worker.
    if (entry.currentJobId != null) {
      const pending = this.pending.get(entry.currentJobId);
      if (pending) {
        this.pending.delete(entry.currentJobId);
        pending.reject(new Error(`worker ${entry.id} crashed: ${err.message}`));
        this.stats.matchesFailed += 1;
      }
    }
    // Respawn so the pool stays full.
    entry.worker.removeAllListeners();
    this._respawn(entry);
  }

  _onExit(entry, code) {
    if (code !== 0 && entry.currentJobId != null) {
      const pending = this.pending.get(entry.currentJobId);
      if (pending) {
        this.pending.delete(entry.currentJobId);
        pending.reject(new Error(`worker ${entry.id} exited with code ${code}`));
        this.stats.matchesFailed += 1;
      }
    }
  }

  _respawn(entry) {
    const idx = this.workers.indexOf(entry);
    if (idx < 0) return;
    this.workers.splice(idx, 1);
    this._spawn(entry.id);
    // New worker is idle; drain queue.
    this._pump();
  }

  _pump() {
    while (this.queue.length > 0) {
      const idle = this.workers.find((w) => !w.busy);
      if (!idle) return;
      const job = this.queue.shift();
      idle.busy = true;
      idle.currentJobId = job.jobId;
      idle.busyStartMs = Date.now();
      idle.worker.postMessage(job);
    }
  }

  /**
   * Submit a match job. Returns a Promise that resolves with the
   * `match-result` payload from the worker (same shape the env.js runMatch
   * would return synchronously).
   */
  runMatch({ weightsA, weightsB, seed, sampleTemp = 0.8 }) {
    return new Promise((resolve, reject) => {
      const jobId = this.nextJobId;
      this.nextJobId += 1;
      const job = { type: 'match', jobId, weightsA, weightsB, seed, sampleTemp };
      this.pending.set(jobId, { resolve, reject, enqueuedAt: Date.now() });

      const idle = this.workers.find((w) => !w.busy);
      if (idle) {
        idle.busy = true;
        idle.currentJobId = jobId;
        idle.busyStartMs = Date.now();
        idle.worker.postMessage(job);
      } else {
        this.queue.push(job);
      }
    });
  }

  /**
   * Pre-warm every worker by running a throwaway match on each. Runs all
   * warmups in parallel so the total time is the slowest single warmup, not
   * the sum. Resolves when every worker has completed its warmup.
   */
  async warmup() {
    const promises = this.workers.map((w) => new Promise((resolve, reject) => {
      const jobId = this.nextJobId;
      this.nextJobId += 1;
      this.pending.set(jobId, { resolve, reject });
      w.busy = true;
      w.currentJobId = jobId;
      w.busyStartMs = Date.now();
      w.worker.postMessage({ type: 'warmup', jobId });
    }));
    return Promise.all(promises);
  }

  /**
   * Utilization stats, useful for CLI telemetry and for diagnosing starved
   * pools (e.g. if matchesPerGen is too small relative to workerCount).
   *
   * Returns { workerCount, matchesRun, meanMatchDurationMs,
   *           totalWallMs (since pool start), utilizationPct[] }.
   */
  snapshotStats(wallStartMs) {
    const wallMs = Date.now() - wallStartMs;
    const mean = this.stats.matchesRun > 0
      ? this.stats.totalMatchDurationMs / this.stats.matchesRun
      : 0;
    const utilization = this.stats.perWorkerBusyMs.map(
      (busy) => wallMs > 0 ? (busy / wallMs) : 0,
    );
    return {
      workerCount: this.workerCount,
      matchesRun: this.stats.matchesRun,
      matchesFailed: this.stats.matchesFailed,
      meanMatchDurationMs: mean,
      totalWallMs: wallMs,
      utilization,
      matchesPerWorker: [...this.stats.perWorkerMatchCounts],
    };
  }

  /**
   * Graceful shutdown: wait for in-flight jobs, then terminate every worker.
   */
  async shutdown({ timeoutMs = 5000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    for (const w of this.workers) {
      try {
        w.worker.postMessage({ type: 'shutdown' });
      } catch { /* already exited */ }
    }
    // Give shutdown a moment, then hard-terminate any stragglers.
    await new Promise((r) => setTimeout(r, 100));
    await Promise.all(this.workers.map((w) => w.worker.terminate().catch(() => {})));
  }
}
