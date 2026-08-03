import assert from 'node:assert/strict';
import test from 'node:test';

import { createShadowTestContext } from '../../data/persistence/sqlite/shadowDomainTestUtils.mjs';
import {
  completeRoutineRun,
  completeRoutineStep,
  getActiveRoutineRun,
  getRoutineStepReceipts,
  startRoutineRun,
} from './RoutineCommands.js';

async function setup() {
  const context = await createShadowTestContext();
  const databaseConnection = {
    ready: Promise.resolve(),
    persistenceRuntime: { sqliteStorageAdapter: { client: context.client } },
    createSyncCommandContext({ origin = 'desktop' } = {}) {
      return { origin, enqueueSync: false };
    },
    async commitAtomicMutation({ operationId, label, additionalStatements = [] }) {
      const result = await context.client.executeAtomic({
        commandId: operationId,
        label,
        statements: additionalStatements,
      });
      return { changed: !result.duplicate, duplicate: result.duplicate };
    },
  };
  return { ...context, databaseConnection };
}

test('routine runs resume the exact next step and each receipt is idempotent', async () => {
  const { close, databaseConnection } = await setup();
  try {
    const started = await startRoutineRun(databaseConnection, {
      playerId: 'player-1',
      routineType: 'day',
      scheduledFor: '2026-08-02',
      steps: ['Water', 'Review day'],
      at: '2026-08-02T12:00:00.000Z',
    });
    assert.equal(started.currentStepId, 'step-1');

    const advanced = await completeRoutineStep(databaseConnection, started.id, 'step-1', {
      at: '2026-08-02T12:01:00.000Z',
    });
    assert.equal(advanced.currentStepId, 'step-2');
    await completeRoutineStep(databaseConnection, started.id, 'step-1', {
      at: '2026-08-02T12:02:00.000Z',
    });
    assert.equal((await getRoutineStepReceipts(databaseConnection, started.id)).length, 1);

    const resumed = await startRoutineRun(databaseConnection, {
      playerId: 'player-1',
      routineType: 'day',
      scheduledFor: '2026-08-02',
      steps: ['Water', 'Review day'],
    });
    assert.equal(resumed.currentStepId, 'step-2');
  } finally {
    await close();
  }
});

test('routine completion is stable and removes the run from active launch precedence', async () => {
  const { close, databaseConnection } = await setup();
  try {
    const started = await startRoutineRun(databaseConnection, {
      playerId: 'player-1', routineType: 'night', scheduledFor: '2026-08-02', steps: [],
    });
    const completed = await completeRoutineRun(databaseConnection, started.id, {
      at: '2026-08-03T04:00:00.000Z',
    });
    assert.equal(completed.status, 'completed');
    assert.equal(await getActiveRoutineRun(databaseConnection, 'player-1'), null);
    const replay = await completeRoutineRun(databaseConnection, started.id);
    assert.equal(replay.version, completed.version);
  } finally {
    await close();
  }
});
