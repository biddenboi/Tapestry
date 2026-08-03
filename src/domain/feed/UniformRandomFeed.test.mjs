import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const postTagsSource = await readFile(new URL('./PostTags.js', import.meta.url), 'utf8');
const postTagsUrl = `data:text/javascript;base64,${Buffer.from(postTagsSource).toString('base64')}`;
const selectionSource = (await readFile(new URL('./UniformRandomFeed.js', import.meta.url), 'utf8'))
  .replace("from '@domain/feed/PostTags.js';", `from '${postTagsUrl}';`);
const {
  UniformRandomFeedIndex,
  isFeedEntryEligible,
  selectUniformRandomFeedEntry,
} = await import(`data:text/javascript;base64,${Buffer.from(selectionSource).toString('base64')}`);

const entries = [
  { UUID: 'a', parent: 'p1', type: 'note', tags: ['focus'], inGameTimestamp: 10 },
  { UUID: 'b', parent: 'p1', type: 'note', tags: ['focus', 'shipped'], inGameTimestamp: 20 },
  { UUID: 'c', parent: 'p2', type: 'image', tags: ['rest'], inGameTimestamp: 30 },
];

test('every eligible entry occupies an equal-width random interval', () => {
  const counts = new Map(entries.map((entry) => [entry.UUID, 0]));
  for (let bucket = 0; bucket < entries.length; bucket += 1) {
    const selected = selectUniformRandomFeedEntry(entries, {
      random: () => (bucket + 0.5) / entries.length,
    });
    counts.set(selected.UUID, counts.get(selected.UUID) + 1);
  }
  assert.deepEqual([...counts.values()], [1, 1, 1]);
});

test('explicit filters are applied before the unweighted draw', () => {
  const first = selectUniformRandomFeedEntry(entries, {
    filters: { authorUUIDs: ['p1'], tags: ['focus'] },
    random: () => 0,
  });
  const second = selectUniformRandomFeedEntry(entries, {
    filters: { authorUUIDs: ['p1'], tags: ['focus'] },
    random: () => 0.999999,
  });
  assert.equal(first.UUID, 'a');
  assert.equal(second.UUID, 'b');
});

test('empty and single-entry result sets are handled directly', () => {
  assert.equal(selectUniformRandomFeedEntry([], { random: () => 0.5 }), null);
  assert.equal(selectUniformRandomFeedEntry([entries[1]], { random: () => 0.999 }), entries[1]);
});

test('deleted and future entries are ineligible', () => {
  assert.equal(isFeedEntryEligible({ ...entries[0], deletedAt: '2026-01-01' }), false);
  assert.equal(isFeedEntryEligible(entries[2], { viewerIGT: 29 }), false);
  assert.equal(isFeedEntryEligible(entries[2], { viewerIGT: 30 }), true);
});

test('the ordinary indexed path performs bounded point reads, not a store scan', () => {
  const index = new UniformRandomFeedIndex(entries);
  let reads = 0;
  const store = {
    get(UUID) {
      reads += 1;
      return entries.find((entry) => entry.UUID === UUID);
    },
  };

  const selected = index.select(store, { viewerIGT: 100, random: () => 0.5 });
  assert.equal(selected.UUID, 'b');
  assert.equal(reads, 1);
});


test('ordinary selection point-read cost is independent of journal count', () => {
  for (const size of [10, 20_000]) {
    const records = Array.from({ length: size }, (_, index) => ({
      UUID: `entry-${index}`,
      inGameTimestamp: index,
    }));
    const index = new UniformRandomFeedIndex(records);
    const backing = new Map(records.map((entry) => [entry.UUID, entry]));
    let reads = 0;
    const store = {
      get(UUID) {
        reads += 1;
        return backing.get(UUID);
      },
    };

    const selected = index.select(store, { viewerIGT: size, random: () => 0.5 });
    assert.ok(selected);
    assert.equal(reads, 1);
  }
});

test('removed or newly ineligible indexed records cannot be selected', () => {
  const index = new UniformRandomFeedIndex(entries);
  const store = new Map(entries.map((entry) => [entry.UUID, entry]));

  store.delete('a');
  index.remove('a');
  assert.notEqual(index.select(store, { random: () => 0 })?.UUID, 'a');

  store.set('b', { ...entries[1], deleted: true });
  assert.equal(
    index.select(store, {
      filters: { authorUUIDs: ['p1'] },
      random: () => 0,
      rejectionAttempts: 1,
    }),
    null,
  );
});
