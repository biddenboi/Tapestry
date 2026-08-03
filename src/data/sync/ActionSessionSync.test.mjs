import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./ActionSessionSync.js', import.meta.url), 'utf8');
source = source.replace(
  "import { STORES } from '@domain/constants.js';",
  `const STORES = {
    todo: 'todos', actionSession: 'actionSessions', player: 'players',
    contribution: 'contributions', goalUpdate: 'goalUpdates', event: 'events',
    worldConsequenceReceipt: 'worldConsequences', handoff: 'handoffs',
    matchScoreEvent: 'matchScores', rewardProvenance: 'rewardProvenance',
  };`,
);
const { buildRemoteActionSessionMutation } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function record(UUID, extra = {}) {
  return { UUID, parent: 'profile-pinned', ...extra };
}

test('remote finalization replays the session and every canonical settlement record', () => {
  const mutation = buildRemoteActionSessionMutation({
    commandType: 'finalizeActionSession',
    payload: {
      session: record('session-1', { targetUUID: 'todo-1' }),
      player: record('profile-pinned'),
      todo: record('todo-1'),
      contribution: record('contribution-1'),
      goalUpdate: record('goal-update-1'),
      daybookEvent: record('event-1'),
      worldReceipt: record('world-1'),
      handoffRecords: [record('handoff-old'), record('handoff-new')],
      scoreEvent: record('score-1'),
      provenance: [record('provenance-1'), record('provenance-2')],
    },
  });

  assert.deepEqual(mutation.puts.map(({ store }) => store), [
    'actionSessions', 'players', 'todos', 'contributions', 'goalUpdates',
    'events', 'worldConsequences', 'handoffs', 'handoffs', 'matchScores',
    'rewardProvenance', 'rewardProvenance',
  ]);
  assert.deepEqual(mutation.sync, { origin: 'remote-sync', enqueueSync: false });
});

test('remote Action Session replay rejects cross-profile evidence and wrong targets', () => {
  assert.throws(() => buildRemoteActionSessionMutation({
    commandType: 'finalizeActionSession',
    payload: {
      session: record('session-1', { targetUUID: 'todo-1' }),
      contribution: record('contribution-1', { parent: 'profile-other' }),
    },
  }), (error) => error.code === 'action-session-profile-mismatch');

  assert.throws(() => buildRemoteActionSessionMutation({
    commandType: 'finalizeActionSession',
    payload: {
      session: record('session-1', { targetUUID: 'todo-1' }),
      todo: record('todo-other'),
    },
  }), (error) => error.code === 'action-session-target-mismatch');
});
