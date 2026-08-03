function required(method, implementation) {
  if (typeof implementation !== 'function') {
    throw new Error(`JournalStore requires a ${method} implementation.`);
  }
  return implementation;
}

// Journal bodies intentionally remain Markdown. This port keeps their file
// lifecycle separate from structured metadata and future SQLite transactions.
export class JournalStore {
  constructor({ read, list, write, remove, reconcile } = {}) {
    this._read = required('read', read);
    this._list = required('list', list);
    this._write = required('write', write);
    this._remove = required('remove', remove);
    this._reconcile = required('reconcile', reconcile);
  }

  read(journalUUID, options) { return this._read(journalUUID, options); }
  list(options) { return this._list(options); }
  write(journal, options) { return this._write(journal, options); }
  remove(journalUUID, options) { return this._remove(journalUUID, options); }
  reconcile(options) { return this._reconcile(options); }
}

export default JournalStore;
