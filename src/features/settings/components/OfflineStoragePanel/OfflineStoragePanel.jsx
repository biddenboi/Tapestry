import { useCallback, useEffect, useState } from 'react';
import { STORES } from '@domain/constants.js';

function sizeLabel(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

async function cacheUsage() {
  if (typeof caches === 'undefined') return { bytes: null, names: [] };
  const names = await caches.keys();
  let bytes = 0;
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    const cache = await caches.open(name);
    // eslint-disable-next-line no-await-in-loop
    const responses = await cache.matchAll();
    for (const response of responses) {
      const header = Number(response.headers.get('content-length'));
      if (Number.isFinite(header) && header >= 0) bytes += header;
      else {
        // Cache entries are local; this does not make a network request.
        // eslint-disable-next-line no-await-in-loop
        bytes += (await response.clone().arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
      }
    }
  }
  return { bytes, names };
}

function currentVersionedCaches(names = []) {
  const current = new Set();
  for (const prefix of ['tapestry-shell-v', 'tapestry-assets-v']) {
    const latest = names
      .filter((name) => name.startsWith(prefix))
      .sort((left, right) => Number(right.slice(prefix.length)) - Number(left.slice(prefix.length)))[0];
    if (latest) current.add(latest);
  }
  return current;
}

async function inspectStorage(databaseConnection) {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
  const [persisted, estimate, cache] = await Promise.all([
    storage?.persisted?.().catch(() => false) || false,
    storage?.estimate?.().catch(() => ({})) || {},
    cacheUsage().catch(() => ({ bytes: null, names: [] })),
  ]);
  const client = databaseConnection?.syncRuntime?.client;
  const sqlite = client?.query ? await client.query({
    sql: `SELECT
      (SELECT page_count FROM pragma_page_count) AS pageCount,
      (SELECT page_size FROM pragma_page_size) AS pageSize,
      (SELECT freelist_count FROM pragma_freelist_count) AS freePages,
      (SELECT COALESCE(SUM(byte_size),0) FROM document_resource_payloads) AS resourceBytes,
      (SELECT COUNT(*) FROM document_players) AS profiles,
      (SELECT COUNT(*) FROM document_todos) AS todos,
      (SELECT COUNT(*) FROM document_tasks) AS completedTasks,
      (SELECT COUNT(*) FROM document_journals) AS chronicleRecords,
      (SELECT COUNT(*) FROM document_resources) AS resources,
      (SELECT COUNT(*) FROM sync_operations WHERE status IN ('pending','uploading')) AS pendingOperations`,
    result: 'one',
  }).catch(() => null) : null;
  return {
    supported: typeof storage?.persist === 'function',
    persisted: Boolean(persisted),
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
    usageDetails: estimate.usageDetails || {},
    cache,
    sqlite: sqlite ? {
      ...sqlite,
      bytes: Number(sqlite.pageCount || 0) * Number(sqlite.pageSize || 0),
      freeBytes: Number(sqlite.freePages || 0) * Number(sqlite.pageSize || 0),
    } : null,
  };
}

export default function OfflineStoragePanel({ databaseConnection }) {
  const [details, setDetails] = useState({ supported: false, persisted: false, usage: null, quota: null, usageDetails: {}, cache: {}, sqlite: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => inspectStorage(databaseConnection).then(setDetails), [databaseConnection]);

  useEffect(() => { void refresh(); }, [refresh]);

  const requestPersistence = async () => {
    if (!navigator.storage?.persist || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const granted = await navigator.storage.persist();
      await refresh();
      setMessage(granted ? 'This browser granted persistent local storage.' : 'The browser kept its standard storage policy. Private sync remains the durable backup.');
    } catch (error) {
      setMessage(error?.message || 'The browser could not change its storage policy.');
    } finally {
      setBusy(false);
    }
  };

  const compact = async () => {
    const runtime = databaseConnection?.syncRuntime;
    if (!runtime?.transport || busy) return;
    setBusy(true);
    setMessage('Synchronizing before compacting…');
    try {
      const synchronized = await runtime.synchronize({ reason: 'compact-local-storage' });
      if (!synchronized?.synchronized) throw new Error('A successful private sync is required before compacting.');
      const syncStatus = await runtime.getDiagnostics();
      if (Number(syncStatus.counts?.pending || 0) + Number(syncStatus.counts?.uploading || 0) > 0) {
        throw new Error('Pending operations must be acknowledged before compacting.');
      }
      await databaseConnection.flushWrites?.();
      await databaseConnection.clear(STORES.derivedCache);
      const client = runtime.client;
      await client.query({
        sql: `DELETE FROM sync_operations
              WHERE status='accepted' AND accepted_at IS NOT NULL
                AND accepted_at < datetime('now','-30 days')`,
        result: 'changes',
      });
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        const currentCaches = currentVersionedCaches(names);
        await Promise.all(names
          .filter((name) => name.startsWith('tapestry-') && !currentCaches.has(name))
          .map((name) => caches.delete(name)));
      }
      await client.query({ sql: 'PRAGMA optimize', result: 'none' });
      await client.query({ sql: 'VACUUM', result: 'none' });
      await refresh();
      setMessage('Local storage compacted after a successful sync. Canonical history and evidence were retained.');
    } catch (error) {
      setMessage(error?.message || 'Local storage could not be compacted. No canonical data was removed.');
    } finally {
      setBusy(false);
    }
  };

  const sqlite = details.sqlite;
  const pending = Number(sqlite?.pendingOperations || 0);
  const canCompact = Boolean(databaseConnection?.syncRuntime?.transport);
  return (
    <div className="settings-offline-storage">
      <div><strong>Offline storage</strong><span>{details.persisted ? 'Persistent storage granted' : 'Standard browser storage'}</span></div>
      <div className="settings-offline-storage__metrics">
        <span>Total origin<strong>{sizeLabel(details.usage)}</strong></span>
        <span>SQLite pages<strong>{sizeLabel(sqlite?.bytes)}</strong></span>
        <span>SQLite free<strong>{sizeLabel(sqlite?.freeBytes)}</strong></span>
        <span>Images<strong>{sizeLabel(sqlite?.resourceBytes)}</strong></span>
        <span>Service worker<strong>{sizeLabel(details.cache?.bytes)}</strong></span>
        <span>Browser quota<strong>{sizeLabel(details.quota)}</strong></span>
      </div>
      {sqlite && (
        <div className="settings-offline-storage__counts">
          <span>Profiles <b>{sqlite.profiles}</b></span><span>Tasks <b>{sqlite.todos}</b></span>
          <span>Completed <b>{sqlite.completedTasks}</b></span><span>Chronicle <b>{sqlite.chronicleRecords}</b></span>
          <span>Images <b>{sqlite.resources}</b></span><span>Pending sync <b>{pending}</b></span>
        </div>
      )}
      <span className="settings-offline-storage__message">
        iPhone origin usage includes WebKit container, OPFS, and browser-cache overhead. It is not the same as the size of your Tapestry records.
      </span>
      <div className="settings-offline-storage__actions">
        <button type="button" disabled={busy || details.persisted || !details.supported} onClick={requestPersistence}>{details.persisted ? 'Protected' : busy ? 'Working…' : 'Keep data offline'}</button>
        <button type="button" disabled={busy || !canCompact} onClick={compact}>{busy ? 'Working…' : 'Compact local storage'}</button>
      </div>
      {!canCompact && <span className="settings-offline-storage__message">Compact becomes available after private sync is connected.</span>}
      {message && <span className="settings-offline-storage__message">{message}</span>}
    </div>
  );
}
