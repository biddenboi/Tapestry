import CoreStorage from './CoreStorage.js';
import PersistenceDevelopmentReporter from './PersistenceDevelopmentReporter.js';
import { createDomainRepositories } from './repositories/createDomainRepositories.js';
import ImportExportService from './services/ImportExportService.js';
import TimelineQueryService from './services/TimelineQueryService.js';
import ProfileDaybookQueryService from './services/ProfileDaybookQueryService.js';
import SocialWorldPresenceService from './services/SocialWorldPresenceService.js';
import SocialWorldQueryService from './services/SocialWorldQueryService.js';
import SocialWorldCastService from './services/SocialWorldCastService.js';
import SocialWorldFriendshipService from './services/SocialWorldFriendshipService.js';
import SocialWorldResidencyService from './services/SocialWorldResidencyService.js';
import SocialWorldSceneQueryService from './services/SocialWorldSceneQueryService.js';
import SocialWorldProfileCardQueryService from './services/SocialWorldProfileCardQueryService.js';
import SocialActivityIndexService from './services/SocialActivityIndexService.js';
import SocialEncounterService from './services/SocialEncounterService.js';
import DojoRoomQueryService from './services/DojoRoomQueryService.js';
import DojoStandingsService from './services/DojoStandingsService.js';
import ReminderQueryService from './services/ReminderQueryService.js';
import EloQueryService from './services/EloQueryService.js';
import ProfileLifecycleService from './services/ProfileLifecycleService.js';
import SqliteProfileContextRepository from './repositories/SqliteProfileContextRepository.js';
import ProfileContextFactService from './services/ProfileContextFactService.js';
import ProfileContextSuggestionService from './services/ProfileContextSuggestionService.js';
import ProfileContextProjectionService from './services/ProfileContextProjectionService.js';
import ProfileContextCommandService from './services/ProfileContextCommandService.js';
import ProfileContextActionService from './services/ProfileContextActionService.js';
import DomainHydrationCoordinator from './services/DomainHydrationCoordinator.js';
import DemoDataSeeder from './services/DemoDataSeeder.js';
import { STORES } from '../../domain/constants.js';
import SqliteShadowReadinessCoordinator, {
  SQLITE_SHADOW_PROJECTION,
  SQLITE_SHADOW_PROJECTIONS,
} from './services/SqliteShadowReadinessCoordinator.js';
import DataIntegrityService from './services/DataIntegrityService.js';
import SaveVerificationService from './services/SaveVerificationService.js';
import AchievementV2Repository from './repositories/AchievementV2Repository.js';
import NavigationPreferenceRepository from './repositories/NavigationPreferenceRepository.js';
import ChronicleSchema40ReconciliationService from './services/ChronicleSchema40ReconciliationService.js';
import ContributionRoadReconciliationService from './services/ContributionRoadReconciliationService.js';
import SyncRuntime from '../sync/SyncRuntime.js';
import {
  buildRemoteRoutineRunStatements,
  buildRemoteRoutineStepStatements,
} from '../../domain/routines/RoutineCommands.js';
import { buildRemoteChronicleMutation } from '../sync/ChronicleSync.js';
import {
  ACTION_SESSION_SYNC_COMMANDS,
  buildRemoteActionSessionMutation,
} from '../sync/ActionSessionSync.js';
import {
  remoteShopActivationMutation,
  remoteShopEffectCancellationMutation,
} from '../../domain/shop/ShopActivationService.js';

