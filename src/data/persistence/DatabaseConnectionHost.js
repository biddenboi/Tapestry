import { STORES } from '@domain/constants.js';
import {
  measureDynamicModule,
  recordStartupDatabaseRead,
  recordStoreHydration,
  registerStaticModule,
} from '@shared/performance/startupPerf.js';
import { isResourceRef } from '@shared/resources/Resources.js';
import {
  buildLegacyProfileIGTRecovery,
  getCurrentIGT,
  migratePlayerIGTClock,
  needsProfileIGTActivityRecovery,
  preparePlayerIGTWrite,
  PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
} from '@domain/time/Time.js';
import {
  SOCIAL_WORLD_PERFORMANCE_OPERATION,
  measureSocialWorldOperation,
} from '@domain/social-world/SocialWorldPerformance.js';
import {
  applyProfileSummaryOperations,
  isProfileSummarySourceStore,
} from '@domain/profile/ProfileSummary.js';
import {
  IGT_ORIGIN,
} from '@domain/matches/IGT.js';
import {
  createEconomyState,
  writeGlobalMoney,
} from '@data/db/economyState.js';
import { UniformRandomFeedIndex } from '@domain/feed/UniformRandomFeed.js';
import {
  TIMESTAMPED_STORES,
  cloneValue,
  createEmptyAppState,
  createEmptyStoreMap,
  matchesIndex,
  normalizeAppState,
  normalizePlayerEloFields,
} from '@data/db/databaseConnectionUtils.js';
import { databaseConnectionFeatureMethods } from '@data/db/databaseConnectionFeatureMethods.js';
import { HYDRATION_DOMAINS } from '@data/db/domainHydration.js';
import PersistenceRuntime from '@data/persistence/PersistenceRuntime.js';
import { THEME_REGISTRY } from '@domain/themes/ThemeRegistry.js';
import { synchronizeThemeRecipeManifests } from '@domain/themes/ThemeRecipeRegistry.js';
import {
  applyProtectedNoteMutation,
  isNoteConflict,
  normalizeNoteRecord,
} from '@data/persistence/notes/noteDurability.js';
import {
  buildSyncOutboxStatement,
  normalizeSyncContext,
  syncCursorStatement,
} from '@data/sync/SyncContracts.js';
import { referenceCaptureGuard } from '@data/sync/ReferenceCaptureGuard.js';
registerStaticModule('data/DatabaseConnection');

const loadMaterializedLeaderboardJobs = () => measureDynamicModule(
  'materialized-leaderboard-jobs',
  () => import('@domain/leaderboards/MaterializedLeaderboards.js'),
);
const MATERIALIZED_LEADERBOARD_SOURCE_STORES = new Set([
  STORES.player,
  STORES.match,
  STORES.task,
  STORES.friendship,
  STORES.event,
  STORES.eventBuff,
  STORES.contribution,
]);
const COMPACT_APP_STATE_ID = '__tapestry_compact_app_state__';
const COMPACT_ECONOMY_STATE_ID = '__tapestry_compact_economy_state__';

