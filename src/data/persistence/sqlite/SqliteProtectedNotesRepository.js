import { sha256Text } from './migrationChecksum.js';
import { parseJson, stableJson, textOrNull } from './shadowDomainUtils.js';

const NOTE_SELECT = `SELECT id,player_id AS playerId,content,revision,content_hash AS contentHash,
  created_at AS createdAt,updated_at AS updatedAt,
  deleted_at AS deletedAt,deleted_content_hash AS deletedContentHash,
  last_operation_id AS lastOperationId,extra_json AS extraJson FROM notes`;
const CONFLICT_SELECT = `SELECT id,note_id AS noteId,based_on_revision AS basedOnRevision,
  attempted_revision AS attemptedRevision,canonical_revision AS canonicalRevision,
  attempted_content AS attemptedContent,attempted_hash AS attemptedHash,canonical_hash AS canonicalHash,
  operation_id AS operationId,action,reason,source,detected_at AS detectedAt,
  resolved_at AS resolvedAt,resolution,metadata_json AS metadataJson FROM note_conflicts`;

function noteFromRow(row) {
  if (!row) return null;
  return {
    ...parseJson(row.extraJson, {}),
    UUID: row.id,
    recordKind: 'note',
    parent: row.playerId,
    content: String(row.content || ''),
    revision: Number(row.revision),
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    deletedContentHash: row.deletedContentHash,
    lastOperationId: row.lastOperationId,
  };
}

function conflictFromRow(row) {
  return row ? {
    UUID: row.id,
    recordKind: 'note-conflict',
    conflictOf: row.noteId,
    baseRevision: row.basedOnRevision == null ? null : Number(row.basedOnRevision),
    revision: row.attemptedRevision == null ? null : Number(row.attemptedRevision),
    canonicalRevision: row.canonicalRevision == null ? null : Number(row.canonicalRevision),
    content: row.attemptedContent,
    contentHash: row.attemptedHash,
    canonicalHash: row.canonicalHash,
    operationId: row.operationId,
    attemptedAction: row.action,
    conflictReason: row.reason,
    conflictSource: row.source,
    conflictDetectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
    resolution: row.resolution,
    ...parseJson(row.metadataJson, {}),
  } : null;
}

function conflictId(noteId, operationId) {
  const safe = (value) => String(value || 'unknown').replaceAll(/[^0-9A-Za-z_-]/g, '-').slice(0, 80);
  return `note-conflict-${safe(noteId)}-${safe(operationId)}`;
}

