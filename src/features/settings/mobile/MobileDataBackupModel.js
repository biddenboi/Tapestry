function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function describeMobileSyncState(sync = {}, { online = true } = {}) {
  const pending = count(sync.counts?.pending) + count(sync.counts?.uploading);
  const conflicts = Math.max(count(sync.openConflictCount), count(sync.counts?.conflict));
  if (conflicts > 0 || sync.status === 'conflict') {
    return Object.freeze({ tone: 'warning', label: 'Sync needs attention', detail: `${conflicts || 1} conflict${conflicts === 1 ? '' : 's'} to review`, pending, conflicts });
  }
  if (sync.status === 'error' || sync.latestError) {
    return Object.freeze({ tone: 'danger', label: 'Sync error', detail: sync.latestError?.message || 'Local changes remain safe.', pending, conflicts });
  }
  if (!online) {
    return Object.freeze({ tone: 'quiet', label: 'Offline', detail: pending ? `${pending} change${pending === 1 ? '' : 's'} waiting` : 'Local changes remain safe.', pending, conflicts });
  }
  if (sync.status === 'syncing') {
    return Object.freeze({ tone: 'active', label: 'Syncing', detail: pending ? `${pending} change${pending === 1 ? '' : 's'} remaining` : 'Checking for updates…', pending, conflicts });
  }
  if (pending > 0 || sync.status === 'pending') {
    return Object.freeze({ tone: 'active', label: 'Pending sync', detail: `${pending || 1} change${pending === 1 ? '' : 's'} waiting`, pending, conflicts });
  }
  if (sync.transportConfigured || sync.status === 'synced') {
    const last = sync.lastSynchronizedAt ? new Date(sync.lastSynchronizedAt) : null;
    return Object.freeze({
      tone: 'success',
      label: 'Private sync connected',
      detail: last && Number.isFinite(last.getTime()) ? `Last synced ${last.toLocaleString()}` : 'Local and remote state are ready.',
      pending,
      conflicts,
    });
  }
  return Object.freeze({ tone: 'quiet', label: 'Local only', detail: 'This device is not connected to private sync.', pending, conflicts });
}

