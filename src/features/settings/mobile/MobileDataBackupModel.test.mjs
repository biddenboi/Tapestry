import assert from 'node:assert/strict';
import test from 'node:test';
import { describeMobileSyncState } from './MobileDataBackupModel.js';

test('mobile sync status prioritizes actionable conflicts and errors', () => {
  assert.deepEqual(describeMobileSyncState({
    status: 'conflict',
    openConflictCount: 2,
    counts: { pending: 3, conflict: 2 },
  }), {
    tone: 'warning',
    label: 'Sync needs attention',
    detail: '2 conflicts to review',
    pending: 3,
    conflicts: 2,
  });
  assert.equal(describeMobileSyncState({ status: 'error', latestError: { message: 'Rejected write' } }).detail, 'Rejected write');
});

test('mobile sync status stays passive offline and exposes queued work', () => {
  const state = describeMobileSyncState({ counts: { pending: 2, uploading: 1 } }, { online: false });
  assert.equal(state.label, 'Offline');
  assert.equal(state.detail, '3 changes waiting');
  assert.equal(state.pending, 3);
});

