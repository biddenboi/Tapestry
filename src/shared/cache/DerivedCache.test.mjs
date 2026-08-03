import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bumpSourceVersion,
  derivedCacheState,
  readStaleWhileRevalidate,
  sourceVersionForRecords,
  withDerivedCacheMetadata,
} from './DerivedCache.js';

test('derived caches carry deterministic source-domain versions', () => {
  const rows = [
    { UUID: 'b', updatedAt: '2026-01-02T00:00:00.000Z' },
    { UUID: 'a', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  assert.equal(sourceVersionForRecords(rows), sourceVersionForRecords([...rows].reverse()));
  const cache = withDerivedCacheMetadata({ rows }, { sourceVersions: { tasks: sourceVersionForRecords(rows) } });
  assert.equal(derivedCacheState(cache, cache.cache.sourceVersions).stale, false);
});

test('stale-while-revalidate returns cached data before scheduling replacement', async () => {
  const calls = [];
  const stale = withDerivedCacheMetadata({ rows: ['old'] }, { sourceVersions: { tasks: '1' } });
  const result = readStaleWhileRevalidate({
    value: stale,
    expectedSourceVersions: { tasks: '2' },
    schedule: async (callback) => {
      calls.push('scheduled');
      return callback();
    },
    revalidate: async () => calls.push('rebuilt'),
  });
  assert.deepEqual(result.value.rows, ['old']);
  assert.equal(result.stale, true);
  await result.revalidation;
  assert.deepEqual(calls, ['scheduled', 'rebuilt']);
});

test('incremental cache versions can advance without reading source stores', () => {
  assert.deepEqual(bumpSourceVersion({ tasks: '4' }, 'tasks'), { tasks: '5' });
});
