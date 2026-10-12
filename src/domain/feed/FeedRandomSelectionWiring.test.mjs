import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [feedSource, querySource, cursorSource, panelRequirementsSource] = await Promise.all([
  readFile(new URL('../../features/feed/pages/FeedPage/FeedPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../data/persistence/services/ChronicleQueryService.js', import.meta.url), 'utf8'),
  readFile(new URL('../chronicle/ChronicleFeedCursor.js', import.meta.url), 'utf8'),
  readFile(new URL('../../app/data-source/panelDomainRequirements.js', import.meta.url), 'utf8'),
]);




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
