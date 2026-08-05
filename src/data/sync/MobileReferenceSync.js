import { STORES } from '@domain/constants.js';
import {
  effectCancellationStatement,
  effectIntervalStatement,
} from '@domain/shop/ShopActivationService.js';
import { buildRemoteRoutineRunStatements } from '@domain/routines/RoutineCommands.js';
import {
  DEFAULT_WORKSPACE_ID,
  planningCreatorId,
  planningWorkspaceId,
  withWorkspacePlanningScope,
} from '@domain/planning/WorkspacePlanningScope.js';

// This is the bounded, mobile-safe bootstrap mirror. It deliberately excludes
// attachments/resources, exports, drafts, derived caches, and analytics. The
// only app-setting records admitted are portable Task Recommender v12 model
// artifacts trained on desktop; mobile can serve them but does not receive the
// rest of the desktop settings database. Normal edits still use command-specific sync; these records let a
// clean device reconstruct the synchronized working set before replaying the
// operation log.
export const MOBILE_ML_MODEL_RECORD_TYPE = 'ml-model';
export const MOBILE_ML_MODEL_UUID_PREFIX = 'task-recommender-v12-';
export const MOBILE_REFERENCE_CURSOR_STREAM = 'mobile-reference-v1';
const MOBILE_REFERENCE_DELTA_PAGE_SIZE = 500;
const mobileReferenceDeltaState = new WeakMap();

export function isMobileMlModelRecord(record) {
  return String(record?.UUID || '').startsWith(MOBILE_ML_MODEL_UUID_PREFIX);
}
export const MOBILE_REFERENCE_RECORD_TYPES = Object.freeze([
  ['profile', STORES.player],
  ['goal', STORES.project],
  ['goal-area', STORES.goalArea],
  ['goal-milestone', STORES.goalMilestone],
  ['goal-update', STORES.goalUpdate],
  ['goal-link', STORES.goalLink],
  ['goal-participant', STORES.goalParticipant],
  ['goal-contribution', STORES.contribution],
]);

export const MOBILE_ACTIVE_PROFILE_RECORD_TYPE = 'active-profile-state';
const MOBILE_ACTIVE_PROFILE_RECORD_ID = 'active';
export const MOBILE_WORKING_SET_MANIFEST_TYPE = 'mobile-working-set-manifest';
export const MOBILE_WORKING_SET_SCHEMA_VERSION = 4;
const MOBILE_WORKING_SET_MANIFEST_ID = 'current';

export const MOBILE_BOOTSTRAP_RECORD_TYPES = Object.freeze([
  ...MOBILE_REFERENCE_RECORD_TYPES,
  ['task', STORES.todo],
  ['completed-task', STORES.task],
  ['task-completion-event', STORES.taskCompletionEvent],
  ['task-completion-receipt', STORES.taskCompletionReceipt],
  ['reminder', STORES.reminder],
  ['action-plan', STORES.actionPlan],
  ['action-session', STORES.actionSession],
  ['handoff', STORES.handoff],
  ['match', STORES.match],
  ['match-score-event', STORES.matchScoreEvent],
  ['reward-provenance', STORES.rewardProvenance],
  ['world-consequence-receipt', STORES.worldConsequenceReceipt],
  ['shop-catalog', STORES.shop],
  ['inventory', STORES.inventory],
  ['transaction', STORES.transaction],
  ['journal', STORES.journal],
  ['journal-comment', STORES.journalComment],
  ['chronicle-entry-metadata', STORES.chronicleEntryMetadata],
  ['chronicle-entry-revision', STORES.chronicleEntryRevision],
  ['chronicle-entry-access', STORES.chronicleEntryAccess],
  ['chronicle-story', STORES.chronicleStory],
  ['chronicle-story-entry', STORES.chronicleStoryEntry],
  ['chronicle-entry-link', STORES.chronicleEntryLink],
  ['chronicle-reaction', STORES.chronicleReaction],
  ['event', STORES.event],
  ['custom-event', STORES.customEvent],
  ['event-log', STORES.eventLog],
  ['event-buff', STORES.eventBuff],
  ['rhythm-definition', STORES.rhythmDefinition],
  ['rhythm-opportunity', STORES.rhythmOpportunity],
  ['achievement-event', STORES.achievementEvent],
  ['achievement-state', STORES.achievementState],
  ['achievement-receipt', STORES.achievementReceipt],
  ['friendship', STORES.friendship],
  ['notification', STORES.notification],
  [MOBILE_ML_MODEL_RECORD_TYPE, STORES.appSetting],
]);

export const STORE_BY_TYPE = new Map(MOBILE_BOOTSTRAP_RECORD_TYPES);
// Model artifacts are captured by a prefix-filtered SQLite trigger. Do not map
// the whole appSettings store here or ordinary desktop-only settings would be
// mistaken for portable model records by generic mutation capture.
export const RECORD_TYPE_BY_STORE = new Map(MOBILE_BOOTSTRAP_RECORD_TYPES
  .filter(([recordType]) => recordType !== MOBILE_ML_MODEL_RECORD_TYPE)
  .map(([recordType, store]) => [store, recordType]));
