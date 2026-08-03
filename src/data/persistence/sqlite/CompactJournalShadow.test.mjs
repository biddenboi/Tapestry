import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeJournalUtf8,
  hashCompactJournal,
  parseCompactJournal,
  serializeCompactJournal,
  validateJournalPath,
} from '../journals/CompactJournalMarkdown.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const now = new Date('2026-07-12T19:30:00.000Z');

function legacyMarkdown({ id, player = 'p1', created = '2026-06-13T00:00:00.000Z', updated = '', igt = 42, title = 'Daily note', body = 'Visible body.' } = {}) {
  return `> uuid: ${id}\n> player: ${player}\n> createdAt: ${created}\n> editedAt: ${updated}\n> inGameTimestamp: ${igt}\n\n# ${title}\n\n![[.attachments/${id}/image.png]]\n\n${body}\n`;
}

async function seedPlayer(context) {
  await context.shadow.importers.coreProfiles.import({
    players: [{ UUID: 'p1', username: 'Journal owner', createdAt: now.toISOString() }],
    appState: { activePlayerUUID: 'p1' },
  });
}

test('Batch 14 compact journal format is deterministic, minimal, and lossless for title/body text', async () => {
  const markdown = serializeCompactJournal({
    id: 'journal-1',
    player: 'p1',
    created: '2026-06-13T00:00:00.000Z',
    title: 'Café: "quoted"',
    body: 'First line\r\n---\r\nBody delimiter stays body.\nDecomposed: Cafe\u0301',
  });
  assert.equal(markdown.includes('updated:'), false);
  assert.equal(markdown.includes('tags:'), false);
  assert.equal(markdown.includes('votes:'), false);
  assert.equal(markdown.includes('feedState:'), false);
  assert.match(markdown, /^---\nid: "journal-1"\nplayer: "p1"\ncreated:/);

  const parsed = parseCompactJournal(markdown, { expectedId: 'journal-1', path: 'journals/2026/06/13/journal-1.md' });
  assert.equal(parsed.title, 'Café: "quoted"');
  assert.equal(parsed.body, 'First line\n---\nBody delimiter stays body.\nDecomposed: Café');
  assert.equal(parsed.canonical, true);
  const first = await hashCompactJournal(markdown);
  const second = await hashCompactJournal(parsed.markdown);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.contentHash.length, 64);
});

test('Batch 14 rejects invalid UTF-8, duplicate/unknown frontmatter, and unsafe paths', () => {
  assert.throws(() => decodeJournalUtf8(Uint8Array.from([0xc3, 0x28])), (error) => error.code === 'invalid-utf8');
  assert.throws(() => parseCompactJournal(`---\nid: "x"\nid: "y"\nplayer: "p1"\ncreated: "2026-01-01T00:00:00.000Z"\n---\n# T\n\nB\n`),
    (error) => error.code === 'duplicate-frontmatter-key');
  assert.throws(() => parseCompactJournal(`---\nid: "x"\nplayer: "p1"\ncreated: "2026-01-01T00:00:00.000Z"\npinned: "true"\n---\n# T\n\nB\n`),
    (error) => error.code === 'unknown-frontmatter-key');
  assert.throws(() => validateJournalPath('journals/2026/06/../../secrets.md'), (error) => error.code === 'unsafe-path');
  assert.throws(() => validateJournalPath('other/journal.md'), (error) => error.code === 'unsafe-path');
});

test('Batch 14 stages legacy journals, preserves attachment references, and quarantines malformed or duplicate inputs', async (t) => {
  const context = await createShadowTestContext({ now: () => now });
  t.after(context.close);
  await seedPlayer(context);
  const source = {
    journals: [{
      path: 'journals/2026/06/13/journal-a.md',
      manifestEntry: { uuid: 'journal-a', path: 'journals/2026/06/13/journal-a.md' },
      markdown: legacyMarkdown({ id: 'journal-a', title: 'A: title', body: 'Body A\n---\nStill body.' }),
    }, {
      path: 'journals/2026/06/14/journal-b.md',
      manifestEntry: { uuid: 'journal-b', path: 'journals/2026/06/14/journal-b.md' },
      markdown: legacyMarkdown({ id: 'journal-b', created: '2026-06-14T00:00:00.000Z', updated: '2026-06-14T01:00:00.000Z', title: 'B', body: 'Body B' }),
    }, {
      path: 'journals/2026/06/15/journal-a-copy.md',
      manifestEntry: { uuid: 'journal-a', path: 'journals/2026/06/15/journal-a-copy.md' },
      markdown: legacyMarkdown({ id: 'journal-a', title: 'Conflicting duplicate', body: 'Must be quarantined.' }),
    }, {
      path: 'journals/2026/../escape.md',
      manifestEntry: { uuid: 'journal-bad', path: 'journals/2026/../escape.md' },
      markdown: legacyMarkdown({ id: 'journal-bad' }),
    }],
    journalMetadata: [{ UUID: 'journal-a', tags: ['focus'], votes: { p1: 1 }, pinned: true }, { UUID: 'orphan-meta', tags: ['orphan'] }],
  };

  const imported = await context.shadow.importers.journals.import(source);
  assert.deepEqual(imported.counts, {
    inputDocuments: 4,
    converted: 2,
    quarantined: 2,
    metadataRecords: 2,
    diagnostics: imported.counts.diagnostics,
  });
  assert.ok(imported.counts.diagnostics >= 3);
  assert.equal(imported.stagedDocuments.length, 2);

  const stagedA = imported.stagedDocuments.find((row) => row.id === 'journal-a');
  const parsedA = parseCompactJournal(stagedA.markdown, { expectedId: 'journal-a', path: stagedA.targetPath });
  assert.equal(parsedA.title, 'A: title');
  assert.equal(parsedA.body, '![[.attachments/journal-a/image.png]]\n\nBody A\n---\nStill body.');
  assert.equal(stagedA.contentHash, (await hashCompactJournal(stagedA.markdown)).contentHash);
  assert.equal((await context.client.query({ sql: 'SELECT COUNT(*) FROM journal_import_quarantine', result: 'value' })), 2);
  assert.equal((await context.client.query({ sql: "SELECT document_state FROM journals WHERE id='journal-a'", result: 'value' })), 'staged');
  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);

  const duplicate = await context.shadow.importers.journals.import(source);
  assert.equal(duplicate.duplicate, true);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM shadow_import_runs WHERE domain='journals'", result: 'value' }), 1);
});
