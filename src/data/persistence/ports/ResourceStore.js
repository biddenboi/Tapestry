function required(method, implementation) {
  if (typeof implementation !== 'function') {
    throw new Error(`ResourceStore requires a ${method} implementation.`);
  }
  return implementation;
}

// Binary resource bytes remain ordinary files. SQLite will own metadata and
// references through this contract rather than absorbing browser File handles.
export class ResourceStore {
  constructor({ read, findByHash, write, remove, reconcile } = {}) {
    this._read = required('read', read);
    this._findByHash = required('findByHash', findByHash);
    this._write = required('write', write);
    this._remove = required('remove', remove);
    this._reconcile = required('reconcile', reconcile);
  }

  read(resourceUUID, options) { return this._read(resourceUUID, options); }
  findByHash(hash, options) { return this._findByHash(hash, options); }
  write(resource, options) { return this._write(resource, options); }
  remove(resourceUUID, options) { return this._remove(resourceUUID, options); }
  reconcile(options) { return this._reconcile(options); }
}

export default ResourceStore;
