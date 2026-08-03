function required(method, implementation) {
  if (typeof implementation !== 'function') {
    throw new Error(`StorageAdapter requires a ${method} implementation.`);
  }
  return implementation;
}

// Backend-neutral structured storage contract. Repositories may depend on this
// port; browser Map storage and the future SQLite worker implement it.
export class StorageAdapter {
  constructor({ get, getAll, put, remove, clear, range = null, transaction } = {}) {
    this._get = required('get', get);
    this._getAll = required('getAll', getAll);
    this._put = required('put', put);
    this._remove = required('remove', remove);
    this._clear = required('clear', clear);
    this._range = typeof range === 'function' ? range : null;
    this._transaction = required('transaction', transaction);
  }

  get(store, UUID) { return this._get(store, UUID); }
  getAll(store) { return this._getAll(store); }
  put(store, record, options) { return this._put(store, record, options); }
  remove(store, UUID, options) { return this._remove(store, UUID, options); }
  clear(store, options) { return this._clear(store, options); }
  range(store, query, options) {
    if (!this._range) throw new Error('StorageAdapter range is not implemented by this backend.');
    return this._range(store, query, options);
  }
  transaction(work, options) { return this._transaction(work, options); }
}

export default StorageAdapter;