const SPECIAL_RECORD_TYPES = new Set(['routine-run', 'routine-step-receipt', 'effect-interval', 'effect-cancellation']);
const MOBILE_PROJECTION_REPAIR_META_KEY = 'mobile-reference-projections-v1';
const MOBILE_PROJECTION_REPAIR_VERSION = 1;
const CORE_PROJECTION_TYPES = new Set(['profile', MOBILE_ACTIVE_PROFILE_RECORD_TYPE]);
const PLANNING_PROJECTION_TYPES = new Set([
  'goal', 'task', 'completed-task', 'reminder', 'goal-contribution',
]);
const MATCH_PROJECTION_TYPES = new Set(['match']);
const EVENT_PROJECTION_TYPES = new Set([
  'event', 'custom-event', 'event-log', 'event-buff', 'goal-contribution',
  'rhythm-definition', 'rhythm-opportunity',
]);
const COMMERCE_PROJECTION_TYPES = new Set(['shop-catalog', 'inventory', 'transaction']);
const SOCIAL_PROJECTION_TYPES = new Set(['friendship', 'notification']);
const JOURNAL_RELATION_PROJECTION_TYPES = new Set([
  'journal', 'journal-comment', 'chronicle-entry-metadata',
]);
const RECOVERY_PROJECTION_TYPES = new Set([
  'achievement-event', 'achievement-state', 'achievement-receipt',
]);
const TYPED_DELETE_TABLE_BY_RECORD_TYPE = new Map([
  ['task', 'todos'],
  ['reminder', 'reminders'],
  ['journal', 'journals'],
  ['journal-comment', 'journal_comments'],
]);
const WORKSPACE_DEFINITION_TYPES = new Set([
  'task', 'reminder', 'goal', 'goal-area', 'goal-milestone', 'goal-link',
]);
const WORKSPACE_RELATED_TYPES = new Set([
  ...WORKSPACE_DEFINITION_TYPES,
  'completed-task', 'goal-update', 'goal-participant', 'goal-contribution',
]);

export function recordTime(record) {
  return Math.max(0, ...[
    record?.syncUpdatedAt,
    record?.updatedAt,
    record?.modifiedAt,
    record?.lastModifiedAt,
    record?.igtLastActiveDate,
    record?.completedAt,
    record?.createdAt,
    record?.occurredAt,
    record?.startedAt,
    record?.joinedAt,
    record?.publishedAt,
    record?.recordedAt,
    record?.receivedAt,
    record?.acquiredAt,
    record?.purchasedAt,
    record?.activatedAt,
    record?.cancelledAt,
    record?.scheduledFor,
    record?.timestamp,
  ].map((value) => {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }));
}

function recordPlayer(record) {
  return record?.parent || record?.playerUUID || record?.playerId || null;
}

export function referenceRecord(recordType, recordId, data, updatedAt = null) {
  const workspaceRelated = WORKSPACE_RELATED_TYPES.has(recordType);
  const workspaceId = workspaceRelated ? planningWorkspaceId(data) : null;
  const scopedData = WORKSPACE_DEFINITION_TYPES.has(recordType)
    ? withWorkspacePlanningScope(data, {
        workspaceId,
        createdByPlayerId: planningCreatorId(data),
      })
    : workspaceRelated && data && !data.workspaceId
      ? { ...data, workspaceId }
      : data;
  return {
    recordType,
    recordId: String(recordId),
    workspaceId,
    playerId: WORKSPACE_DEFINITION_TYPES.has(recordType) ? null : recordPlayer(scopedData),
    data: scopedData,
    updatedAt: new Date(updatedAt || recordTime(scopedData)).toISOString(),
  };
}

function collectResourceUUIDs(value, output = new Set()) {
  if (!value || typeof value !== 'object') return output;
  if (value.type === 'resource' && typeof value.resourceUUID === 'string') {
    output.add(value.resourceUUID);
    return output;
  }
  if (Array.isArray(value)) value.forEach((entry) => collectResourceUUIDs(entry, output));
  else Object.values(value).forEach((entry) => collectResourceUUIDs(entry, output));
  return output;
}

async function publishReferencedMobileResources(databaseConnection, transport, records) {
  if (!transport?.publishMobileResources) return { uploaded: 0, registered: 0 };
  const ids = new Set();
  records
    .filter((entry) => ['profile', 'shop-catalog', 'journal'].includes(entry.recordType))
    .forEach((entry) => collectResourceUUIDs(entry.data, ids));
  const resources = [];
  for (const resourceUUID of ids) {
    // eslint-disable-next-line no-await-in-loop
    const resource = await databaseConnection.get(STORES.resource, resourceUUID).catch(() => null);
    if (resource) resources.push(resource);
  }
  return transport.publishMobileResources(resources);
}

export async function publishCurrentMobileResources(databaseConnection, transport) {
  if (!transport?.publishMobileResources) return { uploaded: 0, registered: 0 };
  const documents = databaseConnection?.persistenceRuntime?.sqliteStorageAdapter?.documents;
  const records = [];
  for (const [recordType, store] of [
    ['profile', STORES.player],
    ['shop-catalog', STORES.shop],
    ['journal', STORES.journal],
  ]) {
    // Prefer canonical documents so an incomplete typed projection cannot
    // hide a profile or catalog image from cloud publication.
    // eslint-disable-next-line no-await-in-loop
    const entries = await (
      documents?.getAll?.(store) || databaseConnection.getAll(store)
    ).catch(() => []);
    records.push(...entries.map((data) => ({ recordType, data })));
  }
  return publishReferencedMobileResources(databaseConnection, transport, records);
}

async function sqliteClient(databaseConnection) {
  await databaseConnection.ready;
  return databaseConnection?.persistenceRuntime?.sqliteStorageAdapter?.client || null;
}

