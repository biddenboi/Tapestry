import assert from 'node:assert/strict';
import test from 'node:test';
import { recordGoalUpdateCommand } from './GoalUpdateCommands.js';

test('Goal updates keep workspace visibility while pinning authorship and sync to the active profile', async () => {
  let syncContext = null;
  let atomicMutation = null;
  const databaseConnection = {
    createSyncCommandContext(context) {
      syncContext = context;
      return { ...context, prepared: true };
    },
    async commitAtomicMutation(mutation) {
      atomicMutation = mutation;
      return { changed: true, duplicate: false };
    },
  };
  const goal = {
    UUID: 'goal-1',
    parent: 'creator-profile',
    workspaceId: 'workspace:default',
    name: 'Shared Goal',
  };
  const update = {
    UUID: 'update-1',
    parent: 'active-profile',
    goalUUID: goal.UUID,
    summary: 'Moved the work forward.',
    createdAt: '2026-08-02T18:00:00.000Z',
  };

  const result = await recordGoalUpdateCommand(databaseConnection, { goal, update }, {
    origin: 'mobile',
  });

  assert.equal(result.operationId, 'recordGoalUpdate:update-1');
  assert.equal(syncContext.playerId, 'active-profile');
  assert.equal(syncContext.workspaceId, 'workspace:default');
  assert.equal(syncContext.origin, 'mobile');
  assert.equal(syncContext.commandType, 'recordGoalUpdate');
  assert.equal(atomicMutation.puts[0].record.UUID, 'goal-1');
  assert.equal(atomicMutation.puts[1].record.parent, 'active-profile');
  assert.equal(atomicMutation.sync.prepared, true);
});

