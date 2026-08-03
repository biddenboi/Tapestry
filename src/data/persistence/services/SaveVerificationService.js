import { STORES } from '@domain/constants.js';

export class SaveVerificationService {
  constructor(facade, integrityService) {
    this.facade = facade;
    this.integrityService = integrityService;
  }

  verifySave(options) {
    return this.integrityService.verify(options);
  }

  async rebuildDisposableCaches() {
    await this.facade.clear(STORES.derivedCache);
    const leaderboards = await this.facade.reconcileMissingMaterializedLeaderboards({
      force: true,
      reason: 'settings-cache-rebuild',
    });
    return {
      rebuiltAt: new Date().toISOString(),
      leaderboards,
      authoritativeRecordsChanged: false,
    };
  }

  getPreMigrationBackup() {
    const backup = this.facade.persistenceRuntime?.sqliteStorageAdapter?.lastPreMigrationBackup;
    if (!backup) return null;
    return {
      ...backup,
      byteArray: new Uint8Array(backup.byteArray),
    };
  }

  downloadPreMigrationBackup() {
    const backup = this.getPreMigrationBackup();
    if (!backup) throw new Error('No pre-migration backup is available in this session.');
    const blob = new Blob([backup.byteArray], { type: 'application/x-sqlite3' });
    this.facade._downloadBlob(
      blob,
      `tapestry-pre-migration-${backup.sourceSchemaVersion || 'unknown'}-to-${backup.targetSchemaVersion}.sqlite`,
    );
    return {
      direction: 'download',
      checksum: backup.manifestChecksum,
      byteLength: backup.snapshotByteLength,
    };
  }
}

export default SaveVerificationService;

