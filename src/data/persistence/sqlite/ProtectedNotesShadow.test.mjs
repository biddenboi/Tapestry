import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Text } from './migrationChecksum.js';
import { createShadowTestContext } from './shadowDomainTestUtils.mjs';

const baseTime = new Date('2026-07-12T18:00:00.000Z');

async function seedCore(context) {
  await context.shadow.importers.coreProfiles.import({
    players: [{ UUID: 'p1', username: 'Notes' }], appState: { activePlayerUUID: 'p1' },
    economyState: { globalMoney: 0 }, settings: [],
  });
}

test('Batch 13 imports notes by revision/hash, preserves all text, and quarantines ambiguity', async (t) => {
  const context = await createShadowTestContext({ now: () => baseTime });
  t.after(context.close);
  await seedCore(context);
  const records = [
    { UUID: 'same', parent: 'p1', content: 'older text', revision: 1, createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString(), lastOperationId: 'old-op' },
    { UUID: 'same', parent: 'p1', content: 'equal revision A', revision: 2, createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString(), lastOperationId: 'equal-a' },
    { UUID: 'same', parent: 'p1', content: 'equal revision B', revision: 2, createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString(), lastOperationId: 'equal-b' },
    { UUID: 'deleted', parent: 'p1', content: '', revision: 3, deletedAt: baseTime.toISOString(), createdAt: baseTime.toISOString(), updatedAt: baseTime.toISOString(), lastOperationId: 'delete-op' },
  ];
  const result = await context.shadow.importers.notes.import({ notes: records });
  assert.equal(result.counts.notes, 2);
  assert.equal(result.counts.tombstones, 1);
  assert.ok(result.diagnostics.some((entry) => entry.reason === 'same-revision-different-hash'));
  assert.ok(result.diagnostics.some((entry) => entry.reason === 'stale-source'));

  const canonical = await context.shadow.notes.get('same', { includeDeleted: true });
  assert.equal(canonical.revision, 2);
  assert.equal(canonical.contentHash.length, 64);
  const conflicts = await context.shadow.notes.getConflicts({ noteId: 'same', includeResolved: true });
  const allText = new Set([canonical.content, ...conflicts.map((conflict) => conflict.content)]);
  assert.deepEqual(allText, new Set(['older text', 'equal revision A', 'equal revision B']));
  assert.equal((await context.shadow.notes.get('deleted', { includeDeleted: true })).deletedAt, baseTime.toISOString());

  assert.deepEqual(await context.client.query({ sql: 'PRAGMA foreign_key_check', result: 'all' }), []);
});

test('Batch 13 enforces CAS, idempotency, conflicts, tombstones, and conflict resolution', async (t) => {
  let current = new Date(baseTime);
  const context = await createShadowTestContext({ now: () => new Date(current) });
  t.after(context.close);
  await seedCore(context);

  const created = await context.shadow.notes.createNote({ UUID: 'n1', parent: 'p1', content: 'v1' }, { operationId: 'create-n1', now: current });
  assert.equal(created.status, 'applied');
  assert.equal(created.record.revision, 1);
  const duplicateCreate = await context.shadow.notes.createNote({ UUID: 'n1', parent: 'p1', content: 'ignored' }, { operationId: 'create-n1', now: current });
  assert.equal(duplicateCreate.idempotent, true);

  current = new Date('2026-07-12T18:01:00.000Z');
  const updated = await context.shadow.notes.updateNoteIfCurrent('n1', {
    content: 'v2', expectedRevision: created.record.revision, expectedHash: created.record.contentHash,
    operationId: 'update-n1', now: current,
  });
  assert.equal(updated.status, 'applied');
  assert.equal(updated.record.revision, 2);
  assert.equal(updated.record.content, 'v2');

  const stale = await context.shadow.notes.updateNoteIfCurrent('n1', {
    content: 'stale text', expectedRevision: 1, expectedHash: created.record.contentHash,
    operationId: 'stale-n1', now: current,
  });
  assert.equal(stale.status, 'conflict');
  assert.equal((await context.shadow.notes.get('n1')).content, 'v2');
  assert.equal(stale.conflict.content, 'stale text');

  const resolved = await context.shadow.notes.resolveConflict(stale.conflict.UUID, {
    expectedRevision: 2, expectedHash: updated.record.contentHash, operationId: 'resolve-n1', now: current,
  });
  assert.equal(resolved.status, 'applied');
  assert.equal(resolved.record.revision, 3);
  assert.equal(resolved.record.content, 'stale text');

  const deleted = await context.shadow.notes.deleteNoteIfCurrent('n1', {
    expectedRevision: 3, expectedHash: resolved.record.contentHash, operationId: 'delete-n1', now: current,
  });
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.record.revision, 4);
  assert.equal(deleted.record.content, '');

  const resurrection = await context.shadow.notes.updateNoteIfCurrent('n1', {
    content: 'resurrected', expectedRevision: 3, expectedHash: resolved.record.contentHash,
    operationId: 'resurrect-n1', now: current,
  });
  assert.equal(resurrection.status, 'conflict');
  assert.equal(resurrection.conflict.conflictReason, 'deleted');
  assert.equal((await context.shadow.notes.get('n1', { includeDeleted: true })).revision, 4);

  const diagnostics = await context.shadow.notes.getRevisionDiagnostics('n1');
  assert.equal(diagnostics.monotonic, true);
  assert.deepEqual(diagnostics.receipts.map((receipt) => receipt.revision), [1, 2, 3, 4]);
  assert.equal(await context.client.query({ sql: "SELECT COUNT(*) FROM note_write_receipts WHERE operation_id='update-n1'", result: 'value' }), 1);
});

test('Batch 13 stale clients and interrupted transactions cannot replace canonical text', async (t) => {
  const context = await createShadowTestContext({ now: () => baseTime });
  t.after(context.close);
  await seedCore(context);
  const firstRepository = context.shadow.notes;
  const secondRepository = new (firstRepository.constructor)({ client: context.client, now: () => baseTime });
  const created = await firstRepository.createNote({ UUID: 'race', parent: 'p1', content: 'base' }, { operationId: 'race-create', now: baseTime });

  const winner = await firstRepository.updateNoteIfCurrent('race', {
    content: 'winner', expectedRevision: created.record.revision, expectedHash: created.record.contentHash,
    operationId: 'race-winner', now: baseTime,
  });
  const loser = await secondRepository.updateNoteIfCurrent('race', {
    content: 'loser', expectedRevision: created.record.revision, expectedHash: created.record.contentHash,
    operationId: 'race-loser', now: baseTime,
  });
  assert.equal(winner.status, 'applied');
  assert.equal(loser.status, 'conflict');
  assert.equal((await firstRepository.get('race')).content, 'winner');

  await assert.rejects(context.client.executeAtomic({
    commandId: 'note-interrupted-transaction',
    label: 'note-interruption-fixture',
    statements: [
      { sql: "UPDATE notes SET content='should rollback',revision=revision+1 WHERE id='race'", result: 'changes' },
      { sql: 'INSERT INTO table_that_does_not_exist(value) VALUES(1)', result: 'changes' },
    ],
  }));
  assert.equal((await firstRepository.get('race')).content, 'winner');
  assert.equal((await firstRepository.get('race')).revision, 2);

  assert.equal((await firstRepository.get('race')).contentHash, await sha256Text('winner'));
});
