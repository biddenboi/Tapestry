import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryJournalFileAdapter } from '../journals/JournalFileAdapters.js';
import { hashCompactJournal, serializeCompactJournal } from '../journals/CompactJournalMarkdown.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const fixedNow = new Date('2026-07-12T20:00:00.000Z');

function legacy(id = 'journal-1', body = 'Version one') {
  return `> uuid: ${id}\n> player: p1\n> createdAt: 2026-06-13T00:00:00.000Z\n> editedAt:\n> inGameTimestamp: 9\n\n# Journal\n\n${body}\n`;
}

async function setup() {
  const context = await createShadowTestContext({ now: () => fixedNow });
  await context.shadow.importers.coreProfiles.import({
    players: [{ UUID: 'p1', username: 'Owner', createdAt: fixedNow.toISOString() }],
    appState: { activePlayerUUID: 'p1' },
  });
  await context.shadow.importers.journals.import({
    journals: [{ path: 'journals/2026/06/13/journal-1.md', manifestEntry: { uuid: 'journal-1' }, markdown: legacy() }],
  });
  const files = new MemoryJournalFileAdapter();
  const service = context.shadow.createJournalFileOperations(files);
  await service.publishStagedImport('journal-1', { operationId: 'initial-publish' });
  return { context, files };
}

for (const phase of ['after-prepare', 'after-file-publish', 'after-published-state', 'after-index']) {
  test(`Batch 15 recovers an update crash at ${phase} without losing the prior or proposed journal`, async (t) => {
    const { context, files } = await setup();
    t.after(context.close);
    const before = await context.shadow.createJournalFileOperations(files).getJournal('journal-1');
    const oldPath = before.filePath;
    const oldText = await files.readText(oldPath);
    let injected = false;
    const crashing = context.shadow.createJournalFileOperations(files, {
      phaseHook: (name) => {
        if (!injected && name === phase) {
          injected = true;
          throw new Error(`crash:${phase}`);
        }
      },
    });
    const nextMarkdown = serializeCompactJournal({
      id: 'journal-1', player: 'p1', created: before.created,
      updated: '2026-07-12T20:00:00.000Z', title: 'Journal', body: `Version two (${phase})`,
    });
    await assert.rejects(crashing.updateJournal('journal-1', nextMarkdown, {
      operationId: `update-${phase}`,
      expectedRevision: before.revision,
      expectedHash: before.contentHash,
    }), new RegExp(`crash:${phase}`));

    assert.equal(await files.readText(oldPath), oldText, 'the prior version must remain intact');
    const recovery = context.shadow.createJournalFileOperations(files);
    const report = await recovery.reconcile();
    const after = await recovery.getJournal('journal-1');
    assert.equal(after.state, 'indexed');
    assert.equal(after.revision, before.revision + 1);
    assert.equal((await hashCompactJournal(await files.readText(after.filePath))).contentHash, after.contentHash);
    assert.match(await files.readText(after.filePath), new RegExp(`Version two \\(${phase}\\)`));
    assert.equal(await files.readText(oldPath), oldText, 'reconciliation must not destroy the known-good prior version');
    assert.equal((await recovery.reconcile()).resumed.length, 0, 'startup reconciliation must be idempotent');
    assert.ok(report.resumed.length <= 1);
  });
}

test('Batch 15 imports a valid external edit and quarantines the stale proposed overwrite', async (t) => {
  const { context, files } = await setup();
  t.after(context.close);
  const service = context.shadow.createJournalFileOperations(files);
  const before = await service.getJournal('journal-1');
  const external = serializeCompactJournal({
    id: 'journal-1', player: 'p1', created: before.created,
    updated: '2026-07-12T20:01:00.000Z', title: 'External title', body: 'Edited outside Tapestry',
  });
  await files.writeText(before.filePath, external);
  const attempted = serializeCompactJournal({
    id: 'journal-1', player: 'p1', created: before.created,
    updated: '2026-07-12T20:02:00.000Z', title: 'Stale app title', body: 'Stale proposed text',
  });
  const result = await service.updateJournal('journal-1', attempted, {
    operationId: 'stale-after-external',
    expectedRevision: before.revision,
    expectedHash: before.contentHash,
  });
  assert.equal(result.status, 'quarantined');
  assert.equal(result.operation.errorCode, 'external-edit');
  const canonical = await service.getJournal('journal-1');
  assert.equal(canonical.title, 'External title');
  assert.equal(canonical.revision, before.revision + 1);
  assert.equal(canonical.contentHash, (await hashCompactJournal(external)).contentHash);
  assert.equal(await files.readText(before.filePath), external);
  assert.ok((await service.listOpenIssues()).some((issue) => issue.issueType === 'external-edit'));
});

