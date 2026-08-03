import assert from 'node:assert/strict';
import test from 'node:test';
import { STORES } from '../../../domain/constants.js';
import { noteContentHash } from '../notes/noteDurability.js';
import { migrateLegacyQuickNotesToEntries } from './LegacyQuickNoteEntryMigration.js';

test('late legacy imports convert Quick Notes to private canonical Entries idempotently', async () => {
  const now = '2026-07-28T00:00:00.000Z';
  const source = {
    [STORES.player]: [{ UUID: 'p1', username: 'Writer' }],
    [STORES.notes]: [{
      UUID: 'n1', parent: 'p1', content: 'Preserve all of this.', revision: 4,
      contentHash: noteContentHash('Preserve all of this.'), createdAt: now, updatedAt: now,
    }],
  };
  const first = await migrateLegacyQuickNotesToEntries(source);
  const second = await migrateLegacyQuickNotesToEntries(first);
  assert.equal(second[STORES.journal].length, 1);
  assert.equal(second[STORES.journal][0].entry, 'Preserve all of this.');
  assert.equal(second[STORES.chronicleEntryMetadata][0].visibility, 'private');
  assert.equal(second[STORES.chronicleEntryAccess][0].editPolicy, 'owner');
  assert.equal(second[STORES.chronicleEntryRevision].length, 1);
  assert.equal(second[STORES.chronicleEntryOperationReceipt].length, 1);
  assert.equal(second[STORES.chronicleLegacyNoteMapping][0].legacyRevision, 4);
});

test('unowned legacy text is retained in recovery instead of being dropped', async () => {
  const migrated = await migrateLegacyQuickNotesToEntries({
    [STORES.notes]: [{ UUID: 'n1', content: 'Unowned text' }],
  });
  assert.equal(migrated[STORES.journal], undefined);
  assert.equal(migrated[STORES.chronicleLegacyNoteMapping][0].migrationState, 'conflict');
  assert.equal(migrated[STORES.chronicleEntryConflict][0].proposedBody, 'Unowned text');
});
