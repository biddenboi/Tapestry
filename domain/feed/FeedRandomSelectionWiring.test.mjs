import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const databaseSource = await readFile(new URL('../../data/DatabaseConnection.js', import.meta.url), 'utf8');
const timelineSource = await readFile(
  new URL('../../data/persistence/services/TimelineQueryService.js', import.meta.url),
  'utf8',
);
const feedSource = await readFile(new URL('../../features/feed/components/Feed/Feed.jsx', import.meta.url), 'utf8');
const panelRequirementsSource = await readFile(
  new URL('../../app/data-source/panelDomainRequirements.js', import.meta.url),
  'utf8',
);

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start + signature.length);
  assert.ok(start >= 0 && end > start, `Could not isolate ${signature}`);
  return source.slice(start, end);
}

test('ordinary Feed maintains a five-post random buffer without ordered scans', () => {
  assert.match(feedSource, /getRandomVisibleFeedEntry\(viewerIGTRef\.current\)/);
  assert.match(feedSource, /const RANDOM_POSTS_AHEAD = 5;/);
  assert.match(
    feedSource,
    /minimumCount = bottomVisibleIndex \+ 1 \+ RANDOM_POSTS_AHEAD/,
  );
  assert.match(feedSource, /onVisibilityChange=\{handleRandomCardVisibility\}/);
  assert.match(feedSource, /randomItems\.map\(\(item, index\) =>/);
  assert.doesNotMatch(feedSource, /orderFeedEntries|getFeedPage|compareFeedEntriesNewestFirst/);

  const ordinaryLoad = methodBody(
    feedSource,
    'const loadRandomEntry = useCallback',
    'useEffect(() => {\n    if (!canLoad || search.trim())',
  );
  assert.doesNotMatch(ordinaryLoad, /getAllThroughIGT|journalComment|recommender|analyticsEvent/);
});

test('full journal scans remain confined to active text search', () => {
  const searchEffect = methodBody(
    feedSource,
    "useEffect(() => {\n    if (!isActive)",
    'const patchEntry = useCallback',
  );
  assert.match(searchEffect, /const query = search\.trim\(\)/);
  assert.match(searchEffect, /getAllThroughIGT\(STORES\.journal/);
  assert.match(searchEffect, /searchFeedEntries\(journals, byUUID, query\)/);
});

test('database random selection does not read recommender or behavior stores', () => {
  const randomMethod = methodBody(
    timelineSource,
    'async getRandomVisibleFeedEntry',
    'async getCommentsForJournalThroughIGT',
  );
  assert.match(randomMethod, /_store\(STORES\.journal\)/);
  assert.doesNotMatch(
    randomMethod,
    /recommender|analytics|behavior|taskRecommendations|_recordValues|getAll|sort\(/i,
  );
});

test('ordinary Feed does not preload the comments domain', () => {
  assert.match(panelRequirementsSource, /feed: Object\.freeze\(\[D\.journals, D\.profiles\]\)/);
});
