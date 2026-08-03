export class DomainRepository {
  constructor(connection, { domain, domains = null, stores }) {
    this.connection = connection;
    this.domain = domain;
    this.domains = Object.freeze([...(domains || [domain])]);
    this.stores = Object.freeze([...(stores || [])]);
  }

  ensureLoaded() {
    return this.connection.ensureDomainsLoaded(this.domains);
  }

  async getAll(store = this.stores[0]) {
    if (!this.stores.includes(store)) throw new Error(`${store} is not owned by ${this.domain}.`);
    await this.ensureLoaded();
    return this.connection.getAll(store);
  }

  async get(store, UUID) {
    if (!this.stores.includes(store)) throw new Error(`${store} is not owned by ${this.domain}.`);
    await this.ensureLoaded();
    return this.connection.get(store, UUID);
  }

  async put(store, record, options) {
    if (!this.stores.includes(store)) throw new Error(`${store} is not owned by ${this.domain}.`);
    await this.ensureLoaded();
    return this.connection.add(store, record, options);
  }

  async remove(store, UUID) {
    if (!this.stores.includes(store)) throw new Error(`${store} is not owned by ${this.domain}.`);
    await this.ensureLoaded();
    return this.connection.remove(store, UUID);
  }
}

export default DomainRepository;
