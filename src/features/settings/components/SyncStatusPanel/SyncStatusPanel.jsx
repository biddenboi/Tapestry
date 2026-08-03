import { useEffect, useState, useSyncExternalStore } from 'react';

const STATUS_COPY = Object.freeze({
  'local-only': 'This device is using local SQLite. Sign in above to connect private cross-device sync.',
  pending: 'Local changes are safe and waiting to upload.',
  syncing: 'Sending local operations and checking for newer records.',
  synced: 'All queued operations have been acknowledged.',
  conflict: 'One or more records need a conflict decision. Both versions are preserved.',
  error: 'Sync needs attention. Local changes remain saved on this device.',
});

export default function SyncStatusPanel({ databaseConnection }) {
  const runtime = databaseConnection?.syncRuntime;
  const store = runtime?.statusStore;
  const empty = Object.freeze({
    status: 'local-only',
    label: 'Local only',
    counts: {},
    openConflictCount: 0,
    transportConfigured: false,
  });
  const snapshot = useSyncExternalStore(
    store?.subscribe || (() => () => undefined),
    store?.getSnapshot || (() => empty),
    store?.getSnapshot || (() => empty),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(databaseConnection?.ready)
      .then(() => runtime?.getDiagnostics?.())
      .catch((error) => {
        if (!cancelled) console.warn('[Settings] sync diagnostics unavailable:', error);
      });
    return () => { cancelled = true; };
  }, [databaseConnection, runtime]);

  const syncNow = async () => {
    if (!runtime || busy) return;
    setBusy(true);
    try {
      await runtime.synchronize({ reason: 'manual' });
    } catch {
      // The status store exposes the durable error without discarding local work.
    } finally {
      setBusy(false);
    }
  };

  const queued = Number(snapshot.counts?.pending || 0) + Number(snapshot.counts?.uploading || 0);
  return (
    <div className={`settings-sync-card settings-sync-card--${snapshot.status}`} aria-live="polite">
      <div className="settings-sync-card__summary">
        <span className="settings-sync-card__signal" aria-hidden="true" />
        <div>
          <strong>{snapshot.label}</strong>
          <span>{STATUS_COPY[snapshot.status] || STATUS_COPY['local-only']}</span>
        </div>
      </div>
      <div className="settings-sync-card__metrics">
        <span>Queued<strong>{queued}</strong></span>
        <span>Conflicts<strong>{Number(snapshot.openConflictCount || 0)}</strong></span>
        <span>Accepted<strong>{Number(snapshot.counts?.accepted || 0)}</strong></span>
      </div>
      <button
        type="button"
        onClick={syncNow}
        disabled={busy || !snapshot.transportConfigured}
        title={snapshot.transportConfigured ? 'Run sync now' : 'Private sync server is not configured yet'}
      >
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {snapshot.latestError?.message && (
        <span className="settings-sync-card__error">{snapshot.latestError.message}</span>
      )}
    </div>
  );
}
