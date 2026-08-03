import { sha256Text } from './migrationChecksum.js';

export function stableJson(value) {
  const seen = new WeakSet();
  const normalize = (input) => {
    if (input == null || typeof input !== 'object') {
      if (typeof input === 'number' && !Number.isFinite(input)) return null;
      return input;
    }
    if (seen.has(input)) throw new TypeError('Cannot serialize cyclic shadow-import input.');
    seen.add(input);
    if (Array.isArray(input)) {
      const result = input.map(normalize);
      seen.delete(input);
      return result;
    }
    const result = {};
    for (const key of Object.keys(input).sort()) result[key] = normalize(input[key]);
    seen.delete(input);
    return result;
  };
  return JSON.stringify(normalize(value));
}

export async function fingerprintShadowSource(value) {
  return sha256Text(stableJson(value));
}

export function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try { return JSON.parse(String(value)); }
  catch { return fallback; }
}

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function textOrNull(value) {
  if (value == null || value === '') return null;
  return String(value);
}

export function numberOrNull(value, { min = -Infinity, integer = false } = {}) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min) return null;
  return integer ? Math.trunc(numeric) : numeric;
}

export function nonNegativeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : Math.max(0, Number(fallback) || 0);
}

export const CURRENCY_MINOR_SCALE = 100;

export function currencyToMinor(value, fallback = 0) {
  const amount = nonNegativeNumber(value, fallback);
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(amount * CURRENCY_MINOR_SCALE));
}

export function currencyFromMinor(value, fallback = 0) {
  const minor = Number(value);
  if (!Number.isSafeInteger(minor) || minor < 0) return nonNegativeNumber(fallback, 0);
  return minor / CURRENCY_MINOR_SCALE;
}

export function booleanInteger(value) {
  return value ? 1 : 0;
}

export function omitKeys(record, keys) {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(asObject(record)).filter(([key]) => !omitted.has(key)));
}

export function deterministicRows(records = [], {
  id = (record) => record?.UUID,
  kind = 'record',
} = {}) {
  const grouped = new Map();
  const rejected = [];
  for (const candidate of Array.isArray(records) ? records : []) {
    const recordId = textOrNull(id(candidate));
    if (!recordId) {
      rejected.push({ kind, reason: 'missing-id', record: candidate });
      continue;
    }
    const canonical = stableJson(candidate);
    const rows = grouped.get(recordId) || [];
    rows.push({ record: candidate, canonical });
    grouped.set(recordId, rows);
  }
  const selected = [];
  const conflicts = [];
  for (const recordId of [...grouped.keys()].sort()) {
    const rows = grouped.get(recordId).sort((left, right) => left.canonical.localeCompare(right.canonical));
    selected.push(rows[0].record);
    for (const duplicate of rows.slice(1)) {
      if (duplicate.canonical !== rows[0].canonical) {
        conflicts.push({
          kind,
          recordId,
          reason: 'duplicate-id-different-record',
          selected: rows[0].record,
          rejected: duplicate.record,
        });
      }
    }
  }
  return { selected, conflicts, rejected };
}

export function createImportLedgerStatements({
  runId,
  domain,
  sourceFingerprint,
  importerVersion,
  startedAt,
  finishedAt,
  counts,
  diagnostics,
}) {
  return [{
    sql: `
INSERT INTO shadow_import_runs(
  run_id, domain, source_fingerprint, importer_version,
  started_at, finished_at, outcome, counts_json, diagnostics_json
) VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(run_id) DO NOTHING
`.trim(),
    bind: [
      runId,
      domain,
      sourceFingerprint,
      importerVersion,
      startedAt,
      finishedAt,
      'applied',
      stableJson(counts),
      stableJson(diagnostics),
    ],
    result: 'changes',
  }];
}

export function rowsToMap(rows, key = 'id') {
  return new Map((rows || []).map((row) => [String(row[key]), row]));
}