export class DatabaseConnectionHost {
  demoMode = false;
  eloWorldCache = new Map();
  domainHydration = null;
  demoDataSeeder = null;
  get loadedDomains() { return this.domainHydration?.loadedDomains || new Set(); }
  set loadedDomains(value) { this.domainHydration.loadedDomains = value; }
  get domainLoadPromises() { return this.domainHydration?.domainLoadPromises || new Map(); }
  set domainLoadPromises(value) { this.domainHydration.domainLoadPromises = value; }
  get loadedStoreKeys() { return this.domainHydration?.loadedStoreKeys || new Set(); }
  set loadedStoreKeys(value) { this.domainHydration.loadedStoreKeys = value; }
  get storeLoadPromises() { return this.domainHydration?.storeLoadPromises || new Map(); }
  set storeLoadPromises(value) { this.domainHydration.storeLoadPromises = value; }
  get postMatchRecoveryQueued() { return this.domainHydration?.postMatchRecoveryQueued || false; }
  set postMatchRecoveryQueued(value) { this.domainHydration.postMatchRecoveryQueued = Boolean(value); }
  feedRandomIndex = new UniformRandomFeedIndex();
  feedRandomIndexStore = null;
  economyState = createEconomyState(0);
  appState = createEmptyAppState();
  stores = createEmptyStoreMap();
  compactWritePromise = Promise.resolve();
  materializedLeaderboardWritePromise = Promise.resolve(null);
  constructor(options = {}) {
    this.persistenceRuntime = new PersistenceRuntime(this, {
      ...options,
      getStores: () => this.stores,
      setStores: (stores) => { this.stores = stores; },
      createEmptyStoreMap,
      clone: cloneValue,
    });
    this.domainHydration = this.persistenceRuntime.domainHydration;
    this.demoDataSeeder = this.persistenceRuntime.demoDataSeeder;
    this.persistenceReporter = this.persistenceRuntime.reporter;
    this.coreStorage = this.persistenceRuntime.storage;
    this.storageAdapter = this.persistenceRuntime.storageAdapter;
    this.repositories = this.persistenceRuntime.repositories;
    this.timelineQueries = this.persistenceRuntime.timelineQueries;
    this.profileDaybookQueries = this.persistenceRuntime.profileDaybookQueries;
    this.profileContextRepository = this.persistenceRuntime.profileContextRepository;
    this.profileContextFacts = this.persistenceRuntime.profileContextFacts;
    this.profileContextProjections = this.persistenceRuntime.profileContextProjections;
    this.profileContextSuggestions = this.persistenceRuntime.profileContextSuggestions;
    this.profileContextCommands = this.persistenceRuntime.profileContextCommands;
    this.profileContextActions = this.persistenceRuntime.profileContextActions;
    this.socialWorldPresence = this.persistenceRuntime.socialWorldPresence;
    this.socialWorldQueries = this.persistenceRuntime.socialWorldQueries;
    this.socialWorldCast = this.persistenceRuntime.socialWorldCast;
    this.socialWorldFriendships = this.persistenceRuntime.socialWorldFriendships; this.socialWorldResidency = this.persistenceRuntime.socialWorldResidency; this.socialWorldSceneQueries = this.persistenceRuntime.socialWorldSceneQueries; this.socialActivityIndex = this.persistenceRuntime.socialActivityIndex; this.socialEncounters = this.persistenceRuntime.socialEncounters; this.socialWorldProfileCards = this.persistenceRuntime.socialWorldProfileCards; this.dojoRoomQueries = this.persistenceRuntime.dojoRoomQueries; this.dojoStandings = this.persistenceRuntime.dojoStandings;
    this.reminderQueries = this.persistenceRuntime.reminderQueries;
    this.eloQueries = this.persistenceRuntime.eloQueries;
    this.profileLifecycle = this.persistenceRuntime.profileLifecycle;
    this.importExport = this.persistenceRuntime.importExport;
    this.dataIntegrity = this.persistenceRuntime.dataIntegrity;
    this.saveVerification = this.persistenceRuntime.saveVerification;
    this.achievementV2 = this.persistenceRuntime.achievementV2;
    this.navigationPreferences = this.persistenceRuntime.navigationPreferences;
    this.chronicleSchema40 = this.persistenceRuntime.chronicleSchema40;
    this.contributionRoad = this.persistenceRuntime.contributionRoad;
    this.syncRuntime = this.persistenceRuntime.syncRuntime;
    this.ready = Promise.resolve();
  }
  _compactSystemRecords({
    appState = this.appState,
    economyState = this.economyState,
  } = {}) {
    return [
      { UUID: COMPACT_APP_STATE_ID, kind: 'compact-system-state', value: normalizeAppState(appState) },
      { UUID: COMPACT_ECONOMY_STATE_ID, kind: 'compact-system-state', value: createEconomyState(economyState?.globalMoney || 0) },
    ];
  }
  async _synchronizePlayerIGTClockRows(players = [], label = 'player-igt-clock-sync') {
    const rows = (players || []).filter((player) => player?.UUID);
    if (!rows.length) return { synchronized: 0 };
    await this.persistenceRuntime.sqliteStorageAdapter.client.executeAtomic({
      commandId: `${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      label,
      statements: rows.map((player) => ({
        sql: `UPDATE players
              SET in_game_time=?,
                  extra_json=json_set(
                    extra_json,
                    '$.igtClockVersion',?,
                    '$.igtActivityRecoveryVersion',?,
                    '$.igtActive',json(?),
                    '$.igtLastActiveDate',?
                  )
              WHERE id=?`,
        bind: [
          Math.max(0, Math.trunc(Number(player.inGameTime) || 0)),
          Number(player.igtClockVersion) || 2,
          Number(player.igtActivityRecoveryVersion)
            || PROFILE_IGT_ACTIVITY_RECOVERY_VERSION,
          player.igtActive ? 'true' : 'false',
          player.igtLastActiveDate || null,
          player.UUID,
        ],
        result: 'changes',
      })),
    });
    return { synchronized: rows.length };
  }
  async initializeCompactSqlite() {
    const documents = this.persistenceRuntime.sqliteStorageAdapter?.documents;
    if (!documents) throw new Error('Canonical SQLite document repository is unavailable.');
    const nextStores = createEmptyStoreMap();
    await Promise.all(Object.values(STORES).map(async (store) => {
      const records = await documents.getAll(store);
      nextStores.set(store, new Map(records.filter(Boolean).map((record) => [record.UUID, cloneValue(record)])));
    }));
    const settings = nextStores.get(STORES.appSetting);
    const compactAppState = settings.get(COMPACT_APP_STATE_ID)?.value;
    const compactEconomyState = settings.get(COMPACT_ECONOMY_STATE_ID)?.value;
    settings.delete(COMPACT_APP_STATE_ID);
    settings.delete(COMPACT_ECONOMY_STATE_ID);
    this.appState = normalizeAppState(compactAppState);
    this.economyState = createEconomyState(compactEconomyState?.globalMoney || 0);
    const nowMs = Date.now();
    const playerStore = nextStores.get(STORES.player);
    const legacyActivityRows = await this.persistenceRuntime.sqliteStorageAdapter.client.query({
      sql: `SELECT player_id AS playerUUID,event_type AS eventType,created_at AS createdAt
            FROM lifecycle_events
            WHERE player_id IS NOT NULL
              AND event_type IN ('wake','enter','item_use','end_work','end-work')
            ORDER BY created_at,id`,
      result: 'all',
    });
    const activeStateUpdatedAt = await this.persistenceRuntime.sqliteStorageAdapter.client.query({
      sql: 'SELECT updated_at FROM app_state WHERE singleton_id=1',
      result: 'value',
    });
    const legacyRecovery = buildLegacyProfileIGTRecovery(
      [...playerStore.values()],
      {
        activityEvents: legacyActivityRows,
        activePlayerUUID: this.appState.activePlayerUUID,
        activeStateUpdatedAt,
        nowMs,
      },
    );
    const migratedPlayers = [];
    for (const [UUID, player] of playerStore.entries()) {
      const needsActivityRecovery = needsProfileIGTActivityRecovery(player);
      const recovered = needsActivityRecovery ? legacyRecovery.get(UUID) : null;
      const recoveredClock = recovered ? {
        inGameTime: recovered.inGameTime,
        igtActive: recovered.igtActive,
        igtLastActiveDate: recovered.igtLastActiveDate,
        igtClockVersion: recovered.igtClockVersion,
        igtActivityRecoveryVersion: recovered.igtActivityRecoveryVersion,
      } : null;
      const migrated = migratePlayerIGTClock({
        ...player,
        ...(recoveredClock || {}),
      }, {
        active: UUID === this.appState.activePlayerUUID,
        nowMs,
      });
      playerStore.set(UUID, cloneValue(migrated));
      if (JSON.stringify(migrated) !== JSON.stringify(player)) migratedPlayers.push(migrated);
    }
    if (migratedPlayers.length) {
      await documents.commitBatch({
        label: 'profile-igt-clock-v2-migration',
        operations: migratedPlayers.map((record) => ({
          type: 'put',
          store: STORES.player,
          record,
        })),
      });
      await this._synchronizePlayerIGTClockRows(
        migratedPlayers,
        'profile-igt-clock-v2-projection',
      );
    }
    this.stores = nextStores;
    this._rebuildFeedRandomIndex();
    this.loadedDomains = new Set(HYDRATION_DOMAINS);
    this.loadedStoreKeys = new Set(Object.values(STORES));
    this.eloWorldCache.clear();
    this.persistenceRuntime.markSqliteAuthoritativeProjectionsReady();
    await synchronizeThemeRecipeManifests(
      this.persistenceRuntime.sqliteStorageAdapter,
      THEME_REGISTRY,
    );
    await this.achievementV2.synchronizeDefinitions();
    await this.chronicleSchema40.reconcile();
    await this.syncRuntime.initialize();
    return {
      initialized: true,
      recordCount: [...nextStores.values()].reduce((total, records) => total + records.size, 0),
    };
  }
  async persistAllToCompactSqlite({ label = 'compact-replace-all' } = {}) {
    const documents = this.persistenceRuntime.sqliteStorageAdapter?.documents;
    const entries = Object.values(STORES).map((store) => [
      store,
      [
        ...this._records(store),
        ...(store === STORES.appSetting ? this._compactSystemRecords() : []),
      ],
    ]);
    await documents.replaceAll(entries, { label });
    const leaderboardReconciliation = await this.reconcileMissingMaterializedLeaderboards({
      force: true,
      reason: `${label}:missing-cache-reconciliation`,
    });
    return { persisted: true, leaderboardReconciliation };
  }
  _queueCompactSystemStateWrite() {
    const documents = this.persistenceRuntime.sqliteStorageAdapter?.documents;
    const records = this._compactSystemRecords();
    this.compactWritePromise = this.compactWritePromise
      .then(() => documents.commitBatch({
        label: 'compact-system-state',
        operations: records.map((record) => ({ type: 'put', store: STORES.appSetting, record })),
      }));
  }
  getRepository(domain) {
    const repository = this.repositories?.[domain] || null;
    if (!repository) throw new Error(`Unknown persistence repository: ${domain}`);
    return repository;
  }
  createSyncCommandContext(input) {
    return this.syncRuntime.createCommandContext(input);
  }
  getQuickNotes() {
    return this.getRepository('notes').getAll();
  }
  getNoteConflicts(options) {
    return this.getRepository('notes').getConflicts(options);
  }
  getNoteOperationResult(operationId) {
    return this.getRepository('notes').getOperationResult(operationId);
  }
  createNote(note, options) {
    return this.getRepository('notes').createNote(note, options);
  }
  updateNoteIfCurrent(noteUUID, options) {
    return this.getRepository('notes').updateNoteIfCurrent(noteUUID, options);
  }
  deleteNoteIfCurrent(noteUUID, options) {
    return this.getRepository('notes').deleteNoteIfCurrent(noteUUID, options);
  }
  recoverNoteConflict(conflictUUID, note, options) {
    return this.getRepository('notes').recoverConflictAsNewNote(conflictUUID, note, options);
  }
  isPartiallyLoaded() { return this.domainHydration.isPartiallyLoaded(); }
  ensureFullyLoaded() { return this.domainHydration.ensureFullyLoaded(); }
  getDomainLoadState(domain) { return this.domainHydration.getDomainLoadState(domain); }
  isDomainLoaded(domain) { return this.domainHydration.isDomainLoaded(domain); }
  getLoadedDomains() { return this.domainHydration.getLoadedDomains(); }
  ensureDomainsLoaded(domains) { return this.domainHydration.ensureDomainsLoaded(domains); }
  ensureDomainLoaded(domain) { return this.domainHydration.ensureDomainLoaded(domain); }
  invalidateMatchDerivedCaches() {
    this.eloWorldCache.clear();
  }
  _replaceStoreRecords(store, records) {
    const next = this.coreStorage.replaceStore(store, records);
    this._invalidateEloWorldCache(store);
    if (store === STORES.journal) this._rebuildFeedRandomIndex(next);
    return next;
  }
  _rebuildFeedRandomIndex(store = this._store(STORES.journal)) {
    this.feedRandomIndex.rebuild(store.values());
    this.feedRandomIndexStore = store;
  }
  _ensureFeedRandomIndex(store = this._store(STORES.journal)) {
    if (this.feedRandomIndexStore !== store || this.feedRandomIndex.size !== store.size) {
      this._rebuildFeedRandomIndex(store);
    }
    return this.feedRandomIndex;
  }
  _queueCompactDerivedWrites(label, operations = []) {
    if (!operations.length) return;
    const documents = this.persistenceRuntime.sqliteStorageAdapter?.documents;
    if (!documents) return;
    this.compactWritePromise = this.compactWritePromise
      .then(() => documents.commitBatch({ label, operations }))
      .catch((error) => {
        console.warn(`[DatabaseConnection] ${label} persistence failed; derived state will be rebuilt:`, error);
      });
  }
  _applyProfileSummaryMutations(operations = []) {
    const relevant = (operations || []).filter((operation) => (
      operation?.store !== STORES.profileSummary
      && isProfileSummarySourceStore(operation?.store)
    ));
    if (!relevant.length || !this.loadedDomains.has('profileSummaries')) return;
    const existing = this._recordValues(STORES.profileSummary);
    const { summaries, touched } = applyProfileSummaryOperations(existing, relevant);
    if (!touched.length) return;
    const byUUID = new Map(summaries.map((record) => [record.UUID, record]));
    const compactOperations = [];
    for (const UUID of touched) {
      const record = byUUID.get(UUID);
      if (!record) {
        this._store(STORES.profileSummary).delete(UUID);
        compactOperations.push({ type: 'delete', store: STORES.profileSummary, UUID });
        continue;
      }
      this._store(STORES.profileSummary).set(UUID, cloneValue(record));
      compactOperations.push({
        type: 'put',
        store: STORES.profileSummary,
        record: cloneValue(record),
      });
    }
    this._queueCompactDerivedWrites('profile-summary-derived-update', compactOperations);
  }
  _resetLoadedData(options) { return this.domainHydration._resetLoadedData(options); }
  loadDemoData() { return this.demoDataSeeder.seed(); }
  _store(store) {
    return this.coreStorage.store(store);
  }
  async _index(store, indexName, key) {
    await this.ready;
    const records = this._store(store);
    const matches = [];
    for (const record of records.values()) {
      if (matchesIndex(record, indexName, key)) matches.push(cloneValue(record));
    }
    recordStartupDatabaseRead(store, { operation: 'scan', records: records.size });
    return matches;
  }
  /* ── Generic CRUD (used everywhere in the app) ─────────────────── */
  async get(store, UUID) {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    await this.ready;
    const value = cloneValue(this._store(store).get(UUID) || null);
    recordStartupDatabaseRead(store, { operation: 'get', records: value ? 1 : 0, startedAt });
    return value;
  }
  _records(store) {
    return this.coreStorage.records(store);
  }
  _recordValues(store) {
    const values = this.coreStorage.values(store);
    recordStartupDatabaseRead(store, { operation: 'scan', records: values.length });
    return values;
  }
  _invalidateEloWorldCache(store) {
    if (store === STORES.player || store === STORES.match) this.eloWorldCache.clear();
  }
  _queueMaterializedLeaderboardRebuild(operations = [], reason = 'committed-store-mutation') {
    const committedOperations = (operations || []).filter((operation) => (
      MATERIALIZED_LEADERBOARD_SOURCE_STORES.has(operation?.store)
    ));
    if (!committedOperations.length) return;
    const rebuild = Promise.resolve()
      .then(loadMaterializedLeaderboardJobs)
      .then(({ queueLeaderboardRebuildForOperations }) => (
        queueLeaderboardRebuildForOperations(this, committedOperations, reason)
      ));
    this.materializedLeaderboardWritePromise = rebuild.catch((error) => {
        console.warn('[DatabaseConnection] leaderboard snapshot rebuild failed:', error);
        return null;
      });
  }
  async flushSyncProjections() {
    await this.materializedLeaderboardWritePromise;
    this.eloWorldCache.clear();
    return { flushed: true };
  }
  async reconcileMissingMaterializedLeaderboards({
    force = false,
    reason = 'full-load-cache-reconciliation',
  } = {}) {
    const {
      CONTRIBUTION_LEADERBOARD_SNAPSHOT_ID,
      MATCH_LEADERBOARD_SNAPSHOT_ID,
      MATERIALIZED_LEADERBOARD_SCHEMA_VERSION,
      LEADERBOARD_REBUILD_SCOPE,
      queueMaterializedLeaderboardRebuild,
    } = await loadMaterializedLeaderboardJobs();
    const settings = this._store(STORES.derivedCache);
    const hasCurrentSnapshots = [
      settings.get(MATCH_LEADERBOARD_SNAPSHOT_ID)?.value,
      settings.get(CONTRIBUTION_LEADERBOARD_SNAPSHOT_ID)?.value,
    ].every((snapshot) => (
      Number(snapshot?.schemaVersion) === MATERIALIZED_LEADERBOARD_SCHEMA_VERSION
    ));
    if (!force && hasCurrentSnapshots) {
      return { rebuilt: false, reason: 'current' };
    }
    const result = await queueMaterializedLeaderboardRebuild(this, {
      scopes: [
        LEADERBOARD_REBUILD_SCOPE.match,
        LEADERBOARD_REBUILD_SCOPE.contribution,
      ],
      reason,
    });
    return { rebuilt: true, reason, result };
  }

  async _ensureStoreLoadedForMutation(store, record = null, mutationType = 'put') {
    await this.ready;
    void store;
    void record;
    void mutationType;
  }

  async commitAtomicMutation({
    label = 'atomic-mutation',
    puts = [],
    deletes = [],
    globalMoney,
    flush = false,
    queueDerived = true,
    operationId = null,
    sync = null,
    additionalStatements = [],
  } = {}) {
    await this.ready;
    const requestedPuts = Array.isArray(puts) ? puts : [];
    const requestedDeletes = Array.isArray(deletes) ? deletes : [];
    const requestedStatements = Array.isArray(additionalStatements)
      ? additionalStatements.filter(Boolean)
      : [];
    const requestedOperations = [
      ...requestedPuts.map((entry) => ({ type: 'put', ...entry })),
      ...requestedDeletes.map((entry) => ({ type: 'delete', ...entry })),
    ];
    if (requestedOperations.some((operation) => operation?.store === STORES.notes)) {
      throw new Error('Quick Notes require the protected revision-aware Notes repository.');
    }
    if (!requestedOperations.length && globalMoney === undefined && !requestedStatements.length) {
      return { changed: false, label, operationCount: 0 };
    }
    for (const statement of requestedStatements) {
      if (!statement || typeof statement.sql !== 'string' || !statement.sql.trim()) {
        throw new TypeError('Atomic mutation SQL statements require a non-empty sql string.');
      }
      if (statement.bind != null && !Array.isArray(statement.bind)) {
        throw new TypeError('Atomic mutation SQL statement bindings must be an array.');
      }
    }

    const syncContext = normalizeSyncContext({
      ...(sync || {}),
      operationId: sync?.operationId || operationId || null,
    });
    const localMutationTimestamp = syncContext.origin === 'remote-sync'
      ? null
      : new Date().toISOString();
    if (syncContext.enqueueSync) {
      const device = await this.syncRuntime.devices.get(syncContext.deviceId);
      if (!device || String(device.ownerId) !== String(syncContext.ownerId) || device.retiredAt) {
        const error = new Error('The sync command references an unavailable or mismatched device identity.');
        error.code = 'sync-device-unavailable';
        throw error;
      }
    }

    for (const operation of requestedOperations) {
      if (!operation?.store) throw new Error('Atomic mutations require a store for every operation.');
      if (operation.type === 'put' && !operation.record?.UUID) {
        throw new Error(`Cannot save ${operation.store} record without a UUID.`);
      }
      if (operation.type === 'delete' && !operation.UUID) {
        throw new Error(`Cannot delete ${operation.store} record without a UUID.`);
      }
      await this._ensureStoreLoadedForMutation(
        operation.store,
        operation.record || { UUID: operation.UUID },
        operation.type,
      );
    }

    const stagedStores = new Map();
    const stagedOperations = [];
    const getStagedStore = (store) => {
      if (!stagedStores.has(store)) stagedStores.set(store, new Map(this._store(store)));
      return stagedStores.get(store);
    };

    for (const operation of requestedOperations) {
      const stagedStore = getStagedStore(operation.store);
      if (operation.type === 'delete') {
        const previousRecord = cloneValue(stagedStore.get(operation.UUID) || null);
        stagedStore.delete(operation.UUID);
        stagedOperations.push({
          type: 'delete',
          store: operation.store,
          UUID: operation.UUID,
          previousRecord,
        });
        continue;
      }

      const previousRecord = cloneValue(stagedStore.get(operation.record.UUID) || null);
      let next = cloneValue(operation.record);
      if (operation.store === STORES.player) {
        next = normalizePlayerEloFields(preparePlayerIGTWrite(next, previousRecord), previousRecord);
      }
      if (TIMESTAMPED_STORES.has(operation.store)
          && (next?.inGameTimestamp == null || next.inGameTimestamp === ''
            || !Number.isFinite(Number(next.inGameTimestamp)))) {
        const actorUUID = next?.parent || next?.authorUUID || next?.requestedBy;
        const actor = actorUUID
          ? await this.get(STORES.player, actorUUID)
          : await this._getCurrentPlayerRecord();
        next = { ...next, inGameTimestamp: Math.max(0, Number(getCurrentIGT(actor)) || 0) };
      }
      if (localMutationTimestamp) {
        next = { ...next, syncUpdatedAt: localMutationTimestamp };
      }
      stagedStore.set(next.UUID, cloneValue(next));
      stagedOperations.push({
        type: 'put',
        store: operation.store,
        record: cloneValue(next),
        previousRecord,
        preserveRemoteConflict: operation.store === STORES.notes || operation.store === STORES.journal,
      });
    }

    const nextEconomyState = cloneValue(this.economyState);
    if (globalMoney !== undefined) writeGlobalMoney(globalMoney, nextEconomyState);

    // SQLite commits the complete command before the UI cache changes, so a
    // failed multi-record operation cannot expose partial state.
    const compactOperations = stagedOperations.map((operation) => (
      operation.type === 'put'
        ? { type: 'put', store: operation.store, record: operation.record }
        : { type: 'delete', store: operation.store, UUID: operation.UUID }
    ));
    if (globalMoney !== undefined) {
      compactOperations.push({
        type: 'put',
        store: STORES.appSetting,
        record: this._compactSystemRecords({ economyState: nextEconomyState })[1],
      });
    }
    const referenceOutboxStatements = this.syncRuntime.buildReferenceOutboxStatements(
      stagedOperations,
      { origin: syncContext.origin },
    );
    const referenceTypes = this.syncRuntime.referenceTypesForOperations(stagedOperations);
    const captureGuard = referenceCaptureGuard(syncContext.origin);
    const commit = await this.persistenceRuntime.sqliteStorageAdapter.documents.commitBatch({
      ...(operationId ? { commandId: String(operationId) } : {}),
      label,
      beforeStatements: captureGuard.beforeStatements,
      operations: compactOperations,
      additionalStatements: [
        ...requestedStatements,
        buildSyncOutboxStatement(syncContext),
        syncCursorStatement(syncContext.cursor),
        ...referenceOutboxStatements,
      ].filter(Boolean),
      afterStatements: captureGuard.afterStatements,
    });

    // A stable operation ID may be retried after an acknowledgement is lost.
    // The worker receipt makes that retry a no-op; do not project the caller's
    // potentially stale retry payload into the read cache.
    if (commit?.duplicate) {
      return {
        changed: false,
        duplicate: true,
        label,
        operationId: operationId || syncContext.operationId || null,
        operationCount: 0,
        persistence: { changed: false, reason: 'duplicate-operation' },
      };
    }

    // Update the read cache only after authoritative persistence succeeds.
    for (const [store, records] of stagedStores.entries()) {
      this.stores.set(store, records);
      this._invalidateEloWorldCache(store);
      if (store === STORES.journal) this._rebuildFeedRandomIndex(records);
    }
    if (globalMoney !== undefined) this.economyState = nextEconomyState;

    this._applyProfileSummaryMutations(stagedOperations);
    if (queueDerived) this._queueMaterializedLeaderboardRebuild(stagedOperations, label);

    const persistence = flush
      ? { changed: true, direction: 'sqlite' }
      : { changed: false, reason: 'deferred' };
    const result = {
      changed: true,
      duplicate: false,
      label,
      operationId: operationId || syncContext.operationId || null,
      operationCount: stagedOperations.length + requestedStatements.length,
      stores: [...new Set(stagedOperations.map((operation) => operation.store))],
      economyChanged: globalMoney !== undefined,
      persistence,
      syncQueued: syncContext.enqueueSync || referenceOutboxStatements.length > 0,
      referenceQueued: referenceOutboxStatements.length,
    };
    if (syncContext.enqueueSync || referenceOutboxStatements.length) {
      await this.syncRuntime.operationCommitted({
        referenceTypes,
        commandQueued: Boolean(syncContext.enqueueSync),
        label,
      });
    }
    return result;
  }

  async add(store, data) {
    if (store === STORES.notes) {
      throw new Error('Quick Notes cannot be written through generic add(); use createNote or updateNoteIfCurrent.');
    }
    if (!data?.UUID) throw new Error(`Cannot save ${store} record without a UUID.`);
    const result = await this.commitAtomicMutation({
      label: `generic-put:${store}`,
      puts: [{ store, record: data }],
      sync: { origin: 'desktop', enqueueSync: false },
    });
    if (!result.changed && !result.duplicate) {
      throw new Error(`Saving ${store}:${data.UUID} produced no durable mutation.`);
    }
    if (store === STORES.journal) {
      const persisted = await this.persistenceRuntime.sqliteStorageAdapter.documents.get(store, data.UUID);
      if (!persisted || persisted.UUID !== data.UUID) {
        throw new Error(`Journal ${data.UUID} failed SQLite durability verification.`);
      }
    }
    return data.UUID;
  }

  async _commitProtectedNoteMutation(mutation) {
    await this._ensureStoreLoadedForMutation(STORES.notes, mutation?.record, mutation?.action);
    const target = new Map(this._store(STORES.notes));
    const result = applyProtectedNoteMutation(target, mutation, { clone: cloneValue });
    const current = this._store(STORES.notes);
    const operations = [...target.values()]
      .filter((record) => JSON.stringify(current.get(record.UUID) || null) !== JSON.stringify(record))
      .map((record) => ({ type: 'put', store: STORES.notes, record }));
    await this.persistenceRuntime.sqliteStorageAdapter.documents.commitBatch({
      label: 'protected-note',
      operations,
    });
    this.stores.set(STORES.notes, target);
    return cloneValue(result);
  }

  async _recoverNoteConflict(conflictUUID, note, { operationId, now = new Date().toISOString() } = {}) {
    const conflict = normalizeNoteRecord(await this.get(STORES.notes, conflictUUID));
    if (!conflict || !isNoteConflict(conflict)) throw new Error('This recovery draft no longer exists.');
    if (conflict.resolvedAt && conflict.recoveredAs) {
      return { status: 'applied', idempotent: true, record: await this.get(STORES.notes, conflict.recoveredAs) };
    }
    const created = await this.createNote(note, { operationId, now });
    if (created.status === 'conflict') return created;
    const resolved = {
      ...conflict,
      resolvedAt: now,
      recoveredAs: created.record.UUID,
      updatedAt: now,
    };
    await this.persistenceRuntime.sqliteStorageAdapter.documents.put(STORES.notes, resolved);
    this._store(STORES.notes).set(resolved.UUID, cloneValue(resolved));
    return created;
  }

  async _flushMutationWrite() {
    await this.compactWritePromise;
    return { changed: true, direction: 'sqlite' };
  }

  async flushWrites() {
    return this._flushMutationWrite();
  }

  _queueAppStateWrite() {
    this._queueCompactSystemStateWrite();
  }

  async remove(store, UUID) {
    if (store === STORES.notes) {
      throw new Error('Quick Notes cannot be removed through generic remove(); use deleteNoteIfCurrent.');
    }
    if (!UUID) return false;
    const existing = await this.get(store, UUID);
    if (!existing) return false;
    await this.commitAtomicMutation({
      label: `generic-delete:${store}`,
      deletes: [{ store, UUID }],
      sync: { origin: 'desktop', enqueueSync: false },
    });
    return true;
  }

  async clear(store) {
    if (store === STORES.notes) {
      throw new Error('Quick Notes cannot be cleared through generic CRUD.');
    }
    const records = await this.getAll(store);
    if (!records.length) return 0;
    await this.commitAtomicMutation({
      label: `generic-clear:${store}`,
      deletes: records.filter((record) => record?.UUID).map((record) => ({ store, UUID: record.UUID })),
      sync: { origin: 'desktop', enqueueSync: false },
    });
    return records.length;
  }

  async getAll(store) {
    await this.ready;
    return this._records(store);
  }

  getPlayerStore(store, UUID) { return this._index(store, 'parent', UUID); }

  async findResourceByHash(hash) {
    if (!hash) return null;
    const rows = await this._index(STORES.resource, 'hash', hash);
    return rows[0] || null;
  }

  getAllThroughIGT(store, viewerIGT) { return this.timelineQueries.getAllThroughIGT(store, viewerIGT); }
  getPlayerStoreThroughIGT(store, playerUUID, viewerIGT) { return this.timelineQueries.getPlayerStoreThroughIGT(store, playerUUID, viewerIGT); }
  getRandomVisibleFeedEntry(viewerIGT, options) { return this.timelineQueries.getRandomVisibleFeedEntry(viewerIGT, options); }
  getCommentsForJournalThroughIGT(journalUUID, viewerIGT) { return this.timelineQueries.getCommentsForJournalThroughIGT(journalUUID, viewerIGT); }
  getEventLogsForEventThroughIGT(eventUUID, viewerIGT) { return this.timelineQueries.getEventLogsForEventThroughIGT(eventUUID, viewerIGT); }
  getCompletedMatchesThroughIGT(viewerIGT) { return this.timelineQueries.getCompletedMatchesThroughIGT(viewerIGT); }
  getProfileMatchesForPlayer(playerUUID, viewerIGT) { return this.timelineQueries.getProfileMatchesForPlayer(playerUUID, viewerIGT); }
  getVisibleMatchesForPlayer(playerUUID, viewerIGT) { return this.timelineQueries.getVisibleMatchesForPlayer(playerUUID, viewerIGT); }
  getProfileDaybookPage(query) {
    return measureSocialWorldOperation(SOCIAL_WORLD_PERFORMANCE_OPERATION.profileDaybookPage, () => (
      this.profileDaybookQueries.getProfileDaybookPage(query)
    ));
  }
  getPlayerReminders(playerUUID) { return this.reminderQueries.getPlayerReminders(playerUUID); }
  getWorkspaceReminders(workspaceId) { return this.reminderQueries.getWorkspaceReminders(workspaceId); }
  _getReminderTime(reminder) { return this.reminderQueries._getReminderTime(reminder); }
  getUpcomingReminders(playerUUID, options) { return this.reminderQueries.getUpcomingReminders(playerUUID, options); }
  getUpcomingWorkspaceReminders(workspaceId, options) { return this.reminderQueries.getUpcomingWorkspaceReminders(workspaceId, options); }
  getDueReminders(playerUUID, now) { return this.reminderQueries.getDueReminders(playerUUID, now); }
  _patchReminder(reminderUUID, patch) { return this.reminderQueries._patchReminder(reminderUUID, patch); }
  completeReminder(reminderUUID, options) { return this.reminderQueries.completeReminder(reminderUUID, options); }
  dismissReminder(reminderUUID, options) { return this.reminderQueries.dismissReminder(reminderUUID, options); }
  snoozeReminder(reminderUUID, minutes, options) { return this.reminderQueries.snoozeReminder(reminderUUID, minutes, options); }
  getEloWorldAtIGT(viewerIGT, options) { return this.eloQueries.getEloWorldAtIGT(viewerIGT, options); }
  getPlayersAtIGT(viewerIGT, options) { return this.eloQueries.getPlayersAtIGT(viewerIGT, options); }
  getPlayerAtIGT(playerUUID, viewerIGT) { return this.eloQueries.getPlayerAtIGT(playerUUID, viewerIGT); }
  getStoreFromRange(store, startDate, endDate) { return this.eloQueries.getStoreFromRange(store, startDate, endDate); }
  _collectReferencedResourceUUIDs(values = []) {
    const refs = new Set();
    const stack = Array.isArray(values) ? [...values] : [values];
    const seen = new WeakSet();
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value);
      if (isResourceRef(value)) {
        refs.add(value.resourceUUID);
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) stack.push(item);
        continue;
      }
      for (const item of Object.values(value)) stack.push(item);
    }
    return refs;
  }

  /* ── Download helper ────────────────────────────────────────────── */
  _download(data, filename) {
    const json = JSON.stringify(data, (_k, v) => (v == null || v === '' ? undefined : v));
    this._downloadBlob(new Blob([json], { type: 'application/json' }), filename);
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

  _snapshotAllStores() {
    return this.coreStorage.snapshot();
  }

  getSaveAsZip(...args) {
    return this.importExport.getSaveAsZip(...args);
  }
  createCompactBackup(...args) {
    return this.importExport.createCompactBackup(...args);
  }
  createEncryptedDesktopBackup(...args) {
    return this.importExport.createEncryptedDesktopBackup(...args);
  }
  restoreEncryptedDesktopBackup(...args) {
    return this.importExport.restoreEncryptedDesktopBackup(...args);
  }
  verifySave(...args) {
    return this.saveVerification.verifySave(...args);
  }
  rebuildDisposableCaches(...args) {
    return this.saveVerification.rebuildDisposableCaches(...args);
  }
  downloadPreMigrationBackup(...args) {
    return this.saveVerification.downloadPreMigrationBackup(...args);
  }

  _getSaveAsZipInternal() { return this.importExport._getSaveAsZipInternal(); }
  saveUpload(...args) {
    return this.importExport.saveUpload(...args);
  }
  saveFolderUpload(...args) {
    return this.importExport.saveFolderUpload(...args);
  }
  restoreCloudCheckpoint(...args) {
    return this.importExport.restoreCloudCheckpoint(...args);
  }

  _saveUploadInternal(file) { return this.importExport._saveUploadInternal(file); }
  _zipUpload(bytes) { return this.importExport._zipUpload(bytes); }
  /* ═════════════════════════════════════════════════════════════════
     PROFILE MANAGEMENT
  ═════════════════════════════════════════════════════════════════ */

  // Players flagged by banProfile; hidden from all normal queries.
  _isBanned(player) { return this.profileLifecycle._isBanned(player); }
  getActivePlayerUUID() { return this.profileLifecycle.getActivePlayerUUID(); }
  getActivePlayerChangedAt() { return this.profileLifecycle.getActivePlayerChangedAt(); }
  setActivePlayerUUID(uuid, options) { return this.profileLifecycle.setActivePlayerUUID(uuid, options); }
  getMobileWorkingSetState() {
    return {
      appliedAt: this.appState.mobileWorkingSetAppliedAt || null,
      schemaVersion: Math.max(0, Number(this.appState.mobileWorkingSetSchemaVersion) || 0),
    };
  }
  setMobileWorkingSetState({ appliedAt = null, schemaVersion = 0 } = {}) {
    this.appState = {
      ...this.appState,
      mobileWorkingSetAppliedAt: appliedAt || null,
      mobileWorkingSetSchemaVersion: Math.max(0, Number(schemaVersion) || 0),
    };
    this._queueAppStateWrite();
  }
  _getCurrentPlayerRecord() { return this.profileLifecycle._getCurrentPlayerRecord(); }
  getCurrentPlayer() { return this.profileLifecycle.getCurrentPlayer(); }
  getAllPlayers(options) { return this.profileLifecycle.getAllPlayers(options); }
  getActivePlayers() { return this.profileLifecycle.getActivePlayers(); }
  switchProfile(fromPlayer, toUUID) { return this.profileLifecycle.switchProfile(fromPlayer, toUUID); }
  createAndSwitchProfile(fromPlayer, newPlayerData) { return this.profileLifecycle.createAndSwitchProfile(fromPlayer, newPlayerData); }
  _deleteWhere(store, predicate) { return this.profileLifecycle._deleteWhere(store, predicate); }
  banProfile(playerUUID) { return this.profileLifecycle.banProfile(playerUUID); }
  wipeProfile(playerUUID) { return this.profileLifecycle.wipeProfile(playerUUID); }

  /* Feature-facing database methods are mixed in below from @data/db/databaseConnectionFeatureMethods.js. */
}

for (const [name, method] of Object.entries(databaseConnectionFeatureMethods)) {
  Object.defineProperty(DatabaseConnectionHost.prototype, name, {
    value: method,
    writable: true,
    configurable: true,
  });
}

export default DatabaseConnectionHost;
