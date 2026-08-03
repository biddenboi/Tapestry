import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

let source = await readFile(new URL('./MobileMatchQueryService.js', import.meta.url), 'utf8');
source = source
  .replace("import { STORES } from '../../../domain/constants.js';", "const STORES = { match: 'matches' };")
  .replace("import { getMatchTeams } from '../../../domain/matches/MatchContracts.js';", "const getMatchTeams = (match) => match.teams || [];");
const service = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('mobile resumes the newest active canonical Match for the selected participant', async () => {
  const matches = [
    { UUID: 'complete', status: 'complete', participantProfileId: 'p1', updatedAt: '2026-08-02T12:00:00Z' },
    { UUID: 'pending', status: 'pending', parent: 'p1', updatedAt: '2026-08-02T12:10:00Z' },
    { UUID: 'other', status: 'active', participantProfileId: 'p2', updatedAt: '2026-08-02T12:20:00Z' },
    { UUID: 'active', status: 'active', teams: [[{ UUID: 'p1' }], [{ UUID: 'p2' }]], updatedAt: '2026-08-02T12:05:00Z' },
  ];
  const result = await service.queryResumableMobileMatch({
    async getAll(store) {
      assert.equal(store, 'matches');
      return matches;
    },
  }, { playerUUID: 'p1' });
  assert.equal(result.UUID, 'active');
});

test('mobile does not expose another profile’s pending or active Match', async () => {
  const result = await service.queryResumableMobileMatch({
    async getAll() {
      return [{ UUID: 'other', status: 'active', teams: [[{ UUID: 'p2' }]] }];
    },
  }, { playerUUID: 'p1' });
  assert.equal(result, null);
});
