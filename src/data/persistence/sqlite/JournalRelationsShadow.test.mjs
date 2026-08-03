import assert from 'node:assert/strict';
import test from 'node:test';
import { DATA_DOMAIN, DOMAIN_INVALIDATION } from '../../../app/context/domainRevisions.js';
import { parseCompactJournal } from '../journals/CompactJournalMarkdown.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const now = new Date('2026-07-12T21:00:00.000Z');
const journalMarkdown = (id, created, igt, title, body) => `> uuid: ${id}\n> player: p1\n> createdAt: ${created}\n> editedAt:\n> inGameTimestamp: ${igt}\n\n# ${title}\n\n${body}\n`;

async function setup(context) {
  await context.shadow.importers.coreProfiles.import({
    players: [
      { UUID: 'p1', username: 'Owner', createdAt: now.toISOString() },
      { UUID: 'p2', username: 'Voter', createdAt: now.toISOString() },
    ],
    appState: { activePlayerUUID: 'p1' },
  });
  await context.shadow.importers.journals.import({
    journals: [
      { path: 'journals/2026/07/10/j1.md', manifestEntry: { uuid: 'j1' }, markdown: journalMarkdown('j1', '2026-07-10T00:00:00.000Z', 10, 'First', 'Body one') },
      { path: 'journals/2026/07/11/j2.md', manifestEntry: { uuid: 'j2' }, markdown: journalMarkdown('j2', '2026-07-11T00:00:00.000Z', 20, 'Second', 'Body two') },
      { path: 'journals/2026/07/12/j3.md', manifestEntry: { uuid: 'j3' }, markdown: journalMarkdown('j3', '2026-07-12T00:00:00.000Z', 30, 'Third', 'Body three') },
    ],
  });
  await context.shadow.importers.journalRelations.import({
    journalMetadata: [
      { UUID: 'j1', tags: ['Focus', '#daily'], votes: { p2: 1 }, sortAt: '2026-07-10T01:00:00.000Z', feedState: { version: 1, source: 'legacy' } },
      { UUID: 'j2', tags: ['daily'], votes: { p2: -1 }, pinned: true, sortAt: '2026-07-09T01:00:00.000Z' },
      { UUID: 'j3', visibility: 'hidden', tags: ['private'] },
    ],
    journalComments: [
      { UUID: 'c1', journalUUID: 'j1', authorUUID: 'p2', text: 'Earlier', createdAt: '2026-07-10T02:00:00.000Z', inGameTimestamp: 12, votes: { p1: 1 } },
      { UUID: 'c2', journalUUID: 'j1', authorUUID: 'p1', text: 'Later', createdAt: '2026-07-10T03:00:00.000Z', inGameTimestamp: 25, votes: { p2: -1 } },
    ],
  });
}

test('Batch 16 preserves feed metadata, votes, tags, comments, ordering, random selection, and IGT visibility', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  await setup(context);

  const feed = await context.shadow.journals.listFeed({ viewerIGT: 25 });
  assert.deepEqual(feed.map((entry) => entry.UUID), ['j2', 'j1']);
  assert.deepEqual(feed[0].tags, ['daily']);
  assert.deepEqual(feed[0].votes, { p2: -1 });
  assert.equal(feed[1].entry, 'Body one');
  assert.deepEqual(feed[1].feedState, { source: 'legacy', version: 1 });
  assert.equal((await context.shadow.journals.listFeed({ viewerIGT: 15 })).map((entry) => entry.UUID).join(','), 'j1');
  assert.equal((await context.shadow.journals.getRandomVisibleEntry(25, { random: () => 0.99 })).UUID, 'j1');

  const comments = await context.shadow.journals.getCommentsForJournalThroughIGT('j1', 20);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].UUID, 'c1');
  assert.deepEqual(comments[0].votes, { p1: 1 });

  const staged = await context.client.query({ sql: "SELECT compact_markdown FROM journal_import_staging WHERE journal_id='j1'", result: 'value' });
  const parsed = parseCompactJournal(staged);
  assert.equal(parsed.markdown.includes('pinned:'), false);
  assert.equal(parsed.markdown.includes('votes:'), false);
  assert.equal(parsed.markdown.includes('tags:'), false);
  assert.equal(parsed.markdown.includes('feedState:'), false);
});

test('Batch 16 typed mutations are idempotent and keep journal/profile/feed invalidation boundaries explicit', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  await setup(context);

  await context.shadow.journals.setJournalVote('j1', 'p2', -1, { operationId: 'vote-j1' });
  const duplicateVote = await context.shadow.journals.setJournalVote('j1', 'p2', -1, { operationId: 'vote-j1' });
  assert.equal(duplicateVote.duplicate, true);
  await context.shadow.journals.setTags('j1', ['New', '#focus', 'new'], { operationId: 'tags-j1' });
  await context.shadow.journals.setFeedMetadata('j1', {
    pinned: true, sortAt: '2026-07-12T21:01:00.000Z', feedState: { version: 2, mode: 'ranked' }, operationId: 'feed-j1',
  });
  await context.shadow.journals.upsertComment({
    UUID: 'c3', journalUUID: 'j1', authorUUID: 'p2', text: 'New comment', createdAt: now.toISOString(), inGameTimestamp: 13,
  }, { operationId: 'comment-c3' });
  await context.shadow.journals.setCommentVote('c3', 'p1', 1, { operationId: 'comment-vote-c3' });

  const j1 = await context.shadow.journals.getJournal('j1');
  assert.deepEqual(j1.tags, ['focus', 'New']);
  assert.deepEqual(j1.votes, { p2: -1 });
  assert.equal(j1.pinned, true);
  assert.deepEqual(j1.feedState, { mode: 'ranked', version: 2 });
  assert.deepEqual((await context.shadow.journals.getCommentsForJournalThroughIGT('j1', 20)).find((row) => row.UUID === 'c3').votes, { p1: 1 });

  assert.ok(DOMAIN_INVALIDATION.journalWrite.includes(DATA_DOMAIN.journals));
  assert.ok(DOMAIN_INVALIDATION.journalWrite.includes(DATA_DOMAIN.feed));
  assert.ok(DOMAIN_INVALIDATION.journalWrite.includes(DATA_DOMAIN.profiles));
  assert.ok(DOMAIN_INVALIDATION.journalWrite.includes(DATA_DOMAIN.profileSummaries));
  assert.equal(DOMAIN_INVALIDATION.journalWrite.includes(DATA_DOMAIN.shop), false);
  assert.equal(DOMAIN_INVALIDATION.journalWrite.includes(DATA_DOMAIN.matches), false);
});

test('Batch 16 representative journal queries use relational indexes', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  await setup(context);
  const commentPlan = await context.client.query({
    sql: `EXPLAIN QUERY PLAN SELECT * FROM journal_comments
          WHERE journal_id=? AND (in_game_timestamp IS NULL OR in_game_timestamp<=?)
          ORDER BY COALESCE(in_game_timestamp,0),created_at,id`,
    bind: ['j1', 20], result: 'all',
  });
  assert.ok(commentPlan.some((row) => String(row.detail || row).includes('journal_comments_journal_igt_idx')));
  const tagPlan = await context.client.query({
    sql: 'EXPLAIN QUERY PLAN SELECT journal_id FROM journal_tags WHERE normalized_tag=? ORDER BY journal_id',
    bind: ['daily'], result: 'all',
  });
  assert.ok(tagPlan.some((row) => String(row.detail || row).includes('journal_tags_lookup_idx')));
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});