function intersects(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

async function projectionRepairVersion(client) {
  if (!client?.query) return 0;
  const row = await client.query({
    sql: 'SELECT value_json AS valueJson FROM sync_reference_meta WHERE key=?',
    bind: [MOBILE_PROJECTION_REPAIR_META_KEY],
    result: 'one',
  }).catch(() => null);
  try {
    return Math.max(0, Number(JSON.parse(String(row?.valueJson || '{}')).version) || 0);
  } catch {
    return 0;
  }
}

async function markProjectionRepairComplete(client, details = {}) {
  if (!client?.query) return;
  const updatedAt = new Date().toISOString();
  await client.query({
    sql: `INSERT INTO sync_reference_meta(key,value_json,updated_at)
          VALUES(?,?,?)
          ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
    bind: [
      MOBILE_PROJECTION_REPAIR_META_KEY,
      JSON.stringify({ version: MOBILE_PROJECTION_REPAIR_VERSION, updatedAt, ...details }),
      updatedAt,
    ],
    result: 'changes',
  });
}

/**
 * Rebuild the normalized SQLite projections consumed by IGT, Elo, Points,
 * contribution, Match, and graph queries after document reference sync.
 *
 * A one-time full repair upgrades clients created by older bootstrap code.
 * Later passes touch only domains whose canonical documents actually changed.
 */
export async function reconcileMobileReferenceProjections(databaseConnection, {
  recordTypes = new Set(),
  force = false,
} = {}) {
  const client = await sqliteClient(databaseConnection);
  const importers = databaseConnection?.persistenceRuntime
    ?.sqliteStorageAdapter?.shadowDomains?.importers;
  if (!client?.query || !importers) {
    return { reconciled: false, reason: 'projection-importers-unavailable' };
  }
  const changedTypes = recordTypes instanceof Set ? recordTypes : new Set(recordTypes || []);
  const installedVersion = await projectionRepairVersion(client);
  const full = force || installedVersion < MOBILE_PROJECTION_REPAIR_VERSION;
  if (!full && !changedTypes.size) {
    return { reconciled: false, reason: 'projections-current' };
  }
  const should = (types) => full || intersects(changedTypes, types);
  // Read the canonical document tables directly. During the exact failure we
  // are repairing, facade reads may already be routed to the empty/stale typed
  // projections, which would otherwise make the repair import no records.
  const documents = databaseConnection?.persistenceRuntime?.sqliteStorageAdapter?.documents;
  const records = (store) => (
    documents?.getAll?.(store) || databaseConnection.getAll(store)
  ).catch(() => []);
  const results = {};

  // Profiles must precede every projection with a player foreign key.
  if (should(CORE_PROJECTION_TYPES)) {
    results.coreProfiles = await importers.coreProfiles.import({
      players: await records(STORES.player),
      appState: databaseConnection.appState || {},
      economyState: databaseConnection.economyState || {},
      settings: await records(STORES.appSetting),
    });
    await databaseConnection.achievementV2?.synchronizeDefinitions?.();
  }
  if (should(PLANNING_PROJECTION_TYPES)) {
    const [projects, todos, tasks, reminders] = await Promise.all([
      records(STORES.project), records(STORES.todo), records(STORES.task), records(STORES.reminder),
    ]);
    results.planning = await importers.planning.import({ projects, todos, tasks, reminders });
  }
  if (should(MATCH_PROJECTION_TYPES)) {
    const [matches, backgroundJobs, backgroundJobReceipts] = await Promise.all([
      records(STORES.match), records(STORES.backgroundJob), records(STORES.backgroundJobReceipt),
    ]);
    results.matches = await importers.matches.import({
      matches,
      backgroundJobs,
      backgroundJobReceipts,
    });
  }
  if (should(EVENT_PROJECTION_TYPES)) {
    const [events, customEvents, eventLogs, eventBuffs, contributions] = await Promise.all([
      records(STORES.event), records(STORES.customEvent), records(STORES.eventLog),
      records(STORES.eventBuff), records(STORES.contribution),
    ]);
    results.events = await importers.events.import({
      events, customEvents, eventLogs, eventBuffs, contributions,
    });
  }
  if (should(COMMERCE_PROJECTION_TYPES)) {
    const [shop, inventory, transactions] = await Promise.all([
      records(STORES.shop), records(STORES.inventory), records(STORES.transaction),
    ]);
    results.commerce = await importers.commerce.import({ shop, inventory, transactions });
  }
  if (should(SOCIAL_PROJECTION_TYPES)) {
    const [friendships, notifications] = await Promise.all([
      records(STORES.friendship), records(STORES.notification),
    ]);
    results.social = await importers.social.import({ friendships, notifications });
  }
  if (should(JOURNAL_RELATION_PROJECTION_TYPES) && importers.journals?.import) {
    const [journalMetadata, journalComments] = await Promise.all([
      records(STORES.chronicleEntryMetadata), records(STORES.journalComment),
    ]);
    results.journalRelations = await importers.journals.import({
      journalMetadata,
      journalComments,
    });
  }
  if (should(RECOVERY_PROJECTION_TYPES)) {
    const [
      achievementEvents, achievementStates, achievementReceipts,
      taskRecommendations, analyticsEvents, derivedCaches, profileSummaries,
    ] = await Promise.all([
      records(STORES.achievementEvent), records(STORES.achievementState),
      records(STORES.achievementReceipt), records(STORES.recommenderEvent),
      records(STORES.analyticsEvent), records(STORES.derivedCache), records(STORES.profileSummary),
    ]);
    results.recoveryModel = await importers.recoveryModel.import({
      achievementEvents,
      achievementStates,
      achievementReceipts,
      taskRecommendations,
      analyticsEvents,
      modelSettings: [],
      derivedCaches,
      profileSummaries,
    });
  }
  await markProjectionRepairComplete(client, {
    full,
    recordTypes: [...changedTypes].sort(),
  });
  if (full) databaseConnection.persistenceRuntime?.markSqliteAuthoritativeProjectionsReady?.();
  return { reconciled: true, full, results };
}

async function collectNormalizedRecords(databaseConnection) {
  const client = await sqliteClient(databaseConnection);
  if (!client?.query) return [];
  const [runs, stepReceipts, effectIntervals, effectCancellations] = await Promise.all([
    client.query({
      sql: `SELECT id,player_id AS playerId,routine_type AS routineType,
                   scheduled_for AS scheduledFor,status,current_step_id AS currentStepId,
                   steps_json AS stepsJson,started_at AS startedAt,completed_at AS completedAt,
                   updated_at AS updatedAt,version
            FROM routine_runs ORDER BY updated_at,id`,
      result: 'all',
    }).catch(() => []),
    client.query({
      sql: `SELECT id,routine_run_id AS routineRunId,step_id AS stepId,
                   completed_at AS completedAt,operation_id AS operationId
            FROM routine_step_receipts ORDER BY completed_at,id`,
      result: 'all',
    }).catch(() => []),
    client.query({
      sql: `SELECT id,player_id AS playerId,source_type AS sourceType,source_id AS sourceId,
                   effect_scope AS effectScope,multiplier,stacking_rule AS stackingRule,
                   starts_at AS startsAt,ends_at AS endsAt,policy_version AS policyVersion,
                   created_at AS createdAt
            FROM effect_intervals ORDER BY created_at,id`,
      result: 'all',
    }).catch(() => []),
    client.query({
      sql: `SELECT id,interval_id AS intervalId,player_id AS playerId,device_id AS deviceId,
                   operation_id AS operationId,cancelled_at AS cancelledAt,created_at AS createdAt
            FROM effect_cancellation_receipts ORDER BY cancelled_at,id`,
      result: 'all',
    }).catch(() => []),
  ]);
  const runRecords = runs.map((row) => {
    let steps = [];
    try { steps = JSON.parse(String(row.stepsJson || '[]')); } catch { steps = []; }
    const run = { ...row, steps };
    delete run.stepsJson;
    return referenceRecord('routine-run', row.id, run, row.updatedAt);
  });
  return [
    ...runRecords,
    ...stepReceipts.map((row) => referenceRecord(
      'routine-step-receipt', row.id, row, row.completedAt,
    )),
    ...effectIntervals.map((row) => referenceRecord(
      'effect-interval', row.id, row, row.createdAt,
    )),
    ...effectCancellations.map((row) => referenceRecord(
      'effect-cancellation', row.id, row, row.cancelledAt,
    )),
  ];
}

export async function collectMobileReferenceRecords(databaseConnection, {
  bootstrap = false,
  includeActiveProfile = false,
} = {}) {
  const records = [];
  const recordTypes = bootstrap ? MOBILE_BOOTSTRAP_RECORD_TYPES : MOBILE_REFERENCE_RECORD_TYPES;
  for (const [recordType, store] of recordTypes) {
    // eslint-disable-next-line no-await-in-loop
    const entries = await databaseConnection.getAll(store).catch(() => []);
    for (const entry of entries) {
      if (!entry?.UUID) continue;
      if (recordType === MOBILE_ML_MODEL_RECORD_TYPE && !isMobileMlModelRecord(entry)) continue;
      if (recordType === 'goal-contribution'
          && !entry.goalUUID && !entry.projectId) continue;
      records.push(referenceRecord(recordType, entry.UUID, entry));
    }
  }
  if (includeActiveProfile) {
    const activePlayerUUID = databaseConnection.getActivePlayerUUID?.() || null;
    if (activePlayerUUID) {
      let changedAt = databaseConnection.getActivePlayerChangedAt?.() || null;
      if (!changedAt) {
        databaseConnection.setActivePlayerUUID?.(activePlayerUUID);
        await databaseConnection.flushWrites?.();
        changedAt = databaseConnection.getActivePlayerChangedAt?.() || new Date().toISOString();
      }
      records.push({
        recordType: MOBILE_ACTIVE_PROFILE_RECORD_TYPE,
        recordId: MOBILE_ACTIVE_PROFILE_RECORD_ID,
        workspaceId: null,
        playerId: activePlayerUUID,
        data: {
          UUID: MOBILE_ACTIVE_PROFILE_RECORD_ID,
          activePlayerUUID,
          changedAt,
        },
        updatedAt: changedAt,
      });
    }
  }
  if (bootstrap) records.push(...await collectNormalizedRecords(databaseConnection));
  return records;
}

function normalizedStatements(entry) {
  if (entry.recordType === 'routine-run') {
    return buildRemoteRoutineRunStatements(entry.data);
  }
  if (entry.recordType === 'routine-step-receipt') {
    const receipt = entry.data || {};
    if (!receipt.id || !receipt.routineRunId || !receipt.stepId || !receipt.completedAt) return [];
    return [{
      sql: `INSERT INTO routine_step_receipts(id,routine_run_id,step_id,completed_at,operation_id)
            VALUES(?,?,?,?,?) ON CONFLICT(routine_run_id,step_id) DO NOTHING`,
      bind: [receipt.id, receipt.routineRunId, receipt.stepId,
        receipt.completedAt, receipt.operationId || `bootstrap:${receipt.id}`],
      result: 'changes',
    }];
  }
  if (entry.recordType === 'effect-interval') {
    return [effectIntervalStatement(entry.data)].filter(Boolean);
  }
  if (entry.recordType === 'effect-cancellation') {
    return [effectCancellationStatement(entry.data)].filter(Boolean);
  }
  return [];
}

export async function applyMobileReferenceRecords(databaseConnection, records = [], {
  forceActiveProfile = false,
  pruneMissing = false,
  protectedRecordKeys = new Set(),
} = {}) {
  const localByStore = new Map();
  const puts = [];
  const deletes = [];
  const normalized = [];
  const typedDeleteStatements = [];
  const appliedRecordTypes = new Set();
  let activeProfile = null;
  let manifest = null;
  let newest = 0;
  for (const entry of records) {
    if (entry?.recordType === MOBILE_WORKING_SET_MANIFEST_TYPE) {
      const publishedAt = entry?.data?.publishedAt || entry?.updatedAt || null;
      const publishedTime = new Date(publishedAt || 0).getTime() || 0;
      const schemaVersion = Math.max(0, Number(entry?.data?.schemaVersion) || 0);
      if (!manifest || publishedTime >= manifest.publishedTime) {
        manifest = { publishedAt, publishedTime, schemaVersion };
      }
      newest = Math.max(newest, publishedTime);
      continue;
    }
    if (entry?.recordType === MOBILE_ACTIVE_PROFILE_RECORD_TYPE) {
      const activeProfileKey = `${MOBILE_ACTIVE_PROFILE_RECORD_TYPE}:${MOBILE_ACTIVE_PROFILE_RECORD_ID}`;
      if (protectedRecordKeys?.has?.(activeProfileKey)) continue;
      const activePlayerUUID = entry?.data?.activePlayerUUID || entry?.playerId || null;
      if (activePlayerUUID) {
        const incomingTime = new Date(entry.updatedAt || entry.data?.changedAt || 0).getTime() || 0;
        if (!activeProfile || incomingTime >= activeProfile.incomingTime) {
          activeProfile = {
            activePlayerUUID: String(activePlayerUUID),
            changedAt: entry.updatedAt || entry.data?.changedAt || new Date(incomingTime).toISOString(),
            incomingTime,
          };
          appliedRecordTypes.add(MOBILE_ACTIVE_PROFILE_RECORD_TYPE);
        }
        newest = Math.max(newest, incomingTime);
      }
      continue;
    }
    if (SPECIAL_RECORD_TYPES.has(entry?.recordType)) {
      normalized.push({
        recordType: entry.recordType,
        statements: normalizedStatements(entry),
      });
      newest = Math.max(newest, new Date(entry.updatedAt || 0).getTime() || 0);
      appliedRecordTypes.add(entry.recordType);
      continue;
    }
    const recordKey = `${String(entry?.recordType || '')}:${String(entry?.recordId || entry?.data?.UUID || '')}`;
    if (protectedRecordKeys?.has?.(recordKey)) continue;
    const store = STORE_BY_TYPE.get(entry?.recordType);
    if (!store || !entry?.data?.UUID) continue;
    const scopedIncomingData = WORKSPACE_DEFINITION_TYPES.has(entry.recordType)
      ? withWorkspacePlanningScope(entry.data, {
          workspaceId: entry.workspaceId || DEFAULT_WORKSPACE_ID,
          createdByPlayerId: planningCreatorId(entry.data, entry.playerId),
        })
      : WORKSPACE_RELATED_TYPES.has(entry.recordType) && !entry.data.workspaceId
        ? { ...entry.data, workspaceId: entry.workspaceId || DEFAULT_WORKSPACE_ID }
        : entry.data;
    const incomingTime = Math.max(
      recordTime(scopedIncomingData),
      new Date(entry.updatedAt || 0).getTime() || 0,
    );
    const incomingData = incomingTime > recordTime(scopedIncomingData)
      ? { ...scopedIncomingData, syncUpdatedAt: new Date(incomingTime).toISOString() }
      : scopedIncomingData;
    if (!localByStore.has(store)) {
      // eslint-disable-next-line no-await-in-loop
      const local = await databaseConnection.getAll(store).catch(() => []);
      localByStore.set(store, new Map(local.filter((record) => record?.UUID).map((record) => [record.UUID, record])));
    }
    const current = localByStore.get(store).get(incomingData.UUID);
    if (current && recordTime(current) >= incomingTime) continue;
    if (entry.deleted || incomingData.__deleted) {
      if (current) deletes.push({ store, UUID: incomingData.UUID });
      const typedTable = TYPED_DELETE_TABLE_BY_RECORD_TYPE.get(entry.recordType);
      if (typedTable) {
        typedDeleteStatements.push({
          sql: `DELETE FROM ${typedTable} WHERE id=?`,
          bind: [String(incomingData.UUID)],
          result: 'changes',
        });
      }
      appliedRecordTypes.add(entry.recordType);
      newest = Math.max(newest, incomingTime);
      continue;
    }
    puts.push({ store, record: incomingData });
    appliedRecordTypes.add(entry.recordType);
    newest = Math.max(newest, incomingTime);
  }
  const normalizedPriority = {
    'routine-run': 0,
    'routine-step-receipt': 1,
    'effect-interval': 2,
    'effect-cancellation': 3,
  };
  const orderedNormalizedStatements = normalized
    .sort((left, right) => normalizedPriority[left.recordType] - normalizedPriority[right.recordType])
    .flatMap((entry) => entry.statements);
  if (pruneMissing && manifest?.publishedTime) {
    const idsByStore = new Map();
    for (const entry of records) {
      const store = STORE_BY_TYPE.get(entry?.recordType);
      if (!store || !entry?.data?.UUID || entry.deleted || entry.data.__deleted) continue;
      if (!idsByStore.has(store)) idsByStore.set(store, new Set());
      idsByStore.get(store).add(String(entry.data.UUID));
    }
    for (const [, store] of MOBILE_BOOTSTRAP_RECORD_TYPES) {
      if (idsByStore.has(store) && localByStore.has(store)) continue;
      // eslint-disable-next-line no-await-in-loop
      const local = await databaseConnection.getAll(store).catch(() => []);
      localByStore.set(store, new Map(local.filter((record) => record?.UUID).map((record) => [record.UUID, record])));
    }
    for (const [recordType, store] of MOBILE_BOOTSTRAP_RECORD_TYPES) {
      const retained = idsByStore.get(store) || new Set();
      for (const local of localByStore.get(store)?.values?.() || []) {
        // The app-settings store contains desktop-only settings alongside the
        // portable model bundle. A mobile prune may remove stale model
        // artifacts, but it must never treat unrelated settings as cloud data.
        if (recordType === MOBILE_ML_MODEL_RECORD_TYPE && !isMobileMlModelRecord(local)) continue;
        if (retained.has(String(local.UUID))) continue;
        if (recordTime(local) > manifest.publishedTime) continue;
        deletes.push({ store, UUID: local.UUID });
      }
    }
  }
  if (puts.length || deletes.length || typedDeleteStatements.length || orderedNormalizedStatements.length) {
    await databaseConnection.commitAtomicMutation({
      operationId: `mobile-bootstrap:${newest}:${puts.length}:${deletes.length}:${orderedNormalizedStatements.length}`,
      label: 'mobile-bootstrap-refresh',
      puts,
      deletes,
      additionalStatements: [...typedDeleteStatements, ...orderedNormalizedStatements],
      flush: true,
      sync: { origin: 'remote-sync', enqueueSync: false },
    });
  }

  let activeProfileApplied = 0;
  if (activeProfile) {
    const localChangedAt = new Date(databaseConnection.getActivePlayerChangedAt?.() || 0).getTime() || 0;
    const localActivePlayerUUID = databaseConnection.getActivePlayerUUID?.() || null;
    const player = await databaseConnection.get(STORES.player, activeProfile.activePlayerUUID).catch(() => null);
    const localSelectionMissing = !localActivePlayerUUID;
    if (player && (activeProfile.incomingTime >= localChangedAt
        || (forceActiveProfile && localSelectionMissing))) {
      databaseConnection.setActivePlayerUUID(activeProfile.activePlayerUUID, {
        changedAt: activeProfile.changedAt,
        enqueueSync: false,
      });
      await databaseConnection.flushWrites?.();
      activeProfileApplied = 1;
    }
  }
  if (forceActiveProfile) {
    const selectedPlayerUUID = databaseConnection.getActivePlayerUUID?.() || null;
    const selectedPlayer = selectedPlayerUUID
      ? await databaseConnection.get(STORES.player, selectedPlayerUUID).catch(() => null)
      : null;
    if (!selectedPlayer) {
      const players = await Promise.resolve(databaseConnection.getAll?.(STORES.player) || [])
        .catch(() => []);
      const fallback = players
        .filter((player) => player?.UUID && !player.archivedAt && !player.bannedAt)
        .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))[0]
        || null;
      if (fallback) {
        const changedAt = activeProfile?.changedAt || new Date(newest || Date.now()).toISOString();
        databaseConnection.setActivePlayerUUID(fallback.UUID, {
          changedAt,
          enqueueSync: false,
        });
        await databaseConnection.flushWrites?.();
        activeProfileApplied = 1;
      }
    }
  }
  const projectionRepair = await reconcileMobileReferenceProjections(databaseConnection, {
    recordTypes: appliedRecordTypes,
  });
  return {
    applied: puts.length + deletes.length + orderedNormalizedStatements.length + activeProfileApplied,
    pruned: deletes.length,
    activeProfileApplied,
    manifest,
    projectionRepair,
    recordTypes: [...appliedRecordTypes].sort(),
  };
}

function deltaStateFor(databaseConnection) {
  let state = mobileReferenceDeltaState.get(databaseConnection);
  if (!state) {
    state = { promise: null, followUpRequested: false, forceActiveProfileRequested: false };
    mobileReferenceDeltaState.set(databaseConnection, state);
  }
  return state;
}

function mergeRecordTypes(target, source = []) {
  for (const recordType of source || []) {
    if (recordType) target.add(String(recordType));
  }
}

async function pullMobileReferenceChangePages(databaseConnection, transport, {
  forceActiveProfile = false,
  pageSize = MOBILE_REFERENCE_DELTA_PAGE_SIZE,
} = {}) {
  const runtime = databaseConnection?.syncRuntime;
  if (!runtime?.cursors || !transport?.getMobileReferenceChanges) {
    return { synchronized: false, reason: 'reference-delta-transport-unavailable' };
  }

  const limit = Math.max(1, Math.min(500, Number(pageSize) || MOBILE_REFERENCE_DELTA_PAGE_SIZE));
  let downloaded = 0;
  let applied = 0;
  let pruned = 0;
  let activeProfileApplied = 0;
  let remoteWins = 0;
  const localWins = new Set();
  const recordTypes = new Set();
  let manifest = null;
  let projectionRepair = null;
  let cursor = await runtime.cursors.get(MOBILE_REFERENCE_CURSOR_STREAM);
  let reachedEnd = false;

  for (let page = 0; page < 1000; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const remote = await transport.getMobileReferenceChanges({
      after: cursor.serverSequence,
      limit,
    });
    const entries = Array.isArray(remote) ? remote : remote?.records || [];
    if (!entries.length) {
      reachedEnd = true;
      break;
    }

    let previousSequence = cursor.serverSequence;
    for (const entry of entries) {
      const sequence = Number(entry?.serverSequence);
      if (!Number.isSafeInteger(sequence) || sequence <= previousSequence) {
        const error = new Error('The mobile reference delta stream returned an invalid sequence.');
        error.code = 'reference-delta-sequence-invalid';
        throw error;
      }
      previousSequence = sequence;
    }

    // Protect newer offline writes before applying the remote page. Advancing
    // the cursor happens only after every record in the page is durably
    // applied; a crash before that point simply replays the idempotent page.
    // eslint-disable-next-line no-await-in-loop
    const reconciliation = await runtime.reconcileReferenceOutbox(entries)
      || { localWins: new Set(), discarded: 0 };
    // eslint-disable-next-line no-await-in-loop
    const result = await applyMobileReferenceRecords(databaseConnection, entries, {
      forceActiveProfile,
      protectedRecordKeys: reconciliation.localWins,
    });
    const nextSequence = Number(entries.at(-1)?.serverSequence || previousSequence);
    // eslint-disable-next-line no-await-in-loop
    cursor = await runtime.cursors.advance(MOBILE_REFERENCE_CURSOR_STREAM, nextSequence);

    downloaded += entries.length;
    applied += Number(result.applied || 0);
    pruned += Number(result.pruned || 0);
    activeProfileApplied += Number(result.activeProfileApplied || 0);
    remoteWins += Number(reconciliation.discarded || 0);
    for (const key of reconciliation.localWins || []) localWins.add(key);
    mergeRecordTypes(recordTypes, result.recordTypes);
    if (result.manifest) manifest = result.manifest;
    if (result.projectionRepair) projectionRepair = result.projectionRepair;

    if (entries.length < limit) {
      reachedEnd = true;
      break;
    }
  }

  if (!reachedEnd) {
    const error = new Error('The mobile reference delta stream exceeded its bounded page limit.');
    error.code = 'reference-delta-page-limit';
    throw error;
  }

  return {
    synchronized: true,
    downloaded,
    applied,
    pruned,
    activeProfileApplied,
    cursor: Number(cursor.serverSequence || 0),
    recordTypes: [...recordTypes].sort(),
    manifest,
    projectionRepair,
    referenceConflicts: {
      localWins: localWins.size,
      remoteWins,
    },
  };
}

export function synchronizeMobileReferenceChanges(databaseConnection, transport, options = {}) {
  if (!databaseConnection || !transport?.getMobileReferenceChanges) {
    return Promise.resolve({ synchronized: false, reason: 'reference-delta-transport-unavailable' });
  }
  if (databaseConnection.demoMode) {
    return Promise.resolve({ synchronized: false, reason: 'demo-mode' });
  }

  const state = deltaStateFor(databaseConnection);
  if (state.promise) {
    state.followUpRequested = true;
    state.forceActiveProfileRequested = state.forceActiveProfileRequested
      || options.forceActiveProfile === true;
    return state.promise;
  }

  state.forceActiveProfileRequested = options.forceActiveProfile === true;
  state.promise = (async () => {
    let combined = {
      synchronized: true,
      downloaded: 0,
      applied: 0,
      pruned: 0,
      activeProfileApplied: 0,
      cursor: 0,
      recordTypes: [],
      manifest: null,
      projectionRepair: null,
      referenceConflicts: { localWins: 0, remoteWins: 0 },
    };
    const recordTypes = new Set();
    do {
      state.followUpRequested = false;
      const forceActiveProfile = state.forceActiveProfileRequested;
      state.forceActiveProfileRequested = false;
      // eslint-disable-next-line no-await-in-loop
      const pass = await pullMobileReferenceChangePages(databaseConnection, transport, {
        ...options,
        forceActiveProfile,
      });
      combined = {
        ...combined,
        synchronized: pass.synchronized !== false,
        downloaded: combined.downloaded + Number(pass.downloaded || 0),
        applied: combined.applied + Number(pass.applied || 0),
        pruned: combined.pruned + Number(pass.pruned || 0),
        activeProfileApplied: combined.activeProfileApplied + Number(pass.activeProfileApplied || 0),
        cursor: Math.max(combined.cursor, Number(pass.cursor || 0)),
        manifest: pass.manifest || combined.manifest,
        projectionRepair: pass.projectionRepair || combined.projectionRepair,
        referenceConflicts: {
          localWins: combined.referenceConflicts.localWins
            + Number(pass.referenceConflicts?.localWins || 0),
          remoteWins: combined.referenceConflicts.remoteWins
            + Number(pass.referenceConflicts?.remoteWins || 0),
        },
      };
      mergeRecordTypes(recordTypes, pass.recordTypes);
    } while (state.followUpRequested);
    return { ...combined, recordTypes: [...recordTypes].sort() };
  })().finally(() => {
    state.promise = null;
    state.followUpRequested = false;
    state.forceActiveProfileRequested = false;
  });

  return state.promise;
}

export async function synchronizeMobileReferenceData(databaseConnection, transport, {
  publishActiveProfile = false,
  forceActiveProfile = false,
  uploadReferences = true,
} = {}) {
  if (!transport?.mergeMobileReferenceRecords || !transport?.getMobileReferenceChanges) {
    return { synchronized: false, reason: 'reference-delta-transport-unavailable' };
  }
  if (databaseConnection.demoMode) return { synchronized: false, reason: 'demo-mode' };

  const local = uploadReferences
    ? await collectMobileReferenceRecords(databaseConnection, {
        includeActiveProfile: publishActiveProfile,
      })
    : [];
  if (local.length) await transport.mergeMobileReferenceRecords(local);

  const delta = await synchronizeMobileReferenceChanges(databaseConnection, transport, {
    forceActiveProfile,
  });

  let workingSetRepair = null;
  if (forceActiveProfile) {
    const manifest = delta.manifest;
    const localState = databaseConnection.getMobileWorkingSetState?.() || {};
    const localAppliedTime = new Date(localState.appliedAt || 0).getTime() || 0;
    const needsRepair = manifest
      && manifest.schemaVersion >= MOBILE_WORKING_SET_SCHEMA_VERSION
      && (
        Number(localState.schemaVersion || 0) < manifest.schemaVersion
        || manifest.publishedTime > localAppliedTime
      );
    if (needsRepair) {
      workingSetRepair = await restoreMobileBootstrapData(databaseConnection, transport, {
        pruneMissing: true,
      });
    }
  }

  return {
    ...delta,
    uploaded: local.length,
    workingSetRepair,
  };
}

export async function publishActiveProfileReference(databaseConnection, transport) {
  if (!transport?.mergeMobileReferenceRecords || databaseConnection.demoMode) {
    return { published: false };
  }
  const records = await collectMobileReferenceRecords(databaseConnection, {
    includeActiveProfile: true,
  });
  // Boundary selection is the one mobile workflow allowed to publish profile
  // clocks. Include all profiles so the frozen source and activated target are
  // committed with the same selection timestamp.
  const profileState = records.filter((record) => (
    record.recordType === MOBILE_ACTIVE_PROFILE_RECORD_TYPE
    || record.recordType === 'profile'
  ));
  if (!profileState.length) return { published: false, reason: 'no-active-profile' };
  const result = await transport.mergeMobileReferenceRecords(profileState);
  return { published: true, uploaded: profileState.length, ...result };
}

export async function publishMobileBootstrapData(databaseConnection, transport) {
  if (!transport?.mergeMobileReferenceRecords) return { published: false };
  if (databaseConnection.demoMode) return { published: false, reason: 'demo-mode' };
  const local = await collectMobileReferenceRecords(databaseConnection, {
    bootstrap: true,
    includeActiveProfile: true,
  });
  const publishedAt = new Date().toISOString();
  local.push({
    recordType: MOBILE_WORKING_SET_MANIFEST_TYPE,
    recordId: MOBILE_WORKING_SET_MANIFEST_ID,
    workspaceId: null,
    playerId: databaseConnection.getActivePlayerUUID?.() || null,
    data: {
      UUID: MOBILE_WORKING_SET_MANIFEST_ID,
      schemaVersion: MOBILE_WORKING_SET_SCHEMA_VERSION,
      publishedAt,
    },
    updatedAt: publishedAt,
  });
  const resources = await publishReferencedMobileResources(databaseConnection, transport, local);
  // Replace-all publication sessions are retired. Merge records through the
  // durable idempotent path so concurrent devices cannot invalidate tokens.
  const workingSet = await transport.mergeMobileReferenceRecords(local);
  return { published: true, uploaded: local.length, resources, ...workingSet };
}

export async function restoreMobileBootstrapData(databaseConnection, transport, {
  pruneMissing = true,
  onProgress = null,
} = {}) {
  if (!transport?.getMobileReferenceRecords) return { restored: false };
  onProgress?.({ stage: 'connecting', downloaded: 0, page: 0 });
  // Capture the delta watermark before reading the snapshot. Any write that
  // races the multi-page restore receives a larger sequence and is replayed
  // after the snapshot, so bootstrap cannot skip a concurrent edit/delete.
  const snapshotBaseSequence = Number(
    await transport.getMobileReferenceHead?.().catch(() => 0),
  ) || 0;
  const remote = transport.getMobileReferenceRecordsPaginated
    ? await transport.getMobileReferenceRecordsPaginated(null, { onProgress })
    : await transport.getMobileReferenceRecords();
  if (!transport.getMobileReferenceRecordsPaginated) {
    onProgress?.({
      stage: 'downloading',
      downloaded: remote.length,
      page: remote.length ? 1 : 0,
      batch: remote.length,
      done: true,
    });
  }
  onProgress?.({
    stage: 'applying',
    downloaded: remote.length,
    total: remote.length,
  });
  const reconciliation = await databaseConnection.syncRuntime?.reconcileReferenceOutbox?.(remote)
    || { localWins: new Set(), discarded: 0 };
  const applied = await applyMobileReferenceRecords(databaseConnection, remote, {
    forceActiveProfile: true,
    pruneMissing,
    protectedRecordKeys: reconciliation.localWins,
  });
  const completedTasks = await databaseConnection.getAll(STORES.task).catch(() => []);
  const dojoTasks = completedTasks.filter((task) => task.source === 'dojo' && task.dojoSessionUUID);
  for (const task of dojoTasks) {
    // Rollup commands are idempotent by completed-task UUID.
    // eslint-disable-next-line no-await-in-loop
    await databaseConnection.persistenceRuntime?.dojoStandings?.recordTaskCompletion({ task }).catch(() => undefined);
  }
  await databaseConnection.persistenceRuntime?.dojoStandings?.materializeRanks?.().catch(() => undefined);
  // Elo/Points/contribution caches are derived from the restored canonical
  // rows. Rebuild them behind the usable shell; a large history must never
  // strand desktop or mobile on the cloud-opening interstitial.
  void databaseConnection.reconcileMissingMaterializedLeaderboards?.({
    reason: 'mobile-working-set-restore',
    force: true,
  }).catch(() => undefined);
  if (applied.manifest?.publishedAt) {
    databaseConnection.setMobileWorkingSetState?.({
      appliedAt: applied.manifest.publishedAt,
      schemaVersion: applied.manifest.schemaVersion,
    });
    await databaseConnection.flushWrites?.();
  }
  if (Number.isSafeInteger(snapshotBaseSequence) && snapshotBaseSequence >= 0) {
    await databaseConnection.syncRuntime?.cursors?.advance?.(
      MOBILE_REFERENCE_CURSOR_STREAM,
      snapshotBaseSequence,
    );
  }
  // Complete the two-phase bootstrap by replaying every change committed after
  // the pre-snapshot watermark. This handles records updated, inserted, or
  // tombstoned while the snapshot pages were in flight.
  const catchUp = transport.getMobileReferenceChanges
    ? await synchronizeMobileReferenceChanges(databaseConnection, transport, {
        forceActiveProfile: true,
      })
    : { synchronized: false, downloaded: 0, applied: 0, recordTypes: [] };
  onProgress?.({
    stage: 'opening',
    downloaded: remote.length,
    applied: Number(applied.applied || 0),
    total: remote.length,
  });
  return {
    restored: true,
    downloaded: remote.length,
    dojoRollups: dojoTasks.length,
    referenceConflicts: {
      localWins: reconciliation.localWins.size
        + Number(catchUp.referenceConflicts?.localWins || 0),
      remoteWins: reconciliation.discarded
        + Number(catchUp.referenceConflicts?.remoteWins || 0),
    },
    catchUp,
    ...applied,
    applied: Number(applied.applied || 0) + Number(catchUp.applied || 0),
    recordTypes: [...new Set([
      ...(applied.recordTypes || []),
      ...(catchUp.recordTypes || []),
    ])].sort(),
  };
}

export default synchronizeMobileReferenceData;
