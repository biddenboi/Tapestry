import { STORES } from '@domain/constants.js';
import DomainRepository from './DomainRepository.js';
import {
  buildProtectedNoteMutation,
  isNoteConflict,
  isNoteTombstone,
  normalizeNoteRecord,
  noteOperationResult,
} from '../notes/noteDurability.js';

export class NotesRepository extends DomainRepository {
  constructor(connection) {
    super(connection, { domain: 'notes', stores: [STORES.notes] });
  }

  async getAll() {
    await this.ensureLoaded();
    return (await this.connection.getAll(STORES.notes))
      .map((record) => normalizeNoteRecord(record))
      .filter((record) => record && !isNoteConflict(record) && !isNoteTombstone(record));
  }

  async get(noteUUID) {
    await this.ensureLoaded();
    const record = normalizeNoteRecord(await this.connection.get(STORES.notes, noteUUID));
    return record && !isNoteConflict(record) && !isNoteTombstone(record) ? record : null;
  }

  async getConflicts({ includeResolved = false } = {}) {
    await this.ensureLoaded();
    return (await this.connection.getAll(STORES.notes))
      .map((record) => normalizeNoteRecord(record))
      .filter((record) => isNoteConflict(record) && (includeResolved || !record.resolvedAt));
  }

  async getTombstones() {
    await this.ensureLoaded();
    return (await this.connection.getAll(STORES.notes))
      .map((record) => normalizeNoteRecord(record))
      .filter(isNoteTombstone);
  }

  async getOperationResult(operationId) {
    await this.ensureLoaded();
    return noteOperationResult(await this.connection.getAll(STORES.notes), operationId);
  }

  async createNote(note, { operationId, now } = {}) {
    await this.ensureLoaded();
    const mutation = buildProtectedNoteMutation({
      action: 'create',
      note,
      operationId,
      now,
    });
    return this.connection._commitProtectedNoteMutation(mutation);
  }

  async updateNoteIfCurrent(noteUUID, {
    content,
    expectedRevision,
    expectedHash,
    operationId,
    now,
  } = {}) {
    await this.ensureLoaded();
    const current = await this.connection.get(STORES.notes, noteUUID);
    const mutation = buildProtectedNoteMutation({
      action: 'update',
      current,
      noteUUID,
      content,
      expectedRevision,
      expectedHash,
      operationId,
      now,
    });
    return this.connection._commitProtectedNoteMutation(mutation);
  }

  async deleteNoteIfCurrent(noteUUID, {
    expectedRevision,
    expectedHash,
    operationId,
    now,
  } = {}) {
    await this.ensureLoaded();
    const current = await this.connection.get(STORES.notes, noteUUID);
    const mutation = buildProtectedNoteMutation({
      action: 'delete',
      current,
      noteUUID,
      expectedRevision,
      expectedHash,
      operationId,
      now,
    });
    return this.connection._commitProtectedNoteMutation(mutation);
  }

  async recoverConflictAsNewNote(conflictUUID, note, { operationId, now } = {}) {
    await this.ensureLoaded();
    return this.connection._recoverNoteConflict(conflictUUID, note, { operationId, now });
  }
}

export default NotesRepository;