// DatabaseConnection remains the feature-facing facade. SQLite is the live
// authority and the Map is its read-through UI cache.
export class PersistenceRuntime {
  constructor(facade, {
    getStores,
    setStores,
    createEmptyStoreMap,
    clone,
    sqliteStorageAdapter = null,
  } = {}) {
    if (!facade) throw new Error('PersistenceRuntime requires a database facade.');
    this.facade = facade;
    this.reporter = new PersistenceDevelopmentReporter();
    this.storage = new CoreStorage({ getStores, setStores, createEmptyStoreMap, clone });
    if (!sqliteStorageAdapter) throw new Error('PersistenceRuntime requires SQLite storage.');
    this.sqliteStorageAdapter = sqliteStorageAdapter;
    this.sqliteShadowReadiness = new SqliteShadowReadinessCoordinator();
    this.sqliteProjectionRefreshDomains = new Set();
    this.sqliteProjectionRefreshPromise = null;
    this.storageAdapter = sqliteStorageAdapter;
    this.domainHydration = new DomainHydrationCoordinator(facade);
    this.demoDataSeeder = new DemoDataSeeder(facade);
    this.repositories = createDomainRepositories(facade);
    this.timelineQueries = new TimelineQueryService(facade);
    this.profileDaybookQueries = new ProfileDaybookQueryService(facade);
    this.profileContextRepository = new SqliteProfileContextRepository(facade);
    this.profileContextFacts = new ProfileContextFactService(facade);
    this.profileContextProjections = new ProfileContextProjectionService({
      repository: this.profileContextRepository,
    });
    this.profileContextSuggestions = new ProfileContextSuggestionService({
      repository: this.profileContextRepository,
      factService: this.profileContextFacts,
    });
    this.profileContextCommands = new ProfileContextCommandService({
      repository: this.profileContextRepository,
      projectionService: this.profileContextProjections,
    });
    this.profileContextActions = new ProfileContextActionService(facade);
    this.socialWorldRepository = this.sqliteStorageAdapter?.shadowDomains?.socialWorld || null;
    this.socialRepository = this.sqliteStorageAdapter?.shadowDomains?.social || null;
    this.socialWorldPresence = this.socialWorldRepository
      ? new SocialWorldPresenceService({ repository: this.socialWorldRepository })
      : null;
    this.socialWorldQueries = this.socialWorldRepository
      ? new SocialWorldQueryService({
          repository: this.socialWorldRepository,
          client: this.sqliteStorageAdapter.client,
        })
      : null;
    this.socialWorldCast = this.socialWorldRepository
      ? new SocialWorldCastService({
          repository: this.socialWorldRepository,
          client: this.sqliteStorageAdapter.client,
          readiness: this.sqliteShadowReadiness,
        })
      : null;
    this.socialWorldFriendships = new SocialWorldFriendshipService({
      facade,
      repository: this.socialRepository,
    });
    this.socialWorldResidency = new SocialWorldResidencyService({
      facade,
      socialRepository: this.socialRepository,
      castService: this.socialWorldCast,
      client: this.sqliteStorageAdapter?.client || null,
    });
    this.socialWorldSceneQueries = new SocialWorldSceneQueryService({
      residencyService: this.socialWorldResidency,
      presenceQueryService: this.socialWorldQueries,
      client: this.sqliteStorageAdapter?.client || null,
      facade,
    });
    this.socialActivityIndex = this.socialWorldRepository
      ? new SocialActivityIndexService({ client: this.sqliteStorageAdapter.client })
      : null;
    this.socialEncounters = this.socialActivityIndex
      ? new SocialEncounterService({
          client: this.sqliteStorageAdapter.client,
          activityIndex: this.socialActivityIndex,
        })
      : null;
    this.socialWorldProfileCards = this.socialWorldRepository
      ? new SocialWorldProfileCardQueryService({
          residencyService: this.socialWorldResidency,
          presenceQueryService: this.socialWorldQueries,
          client: this.sqliteStorageAdapter.client,
          encounterService: this.socialEncounters,
          profileContextProjectionService: this.profileContextProjections,
        })
      : null;
    this.dojoRoomQueries = this.sqliteStorageAdapter?.client?.query
      ? new DojoRoomQueryService({ client: this.sqliteStorageAdapter.client })
      : null;
    this.dojoStandings = this.sqliteStorageAdapter?.client?.query
      ? new DojoStandingsService({
          client: this.sqliteStorageAdapter.client,
        })
      : null;
    this.reminderQueries = new ReminderQueryService(facade);
    this.eloQueries = new EloQueryService(facade);
    this.profileLifecycle = new ProfileLifecycleService(facade);
    this.importExport = new ImportExportService(facade);
    this.dataIntegrity = new DataIntegrityService(facade);
    this.saveVerification = new SaveVerificationService(facade, this.dataIntegrity);
    this.achievementV2 = new AchievementV2Repository(facade);
    this.navigationPreferences = new NavigationPreferenceRepository(facade);
    this.chronicleSchema40 = new ChronicleSchema40ReconciliationService(facade);
    this.contributionRoad = new ContributionRoadReconciliationService(facade);
    this.syncRuntime = new SyncRuntime({
      client: this.sqliteStorageAdapter.client,
      connection: facade,
    });
    this.sqliteStorageAdapter.setCommitListener?.((details) => {
      this.syncRuntime.databaseCommitted(details);
    });
    this.syncRuntime.registerCommand('recordRewardProvenance', (entry) => ({
      label: 'remote-reward-provenance',
      puts: [{
        store: STORES.rewardProvenance,
        record: { ...entry.payload, UUID: entry.payload?.UUID || entry.entityId },
      }],
      sync: { origin: 'remote-sync', enqueueSync: false },
    }));
    this.syncRuntime.registerCommand('recordMatchScoreEvent', (entry) => ({
      label: 'remote-match-score-event',
      puts: [{
        store: STORES.matchScoreEvent,
        record: { ...entry.payload, UUID: entry.payload?.UUID || entry.entityId },
      }],
      sync: { origin: 'remote-sync', enqueueSync: false },
    }));
    const remoteMatchMutation = (entry) => {
      const match = entry.payload?.match;
      if (!match?.UUID) throw new Error('Remote Match state is missing its canonical Match snapshot.');
      return {
        label: `remote-${entry.commandType}`,
        puts: [
          { store: STORES.match, record: match },
          entry.payload?.player?.UUID ? { store: STORES.player, record: entry.payload.player } : null,
          entry.payload?.worldReceipt?.UUID ? { store: STORES.worldConsequenceReceipt, record: entry.payload.worldReceipt } : null,
          entry.payload?.rewardProvenance?.UUID ? { store: STORES.rewardProvenance, record: entry.payload.rewardProvenance } : null,
        ].filter(Boolean),
        sync: { origin: 'remote-sync', enqueueSync: false },
      };
    };
    for (const commandType of ['createMatch', 'updateMatch', 'completeMatch']) {
      this.syncRuntime.registerCommand(commandType, remoteMatchMutation);
    }
    this.syncRuntime.registerCommand('recordGoalUpdate', (entry) => {
      const goal = entry.payload?.goal;
      const update = entry.payload?.update;
      if (!goal?.UUID || !update?.UUID) {
        throw new Error('Remote Goal update is missing its canonical Goal or append-only receipt.');
      }
      return {
        label: 'remote-goal-update',
        puts: [
          { store: STORES.project, record: goal },
          { store: STORES.goalUpdate, record: update },
        ],
        sync: { origin: 'remote-sync', enqueueSync: false },
      };
    });
    const remoteTaskRecord = (entry) => {
      const task = entry.payload?.task;
      if (!task?.UUID) throw new Error(`Remote ${entry.commandType} is missing its canonical task record.`);
      return {
        ...task,
        syncVersion: Number(entry.result?.entity?.version || task.syncVersion || 1),
      };
    };
    for (const commandType of ['createTask', 'updateTask']) {
      this.syncRuntime.registerCommand(commandType, (entry) => ({
        label: `remote-${commandType}`,
        puts: [{ store: STORES.todo, record: remoteTaskRecord(entry) }],
        sync: { origin: 'remote-sync', enqueueSync: false },
      }));
    }
    this.syncRuntime.registerCommand('deleteTask', (entry) => ({
      label: 'remote-delete-task',
      deletes: [{ store: STORES.todo, UUID: entry.entityId }],
      sync: { origin: 'remote-sync', enqueueSync: false },
    }));
    const remoteReminderRecord = (entry) => {
      const reminder = entry.payload?.reminder;
      if (!reminder?.UUID) throw new Error(`Remote ${entry.commandType} is missing its canonical reminder record.`);
      return {
        ...reminder,
        syncVersion: Number(entry.result?.entity?.version || reminder.syncVersion || 1),
      };
    };
    for (const commandType of [
      'createReminder',
      'updateReminder',
      'completeReminder',
      'dismissReminder',
      'snoozeReminder',
    ]) {
      this.syncRuntime.registerCommand(commandType, (entry) => ({
        label: `remote-${commandType}`,
        puts: [{ store: STORES.reminder, record: remoteReminderRecord(entry) }],
        sync: { origin: 'remote-sync', enqueueSync: false },
      }));
    }
    this.syncRuntime.registerCommand('deleteReminder', (entry) => ({
      label: 'remote-delete-reminder',
      deletes: [{ store: STORES.reminder, UUID: entry.entityId }],
      sync: { origin: 'remote-sync', enqueueSync: false },
    }));
    for (const commandType of ACTION_SESSION_SYNC_COMMANDS) {
      this.syncRuntime.registerCommand(commandType, buildRemoteActionSessionMutation);
    }
    this.syncRuntime.registerCommand('finalizeMatchActionSessionScore', (entry) => {
      const actionSession = entry.payload?.actionSession;
      const scoreEvent = entry.payload?.scoreEvent;
      if (!actionSession?.UUID || !scoreEvent?.UUID) {
        throw new Error('Remote Match finalization is missing its immutable evidence records.');
      }
      return {
        label: 'remote-finalize-match-action-session-score',
        puts: [
          { store: STORES.actionSession, record: actionSession },
          { store: STORES.matchScoreEvent, record: scoreEvent },
        ],
        sync: { origin: 'remote-sync', enqueueSync: false },
      };
    });
    this.syncRuntime.registerCommand('completeTaskOccurrence', async (entry) => {
      const payload = entry.payload || {};
      const completionEvents = await facade.getAll(STORES.taskCompletionEvent);
      const existing = completionEvents.find((event) => (
        String(event.occurrenceKey || '') === String(payload.occurrenceKey || entry.entityId)
      ));
      if (existing) {
        return {
          label: 'remote-task-occurrence-duplicate',
          puts: [{ store: STORES.taskCompletionEvent, record: existing }],
          sync: { origin: 'remote-sync', enqueueSync: false },
        };
      }
      const completionEvent = payload.completionEvent || {
        UUID: `task-completion-event:${entry.operationId}`,
        parent: entry.playerId,
        type: 'task-completion',
        eventSchemaVersion: 1,
        operationId: entry.operationId,
        occurrenceKey: payload.occurrenceKey || entry.entityId,
        todoUUID: payload.taskId || null,
        completedAt: payload.completedAt || entry.occurredAt,
        createdAt: payload.completedAt || entry.occurredAt,
        durationMs: Number(payload.actualDurationMs || 0),
      };
      const puts = [
        payload.updatedPlayer?.UUID ? { store: STORES.player, record: payload.updatedPlayer } : null,
        payload.completedTask?.UUID ? { store: STORES.task, record: payload.completedTask } : null,
        { store: STORES.taskCompletionEvent, record: completionEvent },
        payload.nextOccurrence?.UUID ? { store: STORES.todo, record: payload.nextOccurrence } : null,
      ].filter(Boolean);
      const deletes = payload.removeTodo && !payload.nextOccurrence && payload.taskId
        ? [{ store: STORES.todo, UUID: payload.taskId }]
        : [];
      return {
        label: 'remote-task-occurrence-complete',
        puts,
        deletes,
        sync: { origin: 'remote-sync', enqueueSync: false },
      };
    });
    for (const commandType of ['startRoutineRun', 'completeRoutineRun']) {
      this.syncRuntime.registerCommand(commandType, (entry) => ({
        label: `remote-${commandType}`,
        additionalStatements: buildRemoteRoutineRunStatements(entry.payload?.run),
        sync: { origin: 'remote-sync', enqueueSync: false },
      }));
    }
    this.syncRuntime.registerCommand('completeRoutineStep', (entry) => ({
      label: 'remote-complete-routine-step',
      additionalStatements: buildRemoteRoutineStepStatements(entry.payload, entry.operationId),
      sync: { origin: 'remote-sync', enqueueSync: false },
    }));
    for (const commandType of [
      'createChronicleEntry',
      'updateChronicleEntry',
      'changeChronicleAccess',
      'archiveChronicleEntry',
      'setChronicleLock',
    ]) {
      this.syncRuntime.registerCommand(commandType, (entry) => (
        buildRemoteChronicleMutation(entry, facade)
      ));
    }
    this.syncRuntime.registerCommand('purchaseShopItems', (entry) => {
      const purchase = entry.payload || {};
      if (!purchase.player?.UUID || !Array.isArray(purchase.inventoryRecords)
          || !Array.isArray(purchase.ledgerRecords)) {
        throw new Error('Remote Shop purchase is missing its canonical receipt records.');
      }
      return {
        label: 'remote-shop-purchase',
        puts: [
          { store: STORES.player, record: purchase.player },
          ...purchase.inventoryRecords.map((record) => ({ store: STORES.inventory, record })),
          ...(purchase.catalogRecords || []).map((record) => ({ store: STORES.shop, record })),
          ...purchase.ledgerRecords.map((record) => ({ store: STORES.transaction, record })),
        ],
        globalMoney: Number(purchase.globalMoneyAfter || 0),
        sync: { origin: 'remote-sync', enqueueSync: false },
      };
    });
    this.syncRuntime.registerCommand('activateShopItem', (entry) => (
      remoteShopActivationMutation(entry.payload)
    ));
    this.syncRuntime.registerCommand('cancelShopEffect', (entry) => (
      remoteShopEffectCancellationMutation(entry.payload)
    ));
  }

