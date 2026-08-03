export const DERIVED_CACHE_CONTRACT_VERSION = 1;
export const DERIVED_CACHE_STATUS = Object.freeze({
  fresh: 'fresh',
  stale: 'stale',
  rebuilding: 'rebuilding',
});

const VERSION_FIELDS = Object.freeze([
  'updatedAt',
  'completedAt',
  'editedAt',
  'createdAt',
  'inGameTimestamp',
  'completedInGameTimestamp',
]);

function stableToken(record = {}) {
  const UUID = String(record?.UUID || record?.id || '');
  const version = VERSION_FIELDS
    .map((field) => record?.[field])
    .find((value) => value != null && value !== '');
  return `${UUID}:${String(version ?? '')}`;
}

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeSourceVersions(sourceVersions = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(sourceVersions || {})
      .filter(([domain]) => String(domain || '').trim())
      .map(([domain, version]) => [String(domain), String(version ?? '0')])
      .sort(([left], [right]) => left.localeCompare(right)),
  ));
}

export function sourceVersionForRecords(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const tokens = rows.map(stableToken).sort();
  return `${rows.length}:${fnv1a(tokens.join('|'))}`;
}

export function sourceVersionsForRecordGroups(groups = {}) {
  return normalizeSourceVersions(Object.fromEntries(
    Object.entries(groups || {}).map(([domain, records]) => [
      domain,
      sourceVersionForRecords(records),
    ]),
  ));
}

export function bumpSourceVersion(sourceVersions = {}, domain, amount = 1) {
  if (!domain) return normalizeSourceVersions(sourceVersions);
  const current = String(sourceVersions?.[domain] ?? '0');
  const increment = Math.max(1, Number(amount) || 1);
  const numeric = /^(\d+)$/.exec(current);
  const bumped = /^(.*)\+(\d+)$/.exec(current);
  const next = numeric
    ? String(Number(numeric[1]) + increment)
    : bumped
      ? `${bumped[1]}+${Number(bumped[2]) + increment}`
      : `${current}+${increment}`;
  return normalizeSourceVersions({ ...sourceVersions, [domain]: next });
}

export function createDerivedCacheMetadata({
  sourceVersions = {},
  generatedAt = new Date().toISOString(),
  status = DERIVED_CACHE_STATUS.fresh,
  staleWhileRevalidate = true,
} = {}) {
  return Object.freeze({
    contractVersion: DERIVED_CACHE_CONTRACT_VERSION,
    sourceVersions: normalizeSourceVersions(sourceVersions),
    generatedAt,
    status: Object.values(DERIVED_CACHE_STATUS).includes(status)
      ? status
      : DERIVED_CACHE_STATUS.fresh,
    staleWhileRevalidate: staleWhileRevalidate !== false,
  });
}

export function withDerivedCacheMetadata(value = {}, options = {}) {
  return {
    ...value,
    cache: createDerivedCacheMetadata(options),
  };
}

export function isDerivedCacheMetadata(value = null) {
  return Number(value?.contractVersion) === DERIVED_CACHE_CONTRACT_VERSION
    && value?.sourceVersions
    && typeof value.sourceVersions === 'object';
}

export function sourceVersionsMatch(actual = {}, expected = {}) {
  const normalizedActual = normalizeSourceVersions(actual);
  const normalizedExpected = normalizeSourceVersions(expected);
  const keys = Object.keys(normalizedExpected);
  return keys.every((key) => normalizedActual[key] === normalizedExpected[key]);
}

export function derivedCacheState(value, expectedSourceVersions = null) {
  const cache = value?.cache;
  if (!isDerivedCacheMetadata(cache)) {
    return { status: DERIVED_CACHE_STATUS.stale, stale: true, reason: 'missing-cache-metadata' };
  }
  if (expectedSourceVersions && !sourceVersionsMatch(cache.sourceVersions, expectedSourceVersions)) {
    return { status: DERIVED_CACHE_STATUS.stale, stale: true, reason: 'source-version-mismatch' };
  }
  const stale = cache.status !== DERIVED_CACHE_STATUS.fresh;
  return { status: cache.status, stale, reason: stale ? 'cache-marked-stale' : null };
}

export function markDerivedCacheStale(value = {}, expectedSourceVersions = null) {
  const cache = value?.cache || {};
  return withDerivedCacheMetadata(value, {
    sourceVersions: expectedSourceVersions || cache.sourceVersions || {},
    generatedAt: cache.generatedAt || value.updatedAt || new Date().toISOString(),
    status: DERIVED_CACHE_STATUS.stale,
    staleWhileRevalidate: true,
  });
}

export function readStaleWhileRevalidate({
  value,
  expectedSourceVersions = null,
  revalidate = null,
  schedule = (callback) => Promise.resolve().then(callback),
} = {}) {
  const state = derivedCacheState(value, expectedSourceVersions);
  const shouldRevalidate = state.stale && typeof revalidate === 'function';
  const revalidation = shouldRevalidate
    ? Promise.resolve(schedule(revalidate)).catch((error) => {
      console.warn('[DerivedCache] background revalidation failed:', error);
      return null;
    })
    : null;
  return Object.freeze({
    value,
    stale: state.stale,
    status: state.status,
    reason: state.reason,
    revalidation,
  });
}
