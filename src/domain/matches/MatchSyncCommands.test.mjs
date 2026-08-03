import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./MatchSyncCommands.js', import.meta.url), 'utf8'))
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { match: 'matches', player: 'players', worldConsequenceReceipt: 'worldConsequenceReceipts', rewardProvenance: 'rewardProvenance' };");
const commands = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('Match completion commits one canonical local transaction and one mobile sync envelope', async () => {
  const commits = [];
  const contexts = [];
  const databaseConnection = {
    createSyncCommandContext(input) {
      contexts.push(input);
      return { ...input, enqueueSync: true };
    },
    async commitAtomicMutation(input) {
      commits.push(input);
      return { duplicate: false };
    },
  };
  const match = { UUID: 'match-1', parent: 'profile-1', status: 'complete', result: { concludedAt: '2026-08-02T12:00:00.000Z' } };
  const player = { UUID: 'profile-1', elo: 1012 };
  const worldReceipt = { UUID: 'world-1' };
  const rewardProvenance = { UUID: 'reward-1' };
  await commands.saveMatchStateCommand(databaseConnection, match, {
    commandType: 'completeMatch',
    operationId: 'complete-match:match-1',
    player,
    worldReceipt,
    rewardProvenance,
    origin: 'mobile',
  });

  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].puts.map(({ store }) => store), [
    'matches', 'players', 'worldConsequenceReceipts', 'rewardProvenance',
  ]);
  assert.equal(commits[0].flush, true);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].origin, 'mobile');
  assert.equal(contexts[0].commandType, 'completeMatch');
  assert.equal(contexts[0].entityType, 'match');
  assert.equal(contexts[0].entityId, 'match-1');
  assert.equal(contexts[0].payload.match, match);
  assert.equal(contexts[0].payload.player, player);
  assert.equal(contexts[0].payload.worldReceipt, worldReceipt);
  assert.equal(contexts[0].payload.rewardProvenance, rewardProvenance);
});
