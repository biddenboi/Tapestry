export class SyncCoordinator {
  constructor({
    runtime,
    windowRef = typeof window === 'undefined' ? null : window,
    intervalMs = 5 * 60 * 1000,
    setIntervalFn = (callback, delay) => globalThis.setInterval(callback, delay),
    clearIntervalFn = (timer) => globalThis.clearInterval(timer),
  } = {}) {
    if (!runtime?.synchronize) throw new Error('SyncCoordinator requires a SyncRuntime.');
    this.runtime = runtime;
    this.windowRef = windowRef;
    this.intervalMs = intervalMs;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.intervalTimer = null;
    this.started = false;
    this.onOnline = () => this.requestSync('connectivity-returned');
    this.onVisibility = () => {
      const state = this.windowRef?.document?.visibilityState;
      // Local commits already schedule synchronization immediately. Returning
      // to a visible tab is a useful reconciliation nudge; hiding or swapping
      // tabs must not start another full sync/checkpoint transaction.
      if (state === 'visible') this.requestSync('foreground');
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.windowRef?.addEventListener?.('online', this.onOnline);
    this.windowRef?.document?.addEventListener?.('visibilitychange', this.onVisibility);
    if (this.intervalMs > 0) {
      this.intervalTimer = this.setIntervalFn(() => {
        if (!this.windowRef?.document || this.windowRef.document.visibilityState === 'visible') {
          this.requestSync('visible-interval');
        }
      }, this.intervalMs);
    }
    this.requestSync('startup');
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.windowRef?.removeEventListener?.('online', this.onOnline);
    this.windowRef?.document?.removeEventListener?.('visibilitychange', this.onVisibility);
    if (this.intervalTimer != null) this.clearIntervalFn(this.intervalTimer);
    this.intervalTimer = null;
    this.runtime.cancelScheduledSync?.();
  }

  requestSync(reason = 'manual') {
    if (!this.started && reason !== 'manual') return;
    this.runtime.scheduleSync(reason);
  }
}

export default SyncCoordinator;
