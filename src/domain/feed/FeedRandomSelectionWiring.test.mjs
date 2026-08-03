import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [feedSource, querySource, cursorSource, panelRequirementsSource] = await Promise.all([
  readFile(new URL('../../features/feed/pages/FeedPage/FeedPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../data/persistence/services/ChronicleQueryService.js', import.meta.url), 'utf8'),
  readFile(new URL('../chronicle/ChronicleFeedCursor.js', import.meta.url), 'utf8'),
  readFile(new URL('../../app/data-source/panelDomainRequirements.js', import.meta.url), 'utf8'),
]);

test('ordinary Feed is a finite Recent page with an explicit older-page action', () => {
  assert.match(feedSource, /defaultPageId: 'recent'/);
  assert.match(feedSource, /sectionId: 'feed'/);
  assert.match(feedSource, /const PAGE_SIZE = 12/);
  assert.match(feedSource, /Older shared writing/);
  assert.doesNotMatch(feedSource, /IntersectionObserver|RANDOM_POSTS_AHEAD|Shuffle feed/);
});

test('Recent uses stable chronological keyset cursors rather than engagement order', () => {
  assert.match(querySource, /sort\(compareChronicleFeedItems\)/);
  assert.match(querySource, /isAfterChronicleCursor/);
  assert.match(cursorSource, /publishedAt/);
  assert.match(cursorSource, /journalUUID/);
  assert.doesNotMatch(feedSource, /votes|score|ranked|recommender/i);
});

test('Wander is explicit, random, and stops after at most five entries', () => {
  assert.match(feedSource, /mode !== 'wander'/);
  assert.match(feedSource, /limit: 5/);
  assert.match(feedSource, /That’s five/);
  assert.match(querySource, /selected\.length < Math\.max\(1, Math\.min\(5, limit\)\)/);
});

test('Feed hydrates Chronicle, Journals, and profiles without Shop or inventory', () => {
  assert.match(panelRequirementsSource, /feed: Object\.freeze\(\[D\.feed, D\.chronicle, D\.profiles\]\)/);
  const feedRequirement = panelRequirementsSource.match(/feed: Object\.freeze\(\[[^\]]+\]\)/)?.[0] || '';
  assert.doesNotMatch(feedRequirement, /D\.(?:shop|inventory)/);
});

test('viewer visibility derives from the current profile IGT', () => {
  assert.match(feedSource, /getCurrentIGT\(currentPlayer\)/);
  assert.match(querySource, /viewerIGT/);
  assert.match(querySource, /canViewChronicleEntry/);
});
