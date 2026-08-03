import {
  createNoteConflict,
  isNoteConflict,
  normalizeNoteRecord,
} from '../notes/noteDurability.js';
import {
  asObject,
  createImportLedgerStatements,
  fingerprintShadowSource,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';
import { sha256Text } from './migrationChecksum.js';

const IMPORTER_VERSION = 'batch13-protected-notes-v2';
const NOTE_KEYS = [
  'UUID','parent','playerUUID','content','revision','contentHash','createdAt','updatedAt','deletedAt',
  'deletedContentHash','lastOperationId','operationReceipts','recordKind',
];
const CONFLICT_KEYS = [
  'UUID','recordKind','conflictOf','baseRevision','canonicalRevision','content','contentHash','canonicalHash',
  'operationId','attemptedAction','conflictReason','conflictSource','conflictDetectedAt','createdAt','updatedAt',
  'resolvedAt','resolution',
];

function chooseCanonicalNotes(records, diagnostics) {
  const grouped = new Map();
  for (const raw of records) {
    const note = normalizeNoteRecord(raw);
    if (!note || isNoteConflict(note)) continue;
    const rows = grouped.get(note.UUID) || [];
    rows.push(note);
    grouped.set(note.UUID, rows);
  }
  const selected = [];
  const generatedConflicts = [];
  for (const noteId of [...grouped.keys()].sort()) {
    const rows = grouped.get(noteId).sort((left, right) => (
      Number(right.revision) - Number(left.revision)
      || String(left.content).localeCompare(String(right.content))
      || stableJson(left).localeCompare(stableJson(right))
    ));
    const winner = rows[0];
    selected.push(winner);
    for (const loser of rows.slice(1)) {
      const equivalent = loser.revision === winner.revision
        && String(loser.content) === String(winner.content)
        && Boolean(loser.deletedAt) === Boolean(winner.deletedAt);
      if (equivalent) continue;
      const reason = loser.revision === winner.revision
        ? 'same-revision-different-hash'
        : 'stale-source';
      diagnostics.push({
        kind: 'note', recordId: noteId, reason,
        canonicalRevision: winner.revision, attemptedRevision: loser.revision,
        canonicalHash: winner.contentHash, attemptedHash: loser.contentHash,
      });
      generatedConflicts.push(createNoteConflict({
        noteUUID: noteId,
        attemptedRecord: loser,
        canonicalRecord: winner,
        action: 'shadow-import',
        reason,
        source: 'sqlite-shadow-import',
        detectedAt: winner.updatedAt || winner.deletedAt || winner.createdAt,
        suffix: `sqlite-import-r${loser.revision}-${loser.contentHash}`,
      }));
    }
  }
  return { selected, generatedConflicts };
}

function normalizeConflict(raw) {
  if (!raw) return null;
  if (isNoteConflict(raw)) {
    return {
      ...raw,
      UUID: String(raw.UUID),
      conflictOf: String(raw.conflictOf || ''),
      content: String(raw.content || ''),
      contentHash: raw.contentHash || normalizeNoteRecord({ UUID: 'hash', content: raw.content }).contentHash,
    };
  }
  return null;
}

export class ProtectedNotesShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('ProtectedNotesShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ notes = [], runId = null } = {}) {
    const sourceFingerprint = await fingerprintShadowSource({ notes });
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs WHERE domain='protected-notes' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) {
      return {
        duplicate: true, runId: existing.runId, sourceFingerprint,
        counts: JSON.parse(existing.countsJson), diagnostics: JSON.parse(existing.diagnosticsJson),
      };
    }

    const diagnostics = [];
    const malformed = [];
    const normalizedRecords = [];
    for (const raw of Array.isArray(notes) ? notes : []) {
      const normalized = normalizeNoteRecord(raw);
      if (!normalized) malformed.push({ kind: 'note', reason: 'missing-id', record: raw });
      else normalizedRecords.push(normalized);
    }
    diagnostics.push(...malformed);
    const { selected, generatedConflicts } = chooseCanonicalNotes(normalizedRecords, diagnostics);
    const sourceConflicts = normalizedRecords.map(normalizeConflict).filter(Boolean);
    const conflictsById = new Map();
    for (const conflict of [...sourceConflicts, ...generatedConflicts].sort((a, b) => String(a.UUID).localeCompare(String(b.UUID)))) {
      const existingConflict = conflictsById.get(conflict.UUID);
      if (!existingConflict) conflictsById.set(conflict.UUID, conflict);
      else if (stableJson(existingConflict) !== stableJson(conflict)) {
        diagnostics.push({ kind: 'note-conflict', recordId: conflict.UUID, reason: 'duplicate-conflict-id' });
        const alternate = { ...conflict, UUID: `${conflict.UUID}-${conflict.contentHash}` };
        conflictsById.set(alternate.UUID, alternate);
      }
    }

    const playerRows = await this.client.query({ sql: 'SELECT id FROM players ORDER BY id', result: 'all' });
    const playerIds = new Set(playerRows.map((row) => String(row.id)));
    const timestamp = this.now().toISOString();
    const effectiveRunId = runId || `protected-notes:${sourceFingerprint.slice(0, 24)}`;
    const statements = [];
    const seenOperations = new Map();
    const canonicalHashes = new Map();

    for (const note of selected) {
      const content = String(note.content || '');
      const canonicalHash = await sha256Text(content);
      canonicalHashes.set(String(note.UUID), canonicalHash);
      const requestedPlayer = textOrNull(note.parent ?? note.playerUUID);
      const playerId = requestedPlayer && playerIds.has(requestedPlayer) ? requestedPlayer : null;
      if (requestedPlayer && !playerId) diagnostics.push({ kind: 'note', recordId: note.UUID, reason: 'unknown-player', playerId: requestedPlayer });
      const operationId = textOrNull(note.lastOperationId)
        || `import:${note.UUID}:r${note.revision}:${canonicalHash}`;
      const extra = {
        ...omitKeys(note, NOTE_KEYS),
      };
      statements.push({
        sql: `INSERT INTO notes(
                id,player_id,content,revision,content_hash,created_at,updated_at,
                deleted_at,deleted_content_hash,last_operation_id,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,content=excluded.content,revision=excluded.revision,
                content_hash=excluded.content_hash,
                created_at=excluded.created_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,
                deleted_content_hash=excluded.deleted_content_hash,last_operation_id=excluded.last_operation_id,
                extra_json=excluded.extra_json
              WHERE excluded.revision>notes.revision
                 OR (excluded.revision=notes.revision AND excluded.content_hash=notes.content_hash)`,
        bind: [
          note.UUID, playerId, content, Number(note.revision), canonicalHash,
          note.createdAt || timestamp, note.updatedAt || note.deletedAt || timestamp,
          textOrNull(note.deletedAt), null, operationId,
          stableJson(extra),
        ], result: 'changes',
      });
      const receipts = [
        ...(Array.isArray(note.operationReceipts) ? note.operationReceipts : []),
        { operationId, action: note.deletedAt ? 'delete' : 'update', revision: note.revision, contentHash: canonicalHash, committedAt: note.updatedAt || timestamp },
      ];
      for (const receipt of receipts) {
        if (!receipt?.operationId) continue;
        const receiptKey = String(receipt.operationId);
        if (seenOperations.has(receiptKey) && seenOperations.get(receiptKey) !== note.UUID) {
          diagnostics.push({ kind: 'note-receipt', reason: 'operation-id-collision', operationId: receiptKey, noteIds: [seenOperations.get(receiptKey), note.UUID] });
          continue;
        }
        seenOperations.set(receiptKey, note.UUID);
        statements.push({
          sql: `INSERT OR IGNORE INTO note_write_receipts(
                  operation_id,note_id,action,resulting_revision,resulting_hash,committed_at
                ) VALUES(?,?,?,?,?,?)`,
          bind: [
            receiptKey, note.UUID,
            ['create','update','delete','resolve'].includes(receipt.action) ? receipt.action : (note.deletedAt ? 'delete' : 'update'),
            Math.max(1, Number(receipt.revision) || Number(note.revision)),
            Number(receipt.revision) === Number(note.revision)
              ? canonicalHash
              : (receipt.contentHash || canonicalHash),
            receipt.committedAt || note.updatedAt || timestamp,
          ], result: 'changes',
        });
      }
    }

    for (const conflict of conflictsById.values()) {
      const attemptedContent = String(conflict.content || '');
      const attemptedHash = await sha256Text(attemptedContent);
      const canonicalHash = canonicalHashes.get(String(conflict.conflictOf || '')) || null;
      const metadata = {
        ...omitKeys(conflict, CONFLICT_KEYS),
      };
      statements.push({
        sql: `INSERT INTO note_conflicts(
                id,note_id,based_on_revision,attempted_revision,canonical_revision,
                attempted_content,attempted_hash,canonical_hash,operation_id,action,reason,source,
                detected_at,resolved_at,resolution,metadata_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO NOTHING`,
        bind: [
          conflict.UUID, String(conflict.conflictOf || ''),
          Number.isFinite(Number(conflict.baseRevision)) ? Number(conflict.baseRevision) : null,
          Number.isFinite(Number(conflict.revision)) ? Number(conflict.revision) : null,
          Number.isFinite(Number(conflict.canonicalRevision)) ? Number(conflict.canonicalRevision) : null,
          attemptedContent, attemptedHash,
          canonicalHash, textOrNull(conflict.operationId),
          conflict.attemptedAction || 'import', conflict.conflictReason || 'stale-source',
          conflict.conflictSource || 'data-import',
          conflict.conflictDetectedAt || conflict.createdAt || timestamp,
          textOrNull(conflict.resolvedAt), textOrNull(conflict.resolution),
          stableJson(metadata),
        ], result: 'changes',
      });
    }

    const counts = {
      notes: selected.length,
      tombstones: selected.filter((note) => note.deletedAt).length,
      conflicts: conflictsById.size,
      receipts: seenOperations.size,
      diagnostics: diagnostics.length,
    };
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId, domain: 'protected-notes', sourceFingerprint,
      importerVersion: IMPORTER_VERSION, startedAt: timestamp, finishedAt: timestamp,
      counts, diagnostics,
    }));
    const result = await this.client.executeAtomic({
      commandId: `shadow-import:${effectiveRunId}`,
      label: 'shadow-import-protected-notes', statements,
    });
    return { duplicate: result.duplicate, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default ProtectedNotesShadowImporter;
