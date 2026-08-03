import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./MatchmakingCommand.js', import.meta.url), 'utf8');
source = source
  .replace("import { v4 as uuid } from 'uuid';", "const uuid = () => 'generated-operation';")
  .replace("import { MATCH_STATUS, STORES } from '@domain/constants.js';", "const MATCH_STATUS = { pending: 'pending' }; const STORES = { match: 'matches' };")
  .replace("import { fireFirstMatchIfDue } from '@domain/events/Events.js';", 'const fireFirstMatchIfDue = async () => undefined;')
  .replace("import { buildGhostRoster } from '@domain/matches/Match.js';", "const buildGhostRoster = async () => ({ insufficient: false, teammates: [{ UUID: 'ally' }], opponents: [{ UUID: 'opponent' }] });")
  .replace(`import {
  createPairMatchContextSnapshot,
  PAIR_MATCH_RULESET_ID,
  withImmutableMatchSnapshots,
} from '@domain/matches/MatchContracts.js';`, "const PAIR_MATCH_RULESET_ID = 'pair-v1'; const createPairMatchContextSnapshot = (value) => value; const withImmutableMatchSnapshots = (value) => value;")
  .replace("import { getCurrentIGT } from '@domain/time/Time.js';", 'const getCurrentIGT = () => 123;')
  .replace("import { saveMatchStateCommand } from './MatchSyncCommands.js';", `const saveMatchStateCommand = (db, match, options) => db.commitAtomicMutation({
    operationId: options.operationId,
    label: options.label,
    sync: db.createSyncCommandContext({
      commandType: options.commandType,
      playerId: match.participantProfileId,
      entityId: match.UUID,
    }),
  });`);
const command = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('mobile Match creation pins the initiating profile and emits one replay-safe command', async () => {
  const commits = [];
  const databaseConnection = {
    async get() { return null; },
    async getPlayersAtIGT() { return [{ UUID: 'profile-1', username: 'Snapshot name' }]; },
    async getProfileContextProjections() { return new Map(); },
    createSyncCommandContext(input) { return { ...input, enqueueSync: true }; },
    async commitAtomicMutation(input) { commits.push(input); return { duplicate: false }; },
  };
  const result = await command.createPairMatchCommand(databaseConnection, {
    UUID: 'profile-1',
    username: 'Current name',
    activeCosmetics: { profileTheme: 'solar', avatarFrame: 'gold' },
  }, {
    operationId: 'match-operation-1',
    at: '2026-08-02T12:00:00.000Z',
  });
  assert.equal(result.match.UUID, 'pair-match:match-operation-1');
  assert.equal(result.match.participantProfileId, 'profile-1');
  assert.equal(result.match.teams[0][0].username, 'Current name');
  assert.equal(result.match.teams[0][0].profileTheme, 'solar');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].operationId, 'create-match:match-operation-1');
  assert.equal(commits[0].sync.commandType, 'createMatch');
  assert.equal(commits[0].sync.playerId, 'profile-1');
  assert.equal(commits[0].sync.entityId, result.match.UUID);
});

test('a repeated Match operation returns the persisted Match without recommitting', async () => {
  const persisted = { UUID: 'pair-match:same', participantProfileId: 'profile-1' };
  let commits = 0;
  const result = await command.createPairMatchCommand({
    async get() { return persisted; },
    async commitAtomicMutation() { commits += 1; },
  }, { UUID: 'profile-1' }, { operationId: 'same' });
  assert.equal(result.duplicate, true);
  assert.equal(result.match, persisted);
  assert.equal(commits, 0);
});

test('remote persistence registers every matching Match lifecycle replay handler', async () => {
  const runtime = await readFile(new URL('../../data/persistence/PersistenceRuntime.js', import.meta.url), 'utf8');
  assert.match(runtime, /\['createMatch', 'updateMatch', 'completeMatch'\]/);
  assert.match(runtime, /Remote Match state is missing its canonical Match snapshot/);
  assert.match(runtime, /sync: \{ origin: 'remote-sync', enqueueSync: false \}/);
});
