import { calculateMigrationChecksum } from './migrationChecksum.js';
import { SQLITE_ERROR_CODES, SqliteRuntimeError } from './sqliteErrors.js';

export class MigrationRunner {
  constructor({ client, migrations = [], applicationVersion = 'unknown' } = {}) {
    if (!client?.applyMigrations) throw new Error('MigrationRunner requires a SQLite client.');
    this.client = client;
    this.migrations = Object.freeze([...migrations]);
    this.applicationVersion = applicationVersion;
  }

  async validate(migrations = this.migrations) {
    const validated = [];
    let priorId = null;
    for (const migration of migrations) {
      const id = String(migration?.id || '').trim();
      if (!id || (priorId && id <= priorId)) {
        throw new SqliteRuntimeError('SQLite migrations must have unique forward-only IDs in sorted order.', {
          code: SQLITE_ERROR_CODES.invalidRequest,
          details: { id, priorId },
        });
      }
      const calculated = await calculateMigrationChecksum(migration);
      if (calculated !== migration.checksum) {
        throw new SqliteRuntimeError(`Migration source checksum does not match its manifest: ${id}`, {
          code: SQLITE_ERROR_CODES.migrationChecksumMismatch,
          details: { id, expected: migration.checksum, calculated },
        });
      }
      validated.push({ ...migration });
      priorId = id;
    }
    return validated;
  }

  async run({ migrations = this.migrations, signal = null, timeoutMs = 30_000 } = {}) {
    const validated = await this.validate(migrations);
    return this.client.applyMigrations(
      validated,
      { applicationVersion: this.applicationVersion },
      { signal, timeoutMs },
    );
  }
}

export default MigrationRunner;
