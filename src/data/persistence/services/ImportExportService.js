import { STORES } from '@domain/constants.js';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import {
  COMPACT_PACKAGE_FORMAT,
  buildCompactManifest,
  buildCompactModelArtifacts,
  collectDeduplicatedImages,
  findCompactPackageManifest,
  stableJson,
  verifyCompactEntries,
} from '@data/persistence/compact/CompactPortablePackage.js';
import {
  LEGACY_PACKAGE_FORMAT,
  parseLegacyPortablePackage,
} from '@data/persistence/legacy/LegacyPortablePackage.js';
import { addPortableFolderFiles } from '@data/persistence/portable/PortableFolderPackage.js';
import { prepareRestoreRuntime } from '@data/persistence/portable/RestoreRuntimeRecovery.js';
import SqliteStorageAdapter from '@data/persistence/sqlite/SqliteStorageAdapter.js';
import { migrateLegacyQuickNotesToEntries } from '@data/persistence/legacy/LegacyQuickNoteEntryMigration.js';
import { clearResourceObjectUrlCache } from '@shared/resources/Resources.js';

const loadJSZip = () => measureDynamicModule('jszip', () => import('jszip'));

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

export class ImportExportService {
  constructor(facade) {
    if (!facade) throw new Error('ImportExportService requires a database facade.');
    this.facade = facade;
    return facadeBackedService(this, facade);
  }

  getSaveAsZip(...args) { return this._getSaveAsZipInternal(...args); }
  saveUpload(...args) { return this._saveUploadInternal(...args); }
  saveFolderUpload(...args) { return this._saveFolderUploadInternal(...args); }
  restoreCloudCheckpoint(...args) { return this._restoreCloudCheckpoint(...args); }
  createCompactBackup() { return this._getSaveAsZipInternal({ kind: 'backup' }); }

  async createEncryptedDesktopBackup() {
    const bridge = typeof window === 'undefined' ? null : window.tapestryDesktopBackups;
    if (!bridge?.write) throw new Error('Encrypted scheduled backups are available in the desktop app.');
    const durability = await this._prepareDurableExport();
    const { blob, manifest } = await this._buildCompactPackage({ kind: 'backup', durability });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const result = await bridge.write({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      filename: `tapestry-backup-${stamp}.zip`,
    });
    return { direction: 'backup', encrypted: true, manifest, ...result };
  }

  async restoreEncryptedDesktopBackup() {
    const bridge = typeof window === 'undefined' ? null : window.tapestryDesktopBackups;
    if (!bridge?.restore) throw new Error('Encrypted backup restore is available in the desktop app.');
    const selected = await bridge.restore();
    if (!selected?.bytes?.length) return null;
    const blob = new Blob([selected.bytes], { type: 'application/zip' });
    Object.defineProperty(blob, 'name', { value: selected.filename || 'tapestry-backup.zip' });
    return this._saveUploadInternal(blob);
  }