export class SqliteProtectedNotesRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteProtectedNotesRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async get(noteId, { includeDeleted = false } = {}) {
    const row = await this.client.query({ sql: `${NOTE_SELECT} WHERE id=?`, bind: [noteId], result: 'one' });
    const note = noteFromRow(row);
    return note && (includeDeleted || !note.deletedAt) ? note : null;
  }

  async getAll({ includeDeleted = false } = {}) {
    const rows = await this.client.query({
      sql: `${NOTE_SELECT}${includeDeleted ? '' : ' WHERE deleted_at IS NULL'} ORDER BY updated_at DESC,id`,
      result: 'all',
    });
    return rows.map(noteFromRow);
  }

  async getConflicts({ noteId = null, includeResolved = false } = {}) {
    const where = [];
    const bind = [];
    if (noteId) { where.push('note_id=?'); bind.push(noteId); }
    if (!includeResolved) where.push('resolved_at IS NULL');
    return (await this.client.query({
      sql: `${CONFLICT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY detected_at DESC,id`,
      bind, result: 'all',
    })).map(conflictFromRow);
  }

  async getOperationResult(operationId) {
    if (!operationId) return null;
    const receipt = await this.client.query({
      sql: `SELECT operation_id AS operationId,note_id AS noteId,action,
                   resulting_revision AS resultingRevision,resulting_hash AS resultingHash,
                   committed_at AS committedAt
            FROM note_write_receipts WHERE operation_id=?`,
      bind: [operationId], result: 'one',
    });
    if (receipt) {
      const record = await this.get(receipt.noteId, { includeDeleted: true });
      return { status: record?.deletedAt ? 'deleted' : 'applied', record, receipt };
    }
    const conflict = conflictFromRow(await this.client.query({
      sql: `${CONFLICT_SELECT} WHERE operation_id=?`, bind: [operationId], result: 'one',
    }));
    return conflict ? { status: 'conflict', conflict, record: await this.get(conflict.conflictOf, { includeDeleted: true }) } : null;
  }

  async _finishOperation(operationId, noteId) {
    const result = await this.getOperationResult(operationId);
    if (result) return result;
    return { status: 'conflict', record: await this.get(noteId, { includeDeleted: true }), conflict: null };
  }

  async createNote(note, { operationId, now = this.now() } = {}) {
    if (!note?.UUID || !operationId) throw new Error('Protected note creation requires a UUID and operation ID.');
    const prior = await this.getOperationResult(operationId);
    if (prior) return { ...prior, idempotent: true };
    const timestamp = now.toISOString();
    const content = String(note.content || '');
    const hash = await sha256Text(content);
    const id = String(note.UUID);
    const cId = conflictId(id, operationId);
    const extra = { ...note };
    for (const key of ['UUID','parent','playerUUID','content','revision','contentHash','createdAt','updatedAt','deletedAt','lastOperationId','operationReceipts']) delete extra[key];
    const result = await this.client.executeAtomic({
      commandId: `note:${operationId}`,
      label: 'protected-note-create-shadow',
      statements: [{
        sql: `INSERT INTO notes(id,player_id,content,revision,content_hash,created_at,updated_at,
                 deleted_at,deleted_content_hash,last_operation_id,extra_json)
              VALUES(?,?,?,1,?,?,?,NULL,NULL,?,?) ON CONFLICT(id) DO NOTHING`,
        bind: [id, textOrNull(note.parent ?? note.playerUUID), content, hash, note.createdAt || timestamp, timestamp, operationId, stableJson(extra)],
        result: 'changes',
      }, {
        sql: `INSERT INTO note_write_receipts(operation_id,note_id,action,resulting_revision,resulting_hash,committed_at)
              SELECT ?,id,'create',revision,content_hash,? FROM notes
              WHERE id=? AND last_operation_id=? ON CONFLICT(operation_id) DO NOTHING`,
        bind: [operationId, timestamp, id, operationId], result: 'changes',
      }, {
        sql: `INSERT INTO note_conflicts(id,note_id,based_on_revision,attempted_revision,canonical_revision,
                 attempted_content,attempted_hash,canonical_hash,operation_id,action,reason,source,detected_at,metadata_json)
              SELECT ?,?,0,1,(SELECT revision FROM notes WHERE id=?),?,?,
                     (SELECT content_hash FROM notes WHERE id=?),?,'create','already-exists','protected-write',?,'{}'
              WHERE NOT EXISTS(SELECT 1 FROM note_write_receipts WHERE operation_id=?)
              ON CONFLICT(id) DO NOTHING`,
        bind: [cId, id, id, content, hash, id, operationId, timestamp, operationId], result: 'changes',
      }],
    });
    const finished = await this._finishOperation(operationId, id);
    return { ...finished, idempotent: result.duplicate };
  }

  async updateNoteIfCurrent(noteId, { content, expectedRevision, expectedHash, operationId, now = this.now() } = {}) {
    return this._casWrite('update', noteId, { content, expectedRevision, expectedHash, operationId, now });
  }

  async deleteNoteIfCurrent(noteId, { expectedRevision, expectedHash, operationId, now = this.now() } = {}) {
    return this._casWrite('delete', noteId, { content: '', expectedRevision, expectedHash, operationId, now });
  }

  async _casWrite(action, noteId, { content, expectedRevision, expectedHash, operationId, now }) {
    if (!noteId || !operationId || !Number.isFinite(Number(expectedRevision)) || !expectedHash) {
      throw new Error('Protected note CAS writes require note ID, operation ID, expected revision, and expected hash.');
    }
    const prior = await this.getOperationResult(operationId);
    if (prior) return { ...prior, idempotent: true };
    const timestamp = now.toISOString();
    const nextContent = action === 'delete' ? '' : String(content || '');
    const nextHash = await sha256Text(nextContent);
    const cId = conflictId(noteId, operationId);
    const nextRevision = Number(expectedRevision) + 1;
    const result = await this.client.executeAtomic({
      commandId: `note:${operationId}`,
      label: `protected-note-${action}-shadow`,
      statements: [{
        sql: `UPDATE notes SET content=?,content_hash=?,revision=revision+1,
                     updated_at=?,deleted_at=?,deleted_content_hash=?,last_operation_id=?
              WHERE id=? AND revision=? AND content_hash=? AND deleted_at IS NULL`,
        bind: [
          nextContent, nextHash, timestamp, action === 'delete' ? timestamp : null,
          action === 'delete' ? expectedHash : null, operationId,
          noteId, Number(expectedRevision), String(expectedHash),
        ], result: 'changes',
      }, {
        sql: `INSERT INTO note_write_receipts(operation_id,note_id,action,resulting_revision,resulting_hash,committed_at)
              SELECT ?,id,?,revision,content_hash,? FROM notes
              WHERE id=? AND last_operation_id=? ON CONFLICT(operation_id) DO NOTHING`,
        bind: [operationId, action, timestamp, noteId, operationId], result: 'changes',
      }, {
        sql: `INSERT INTO note_conflicts(id,note_id,based_on_revision,attempted_revision,canonical_revision,
                 attempted_content,attempted_hash,canonical_hash,operation_id,action,reason,source,detected_at,metadata_json)
              SELECT ?,?,?,?,(SELECT revision FROM notes WHERE id=?),?,?,
                     (SELECT content_hash FROM notes WHERE id=?),?,?,
                     CASE
                       WHEN NOT EXISTS(SELECT 1 FROM notes WHERE id=?) THEN 'missing'
                       WHEN (SELECT deleted_at FROM notes WHERE id=?) IS NOT NULL THEN 'deleted'
                       WHEN (SELECT revision FROM notes WHERE id=?)=? THEN 'same-revision-different-hash'
                       ELSE 'stale'
                     END,
                     'protected-write',?,'{}'
              WHERE NOT EXISTS(SELECT 1 FROM note_write_receipts WHERE operation_id=?)
              ON CONFLICT(id) DO NOTHING`,
        bind: [
          cId, noteId, Number(expectedRevision), nextRevision, noteId,
          nextContent, nextHash, noteId, operationId, action,
          noteId, noteId, noteId, Number(expectedRevision), timestamp, operationId,
        ], result: 'changes',
      }],
    });
    const finished = await this._finishOperation(operationId, noteId);
    return { ...finished, idempotent: result.duplicate };
  }

  async resolveConflict(conflictIdValue, {
    expectedRevision,
    expectedHash,
    operationId,
    now = this.now(),
    resolution = 'use-attempted-content',
  } = {}) {
    if (!conflictIdValue || !operationId) throw new Error('Conflict resolution requires conflict and operation IDs.');
    const conflict = conflictFromRow(await this.client.query({
      sql: `${CONFLICT_SELECT} WHERE id=?`, bind: [conflictIdValue], result: 'one',
    }));
    if (!conflict) return { status: 'missing-conflict' };
    const result = await this._casWrite('update', conflict.conflictOf, {
      content: conflict.content,
      expectedRevision,
      expectedHash,
      operationId,
      now,
    });
    if (result.status === 'applied') {
      const timestamp = now.toISOString();
      await this.client.executeAtomic({
        commandId: `note-conflict-resolution:${operationId}`,
        label: 'protected-note-conflict-resolution-shadow',
        statements: [{
          sql: `UPDATE note_conflicts SET resolved_at=?,resolution=?
                WHERE id=? AND resolved_at IS NULL`,
          bind: [timestamp, resolution, conflictIdValue], result: 'changes',
        }],
      });
    }
    return result;
  }

  async getRevisionDiagnostics(noteId) {
    const note = await this.get(noteId, { includeDeleted: true });
    const receipts = await this.client.query({
      sql: `SELECT operation_id AS operationId,action,resulting_revision AS revision,
                   resulting_hash AS contentHash,committed_at AS committedAt
            FROM note_write_receipts WHERE note_id=? ORDER BY resulting_revision,committed_at,operation_id`,
      bind: [noteId], result: 'all',
    });
    const conflicts = await this.getConflicts({ noteId, includeResolved: true });
    const monotonic = receipts.every((receipt, index) => index === 0 || Number(receipt.revision) >= Number(receipts[index - 1].revision));
    return { note, receipts, conflicts, monotonic };
  }

}

export default SqliteProtectedNotesRepository;
