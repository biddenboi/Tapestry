import {
  asObject,
  createImportLedgerStatements,
  deterministicRows,
  fingerprintShadowSource,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';

const IMPORTER_VERSION = 'recovery-model-shadow-v1';

function boundedJson(value, limit, fallback) {
  const json = stableJson(value);
  return json.length <= limit ? json : stableJson(fallback);
}

export class RecoveryModelShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('RecoveryModelShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({
    achievementEvents = [],
    achievementStates = [],
    achievementReceipts = [],
    taskRecommendations = [],
    analyticsEvents = [],
    modelSettings = [],
    derivedCaches = [],
    profileSummaries = [],
    runId = null,
  } = {}) {
    const source = {
      achievementEvents, achievementStates, achievementReceipts, taskRecommendations,
      analyticsEvents, modelSettings, derivedCaches, profileSummaries,
    };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const prior = await this.client.query({
      sql: `SELECT run_id AS runId FROM shadow_import_runs
            WHERE domain='recovery-model-derived' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (prior) return { duplicate: true, runId: prior.runId, sourceFingerprint };

    const timestamp = this.now().toISOString();
    const diagnostics = [];
    const inputs = {
      achievementEvents: deterministicRows(achievementEvents, { kind: 'achievement-event' }),
      achievementStates: deterministicRows(achievementStates, { kind: 'achievement-state' }),
      achievementReceipts: deterministicRows(achievementReceipts, { kind: 'achievement-receipt' }),
      taskRecommendations: deterministicRows(taskRecommendations, { kind: 'recommendation-event' }),
      analyticsEvents: deterministicRows(analyticsEvents, { kind: 'analytics-event' }),
      modelSettings: deterministicRows(modelSettings, { kind: 'model-setting' }),
      derivedCaches: deterministicRows(derivedCaches, { kind: 'derived-cache' }),
    };
    for (const input of Object.values(inputs)) diagnostics.push(...input.conflicts, ...input.rejected);
    if (profileSummaries.length) diagnostics.push({ kind: 'profile-summary', reason: 'replaced-by-sql-view', count: profileSummaries.length });

    const playerIds = new Set((await this.client.query({ sql: 'SELECT id FROM players ORDER BY id', result: 'all' })).map((row) => String(row.id)));
    const taskIds = new Set((await this.client.query({ sql: 'SELECT id FROM tasks ORDER BY id', result: 'all' })).map((row) => String(row.id)));
    const statements = [];
    const importedEventIds = new Set();
    let eventCount = 0;
    for (const record of inputs.achievementEvents.selected) {
      const id = String(record.UUID);
      const playerId = textOrNull(record.parent);
      if (!playerId || !playerIds.has(playerId) || !textOrNull(record.type)) {
        diagnostics.push({ kind: 'achievement-event', recordId: id, reason: 'invalid-event-owner-or-type', playerId });
        continue;
      }
      importedEventIds.add(id);
      statements.push({
        sql: `INSERT INTO achievement_events(
                id,player_id,player_key,event_type,source_id,event_schema_version,
                occurred_at,created_at,payload_json,idempotency_key
              ) VALUES(?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,player_key=excluded.player_key,event_type=excluded.event_type,
                source_id=excluded.source_id,event_schema_version=excluded.event_schema_version,
                occurred_at=excluded.occurred_at,created_at=excluded.created_at,payload_json=excluded.payload_json`,
        bind: [id, playerId, playerId, String(record.type), textOrNull(record.sourceUUID),
          Math.max(1, Math.trunc(Number(record.eventSchemaVersion) || 1)),
          textOrNull(record.occurredAt) || textOrNull(record.createdAt) || timestamp,
          textOrNull(record.createdAt) || textOrNull(record.occurredAt) || timestamp,
          boundedJson(asObject(record.payload), 262144, {}), String(record.idempotencyKey || id)], result: 'changes',
      });
      eventCount += 1;
    }

    let stateCount = 0;
    for (const record of inputs.achievementStates.selected) {
      const playerId = textOrNull(record.parent) || String(record.UUID).replace(/^achievement-state:/, '');
      if (!playerId || !playerIds.has(playerId)) {
        diagnostics.push({ kind: 'achievement-state', recordId: record.UUID, reason: 'unknown-player', playerId });
        continue;
      }
      statements.push({
        sql: `INSERT INTO achievement_states(
                player_id,counter_version,counters_json,applied_events_json,event_awards_json,
                needs_reconciliation,reconciled_at,reconciliation_reason,created_at,updated_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(player_id) DO UPDATE SET
                counter_version=excluded.counter_version,counters_json=excluded.counters_json,
                applied_events_json=excluded.applied_events_json,event_awards_json=excluded.event_awards_json,
                needs_reconciliation=excluded.needs_reconciliation,reconciled_at=excluded.reconciled_at,
                reconciliation_reason=excluded.reconciliation_reason,updated_at=excluded.updated_at`,
        bind: [playerId, Math.max(1, Math.trunc(Number(record.counterVersion) || 1)),
          boundedJson(asObject(record.counters), 524288, {}), boundedJson(asObject(record.appliedEvents), 524288, {}),
          boundedJson(asObject(record.eventAwards), 524288, {}), record.needsReconciliation === false ? 0 : 1,
          textOrNull(record.reconciledAt), textOrNull(record.reconciliationReason),
          textOrNull(record.createdAt) || timestamp, textOrNull(record.updatedAt) || timestamp], result: 'changes',
      });
      stateCount += 1;
    }

    let receiptCount = 0;
    for (const record of inputs.achievementReceipts.selected) {
      const eventId = textOrNull(record.eventUUID) || String(record.UUID).replace(/^achievement-receipt:/, '');
      if (!eventId || !importedEventIds.has(eventId)) {
        diagnostics.push({ kind: 'achievement-receipt', recordId: record.UUID, reason: 'unknown-event', eventId });
        continue;
      }
      const event = achievementEvents.find((candidate) => String(candidate?.UUID) === eventId);
      const playerId = textOrNull(record.parent) || textOrNull(event?.parent);
      statements.push({
        sql: `INSERT INTO achievement_receipts(
                event_id,player_id,player_key,processor_version,status,earned_keys_json,removed_keys_json,
                issued_keys_json,reward_issued_at,created_at,completed_at,updated_at,last_error
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(event_id) DO UPDATE SET
                player_id=excluded.player_id,player_key=excluded.player_key,processor_version=excluded.processor_version,
                status=excluded.status,earned_keys_json=excluded.earned_keys_json,
                removed_keys_json=excluded.removed_keys_json,issued_keys_json=excluded.issued_keys_json,
                reward_issued_at=excluded.reward_issued_at,completed_at=excluded.completed_at,
                updated_at=excluded.updated_at,last_error=excluded.last_error`,
        bind: [eventId, playerId && playerIds.has(playerId) ? playerId : null, playerId || 'unknown',
          Math.max(1, Math.trunc(Number(record.processorVersion) || 1)),
          ['pending','completed','failed'].includes(record.status) ? record.status : 'completed',
          boundedJson(Array.isArray(record.earnedKeys) ? record.earnedKeys : [], 131072, []),
          boundedJson(Array.isArray(record.removedKeys) ? record.removedKeys : [], 131072, []),
          boundedJson(Array.isArray(record.issuedKeys) ? record.issuedKeys : [], 131072, []),
          textOrNull(record.rewardIssuedAt), textOrNull(record.createdAt) || timestamp,
          textOrNull(record.completedAt), textOrNull(record.updatedAt) || timestamp, textOrNull(record.lastError)], result: 'changes',
      });
      receiptCount += 1;
    }

    let recommendationCount = 0;
    for (const record of inputs.taskRecommendations.selected) {
      const id = String(record.UUID);
      const playerId = textOrNull(record.parent) || textOrNull(record.playerUUID);
      const decisionId = textOrNull(record.decisionUUID);
      const eventType = textOrNull(record.type);
      const eventKey = textOrNull(record.eventKey);
      if (!playerId || !playerIds.has(playerId) || !decisionId || !eventType || !eventKey) {
        diagnostics.push({ kind: 'recommendation-event', recordId: id, reason: 'invalid-protocol-record' });
        continue;
      }
      let taskId = textOrNull(record.taskUUID);
      if (taskId && !taskIds.has(taskId)) {
        diagnostics.push({ kind: 'recommendation-event', recordId: id, reason: 'unknown-task', taskId });
        taskId = null;
      }
      statements.push({
        sql: `INSERT INTO recommendation_events(
                id,player_id,decision_id,protocol_family,protocol_schema_version,record_type,event_type,event_key,
                idempotency_key,sequence,source,task_id,origin,occurred_at,recorded_at,payload_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,decision_id=excluded.decision_id,protocol_family=excluded.protocol_family,
                protocol_schema_version=excluded.protocol_schema_version,record_type=excluded.record_type,
                event_type=excluded.event_type,event_key=excluded.event_key,sequence=excluded.sequence,
                source=excluded.source,task_id=excluded.task_id,origin=excluded.origin,
                occurred_at=excluded.occurred_at,recorded_at=excluded.recorded_at,payload_json=excluded.payload_json`,
        bind: [id, playerId, decisionId, String(record.protocolFamily || 'task-recommender'),
          Math.max(1, Math.trunc(Number(record.protocolSchemaVersion) || 1)), String(record.recordType || 'event'),
          eventType, eventKey, String(record.idempotencyKey || `${decisionId}:${eventKey}`),
          Number.isFinite(Number(record.sequence)) ? Math.max(1, Math.trunc(Number(record.sequence))) : null,
          textOrNull(record.source), taskId, String(record.origin || 'user'),
          textOrNull(record.occurredAt) || textOrNull(record.createdAt) || timestamp,
          textOrNull(record.recordedAt) || textOrNull(record.createdAt) || timestamp,
          boundedJson(asObject(record.payload), 524288, {})], result: 'changes',
      });
      recommendationCount += 1;
    }

    let analyticsCount = 0;
    for (const record of inputs.analyticsEvents.selected) {
      const id = String(record.UUID);
      const playerId = textOrNull(record.parent);
      const eventName = textOrNull(record.eventName);
      if (!playerId || !playerIds.has(playerId) || !eventName) {
        diagnostics.push({ kind: 'analytics-event', recordId: id, reason: 'invalid-owner-or-name' });
        continue;
      }
      statements.push({
        sql: `INSERT INTO analytics_events(
                id,player_id,event_version,event_name,surface,target_type,target_id,metadata_json,created_at
              ) VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,event_version=excluded.event_version,event_name=excluded.event_name,
                surface=excluded.surface,target_type=excluded.target_type,target_id=excluded.target_id,
                metadata_json=excluded.metadata_json,created_at=excluded.created_at`,
        bind: [id, playerId, Math.max(1, Math.trunc(Number(record.version) || 1)), eventName,
          String(record.surface || 'app'), textOrNull(record.targetType),
          textOrNull(record.targetUUID ?? record.itemUUID ?? record.taskUUID ?? record.journalUUID),
          record.metadata == null ? null : boundedJson(asObject(record.metadata), 131072, {}),
          textOrNull(record.createdAt) || timestamp], result: 'changes',
      });
      analyticsCount += 1;
    }

    let modelSettingCount = 0;
    for (const record of inputs.modelSettings.selected) {
      const id = String(record.UUID);
      const playerId = textOrNull(record.parent);
      if (playerId && !playerIds.has(playerId)) {
        diagnostics.push({ kind: 'model-setting', recordId: id, reason: 'unknown-player', playerId });
        continue;
      }
      const settingKey = textOrNull(record.settingKey ?? record.key);
      if (!settingKey) {
        diagnostics.push({ kind: 'model-setting', recordId: id, reason: 'missing-setting-key' });
        continue;
      }
      statements.push({
        sql: `INSERT INTO model_settings(
                id,player_id,setting_key,schema_version,value_json,source_version,created_at,updated_at
              ) VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(player_id,setting_key) DO UPDATE SET
                id=excluded.id,schema_version=excluded.schema_version,value_json=excluded.value_json,
                source_version=excluded.source_version,updated_at=excluded.updated_at`,
        bind: [id, playerId, settingKey, Math.max(1, Math.trunc(Number(record.schemaVersion) || 1)),
          boundedJson(record.value ?? record.payload ?? {}, 1048576, {}),
          Math.max(0, Math.trunc(Number(record.sourceVersion) || 0)),
          textOrNull(record.createdAt) || timestamp, textOrNull(record.updatedAt) || timestamp], result: 'changes',
      });
      modelSettingCount += 1;
    }

    let derivedCacheCount = 0;
    for (const record of inputs.derivedCaches.selected) {
      const id = String(record.UUID);
      const cacheKind = textOrNull(record.kind ?? record.cacheKind);
      if (!cacheKind) {
        diagnostics.push({ kind: 'derived-cache', recordId: id, reason: 'missing-cache-kind' });
        continue;
      }
      statements.push({
        sql: `INSERT INTO derived_cache_entries(
                cache_key,cache_kind,schema_version,required_sources_json,source_versions_json,
                payload_json,created_at,expires_at,invalidated_at
              ) VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(cache_key) DO UPDATE SET
                cache_kind=excluded.cache_kind,schema_version=excluded.schema_version,
                required_sources_json=excluded.required_sources_json,source_versions_json=excluded.source_versions_json,
                payload_json=excluded.payload_json,created_at=excluded.created_at,expires_at=excluded.expires_at,
                invalidated_at=excluded.invalidated_at`,
        bind: [id, cacheKind, Math.max(1, Math.trunc(Number(record.schemaVersion) || 1)),
          '[]', '{}', boundedJson(record, 2097152, {}), textOrNull(record.createdAt) || timestamp,
          textOrNull(record.expiresAt), timestamp], result: 'changes',
      });
      diagnostics.push({ kind: 'derived-cache', recordId: id, reason: 'imported-invalid-disposable-cache' });
      derivedCacheCount += 1;
    }

    const counts = {
      achievementEvents: eventCount,
      achievementStates: stateCount,
      achievementReceipts: receiptCount,
      recommendationEvents: recommendationCount,
      analyticsEvents: analyticsCount,
      modelSettings: modelSettingCount,
      derivedCaches: derivedCacheCount,
      profileSummariesReplacedByView: profileSummaries.length,
      diagnostics: diagnostics.length,
    };
    const effectiveRunId = runId || `recovery-model-derived:${sourceFingerprint.slice(0, 24)}`;
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId, domain: 'recovery-model-derived', sourceFingerprint, importerVersion: IMPORTER_VERSION,
      startedAt: timestamp, finishedAt: timestamp, counts, diagnostics,
    }));
    await this.client.executeAtomic({
      commandId: `shadow-import:${effectiveRunId}`, label: 'recovery-model-derived-shadow-import', statements,
    });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default RecoveryModelShadowImporter;