  _sqliteProjectionImporter(domain) {
    const importers = this.sqliteStorageAdapter?.shadowDomains?.importers;
    const importer = importers?.[domain];
    if (!importer?.import) {
      const error = new Error(`SQLite ${domain} projection importer is unavailable.`);
      error.code = 'sqlite-shadow-importer-unavailable';
      throw error;
    }
    return importer;
  }

  _synchronizeSqliteProjection(domain, source) {
    const importer = this._sqliteProjectionImporter(domain);
    return this.sqliteShadowReadiness.begin(domain, () => importer.import(source));
  }

  _requireProjectionArrays(domain, source, keys) {
    for (const key of keys) {
      if (!Array.isArray(source[key])) {
        const error = new TypeError(`SQLite ${domain} projection requires a loaded ${key} snapshot.`);
        error.code = 'sqlite-shadow-source-incomplete';
        throw error;
      }
    }
    return source;
  }

  synchronizeSqliteCoreProfilesProjection({
    players,
    appState = {},
    economyState = {},
    settings,
  } = {}) {
    const source = this._requireProjectionArrays(SQLITE_SHADOW_PROJECTION.coreProfiles, {
      players,
      appState,
      economyState,
      settings,
    }, ['players', 'settings']);
    return this._synchronizeSqliteProjection(SQLITE_SHADOW_PROJECTION.coreProfiles, source);
  }

