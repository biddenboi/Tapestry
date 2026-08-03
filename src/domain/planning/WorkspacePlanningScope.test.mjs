import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WORKSPACE_ID,
  dedupePlanningRecords,
  isPlanningRecordInWorkspace,
  withWorkspacePlanningScope,
} from './WorkspacePlanningScope.js';

test('legacy planning records belong only to the default workspace', () => {
  const legacy = { UUID: 'todo-1', parent: 'profile-1' };
  assert.equal(isPlanningRecordInWorkspace(legacy, DEFAULT_WORKSPACE_ID), true);
  assert.equal(isPlanningRecordInWorkspace(legacy, 'workspace:other'), false);
  assert.deepEqual(withWorkspacePlanningScope(legacy), {
    ...legacy,
    workspaceId: DEFAULT_WORKSPACE_ID,
    createdByPlayerId: 'profile-1',
  });
});

test('workspace planning records deduplicate by stable UUID using the newest copy', () => {
  const records = dedupePlanningRecords([
    { UUID: 'same', updatedAt: '2026-01-01T00:00:00.000Z', name: 'old' },
    { UUID: 'other', name: 'kept' },
    { UUID: 'same', updatedAt: '2026-01-02T00:00:00.000Z', name: 'new' },
  ]);
  assert.deepEqual(records.map(({ UUID, name }) => ({ UUID, name })), [
    { UUID: 'same', name: 'new' },
    { UUID: 'other', name: 'kept' },
  ]);
});
