const encoder = new TextEncoder();

export async function sha256Text(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 support is required for SQLite migration validation.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalMigrationPayload({ id, sql, compatibilityRepairs = [] }) {
  const source = `${String(id).trim()}\n${String(sql).replace(/\r\n/g, '\n').trim()}\n`;
  if (!compatibilityRepairs.length) return source;
  const repairs = compatibilityRepairs.map((repair) => ({
    migrationId: String(repair?.migrationId || '').trim(),
    checksums: [...(repair?.checksums || [])].map((value) => String(value).trim()).sort(),
    sql: String(repair?.sql || '').replace(/\r\n/g, '\n').trim(),
  }));
  return `${source}${JSON.stringify(repairs)}\n`;
}

export async function calculateMigrationChecksum(migration) {
  return sha256Text(canonicalMigrationPayload(migration));
}