  synchronizeSqlitePlanningProjection({
    projects,
    todos,
    tasks,
    reminders,
  } = {}) {
    const source = this._requireProjectionArrays(SQLITE_SHADOW_PROJECTION.planning, {
      projects,
      todos,
      tasks,
      reminders,
    }, ['projects', 'todos', 'tasks', 'reminders']);
    return this._synchronizeSqliteProjection(SQLITE_SHADOW_PROJECTION.planning, source);
  }

  synchronizeSqliteMatchesProjection({
    matches,
    backgroundJobs,
    backgroundJobReceipts,
  } = {}) {
    const source = this._requireProjectionArrays(SQLITE_SHADOW_PROJECTION.matches, {
      matches,
      backgroundJobs,
      backgroundJobReceipts,
    }, ['matches', 'backgroundJobs', 'backgroundJobReceipts']);
    return this._synchronizeSqliteProjection(SQLITE_SHADOW_PROJECTION.matches, source);
  }

  synchronizeSqliteSocialProjection({
    friendships,
    notifications,
  } = {}) {
    const source = this._requireProjectionArrays(SQLITE_SHADOW_PROJECTION.social, {
      friendships,
      notifications,
    }, ['friendships', 'notifications']);
    return this._synchronizeSqliteProjection(SQLITE_SHADOW_PROJECTION.social, source);
  }

