import { stableJson } from './shadowDomainUtils.js';

export function normalizeSourceKeys(keys = []) {
  return [...new Set((Array.isArray(keys) ? keys : [keys])
    .map((key) => String(key || '').trim())
    .filter(Boolean))].sort();
}

export function bumpSourceVersionStatements(keys, timestamp) {
  return normalizeSourceKeys(keys).map((key) => ({
    sql: `INSERT INTO source_versions(source_key,version,updated_at) VALUES(?,1,?)
          ON CONFLICT(source_key) DO UPDATE SET version=source_versions.version+1,updated_at=excluded.updated_at`,
    bind: [key, timestamp],
    result: 'changes',
  }));
}

export async function readSourceVersions(client, keys = null) {
  const normalized = keys == null ? null : normalizeSourceKeys(keys);
  const rows = await client.query({
    sql: normalized?.length
      ? `SELECT source_key AS sourceKey,version,updated_at AS updatedAt
         FROM source_versions WHERE source_key IN (${normalized.map(() => '?').join(',')}) ORDER BY source_key`
      : `SELECT source_key AS sourceKey,version,updated_at AS updatedAt
         FROM source_versions ORDER BY source_key`,
    bind: normalized || [],
    result: 'all',
  });
  return Object.fromEntries(rows.map((row) => [row.sourceKey, Number(row.version)]));
}

export function sourceVersionSnapshotJson(snapshot = {}) {
  return stableJson(Object.fromEntries(Object.entries(snapshot)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Math.max(0, Math.trunc(Number(value) || 0))])));
}

export function sourceVersionsMatch(expected = {}, actual = {}) {
  return Object.entries(expected).every(([key, version]) => Number(actual[key] || 0) === Number(version || 0));
}
