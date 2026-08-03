import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [feed, composer, detail, styles, cards, quick, story, hub, legacyFeed, legacyComposer, legacyDetail] = await Promise.all([
  read('../feed/pages/FeedPage/FeedPage.jsx'),
  read('./modals/ChronicleComposerModal/ChronicleComposerModal.jsx'),
  read('./modals/ChronicleEntryModal/ChronicleEntryModal.jsx'),
  read('./Chronicle.css'),
  read('./components/ChronicleCards/ChronicleCards.jsx'),
  read('./components/QuickCapture/QuickCaptureLauncher.jsx'),
  read('./pages/StoryReaderPage/StoryReaderPage.jsx'),
  read('../../app/shell/GameHub/GameHub.jsx'),
  read('../feed/components/Feed/Feed.jsx'),
  read('../feed/modals/PostComposerModal/PostComposerModal.jsx'),
  read('../feed/modals/JournalDetailModal/JournalDetailModal.jsx'),
]);

test('Feed defaults to finite Recent and makes random Wander explicit and bounded', () => {
  assert.match(feed, /defaultPageId: 'recent'/);
  assert.match(feed, /sectionId: 'feed'/);
  assert.match(feed, /const PAGE_SIZE = 12/);
  assert.match(feed, /Older shared writing/);
  assert.match(feed, /You’re caught up/);
  assert.match(feed, /limit: 5/);
  assert.match(feed, /That’s five/);
  assert.doesNotMatch(feed, /IntersectionObserver|infinite|Shuffle feed/);
  assert.doesNotMatch(feed, /Search what is currently loaded|Finite, chronological|intentionally finite/);
});

test('Chronicle social UI contains semantic reactions and Responses without vote or reward actions', () => {
  const socialSurface = [feed, detail, cards, legacyFeed, legacyDetail].join('\n');
  assert.match(detail, /ReactionBar/);
  assert.match(detail, /Responses/);
  assert.doesNotMatch(socialSurface, /VoteBar|upvote|downvote|feed-vote|score/i);
  assert.doesNotMatch(socialSurface, /emitReward|award|coins/i);
});

test('composer is private-first, autosaves, preserves close, and uses the canonical aliases', () => {
  assert.match(composer, /initialVisibility = 'private'/);
  assert.match(composer, /useState\(initial\?\.visibility \|\| initialVisibility\)/);
  assert.match(composer, /setTimeout\(\(\) =>/);
  assert.match(composer, /}, 700\)/);
  assert.match(composer, /Saved locally/);
  assert.match(composer, /protectedEditor/);
  assert.doesNotMatch(composer, /playSound|emitReward/);
  assert.match(legacyComposer, /ChronicleComposerModal/);
  assert.match(legacyDetail, /ChronicleEntryModal/);
});

test('Feed is the sole writing destination with Global and Yours consolidation', () => {
  for (const page of ['recent', 'global', 'wander', 'stories', 'essays', 'yours']) {
    assert.match(feed, new RegExp(`id: '${page}'`));
  }
  assert.doesNotMatch(feed, /chronicleOpen|My Chronicle|Back to Feed/);
  assert.match(feed, /<ChroniclePage embedded/);
  assert.match(composer, /EntryShareSelector/);
  assert.match(cards, /EntryAccessBadge/);
});

test('Quick Capture is mounted once and exposes keyboard and command entry points', () => {
  assert.equal((hub.match(/<QuickCaptureLauncher \/>/g) || []).length, 1);
  assert.match(quick, /metaKey \|\| event\.ctrlKey/);
  assert.match(quick, /event\.key\.toLowerCase\(\) === 'j'/);
  assert.match(quick, /tapestry:quick-capture/);
  assert.match(quick, /aria-keyshortcuts/);
  assert.match(quick, /hub-world-button hub-world-button--utility/);
  assert.doesNotMatch(styles, /position:\s*fixed;\s*\n\s*bottom: 18px;\s*\n\s*left: 82px/);
});

test('Stories are keyboard-readable and Chronicle styling spans sharp, responsive, reading, and reduced-motion conventions', () => {
  assert.match(story, /ArrowLeft/);
  assert.match(story, /ArrowRight/);
  assert.match(styles, /--theme-card-radius/);
  assert.match(styles, /\[data-theme="old_windows"\]/);
  assert.match(styles, /\[data-theme="pixelated"\]/);
  assert.match(styles, /\[data-theme="kawaii"\]/);
  assert.match(styles, /\[data-theme="dreamcore"\]/);
  assert.match(styles, /\[data-theme="gamification"\]/);
  assert.match(styles, /\[data-theme="mature_beige"\]/);
  assert.match(styles, /Georgia/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