  async synchronizeSqliteDynamicCastProjections({
    players,
    appState = {},
    economyState = {},
    settings,
    projects,
    todos,
    tasks,
    reminders,
    matches,
    backgroundJobs,
    backgroundJobReceipts,
    friendships,
    notifications,
  } = {}) {
    const coreProfiles = await this.synchronizeSqliteCoreProfilesProjection({
      players, appState, economyState, settings,
    });
    const planning = await this.synchronizeSqlitePlanningProjection({
      projects, todos, tasks, reminders,
    });
    const matchProjection = await this.synchronizeSqliteMatchesProjection({
      matches, backgroundJobs, backgroundJobReceipts,
    });
    const social = await this.synchronizeSqliteSocialProjection({
      friendships, notifications,
    });
    return { coreProfiles, planning, matches: matchProjection, social };
  }

  assertDynamicCastSourcesReady() {
    return this.sqliteShadowReadiness.assertReady(SQLITE_SHADOW_PROJECTIONS);
  }

  resetSqliteShadowReadiness() {
    return this.sqliteShadowReadiness.reset();
  }

  markSqliteAuthoritativeProjectionsReady() {
    for (const domain of SQLITE_SHADOW_PROJECTIONS) {
      this.sqliteShadowReadiness.markReady(domain, {
        sourceFingerprint: 'sqlite-authoritative',
        runId: this.sqliteShadowReadiness.sessionId,
      });
    }
    return this.assertDynamicCastSourcesReady();
  }

  markSqliteProjectionsDirtyForStores(stores = []) {
    void stores;
    return [];
  }

  _queueSqliteProjectionRefresh(domains = []) {
    void domains;
  }

  async synchronizeSqliteIdentity({
    players = null,
    appState = {},
    economyState = {},
    settings = [],
    friendships = null,
    notifications = [],
  } = {}) {
    const importers = this.sqliteStorageAdapter?.shadowDomains?.importers;
    if (!importers) return { synchronized: false, reason: 'sqlite-unavailable' };

    // Narrow helper for presence bootstraps. It deliberately does not establish
    // complete-source readiness.
    const result = { synchronized: true, profiles: null, social: null };
    if (Array.isArray(players) && players.length) {
      result.profiles = await importers.coreProfiles.import({
        players,
        appState,
        economyState,
        settings: Array.isArray(settings) ? settings : [],
      });
    }
    if (Array.isArray(friendships)) {
      result.social = await importers.social.import({
        friendships,
        notifications: Array.isArray(notifications) ? notifications : [],
      });
    }
    return result;
  }

}

export default PersistenceRuntime;
