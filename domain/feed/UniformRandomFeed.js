import { getPostTags } from '@domain/feed/PostTags.js';

const DEFAULT_REJECTION_ATTEMPTS = 16;

function asSet(value) {
  if (value == null) return null;
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return normalized.length ? new Set(normalized) : null;
}

function randomIndex(length, random = Math.random) {
  if (length <= 1) return 0;
  const sample = Number(typeof random === 'function' ? random() : Math.random());
  const normalized = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON) : 0;
  return Math.floor(normalized * length);
}

export function matchesExplicitFeedFilters(entry = {}, filters = {}) {
  const authorUUIDs = asSet(filters.authorUUIDs ?? filters.authors);
  if (authorUUIDs && !authorUUIDs.has(String(entry.parent || '').toLowerCase())) return false;

  const types = asSet(filters.types ?? filters.type);
  if (types && !types.has(String(entry.type || '').toLowerCase())) return false;

  const requiredTags = asSet(filters.tags);
  if (requiredTags) {
    const entryTags = new Set(getPostTags(entry));
    for (const tag of requiredTags) {
      if (!entryTags.has(tag)) return false;
    }
  }

  return true;
}

export function isFeedEntryEligible(entry, { viewerIGT = Infinity, filters = {} } = {}) {
  if (!entry?.UUID) return false;
  if (entry.deleted === true || entry.isDeleted === true || entry.deletedAt) return false;

  const boundary = Number(viewerIGT);
  if (Number.isFinite(boundary)) {
    const entryIGT = Number(entry.inGameTimestamp || 0);
    if (!Number.isFinite(entryIGT) || entryIGT > Math.max(0, boundary)) return false;
  }

  return matchesExplicitFeedFilters(entry, filters);
}

/**
 * Reference implementation used by tests and exact fallbacks. Filtering is
 * completed before one unweighted index is chosen, so every eligible record
 * has probability 1 / eligibleCount.
 */
export function selectUniformRandomFeedEntry(entries = [], options = {}) {
  const eligible = (Array.isArray(entries) ? entries : [])
    .filter((entry) => isFeedEntryEligible(entry, options));
  if (eligible.length === 0) return null;
  return eligible[randomIndex(eligible.length, options.random)];
}

/**
 * O(1) journal UUID maintenance and expected O(1) ordinary selection.
 * Eligibility is checked against the current store record at draw time, so a
 * deleted or newly ineligible record can never leak through a stale candidate.
 */
export class UniformRandomFeedIndex {
  constructor(records = []) {
    this.ids = [];
    this.positions = new Map();
    this.rebuild(records);
  }

  rebuild(records = []) {
    this.ids = [];
    this.positions = new Map();
    for (const entry of records || []) this.upsert(entry);
    return this;
  }

  upsert(entry) {
    const UUID = entry?.UUID ? String(entry.UUID) : '';
    if (!UUID || this.positions.has(UUID)) return;
    this.positions.set(UUID, this.ids.length);
    this.ids.push(UUID);
  }

  remove(UUID) {
    const key = String(UUID || '');
    const position = this.positions.get(key);
    if (position == null) return false;

    const lastIndex = this.ids.length - 1;
    const lastUUID = this.ids[lastIndex];
    this.ids.pop();
    this.positions.delete(key);
    if (position !== lastIndex) {
      this.ids[position] = lastUUID;
      this.positions.set(lastUUID, position);
    }
    return true;
  }

  clear() {
    this.ids = [];
    this.positions.clear();
  }

  select(store, options = {}) {
    if (!store || this.ids.length === 0) return null;
    const random = options.random || Math.random;
    const attempts = Math.max(
      1,
      Math.min(64, Number(options.rejectionAttempts) || DEFAULT_REJECTION_ATTEMPTS),
    );

    // Rejection sampling is exactly uniform conditional on eligibility and
    // avoids scanning the journal store in the ordinary, high-acceptance case.
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const UUID = this.ids[randomIndex(this.ids.length, random)];
      const entry = store.get(UUID);
      if (isFeedEntryEligible(entry, options)) return entry;
    }

    // Sparse explicit filters and empty sets take the exact path. This remains
    // unweighted and reads journal records only.
    const eligible = [];
    for (const UUID of this.ids) {
      const entry = store.get(UUID);
      if (isFeedEntryEligible(entry, options)) eligible.push(entry);
    }
    if (eligible.length === 0) return null;
    return eligible[randomIndex(eligible.length, random)];
  }

  get size() {
    return this.ids.length;
  }
}
