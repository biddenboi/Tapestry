import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('./TaskRecommenderV12PolicyRegistry.js', import.meta.url), 'utf8');
source = source
  .replace("import { STORES } from '@domain/constants.js';", "const STORES = { appSetting: 'appSettings' };")
  .replace(/import \{[\s\S]*?\} from '\.\/TaskRecommenderV12Model\.js';/, "const createTaskRecommenderV12Model = () => ({}); const restoreTaskRecommenderV12Model = (value) => value; const serializeTaskRecommenderV12Model = (value) => value;");

const {
  pruneTaskRecommenderV12StoredModels,
  taskRecommenderV12ChampionPointerId,
  taskRecommenderV12PolicyManifestId,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('retains champion, rollback, and strongest candidate model only', async () => {
  const owner = 'p1';
  const records = new Map();
  records.set(taskRecommenderV12ChampionPointerId(owner), { UUID: taskRecommenderV12ChampionPointerId(owner), value: { championPolicyUUID: 'champ', previousChampionPolicyUUID: 'previous' } });
  for (const [id, role, error] of [['champ', 'current', 1], ['previous', 'current', 2], ['best', 'candidate', 0.2], ['stale', 'candidate', 0.7], ['neutral', 'neutral', 0]]) {
    const UUID = taskRecommenderV12PolicyManifestId(owner, id);
    records.set(UUID, { UUID, value: { playerUUID: owner, policyUUID: id, role, createdAt: `2026-01-0${records.size}T00:00:00.000Z`, trainingEvidence: { metrics: { validation: { meanSquaredError: error } } } } });
  }
  const db = {
    get: async (_store, id) => records.get(id),
    getAll: async () => [...records.values()],
    commitAtomicMutation: async ({ deletes }) => deletes.forEach(({ UUID }) => records.delete(UUID)),
  };
  const result = await pruneTaskRecommenderV12StoredModels(db, owner);
  assert.deepEqual(new Set(result.retained), new Set(['champ', 'previous', 'best']));
  assert.equal(result.removed, 2);
});
