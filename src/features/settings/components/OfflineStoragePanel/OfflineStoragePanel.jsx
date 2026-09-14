import { useCallback, useEffect, useState } from 'react';
import { compactLocalDatabase } from '@data/persistence/LocalStorageMaintenance.js';

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
      const rawLength = response.headers.get('content-length');
      const header = Number(rawLength);
      if (rawLength !== null && Number.isFinite(header) && header >= 0) bytes += header;
      else {
        // Cache entries are local; this does not make a network request.
        // eslint-disable-next-line no-await-in-loop
        bytes += (await response.clone().arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
      }
    }
  }
  return { bytes, names };
}

async function localFileUsage(storage) {
  if (!storage?.getDirectory) return null;
  let bytes = 0;
  const visit = async (directory) => {
    for await (const handle of directory.values()) {
      if (handle.kind === 'directory') await visit(handle);
      else bytes += (await handle.getFile()).size;
    }
  };
  await visit(await storage.getDirectory());
  return bytes;
}

async function inspectStorage(databaseConnection) {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
  const [persisted, estimate, cache, localFiles] = await Promise.all([
    storage?.persisted?.().catch(() => false) || false,
    storage?.estimate?.().catch(() => ({})) || {},
    cacheUsage().catch(() => ({ bytes: null, names: [] })),
    localFileUsage(storage).catch(() => null),
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
      ((SELECT COUNT(*) FROM sync_operations WHERE status IN ('pending','uploading'))
        + (SELECT COUNT(*) FROM sync_reference_outbox WHERE status='pending')) AS pendingOperations,
      (SELECT COALESCE(SUM(p.byte_size),0) FROM document_resource_payload_refs r
        JOIN document_resource_payloads p ON p.content_hash=r.content_hash) AS referencedImageBytes`,
    result: 'one',
  }).catch(() => null) : null;
  return {
    supported: typeof storage?.persist === 'function',
    persisted: Boolean(persisted),
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
    usageDetails: estimate.usageDetails || {},
    cache,
    localFiles,
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
    if (busy) return;
    setBusy(true);
    setMessage('Reclaiming unused database space…');
    try {
      const result = await compactLocalDatabase(databaseConnection);
      await refresh();
      setMessage(`Reclaimed ${sizeLabel(result.reclaimedBytes)}. All records, pending edits, and recovery history were retained.`);
    } catch (error) {
      setMessage(error?.message || 'Local storage could not be compacted.');
    } finally {
      setBusy(false);
    }
  };

  const sqlite = details.sqlite;
  const pending = Number(sqlite?.pendingOperations || 0);
  const canCompact = Boolean(databaseConnection?.syncRuntime?.client);
  return (
    <div className="settings-offline-storage">
      <div><strong>Offline storage</strong><span>{details.persisted ? 'Persistent storage granted' : 'Standard browser storage'}</span></div>
      <div className="settings-offline-storage__metrics">
        <span>Total origin<strong>{sizeLabel(details.usage)}</strong></span>
        <span>Local files<strong>{sizeLabel(details.localFiles)}</strong></span>
        <span>SQLite pages<strong>{sizeLabel(sqlite?.bytes)}</strong></span>
        <span>Reclaimable space<strong>{sizeLabel(sqlite?.freeBytes)}</strong></span>
        <span>Images<strong>{sizeLabel(sqlite?.resourceBytes)}</strong></span>
        <span>Service worker<strong>{sizeLabel(details.cache?.bytes)}</strong></span>
        <span>Saved by image reuse<strong>{sizeLabel(Math.max(0, Number(sqlite?.referencedImageBytes || 0) - Number(sqlite?.resourceBytes || 0)))}</strong></span>
      </div>
      {sqlite && (
        <div className="settings-offline-storage__counts">
          <span>Profiles <b>{sqlite.profiles}</b></span><span>Tasks <b>{sqlite.todos}</b></span>
          <span>Completed <b>{sqlite.completedTasks}</b></span><span>Chronicle <b>{sqlite.chronicleRecords}</b></span>
          <span>Images <b>{sqlite.resources}</b></span><span>Pending sync <b>{pending}</b></span>
        </div>
      )}
      <span className="settings-offline-storage__message">
        Total storage includes browser overhead and offline app files. Identical images share one stored copy. Compacting reclaims unused space without deleting your data and works offline.
      </span>
      <div className="settings-offline-storage__actions">
        <button type="button" disabled={busy} onClick={() => { void refresh().catch((error) => setMessage(error.message)); }}>Refresh usage</button>
        <button type="button" disabled={busy || details.persisted || !details.supported} onClick={requestPersistence}>{details.persisted ? 'Protected' : busy ? 'Working…' : 'Keep data offline'}</button>
        <button type="button" disabled={busy || !canCompact} onClick={compact}>{busy ? 'Working…' : 'Compact local storage'}</button>
      </div>
      {!canCompact && <span className="settings-offline-storage__message">Compacting becomes available when local storage is ready.</span>}
      {message && <span className="settings-offline-storage__message">{message}</span>}
    </div>
  );
}
