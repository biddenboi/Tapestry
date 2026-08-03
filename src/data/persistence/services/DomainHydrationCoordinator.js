import { createEconomyState } from '@data/db/economyState.js';
import {
  createEmptyAppState,
  createEmptyStoreMap,
} from '@data/db/databaseConnectionUtils.js';
import {
  HYDRATION_DOMAINS,
  normalizeHydrationDomains,
} from '@data/db/domainHydration.js';

function facadeBackedService(target, facade) {
  return new Proxy(target, {
    get(service, property, receiver) {
      if (Reflect.has(service, property)) return Reflect.get(service, property, receiver);
      const value = Reflect.get(facade, property, facade);
      return typeof value === 'function' ? value.bind(facade) : value;
    },
    set(service, property, value, receiver) {
      if (Reflect.has(service, property)) return Reflect.set(service, property, value, receiver);
      return Reflect.set(facade, property, value, facade);
    },
  });
}

export class DomainHydrationCoordinator {
  loadedDomains = new Set(HYDRATION_DOMAINS);
  domainLoadPromises = new Map();
  loadedStoreKeys = new Set();
  storeLoadPromises = new Map();
  postMatchRecoveryQueued = false;

  constructor(facade) {
    if (!facade) throw new Error('DomainHydrationCoordinator requires a database facade.');
    this.facade = facade;
    return facadeBackedService(this, facade);
  }

  isPartiallyLoaded() { return false; }

  async ensureFullyLoaded() {
    return { domains: [...this.loadedDomains], loadedDomains: [], partial: false };
  }

  getDomainLoadState(domain) {
    return this.loadedDomains.has(domain) ? 'loaded' : 'idle';
  }

  isDomainLoaded(domain) { return this.loadedDomains.has(domain); }

  getLoadedDomains() { return [...this.loadedDomains]; }

  async ensureDomainsLoaded(domains) {
    const requested = normalizeHydrationDomains(domains);
    for (const domain of requested) this.loadedDomains.add(domain);
    return { domains: requested, loadedDomains: requested, partial: false };
  }

  ensureDomainLoaded(domain) { return this.ensureDomainsLoaded(domain); }

  async _resetLoadedData({ seed = false } = {}) {
    this.persistenceRuntime?.resetSqliteShadowReadiness?.();
    this.demoMode = false;
    this.loadedDomains = new Set(HYDRATION_DOMAINS);
    this.domainLoadPromises = new Map();
    this.loadedStoreKeys = new Set();
    this.storeLoadPromises = new Map();
    this.stores = createEmptyStoreMap();
    this._rebuildFeedRandomIndex();
    this.economyState = createEconomyState(0);
    this.appState = createEmptyAppState();
    this.eloWorldCache.clear();
    if (seed) await this.seedSpecialEvents();
  }
}

export default DomainHydrationCoordinator;