  async _prepareDurableExport() {
    await this.ready;
    await this.ensureFullyLoaded();
    await this.compactWritePromise;
    const runtime = this.syncRuntime;
    const durability = {
      localSqliteFlushed: true,
      cloudConfigured: Boolean(runtime?.transport),
      cloudSynchronized: false,
      preparedAt: new Date().toISOString(),
    };
    if (!runtime?.transport) return durability;
    try {
      const sync = await runtime.synchronize({ reason: 'pre-export-durability-barrier' });
      await this.flushWrites();
      const checkpoint = await runtime.publishCloudCheckpoint?.({ force: true, reason: 'pre-export' });
      if (!checkpoint?.uploaded) {
        const checkpointError = new Error(
          `The current SQLite checkpoint was not confirmed by cloud storage (${checkpoint?.reason || 'unknown reason'}).`,
        );
        checkpointError.code = 'pre-export-cloud-checkpoint-unconfirmed';
        throw checkpointError;
      }
      return {
        ...durability,
        cloudSynchronized: Boolean(sync?.synchronized && checkpoint.uploaded),
        cloudCheckpointConfirmed: true,
        uploadedOperations: Number(sync?.uploaded || 0),
        pulledOperations: Number(sync?.pulled || 0),
        checkpoint: checkpoint || null,
      };
    } catch (error) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (!offline) {
        const next = new Error(`Cloud synchronization failed, so Tapestry did not create a potentially stale download: ${error.message || error}`);
        next.code = 'pre-export-cloud-sync-failed';
        next.cause = error;
        throw next;
      }
      return {
        ...durability,
        offline: true,
        cloudError: String(error?.message || error || 'offline').slice(0, 500),
      };
    }
  }

  async _getSaveAsZipInternal(options = {}) {
    const durability = await this._prepareDurableExport();
    const kind = options.kind === 'backup' ? 'backup' : 'save';
    const { blob, manifest } = await this._buildCompactPackage({ kind, durability });
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    this._downloadBlob(
      blob,
      kind === 'backup'
        ? `tapestry-backup-${stamp}.zip`
        : `tapestry-save-${stamp}.zip`,
    );
    return { direction: 'download', kind, manifest };
  }

  async _buildCompactPackage({ kind = 'save', durability = null } = {}) {
    await this.compactWritePromise;
    const adapter = this.persistenceRuntime.sqliteStorageAdapter;
    const snapshot = await adapter.exportSnapshot({}, { timeoutMs: 30_000 });
    if (snapshot.quickCheck !== 'ok' || snapshot.foreignKeyViolations?.length) {
      throw new Error('SQLite snapshot integrity failed before export.');
    }
    const verified = await adapter.verifySnapshot(
      { byteArray: snapshot.byteArray },
      { timeoutMs: 30_000 },
    );
    if (verified.quickCheck !== 'ok'
      || verified.integrityCheck !== 'ok'
      || verified.foreignKeyViolations?.length) {
      throw new Error('SQLite snapshot verification failed before export.');
    }

    const storeSnapshot = this._snapshotAllStores();
    const allRecords = storeSnapshot.flatMap(([, records]) => records);
    const appSettings = storeSnapshot.find(([store]) => store === STORES.appSetting)?.[1] || [];
    const model = buildCompactModelArtifacts(appSettings);
    const images = await collectDeduplicatedImages([allRecords, this._serializeAppState()]);
    const manifest = await buildCompactManifest({ snapshot, model, images, kind, durability });
    const { default: JSZip } = await loadJSZip();
    const zip = new JSZip();
    zip.file('tapestry.sqlite', snapshot.byteArray);
    zip.file('model/model.bin', model.bytes);
    zip.file('model/metadata.json', stableJson(model.metadata));
    for (const image of images) zip.file(image.path, image.bytes);
    zip.file('manifest.json', stableJson(manifest));
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    return { blob, manifest };
  }

  async _restoreCloudCheckpoint(bytes, { manifest = null } = {}) {
    const byteArray = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes || []);
    if (!byteArray.byteLength) throw new Error('The cloud database checkpoint is empty.');
    await this.ready;
    await this.compactWritePromise;
    const adapter = this.persistenceRuntime.sqliteStorageAdapter;
    const verified = await adapter.verifySnapshot(
      { byteArray },
      { timeoutMs: 30_000 },
    );
    if (verified.quickCheck !== 'ok'
      || verified.integrityCheck !== 'ok'
      || verified.foreignKeyViolations?.length) {
      throw new Error('The cloud database checkpoint failed SQLite integrity verification.');
    }

    const rollback = await adapter.exportSnapshot({}, { timeoutMs: 30_000 });
    const localDevice = this.syncRuntime?.device || null;
    let liveRestored = false;
    try {
      await adapter.restoreSnapshot({ byteArray }, { timeoutMs: 30_000 });
      liveRestored = true;
      await adapter.applyPendingMigrations();
      // A database checkpoint contains the source device's sync identity. Keep
      // this browser's already-registered identity so two devices never share
      // a sequence counter after a cloud-first restore.
      const now = new Date().toISOString();
      await adapter.executeAtomic({
        commandId: `cloud-checkpoint-device:${localDevice?.id || 'new'}:${Date.now()}`,
        label: 'preserve-local-device-after-cloud-restore',
        statements: [{
          sql: 'DELETE FROM sync_devices',
          result: 'changes',
        }, localDevice?.id && localDevice?.ownerId ? {
          sql: `INSERT INTO sync_devices(
                  id,owner_id,display_name,platform,created_at,last_seen_at,retired_at
                ) VALUES(?,?,?,?,?,?,NULL)`,
          bind: [
            localDevice.id,
            localDevice.ownerId,
            localDevice.displayName || 'Tapestry device',
            localDevice.platform || 'web',
            localDevice.createdAt || now,
            now,
          ],
          result: 'changes',
        } : null].filter(Boolean),
      });
      await this.initializeCompactSqlite();
      clearResourceObjectUrlCache();
      await this.reconcileMissingMaterializedLeaderboards({
        force: true,
        reason: 'cloud-checkpoint-cache-reconciliation',
      });
      this.demoMode = false;
      return {
        direction: 'cloud-download',
        format: 'tapestry-sqlite-checkpoint',
        createdAt: manifest?.createdAt || null,
        byteLength: byteArray.byteLength,
      };
    } catch (error) {
      if (liveRestored) {
        await adapter.restoreSnapshot(
          { byteArray: rollback.byteArray },
          { timeoutMs: 30_000 },
        );
        await adapter.applyPendingMigrations();
        await this.initializeCompactSqlite();
        clearResourceObjectUrlCache();
      }
      throw error;
    }
  }

  async _saveUploadInternal(file) {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = /\.zip$/i.test(file.name || '')
      || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    if (!isZip) throw new Error('Tapestry restores require a compact .zip save package.');
    const { recoveredStartup } = await prepareRestoreRuntime({
      ready: this.ready,
      adapter: this.persistenceRuntime?.sqliteStorageAdapter,
    });
    const result = await this._zipUpload(bytes);
    if (recoveredStartup) this.facade.ready = Promise.resolve();
    return result;
  }

  async _saveFolderUploadInternal(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const { default: JSZip } = await loadJSZip();
    const { archive, fileCount } = addPortableFolderFiles(new JSZip(), files);
    const { recoveredStartup } = await prepareRestoreRuntime({
      ready: this.ready,
      adapter: this.persistenceRuntime?.sqliteStorageAdapter,
    });
    const result = await this._restoreZip(archive);
    if (recoveredStartup) this.facade.ready = Promise.resolve();
    return { ...result, source: 'folder', fileCount };
  }

  async _zipUpload(bytes) {
    const { default: JSZip } = await loadJSZip();
    const zip = await JSZip.loadAsync(bytes);
    return this._restoreZip(zip);
  }

  async _restoreZip(zip) {
    const { manifest, root } = await findCompactPackageManifest(zip);
    if (!manifest || manifest.format === LEGACY_PACKAGE_FORMAT) {
      return this._legacyZipUpload(zip);
    }
    if (manifest.format !== COMPACT_PACKAGE_FORMAT) {
      throw new Error('This zip is not a supported Tapestry save package.');
    }
    const readBytes = async (path) => zip.file(`${root}${String(path).replaceAll('\\', '/')}`)
      ?.async('uint8array') || null;
    const restored = await verifyCompactEntries({
      manifest,
      readBytes,
      verifySnapshot: (snapshot) => this.persistenceRuntime.sqliteStorageAdapter.verifySnapshot(
        snapshot,
        { timeoutMs: 30_000 },
      ),
    });
    const adapter = this.persistenceRuntime.sqliteStorageAdapter;
    await this.compactWritePromise;
    const rollback = await adapter.exportSnapshot({}, { timeoutMs: 30_000 });
    let liveRestored = false;
    try {
      await adapter.restoreSnapshot(
        { byteArray: restored.database },
        { timeoutMs: 30_000 },
      );
      liveRestored = true;
      await adapter.applyPendingMigrations();
      await this._restorePackagedResourcePayloads(adapter, restored.images);
      await this.initializeCompactSqlite();
      clearResourceObjectUrlCache();
      await this.reconcileMissingMaterializedLeaderboards({
        force: true,
        reason: 'compact-package-cache-reconciliation',
      });
      this.demoMode = false;
      return {
        direction: 'upload',
        format: COMPACT_PACKAGE_FORMAT,
        sourceRoot: root || null,
      };
    } catch (error) {
      if (liveRestored) {
        await adapter.restoreSnapshot(
          { byteArray: rollback.byteArray },
          { timeoutMs: 30_000 },
        );
        await adapter.applyPendingMigrations();
        await this.initializeCompactSqlite();
        clearResourceObjectUrlCache();
      }
      throw error;
    }
  }

  async _restorePackagedResourcePayloads(adapter, images = []) {
    if (!images.length) return { restored: 0 };
    const resources = await adapter.query({
      sql: `SELECT uuid,
                   json_extract(record_json,'$.hash') AS contentHash,
                   json_extract(record_json,'$.createdAt') AS createdAt
            FROM document_resources
            WHERE json_extract(record_json,'$.hash') IS NOT NULL`,
      result: 'all',
    });
    const imageByHash = new Map(images.map((image) => [String(image.sha256), image]));
    const matched = resources
      .map((resource) => ({
        ...resource,
        image: imageByHash.get(String(resource.contentHash)),
      }))
      .filter((resource) => resource.image);
    if (!matched.length) return { restored: 0 };
    await adapter.executeAtomic({
      commandId: `restore-resource-payloads:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      label: 'restore-packaged-resource-payloads',
      statements: matched.flatMap((resource) => [{
        sql: `INSERT INTO document_resource_payloads(
                content_hash,mime_type,byte_size,payload,created_at
              ) VALUES(?,?,?,?,?)
              ON CONFLICT(content_hash) DO UPDATE SET
                mime_type=excluded.mime_type,
                byte_size=excluded.byte_size,
                payload=excluded.payload`,
        bind: [
          resource.image.sha256,
          resource.image.mimeType,
          resource.image.bytes.byteLength,
          resource.image.bytes,
          resource.createdAt || new Date().toISOString(),
        ],
        result: 'changes',
      }, {
        sql: `INSERT INTO document_resource_payload_refs(resource_uuid,content_hash)
              VALUES(?,?)
              ON CONFLICT(resource_uuid) DO UPDATE SET
                content_hash=excluded.content_hash`,
        bind: [resource.uuid, resource.image.sha256],
        result: 'changes',
      }]),
    });
    return { restored: matched.length };
  }

  async _importLegacyTypedProjections(adapter, legacy) {
    const shadow = adapter.shadowDomains;
    const records = (store) => legacy.stores[store] || [];
    const results = {};
    results.coreProfiles = await shadow.importers.coreProfiles.import({
      players: records(STORES.player),
      appState: legacy.appState,
      economyState: legacy.economyState,
      settings: records(STORES.appSetting),
    });
    results.planning = await shadow.importers.planning.import({
      projects: records(STORES.project),
      todos: records(STORES.todo),
      tasks: records(STORES.task),
      reminders: records(STORES.reminder),
    });
    results.notes = await shadow.importers.notes.import({
      notes: records(STORES.notes),
    });
    results.journals = await shadow.importers.journals.import({
      journals: legacy.shadowJournals,
      journalMetadata: legacy.journalMetadata,
    });
    results.journalRelations = await shadow.importers.journalRelations.import({
      journalMetadata: legacy.journalMetadata,
      journalComments: records(STORES.journalComment),
    });
    results.matches = await shadow.importers.matches.import({
      matches: records(STORES.match),
      backgroundJobs: records(STORES.backgroundJob),
      backgroundJobReceipts: records(STORES.backgroundJobReceipt),
    });
    results.events = await shadow.importers.events.import({
      events: records(STORES.event),
      customEvents: records(STORES.customEvent),
      eventLogs: records(STORES.eventLog),
      eventBuffs: records(STORES.eventBuff),
      contributions: records(STORES.contribution),
    });
    results.commerce = await shadow.importers.commerce.import({
      shop: records(STORES.shop),
      inventory: records(STORES.inventory),
      transactions: records(STORES.transaction),
    });
    results.social = await shadow.importers.social.import({
      friendships: records(STORES.friendship),
      notifications: records(STORES.notification),
    });
    results.recoveryModel = await shadow.importers.recoveryModel.import({
      achievementEvents: records(STORES.achievementEvent),
      achievementStates: records(STORES.achievementState),
      achievementReceipts: records(STORES.achievementReceipt),
      taskRecommendations: records(STORES.recommenderEvent),
      analyticsEvents: records(STORES.analyticsEvent),
      modelSettings: legacy.modelSettings,
      derivedCaches: records(STORES.derivedCache),
      profileSummaries: records(STORES.profileSummary),
    });
    return results;
  }

  async _legacyZipUpload(zip) {
    const legacy = await parseLegacyPortablePackage(zip);
    const liveAdapter = this.persistenceRuntime.sqliteStorageAdapter;
    await this.compactWritePromise;
    const rollback = await liveAdapter.exportSnapshot({}, { timeoutMs: 30_000 });
    const stagingAdapter = new SqliteStorageAdapter();
    let liveRestored = false;
    try {
      await stagingAdapter.open({ mode: 'memory' });
      const migratedStores = await migrateLegacyQuickNotesToEntries(legacy.stores);
      const entries = Object.values(STORES).map((store) => [
        store,
        [
          ...(migratedStores[store] || []),
          ...(store === STORES.appSetting
            ? this._compactSystemRecords({
                appState: legacy.appState,
                economyState: legacy.economyState,
              })
            : []),
        ],
      ]);
      await stagingAdapter.documents.replaceAll(entries, { label: 'legacy-compact-import' });
      const typed = await this._importLegacyTypedProjections(stagingAdapter, {
        ...legacy,
        stores: migratedStores,
      });
      const stagedSnapshot = await stagingAdapter.exportSnapshot({}, { timeoutMs: 30_000 });
      const verified = await stagingAdapter.verifySnapshot(
        { byteArray: stagedSnapshot.byteArray },
        { timeoutMs: 30_000 },
      );
      if (stagedSnapshot.quickCheck !== 'ok'
        || verified.quickCheck !== 'ok'
        || verified.integrityCheck !== 'ok'
        || stagedSnapshot.foreignKeyViolations?.length
        || verified.foreignKeyViolations?.length) {
        throw new Error('Migrated legacy SQLite snapshot failed integrity verification.');
      }

      await liveAdapter.restoreSnapshot(
        { byteArray: stagedSnapshot.byteArray },
        { timeoutMs: 30_000 },
      );
      liveRestored = true;
      await this.initializeCompactSqlite();
      clearResourceObjectUrlCache();
      await this.reconcileMissingMaterializedLeaderboards({
        force: true,
        reason: 'legacy-package-cache-reconciliation',
      });
      this.demoMode = false;
      return {
        direction: 'upload',
        format: LEGACY_PACKAGE_FORMAT,
        sourceSchemaVersion: legacy.schemaVersion,
        recordCount: legacy.recordCount,
        typed,
      };
    } catch (error) {
      if (liveRestored) {
        await liveAdapter.restoreSnapshot(
          { byteArray: rollback.byteArray },
          { timeoutMs: 30_000 },
        );
        await this.initializeCompactSqlite();
        clearResourceObjectUrlCache();
      }
      throw new Error(`Legacy Tapestry save could not be migrated: ${error.message}`, { cause: error });
    } finally {
      await stagingAdapter.close().catch(() => {});
    }
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default ImportExportService;
