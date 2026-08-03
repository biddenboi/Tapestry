export class CoreStorage {
  constructor({ getStores, setStores, createEmptyStoreMap, clone }) {
    this.getStores = getStores;
    this.setStores = setStores;
    this.createEmptyStoreMap = createEmptyStoreMap;
    this.clone = clone;
  }

  store(name) {
    const stores = this.getStores();
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  values(name) {
    return [...this.store(name).values()];
  }

  records(name) {
    return this.values(name).map(this.clone);
  }

  replaceStore(name, records = []) {
    const next = new Map();
    for (const record of records || []) {
      if (record?.UUID) next.set(record.UUID, this.clone(record));
    }
    this.getStores().set(name, next);
    return next;
  }

  replaceAll(storeEntries = []) {
    const next = this.createEmptyStoreMap();
    for (const [name, records] of storeEntries) {
      const map = new Map();
      for (const record of records || []) {
        if (record?.UUID) map.set(record.UUID, this.clone(record));
      }
      next.set(name, map);
    }
    this.setStores(next);
    return next;
  }

  snapshot() {
    return [...this.getStores().entries()].map(([name, records]) => [
      name,
      [...records.values()].map(this.clone),
    ]);
  }
}

export default CoreStorage;
