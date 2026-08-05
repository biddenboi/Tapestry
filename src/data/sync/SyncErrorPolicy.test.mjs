import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isRetiredWorkingSetSyncError,
  visibleSyncError,
} from './SyncErrorPolicy.js';
import SyncStatusStore from './SyncStatusStore.js';

test('retired working-set publication errors are never user-visible', () => {
  const retired = new Error('The mobile working-set publish session is no longer active.');
  assert.equal(isRetiredWorkingSetSyncError(retired), true);
  assert.equal(visibleSyncError(retired), null);
  assert.equal(visibleSyncError({ code: 'mobile-publish-session-inactive', message: 'anything' }), null);

  const current = new Error('Network unavailable');
  assert.equal(isRetiredWorkingSetSyncError(current), false);
  assert.equal(visibleSyncError(current), current);
});

test('retired persisted errors cannot keep a connected runtime in error state', async () => {
  const store = new SyncStatusStore({
    operations: {
      diagnostics: async () => ({
        counts: { accepted: 1 },
        oldestPending: null,
        latestError: {
          code: 'legacy',
          message: 'The mobile working-set publish session is no longer active.',
        },
      }),
    },
    conflicts: { listOpen: async () => [] },
    cursors: { list: async () => [] },
    referenceOutbox: { diagnostics: async () => ({ pending: 0, latestError: null }) },
  });
  store.setTransportConfigured(true);

  const snapshot = await store.refresh();
  assert.equal(snapshot.status, 'synced');
  assert.equal(snapshot.latestError, null);
  assert.equal(snapshot.counts.accepted, 1);
});

test('the account panel filters retired errors at render time and on mount', async () => {
  const source = await readFile(
    new URL('../../features/settings/components/SyncAccountPanel/SyncAccountPanel.jsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /clearRetiredWorkingSetError/);
  assert.match(source, /isRetiredWorkingSetSyncError\(snapshot\.error\)/);
  assert.doesNotMatch(source, /requestError \|\| snapshot\.error\?\.message/);
});
