import { asObject, parseJson, stableJson } from './shadowDomainUtils.js';
import { deserializeProfilePictureValue } from '../profilePictureValue.js';
import {
  bumpSourceVersionStatements,
  normalizeSourceKeys,
  readSourceVersions,
  sourceVersionSnapshotJson,
  sourceVersionsMatch,
} from './sourceVersionUtils.js';

function asIso(value, now) {
  const date = value instanceof Date ? value : new Date(value || now());
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid timestamp is required.');
  return date.toISOString();
}

function achievementEventFromRow(row) {
  if (!row) return null;
  return {
    UUID: row.id,
    parent: row.playerId || row.playerKey,
    playerKey: row.playerKey,
    type: row.eventType,
    sourceUUID: row.sourceId,
    eventSchemaVersion: Number(row.eventSchemaVersion),
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    payload: parseJson(row.payloadJson, {}),
    idempotencyKey: row.idempotencyKey,
  };
}

function achievementStateFromRow(row) {
  if (!row) return null;
  return {
    UUID: `achievement-state:${row.playerId}`,
    parent: row.playerId,
    counterVersion: Number(row.counterVersion),
    counters: parseJson(row.countersJson, {}),
    appliedEvents: parseJson(row.appliedEventsJson, {}),
    eventAwards: parseJson(row.eventAwardsJson, {}),
    needsReconciliation: Boolean(row.needsReconciliation),
    reconciledAt: row.reconciledAt,
    reconciliationReason: row.reconciliationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function achievementReceiptFromRow(row) {
  if (!row) return null;
  return {
    UUID: `achievement-receipt:${row.eventId}`,
    parent: row.playerId || row.playerKey,
    playerKey: row.playerKey,
    eventUUID: row.eventId,
    processorVersion: Number(row.processorVersion),
    status: row.status,
    earnedKeys: parseJson(row.earnedKeysJson, []),
    removedKeys: parseJson(row.removedKeysJson, []),
    issuedKeys: parseJson(row.issuedKeysJson, []),
    rewardIssuedAt: row.rewardIssuedAt,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
    lastError: row.lastError,
  };
}

const ACHIEVEMENT_EVENT_SELECT = `
SELECT id,player_id AS playerId,player_key AS playerKey,event_type AS eventType,source_id AS sourceId,
       event_schema_version AS eventSchemaVersion,occurred_at AS occurredAt,created_at AS createdAt,
       payload_json AS payloadJson,idempotency_key AS idempotencyKey
FROM achievement_events
`.trim();

const ACHIEVEMENT_STATE_SELECT = `
SELECT player_id AS playerId,counter_version AS counterVersion,counters_json AS countersJson,
       applied_events_json AS appliedEventsJson,event_awards_json AS eventAwardsJson,
       needs_reconciliation AS needsReconciliation,reconciled_at AS reconciledAt,
       reconciliation_reason AS reconciliationReason,created_at AS createdAt,updated_at AS updatedAt
FROM achievement_states
`.trim();

const ACHIEVEMENT_RECEIPT_SELECT = `
SELECT event_id AS eventId,player_id AS playerId,player_key AS playerKey,processor_version AS processorVersion,
       status,earned_keys_json AS earnedKeysJson,removed_keys_json AS removedKeysJson,
       issued_keys_json AS issuedKeysJson,reward_issued_at AS rewardIssuedAt,
       created_at AS createdAt,completed_at AS completedAt,updated_at AS updatedAt,last_error AS lastError
FROM achievement_receipts
`.trim();

export class SqliteRecoveryModelRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteRecoveryModelRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async recordAchievementEvent(event = {}, { operationId = null } = {}) {
    const id = String(event.UUID || '').trim();
    const playerId = String(event.parent || '').trim();
    const eventType = String(event.type || '').trim();
    if (!id || !playerId || !eventType) throw new Error('Achievement events require UUID, parent, and type.');
    const existing = await this.getAchievementEvent(id);
    if (existing) {
      const same = existing.parent === playerId
        && existing.type === eventType
        && stableJson(existing.payload) === stableJson(asObject(event.payload));
      if (!same) {
        const error = new Error(`Achievement event ${id} already exists with different content.`);
        error.code = 'achievement-event-conflict';
        throw error;
      }
      return { event: existing, duplicate: true };
    }
    const occurredAt = asIso(event.occurredAt || event.createdAt, this.now);
    const createdAt = asIso(event.createdAt || occurredAt, this.now);
    const idempotencyKey = String(event.idempotencyKey || id);
    const result = await this.client.executeAtomic({
      commandId: `achievement-event:${operationId || idempotencyKey}`,
      label: 'achievement-event-record-shadow',
      statements: [{
        sql: `INSERT INTO achievement_events(
                id,player_id,player_key,event_type,source_id,event_schema_version,
                occurred_at,created_at,payload_json,idempotency_key
              ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        bind: [id, playerId, playerId, eventType, event.sourceUUID ? String(event.sourceUUID) : null,
          Math.max(1, Math.trunc(Number(event.eventSchemaVersion) || 1)), occurredAt, createdAt,
          stableJson(asObject(event.payload)), idempotencyKey],
        result: 'changes',
      }],
    });
    return { event: await this.getAchievementEvent(id), duplicate: result.duplicate };
  }

  async getAchievementEvent(eventId) {
    return achievementEventFromRow(await this.client.query({
      sql: `${ACHIEVEMENT_EVENT_SELECT} WHERE id=?`, bind: [eventId], result: 'one',
    }));
  }

  async getAchievementState(playerId) {
    return achievementStateFromRow(await this.client.query({
      sql: `${ACHIEVEMENT_STATE_SELECT} WHERE player_id=?`, bind: [playerId], result: 'one',
    }));
  }

  async getAchievementReceipt(eventId) {
    return achievementReceiptFromRow(await this.client.query({
      sql: `${ACHIEVEMENT_RECEIPT_SELECT} WHERE event_id=?`, bind: [eventId], result: 'one',
    }));
  }

  async listPendingAchievementEvents({ playerId = null } = {}) {
    const rows = await this.client.query({
      sql: `SELECT e.id,e.player_id AS playerId,e.player_key AS playerKey,e.event_type AS eventType,
                   e.source_id AS sourceId,e.event_schema_version AS eventSchemaVersion,
                   e.occurred_at AS occurredAt,e.created_at AS createdAt,e.payload_json AS payloadJson,
                   e.idempotency_key AS idempotencyKey
            FROM achievement_events e
            LEFT JOIN achievement_receipts r ON r.event_id=e.id
            WHERE (r.event_id IS NULL OR r.status<>'completed')
            ${playerId ? 'AND e.player_id=?' : ''}
            ORDER BY e.occurred_at,e.id`,
      bind: playerId ? [playerId] : [], result: 'all',
    });
    return rows.map(achievementEventFromRow);
  }

  async completeAchievementEvent({
    eventId,
    playerId,
    operationId,
    processorVersion = 1,
    state,
    earnedKeys = [],
    removedKeys = [],
    completedAt = this.now(),
  } = {}) {
    if (!eventId || !playerId || !operationId || !state) {
      throw new Error('Achievement completion requires event, player, operation, and state.');
    }
    const existing = await this.getAchievementReceipt(eventId);
    if (existing?.status === 'completed') return { receipt: existing, state: await this.getAchievementState(playerId), duplicate: true };
    const at = asIso(completedAt, this.now);
    try {
      await this.client.executeAtomic({
        commandId: `achievement-process:${operationId}`,
        label: 'achievement-process-shadow',
        statements: [{
          sql: `INSERT INTO achievement_process_commands(
                  operation_id,event_id,player_id,processor_version,counter_version,counters_json,
                  applied_events_json,event_awards_json,earned_keys_json,removed_keys_json,completed_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          bind: [operationId, eventId, playerId, Math.max(1, Math.trunc(Number(processorVersion) || 1)),
            Math.max(1, Math.trunc(Number(state.counterVersion) || 1)), stableJson(asObject(state.counters)),
            stableJson(asObject(state.appliedEvents)), stableJson(asObject(state.eventAwards)),
            stableJson(Array.isArray(earnedKeys) ? earnedKeys.map(String) : []),
            stableJson(Array.isArray(removedKeys) ? removedKeys.map(String) : []), at],
          result: 'changes',
        }],
      });
    } catch (error) {
      const current = await this.getAchievementReceipt(eventId).catch(() => null);
      if (current?.status === 'completed') return { receipt: current, state: await this.getAchievementState(playerId), duplicate: true };
      if (String(error?.message || '').includes('achievement-event-player-mismatch')) error.code = 'achievement-event-player-mismatch';
      throw error;
    }
    return {
      receipt: await this.getAchievementReceipt(eventId),
      state: await this.getAchievementState(playerId),
      duplicate: false,
    };
  }

  async markAchievementRewardsIssued(eventId, {
    operationId,
    issuedKeys = [],
    issuedAt = this.now(),
  } = {}) {
    if (!eventId || !operationId) throw new Error('Reward issue confirmation requires event and operation IDs.');
    const at = asIso(issuedAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: `achievement-reward:${operationId}`,
      label: 'achievement-reward-issued-shadow',
      statements: [{
        sql: `UPDATE achievement_receipts
              SET issued_keys_json=?,reward_issued_at=COALESCE(reward_issued_at,?),updated_at=?
              WHERE event_id=? AND status='completed'`,
        bind: [stableJson(Array.isArray(issuedKeys) ? issuedKeys.map(String) : []), at, at, eventId],
        result: 'changes',
      }, ...bumpSourceVersionStatements(['achievements'], at)],
    });
    return { receipt: await this.getAchievementReceipt(eventId), duplicate: result.duplicate };
  }

  async appendRecommendationEvent(event = {}, { operationId = null } = {}) {
    const id = String(event.UUID || '').trim();
    const playerId = String(event.parent || event.playerUUID || '').trim();
    const decisionId = String(event.decisionUUID || '').trim();
    const eventType = String(event.type || '').trim();
    const eventKey = String(event.eventKey || eventType || '').trim();
    if (!id || !playerId || !decisionId || !eventType || !eventKey) {
      throw new Error('Recommendation protocol events require UUID, player, decision, type, and event key.');
    }
    const existing = await this.client.query({
      sql: 'SELECT id FROM recommendation_events WHERE id=? OR idempotency_key=?',
      bind: [id, String(event.idempotencyKey || `${decisionId}:${eventKey}`)], result: 'one',
    });
    if (existing) return { event: await this.getRecommendationEvent(existing.id), duplicate: true };
    const occurredAt = asIso(event.occurredAt || event.createdAt, this.now);
    const recordedAt = asIso(event.recordedAt || event.createdAt || occurredAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: `recommendation-event:${operationId || event.idempotencyKey || id}`,
      label: 'recommendation-event-shadow',
      statements: [{
        sql: `INSERT INTO recommendation_events(
                id,player_id,decision_id,protocol_family,protocol_schema_version,record_type,event_type,event_key,
                idempotency_key,sequence,source,task_id,origin,occurred_at,recorded_at,payload_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [id, playerId, decisionId, String(event.protocolFamily || 'task-recommender'),
          Math.max(1, Math.trunc(Number(event.protocolSchemaVersion) || 1)), String(event.recordType || 'event'),
          eventType, eventKey, String(event.idempotencyKey || `${decisionId}:${eventKey}`),
          Number.isFinite(Number(event.sequence)) ? Math.max(1, Math.trunc(Number(event.sequence))) : null,
          event.source == null ? null : String(event.source), event.taskUUID == null ? null : String(event.taskUUID),
          String(event.origin || 'user'), occurredAt, recordedAt, stableJson(asObject(event.payload))],
        result: 'changes',
      }, ...bumpSourceVersionStatements(['recommender'], recordedAt)],
    });
    return { event: await this.getRecommendationEvent(id), duplicate: result.duplicate };
  }

  async getRecommendationEvent(eventId) {
    const row = await this.client.query({
      sql: `SELECT id,player_id AS playerId,decision_id AS decisionId,protocol_family AS protocolFamily,
                   protocol_schema_version AS protocolSchemaVersion,record_type AS recordType,event_type AS eventType,
                   event_key AS eventKey,idempotency_key AS idempotencyKey,sequence,source,task_id AS taskId,
                   origin,occurred_at AS occurredAt,recorded_at AS recordedAt,payload_json AS payloadJson
            FROM recommendation_events WHERE id=?`,
      bind: [eventId], result: 'one',
    });
    if (!row) return null;
    return {
      UUID: row.id, parent: row.playerId, decisionUUID: row.decisionId,
      protocolFamily: row.protocolFamily, protocolSchemaVersion: Number(row.protocolSchemaVersion),
      recordType: row.recordType, type: row.eventType, eventKey: row.eventKey,
      idempotencyKey: row.idempotencyKey, sequence: row.sequence == null ? null : Number(row.sequence),
      source: row.source, taskUUID: row.taskId, origin: row.origin,
      occurredAt: row.occurredAt, recordedAt: row.recordedAt, createdAt: row.recordedAt,
      payload: parseJson(row.payloadJson, {}),
    };
  }

  async listRecommendationEvents({ decisionId = null, playerId = null } = {}) {
    const clauses = [];
    const bind = [];
    if (decisionId) { clauses.push('decision_id=?'); bind.push(decisionId); }
    if (playerId) { clauses.push('player_id=?'); bind.push(playerId); }
    const ids = await this.client.query({
      sql: `SELECT id FROM recommendation_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY CASE WHEN sequence IS NULL THEN 1 ELSE 0 END,sequence,occurred_at,id`,
      bind, result: 'all',
    });
    return Promise.all(ids.map((row) => this.getRecommendationEvent(row.id)));
  }

  async setModelSetting({
    id,
    playerId = null,
    settingKey,
    schemaVersion = 1,
    value,
    sourceVersion = 0,
    operationId,
    updatedAt = this.now(),
  } = {}) {
    if (!id || !settingKey || !operationId) throw new Error('Model settings require id, key, and operation ID.');
    const at = asIso(updatedAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: `model-setting:${operationId}`,
      label: 'model-setting-shadow',
      statements: [{
        sql: `INSERT INTO model_settings(id,player_id,setting_key,schema_version,value_json,source_version,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(player_id,setting_key) DO UPDATE SET
                id=excluded.id,schema_version=excluded.schema_version,value_json=excluded.value_json,
                source_version=excluded.source_version,updated_at=excluded.updated_at`,
        bind: [id, playerId, String(settingKey), Math.max(1, Math.trunc(Number(schemaVersion) || 1)),
          stableJson(value), Math.max(0, Math.trunc(Number(sourceVersion) || 0)), at, at], result: 'changes',
      }, ...bumpSourceVersionStatements(['recommender'], at)],
    });
    return { setting: await this.getModelSetting({ playerId, settingKey }), duplicate: result.duplicate };
  }

  async getModelSetting({ playerId = null, settingKey } = {}) {
    const row = await this.client.query({
      sql: `SELECT id,player_id AS playerId,setting_key AS settingKey,schema_version AS schemaVersion,
                   value_json AS valueJson,source_version AS sourceVersion,created_at AS createdAt,updated_at AS updatedAt
            FROM model_settings WHERE player_id IS ? AND setting_key=?`,
      bind: [playerId, settingKey], result: 'one',
    });
    return row ? { ...row, schemaVersion: Number(row.schemaVersion), sourceVersion: Number(row.sourceVersion), value: parseJson(row.valueJson, null) } : null;
  }

  async recordAnalyticsEvent(event = {}, {
    operationId = null,
    dedupeWindowMs = 0,
  } = {}) {
    const id = String(event.UUID || '').trim();
    const playerId = String(event.parent || '').trim();
    const eventName = String(event.eventName || '').trim();
    if (!id || !playerId || !eventName) throw new Error('Analytics events require UUID, parent, and eventName.');
    const createdAt = asIso(event.createdAt, this.now);
    const windowMs = Math.max(0, Number(dedupeWindowMs) || 0);
    if (windowMs) {
      const time = new Date(createdAt).getTime();
      const before = new Date(time - windowMs).toISOString();
      const after = new Date(time + windowMs).toISOString();
      const duplicate = await this.client.query({
        sql: `SELECT id FROM analytics_events
              WHERE player_id=? AND event_name=? AND surface=? AND target_type IS ? AND target_id IS ?
                AND created_at BETWEEN ? AND ? ORDER BY created_at,id LIMIT 1`,
        bind: [playerId, eventName, String(event.surface || 'app'), event.targetType == null ? null : String(event.targetType),
          (event.targetUUID ?? event.itemUUID ?? event.taskUUID ?? event.journalUUID) == null
            ? null : String(event.targetUUID ?? event.itemUUID ?? event.taskUUID ?? event.journalUUID),
          before, after], result: 'one',
      });
      if (duplicate) return { event: await this.getAnalyticsEvent(duplicate.id), duplicate: true };
    }
    const result = await this.client.executeAtomic({
      commandId: `analytics-event:${operationId || id}`,
      label: 'analytics-event-shadow',
      statements: [{
        sql: `INSERT INTO analytics_events(
                id,player_id,event_version,event_name,surface,target_type,target_id,metadata_json,created_at
              ) VALUES(?,?,?,?,?,?,?,?,?)`,
        bind: [id, playerId, Math.max(1, Math.trunc(Number(event.version) || 1)), eventName,
          String(event.surface || 'app'), event.targetType == null ? null : String(event.targetType),
          (event.targetUUID ?? event.itemUUID ?? event.taskUUID ?? event.journalUUID) == null
            ? null : String(event.targetUUID ?? event.itemUUID ?? event.taskUUID ?? event.journalUUID),
          event.metadata == null ? null : stableJson(asObject(event.metadata)), createdAt],
        result: 'changes',
      }, ...bumpSourceVersionStatements(['analytics'], createdAt)],
    });
    return { event: await this.getAnalyticsEvent(id), duplicate: result.duplicate };
  }

  async getAnalyticsEvent(eventId) {
    const row = await this.client.query({
      sql: `SELECT id,player_id AS playerId,event_version AS eventVersion,event_name AS eventName,surface,
                   target_type AS targetType,target_id AS targetId,metadata_json AS metadataJson,created_at AS createdAt
            FROM analytics_events WHERE id=?`, bind: [eventId], result: 'one',
    });
    return row ? {
      UUID: row.id, parent: row.playerId, version: Number(row.eventVersion), eventName: row.eventName,
      surface: row.surface, targetType: row.targetType, targetUUID: row.targetId,
      metadata: parseJson(row.metadataJson, null), createdAt: row.createdAt,
    } : null;
  }

  async listAnalyticsEvents(playerId, { eventName = null, limit = 100 } = {}) {
    const bind = [playerId];
    const clause = eventName ? 'AND event_name=?' : '';
    if (eventName) bind.push(eventName);
    bind.push(Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 100))));
    const rows = await this.client.query({
      sql: `SELECT id FROM analytics_events WHERE player_id=? ${clause}
            ORDER BY created_at DESC,id DESC LIMIT ?`, bind, result: 'all',
    });
    return Promise.all(rows.map((row) => this.getAnalyticsEvent(row.id)));
  }

  async putDerivedCache({
    cacheKey,
    cacheKind,
    schemaVersion = 1,
    requiredSources = [],
    payload,
    expiresAt = null,
    operationId,
    createdAt = this.now(),
  } = {}) {
    if (!cacheKey || !cacheKind || !operationId) throw new Error('Derived cache writes require key, kind, and operation ID.');
    const sources = normalizeSourceKeys(requiredSources);
    const versions = await readSourceVersions(this.client, sources);
    const at = asIso(createdAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: `derived-cache-put:${operationId}`,
      label: 'derived-cache-put-shadow',
      statements: [{
        sql: `INSERT INTO derived_cache_entries(
                cache_key,cache_kind,schema_version,required_sources_json,source_versions_json,
                payload_json,created_at,expires_at,invalidated_at
              ) VALUES(?,?,?,?,?,?,?,?,NULL)
              ON CONFLICT(cache_key) DO UPDATE SET
                cache_kind=excluded.cache_kind,schema_version=excluded.schema_version,
                required_sources_json=excluded.required_sources_json,source_versions_json=excluded.source_versions_json,
                payload_json=excluded.payload_json,created_at=excluded.created_at,expires_at=excluded.expires_at,
                invalidated_at=NULL`,
        bind: [cacheKey, cacheKind, Math.max(1, Math.trunc(Number(schemaVersion) || 1)), stableJson(sources),
          sourceVersionSnapshotJson(versions), stableJson(payload), at, expiresAt ? asIso(expiresAt, this.now) : null],
        result: 'changes',
      }],
    });
    return { cache: await this.getDerivedCache(cacheKey, { includeStale: true }), duplicate: result.duplicate };
  }

  async getDerivedCache(cacheKey, { includeStale = false, at = this.now() } = {}) {
    const row = await this.client.query({
      sql: `SELECT cache_key AS cacheKey,cache_kind AS cacheKind,schema_version AS schemaVersion,
                   required_sources_json AS requiredSourcesJson,source_versions_json AS sourceVersionsJson,
                   payload_json AS payloadJson,created_at AS createdAt,expires_at AS expiresAt,invalidated_at AS invalidatedAt
            FROM derived_cache_entries WHERE cache_key=?`, bind: [cacheKey], result: 'one',
    });
    if (!row) return null;
    const requiredSources = parseJson(row.requiredSourcesJson, []);
    const expected = parseJson(row.sourceVersionsJson, {});
    const actual = await readSourceVersions(this.client, requiredSources);
    const expired = row.expiresAt ? new Date(row.expiresAt).getTime() <= (at instanceof Date ? at : new Date(at)).getTime() : false;
    const stale = Boolean(row.invalidatedAt) || expired || !sourceVersionsMatch(expected, actual);
    if (stale && !includeStale) return null;
    return {
      cacheKey: row.cacheKey, cacheKind: row.cacheKind, schemaVersion: Number(row.schemaVersion),
      requiredSources, sourceVersions: expected, actualSourceVersions: actual,
      payload: parseJson(row.payloadJson, null), createdAt: row.createdAt,
      expiresAt: row.expiresAt, invalidatedAt: row.invalidatedAt, stale,
    };
  }

  async invalidateSources(sourceKeys, { operationId, invalidatedAt = this.now() } = {}) {
    if (!operationId) throw new Error('Source invalidation requires an operation ID.');
    const sources = normalizeSourceKeys(sourceKeys);
    const at = asIso(invalidatedAt, this.now);
    const result = await this.client.executeAtomic({
      commandId: `source-invalidate:${operationId}`,
      label: 'source-invalidate-shadow',
      statements: [
        ...bumpSourceVersionStatements(sources, at),
        {
          sql: `UPDATE derived_cache_entries SET invalidated_at=COALESCE(invalidated_at,?)
                WHERE EXISTS(
                  SELECT 1 FROM json_each(derived_cache_entries.required_sources_json)
                  WHERE value IN (${sources.map(() => '?').join(',') || "''"})
                )`,
          bind: [at, ...sources], result: 'changes',
        },
      ],
    });
    return { duplicate: result.duplicate, sources, sourceVersions: await readSourceVersions(this.client, sources) };
  }

  async deleteAllDerivedCaches({ operationId } = {}) {
    if (!operationId) throw new Error('Derived cache deletion requires an operation ID.');
    const result = await this.client.executeAtomic({
      commandId: `derived-cache-delete-all:${operationId}`,
      label: 'derived-cache-delete-all-shadow',
      statements: [{ sql: 'DELETE FROM derived_cache_entries', result: 'changes' }],
    });
    return { duplicate: result.duplicate, deleted: Number(result.statementResults?.[0]?.changes || 0) };
  }

  async getProfileSummary(playerId) {
    const row = await this.client.query({
      sql: `SELECT player_id AS playerId,username,profile_picture AS profilePicture,elo,created_at AS createdAt,
                   completed_tasks AS completedTasks,task_points AS taskPoints,journals,completed_matches AS completedMatches,
                   accepted_friends AS acceptedFriends,contribution_total AS contributionTotal,
                   inventory_quantity AS inventoryQuantity
            FROM profile_summary_view WHERE player_id=?`, bind: [playerId], result: 'one',
    });
    if (!row) return null;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
      key === 'profilePicture' ? deserializeProfilePictureValue(value) :
      ['elo','completedTasks','taskPoints','journals','completedMatches','acceptedFriends','contributionTotal','inventoryQuantity'].includes(key)
        ? Number(value || 0) : value]));
  }

  async getMatchLeaderboard({ limit = 100 } = {}) {
    const rows = await this.client.query({
      sql: `SELECT player_id AS playerId,username,profile_picture AS profilePicture,elo,
                   completed_matches AS completedMatches,wins
            FROM match_leaderboard_view ORDER BY elo DESC,wins DESC,username,player_id LIMIT ?`,
      bind: [Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 100)))], result: 'all',
    });
    return rows.map((row) => ({
      ...row,
      profilePicture: deserializeProfilePictureValue(row.profilePicture),
      elo: Number(row.elo),
      completedMatches: Number(row.completedMatches),
      wins: Number(row.wins),
    }));
  }

  async getContributionLeaderboard({ limit = 100 } = {}) {
    const rows = await this.client.query({
      sql: `SELECT player_id AS playerId,username,profile_picture AS profilePicture,
                   contribution_total AS contributionTotal
            FROM contribution_leaderboard_view
            ORDER BY contribution_total DESC,username,player_id LIMIT ?`,
      bind: [Math.max(1, Math.min(1000, Math.trunc(Number(limit) || 100)))], result: 'all',
    });
    return rows.map((row) => ({
      ...row,
      profilePicture: deserializeProfilePictureValue(row.profilePicture),
      contributionTotal: Number(row.contributionTotal),
    }));
  }
}

export default SqliteRecoveryModelRepository;
