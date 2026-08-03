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
// attachments/resources, exports, drafts, derived caches, analytics, and model
// weights. Normal edits still use command-specific sync; these records let a
// clean device reconstruct the synchronized working set before replaying the
// operation log.
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
export const MOBILE_WORKING_SET_SCHEMA_VERSION = 2;
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
  ['chronicle-entry-metadata', STORES.chronicleEntryMetadata],
  ['chronicle-entry-revision', STORES.chronicleEntryRevision],
  ['chronicle-entry-access', STORES.chronicleEntryAccess],
  ['chronicle-story', STORES.chronicleStory],
  ['chronicle-story-entry', STORES.chronicleStoryEntry],
  ['chronicle-entry-link', STORES.chronicleEntryLink],
  ['chronicle-reaction', STORES.chronicleReaction],
  ['event', STORES.event],
  ['event-log', STORES.eventLog],
  ['event-buff', STORES.eventBuff],
  ['achievement-event', STORES.achievementEvent],
  ['achievement-state', STORES.achievementState],
  ['achievement-receipt', STORES.achievementReceipt],
  ['friendship', STORES.friendship],
  ['notification', STORES.notification],
]);

export const STORE_BY_TYPE = new Map(MOBILE_BOOTSTRAP_RECORD_TYPES);
export const RECORD_TYPE_BY_STORE = new Map(MOBILE_BOOTSTRAP_RECORD_TYPES.map(([recordType, store]) => [store, recordType]));
const SPECIAL_RECORD_TYPES = new Set(['routine-run', 'routine-step-receipt', 'effect-interval', 'effect-cancellation']);
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
    .filter((entry) => ['profile', 'shop-catalog'].includes(entry.recordType))
    .forEach((entry) => collectResourceUUIDs(entry.data, ids));
  const resources = [];
  for (const resourceUUID of ids) {
    // eslint-disable-next-line no-await-in-loop
    const resource = await databaseConnection.get(STORES.resource, resourceUUID).catch(() => null);
    if (resource) resources.push(resource);
  }
  return transport.publishMobileResources(resources);
}

async function sqliteClient(databaseConnection) {
  await databaseConnection.ready;
  return databaseConnection?.persistenceRuntime?.sqliteStorageAdapter?.client || null;
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
      const activePlayerUUID = entry?.data?.activePlayerUUID || entry?.playerId || null;
      if (activePlayerUUID) {
        const incomingTime = new Date(entry.updatedAt || entry.data?.changedAt || 0).getTime() || 0;
        if (!activeProfile || incomingTime >= activeProfile.incomingTime) {
          activeProfile = {
            activePlayerUUID: String(activePlayerUUID),
            changedAt: entry.updatedAt || entry.data?.changedAt || new Date(incomingTime).toISOString(),
            incomingTime,
          };
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
      newest = Math.max(newest, incomingTime);
      continue;
    }
    puts.push({ store, record: incomingData });
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
    for (const [, store] of MOBILE_BOOTSTRAP_RECORD_TYPES) {
      const retained = idsByStore.get(store) || new Set();
      for (const local of localByStore.get(store)?.values?.() || []) {
        if (retained.has(String(local.UUID))) continue;
        if (recordTime(local) > manifest.publishedTime) continue;
        deletes.push({ store, UUID: local.UUID });
      }
    }
  }
  if (puts.length || deletes.length || orderedNormalizedStatements.length) {
    await databaseConnection.commitAtomicMutation({
      operationId: `mobile-bootstrap:${newest}:${puts.length}:${deletes.length}:${orderedNormalizedStatements.length}`,
      label: 'mobile-bootstrap-refresh',
      puts,
      deletes,
      additionalStatements: orderedNormalizedStatements,
      flush: true,
      sync: { origin: 'remote-sync', enqueueSync: false },
    });
  }

  let activeProfileApplied = 0;
  if (activeProfile) {
    const localChangedAt = new Date(databaseConnection.getActivePlayerChangedAt?.() || 0).getTime() || 0;
    const player = await databaseConnection.get(STORES.player, activeProfile.activePlayerUUID).catch(() => null);
    if (player && (forceActiveProfile || activeProfile.incomingTime >= localChangedAt)) {
      databaseConnection.setActivePlayerUUID(activeProfile.activePlayerUUID, {
        changedAt: activeProfile.changedAt,
      });
      await databaseConnection.flushWrites?.();
      activeProfileApplied = 1;
    }
  }
  return {
    applied: puts.length + deletes.length + orderedNormalizedStatements.length + activeProfileApplied,
    pruned: deletes.length,
    activeProfileApplied,
    manifest,
  };
}

export async function synchronizeMobileReferenceData(databaseConnection, transport, {
  publishActiveProfile = false,
  forceActiveProfile = false,
  uploadReferences = true,
} = {}) {
  if (!transport?.mergeMobileReferenceRecords || !transport?.getMobileReferenceRecords) {
    return { synchronized: false };
  }
  // Demo fixtures must never become private server reference data.
  if (databaseConnection.demoMode) return { synchronized: false, reason: 'demo-mode' };
  const local = uploadReferences
    ? await collectMobileReferenceRecords(databaseConnection, {
        includeActiveProfile: publishActiveProfile,
      })
    : [];
  if (local.length) await transport.mergeMobileReferenceRecords(local);
  const remote = await transport.getMobileReferenceRecords();
  const reconciliation = await databaseConnection.syncRuntime?.reconcileReferenceOutbox?.(remote)
    || { localWins: new Set(), discarded: 0 };
  const applied = await applyMobileReferenceRecords(databaseConnection, remote, {
    forceActiveProfile,
    protectedRecordKeys: reconciliation.localWins,
  });
  let workingSetRepair = null;
  if (forceActiveProfile) {
    const manifest = applied.manifest;
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
    synchronized: true,
    uploaded: local.length,
    downloaded: remote.length,
    ...applied,
    referenceConflicts: {
      localWins: reconciliation.localWins.size,
      remoteWins: reconciliation.discarded,
    },
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
  if (!transport?.replaceMobileReferenceRecords && !transport?.mergeMobileReferenceRecords) return { published: false };
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
  const workingSet = transport.replaceMobileReferenceRecords
    ? await transport.replaceMobileReferenceRecords(local)
    : await transport.mergeMobileReferenceRecords(local);
  return { published: true, uploaded: local.length, resources, ...workingSet };
}

export async function restoreMobileBootstrapData(databaseConnection, transport, {
  pruneMissing = true,
} = {}) {
  if (!transport?.getMobileReferenceRecords) return { restored: false };
  const remote = await transport.getMobileReferenceRecords();
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
  await databaseConnection.reconcileMissingMaterializedLeaderboards?.({
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
  return {
    restored: true,
    downloaded: remote.length,
    dojoRollups: dojoTasks.length,
    referenceConflicts: {
      localWins: reconciliation.localWins.size,
      remoteWins: reconciliation.discarded,
    },
    ...applied,
  };
}

export default synchronizeMobileReferenceData;
