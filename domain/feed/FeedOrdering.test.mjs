import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const postTagsSource = await readFile(new URL('./PostTags.js', import.meta.url), 'utf8');
const postTagsUrl = `data:text/javascript;base64,${Buffer.from(postTagsSource).toString('base64')}`;
const orderingSource = (await readFile(new URL('./FeedOrdering.js', import.meta.url), 'utf8'))
  .replace("from '@domain/feed/PostTags.js';", `from '${postTagsUrl}';`);
const {
  scorePostTextRelevance,
  searchFeedEntries,
} = await import(`data:text/javascript;base64,${Buffer.from(orderingSource).toString('base64')}`);

test('search uses text relevance without ordinary feed ordering signals', () => {
  const entries = [
    {
      UUID: 'newer-body-match',
      parent: 'player-1',
      title: 'Weekly update',
      entry: 'A short note about focus.',
      inGameTimestamp: 30,
    },
    {
      UUID: 'older-title-match',
      parent: 'player-2',
      title: 'Focus',
      entry: 'Planning notes.',
      inGameTimestamp: 20,
    },
    {
      UUID: 'non-match',
      parent: 'player-1',
      title: 'Recovery',
      entry: 'Rest day.',
      inGameTimestamp: 40,
    },
  ];
  const players = {
    'player-1': { username: 'Ari' },
    'player-2': { username: 'Bo' },
  };

  assert.ok(
    scorePostTextRelevance(entries[1], players['player-2'], 'focus')
      > scorePostTextRelevance(entries[0], players['player-1'], 'focus'),
  );
  assert.deepEqual(searchFeedEntries(entries, players, 'focus').map((entry) => entry.UUID), [
    'older-title-match',
    'newer-body-match',
  ]);
});

test('equal-relevance search results retain input order rather than recency order', () => {
  const entries = [
    { UUID: 'first', title: 'Focus note', inGameTimestamp: 1 },
    { UUID: 'second', title: 'Focus note', inGameTimestamp: 999 },
  ];
  assert.deepEqual(searchFeedEntries(entries, {}, 'focus').map((entry) => entry.UUID), ['first', 'second']);
});

test('explicit tag and comma-separated search criteria retain AND semantics', () => {
  const entries = [
    { UUID: 'both', title: 'Deep work', entry: '#focus shipped', tags: ['focus'], inGameTimestamp: 10 },
    { UUID: 'tag-only', title: 'Break', entry: '#focus', tags: ['focus'], inGameTimestamp: 20 },
  ];

  assert.deepEqual(searchFeedEntries(entries, {}, '#focus, shipped').map((entry) => entry.UUID), ['both']);
  assert.deepEqual(searchFeedEntries(entries, {}, ''), []);
});