test('Batch 15 tombstones deletes and reports missing, duplicate-ID, and orphan states deterministically', async (t) => {
  const { context, files } = await setup();
  t.after(context.close);
  const service = context.shadow.createJournalFileOperations(files);
  const before = await service.getJournal('journal-1');
  const duplicatePath = `journals/.versions/journal-1/${'a'.repeat(64)}.md`;
  await files.writeText(duplicatePath, await files.readText(before.filePath));
  const orphan = serializeCompactJournal({
    id: 'orphan-journal', player: 'p1', created: '2026-06-15T00:00:00.000Z', title: 'Orphan', body: 'Unindexed',
  });
  const orphanHash = (await hashCompactJournal(orphan)).contentHash;
  const orphanPath = `journals/.versions/orphan-journal/${orphanHash}.md`;
  await files.writeText(orphanPath, orphan);

  const firstReport = await service.reconcile();
  assert.ok(firstReport.duplicateIds.some((row) => row.journalId === 'journal-1'));
  assert.ok(firstReport.orphans.some((row) => row.path === orphanPath));
  const issueCount = (await service.listOpenIssues()).length;
  await service.reconcile();
  assert.equal((await service.listOpenIssues()).length, issueCount, 'same reconciliation issue must not duplicate');

  const deleted = await service.deleteJournal('journal-1', {
    operationId: 'delete-journal-1', expectedRevision: before.revision, expectedHash: before.contentHash,
  });
  assert.equal(deleted.status, 'indexed');
  assert.equal(deleted.journal.state, 'deleted');
  assert.equal(await files.readText(before.filePath) != null, true, 'tombstone retention keeps bytes until GC eligibility');
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM journal_file_tombstones WHERE journal_id='journal-1'", result: 'value' }), 1);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM journal_file_garbage_candidates WHERE path=?", bind: [before.filePath], result: 'value' }), 1);
});

test('Batch 15 moves journals by publishing a verified new path and retaining the prior version', async (t) => {
  const { context, files } = await setup();
  t.after(context.close);
  const service = context.shadow.createJournalFileOperations(files);
  const before = await service.getJournal('journal-1');
  const oldText = await files.readText(before.filePath);
  const targetPath = 'journals/2026/07/12/journal-1.md';
  const moved = await service.moveJournal('journal-1', targetPath, {
    operationId: 'move-journal-1', expectedRevision: before.revision, expectedHash: before.contentHash,
  });
  assert.equal(moved.status, 'indexed');
  assert.equal(moved.journal.filePath, targetPath);
  assert.equal(moved.journal.revision, before.revision + 1);
  assert.equal(await files.readText(targetPath), oldText);
  assert.equal(await files.readText(before.filePath), oldText);
  assert.equal(await context.client.query({
    sql: 'SELECT COUNT(*) FROM journal_file_garbage_candidates WHERE path=?', bind: [before.filePath], result: 'value',
  }), 1);
  await assert.rejects(service.moveJournal('journal-1', 'journals/../../escape.md', {
    operationId: 'unsafe-move', expectedRevision: moved.journal.revision, expectedHash: moved.journal.contentHash,
  }), (error) => error.code === 'unsafe-path');
});

test('Batch 15 reports an indexed journal whose file is missing without inventing replacement content', async (t) => {
  const { context, files } = await setup();
  t.after(context.close);
  const service = context.shadow.createJournalFileOperations(files);
  const journal = await service.getJournal('journal-1');
  await files.remove(journal.filePath);
  const report = await service.reconcile();
  assert.deepEqual(report.missing.map((row) => row.journalId), ['journal-1']);
  assert.equal((await service.getJournal('journal-1')).contentHash, journal.contentHash);
  assert.ok((await service.listOpenIssues()).some((issue) => issue.issueType === 'indexed-file-missing'));
});
