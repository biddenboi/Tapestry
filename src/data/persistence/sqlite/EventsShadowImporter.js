import {
  createImportLedgerStatements,
  deterministicRows,
  fingerprintShadowSource,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';

const IMPORTER_VERSION = 'batch19-events-v2';
const EVENT_KEYS = ['UUID','parent','type','name','category','description','createdAt','inGameTimestamp','location'];
const CUSTOM_KEYS = ['UUID','ownerUUID','type','specialKind','name','description','dailyTarget','unit','maxBonusPct','accentColor','bannerColor','bannerImageUrl','bannerResourceHash','createdAt','updatedAt','archivedAt'];
const LOG_KEYS = ['UUID','parent','eventUUID','type','status','value','loggedAt','loggedDate','createdAt','inGameTimestamp','location'];
const BUFF_KEYS = ['UUID','parent','eventUUID','multiplierValue','accumulatedValue','createdAt','updatedAt','expiresAt'];
const CONTRIBUTION_KEYS = ['UUID','parent','goalUUID','projectId','taskUUID','todoUUID','completionEventUUID','source','direction','summary','taskName','value','rewardBand','rewardRarity','rewardCoins','playerNameSnapshot','goalNameSnapshot','createdAt','completedAt','inGameTimestamp','location'];

function boundedJson(value, max = 131072) {
  const text = stableJson(value ?? {});
  return new TextEncoder().encode(text).byteLength <= max ? text : '{}';
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function location(record) {
  const source = record?.location && typeof record.location === 'object' ? record.location : record || {};
  const latitude = finite(source.latitude);
  const longitude = finite(source.longitude);
  if (latitude == null || longitude == null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { latitude: null, longitude: null, accuracy: null, capturedAt: null };
  }
  return {
    latitude,
    longitude,
    accuracy: finite(source.accuracy) == null ? null : Math.max(0, finite(source.accuracy)),
    capturedAt: textOrNull(source.capturedAt),
  };
}

export class EventsShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('EventsShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ events = [], customEvents = [], eventLogs = [], eventBuffs = [], contributions = [], runId = null } = {}) {
    const source = { events, customEvents, eventLogs, eventBuffs, contributions };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs WHERE domain='events' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) return { duplicate: true, runId: existing.runId, sourceFingerprint, counts: JSON.parse(existing.countsJson), diagnostics: JSON.parse(existing.diagnosticsJson) };

    const inputs = {
      events: deterministicRows(events, { kind: 'lifecycle-event' }),
      customEvents: deterministicRows(customEvents, { kind: 'custom-event' }),
      eventLogs: deterministicRows(eventLogs, { kind: 'event-log' }),
      eventBuffs: deterministicRows(eventBuffs, { kind: 'event-buff' }),
      contributions: deterministicRows(contributions, { kind: 'contribution' }),
    };
    const diagnostics = Object.values(inputs).flatMap((input) => [...input.rejected, ...input.conflicts]);
    const [playerIds, projectIds, taskIds, todoIds, resourceHashes] = await Promise.all([
      this.client.query({ sql: 'SELECT id FROM players', result: 'values' }),
      this.client.query({ sql: 'SELECT id FROM projects', result: 'values' }),
      this.client.query({ sql: 'SELECT id FROM tasks', result: 'values' }),
      this.client.query({ sql: 'SELECT id FROM todos', result: 'values' }),
      this.client.query({ sql: "SELECT content_hash FROM resources WHERE state='active'", result: 'values' }),
    ]).then((rows) => rows.map((values) => new Set(values)));
    const timestamp = this.now().toISOString();
    const statements = [];

    for (const record of inputs.events.selected) {
      const id = String(record.UUID);
      const playerId = playerIds.has(record.parent) ? record.parent : null;
      if (record.parent && !playerId) diagnostics.push({ kind: 'lifecycle-event', recordId: id, reason: 'unknown-player', playerId: record.parent });
      const loc = location(record);
      statements.push({
        sql: `INSERT INTO lifecycle_events(
                id,player_id,event_type,name,category,description,created_at,in_game_timestamp,
                latitude,longitude,location_accuracy,location_captured_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,event_type=excluded.event_type,name=excluded.name,category=excluded.category,
                description=excluded.description,created_at=excluded.created_at,in_game_timestamp=excluded.in_game_timestamp,
                latitude=excluded.latitude,longitude=excluded.longitude,location_accuracy=excluded.location_accuracy,
                location_captured_at=excluded.location_captured_at,extra_json=excluded.extra_json`,
        bind: [id, playerId, textOrNull(record.type) || 'event', textOrNull(record.name), textOrNull(record.category), textOrNull(record.description),
          textOrNull(record.createdAt) || timestamp, Number.isFinite(Number(record.inGameTimestamp)) ? Math.trunc(Number(record.inGameTimestamp)) : null,
          loc.latitude, loc.longitude, loc.accuracy, loc.capturedAt, boundedJson(omitKeys(record, EVENT_KEYS))], result: 'changes',
      });
    }

    for (const record of inputs.customEvents.selected) {
      const id = String(record.UUID);
      const ownerId = record.ownerUUID && playerIds.has(record.ownerUUID) ? record.ownerUUID : null;
      if (record.ownerUUID && !ownerId) diagnostics.push({ kind: 'custom-event', recordId: id, reason: 'unknown-owner', playerId: record.ownerUUID });
      let bannerHash = textOrNull(record.bannerResourceHash);
      if (bannerHash && !resourceHashes.has(bannerHash)) {
        diagnostics.push({ kind: 'custom-event', recordId: id, reason: 'unknown-banner-resource', resourceHash: bannerHash });
        bannerHash = null;
      }
      if (typeof record.bannerImageUrl === 'string' && record.bannerImageUrl.startsWith('data:')) {
        diagnostics.push({ kind: 'custom-event', recordId: id, reason: 'inline-banner-requires-resource-import' });
      }
      statements.push({
        sql: `INSERT INTO custom_events(
                id,owner_player_id,event_type,special_kind,name,description,daily_target,unit,max_bonus_pct,
                accent_color,banner_color,banner_resource_hash,created_at,updated_at,archived_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                owner_player_id=excluded.owner_player_id,event_type=excluded.event_type,special_kind=excluded.special_kind,
                name=excluded.name,description=excluded.description,daily_target=excluded.daily_target,unit=excluded.unit,
                max_bonus_pct=excluded.max_bonus_pct,accent_color=excluded.accent_color,banner_color=excluded.banner_color,
                banner_resource_hash=excluded.banner_resource_hash,updated_at=excluded.updated_at,archived_at=excluded.archived_at,
                extra_json=excluded.extra_json`,
        bind: [id, ownerId, textOrNull(record.type) || 'one_time', textOrNull(record.specialKind), String(record.name || 'Untitled event'),
          textOrNull(record.description), finite(record.dailyTarget), textOrNull(record.unit), finite(record.maxBonusPct),
          textOrNull(record.accentColor), textOrNull(record.bannerColor), bannerHash,
          textOrNull(record.createdAt) || timestamp, textOrNull(record.updatedAt), textOrNull(record.archivedAt),
          boundedJson(omitKeys(record, CUSTOM_KEYS))], result: 'changes',
      });
    }

    const customIds = new Set(inputs.customEvents.selected.map((record) => String(record.UUID)));
    for (const record of inputs.eventLogs.selected) {
      const id = String(record.UUID);
      const playerId = playerIds.has(record.parent) ? record.parent : null;
      const eventId = record.eventUUID && customIds.has(record.eventUUID) ? record.eventUUID : null;
      if (record.eventUUID && !eventId) diagnostics.push({ kind: 'event-log', recordId: id, reason: 'unknown-event', eventId: record.eventUUID });
      const loc = location(record);
      statements.push({
        sql: `INSERT INTO event_logs(
                id,player_id,event_id,event_type,status,value,logged_at,logged_date,created_at,in_game_timestamp,
                latitude,longitude,location_accuracy,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,event_id=excluded.event_id,event_type=excluded.event_type,status=excluded.status,
                value=excluded.value,logged_at=excluded.logged_at,logged_date=excluded.logged_date,created_at=excluded.created_at,
                in_game_timestamp=excluded.in_game_timestamp,latitude=excluded.latitude,longitude=excluded.longitude,
                location_accuracy=excluded.location_accuracy,extra_json=excluded.extra_json`,
        bind: [id, playerId, eventId, textOrNull(record.type), textOrNull(record.status), finite(record.value),
          textOrNull(record.loggedAt ?? record.createdAt) || timestamp, textOrNull(record.loggedDate), textOrNull(record.createdAt) || timestamp,
          Number.isFinite(Number(record.inGameTimestamp)) ? Math.trunc(Number(record.inGameTimestamp)) : null,
          loc.latitude, loc.longitude, loc.accuracy, boundedJson(omitKeys(record, LOG_KEYS))], result: 'changes',
      });
    }

    for (const record of inputs.eventBuffs.selected) {
      const id = String(record.UUID);
      const playerId = playerIds.has(record.parent) ? record.parent : null;
      if (!playerId) {
        diagnostics.push({ kind: 'event-buff', recordId: id, reason: 'unknown-player', playerId: record.parent });
        continue;
      }
      const eventId = record.eventUUID && customIds.has(record.eventUUID) ? record.eventUUID : null;
      statements.push({
        sql: `INSERT INTO event_buffs(
                id,player_id,event_id,multiplier_value,accumulated_value,created_at,updated_at,expires_at,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,event_id=excluded.event_id,multiplier_value=excluded.multiplier_value,
                accumulated_value=excluded.accumulated_value,updated_at=excluded.updated_at,expires_at=excluded.expires_at,
                extra_json=excluded.extra_json`,
        bind: [id, playerId, eventId, Math.max(0, finite(record.multiplierValue) ?? 1), finite(record.accumulatedValue),
          textOrNull(record.createdAt) || timestamp, textOrNull(record.updatedAt), textOrNull(record.expiresAt),
          boundedJson(omitKeys(record, BUFF_KEYS), 65536)], result: 'changes',
      });
    }

    for (const record of inputs.contributions.selected) {
      const id = String(record.UUID);
      const contributionSource = textOrNull(record.source);
      if (!contributionSource) {
        diagnostics.push({ kind: 'contribution', recordId: id, reason: 'missing-source' });
        continue;
      }
      const playerId = playerIds.has(record.parent) ? record.parent : null;
      const requestedGoal = textOrNull(record.goalUUID ?? record.projectId);
      const goalId = requestedGoal && projectIds.has(requestedGoal) ? requestedGoal : null;
      const taskId = record.taskUUID && taskIds.has(record.taskUUID) ? record.taskUUID : null;
      const todoId = record.todoUUID && todoIds.has(record.todoUUID) ? record.todoUUID : null;
      const loc = location(record);
      statements.push({
        sql: `INSERT INTO contributions(
                id,player_id,goal_id,task_id,todo_id,completion_event_id,source,direction,summary,value,
                reward_band,reward_rarity,reward_coins,player_name_snapshot,goal_name_snapshot,task_name_snapshot,
                created_at,completed_at,in_game_timestamp,latitude,longitude,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                player_id=excluded.player_id,goal_id=excluded.goal_id,task_id=excluded.task_id,todo_id=excluded.todo_id,
                completion_event_id=excluded.completion_event_id,source=excluded.source,direction=excluded.direction,
                summary=excluded.summary,value=excluded.value,reward_band=excluded.reward_band,
                reward_rarity=excluded.reward_rarity,reward_coins=excluded.reward_coins,
                player_name_snapshot=excluded.player_name_snapshot,goal_name_snapshot=excluded.goal_name_snapshot,
                task_name_snapshot=excluded.task_name_snapshot,completed_at=excluded.completed_at,
                in_game_timestamp=excluded.in_game_timestamp,latitude=excluded.latitude,longitude=excluded.longitude,
                extra_json=excluded.extra_json`,
        bind: [id, playerId, goalId, taskId, todoId, textOrNull(record.completionEventUUID), contributionSource,
          textOrNull(record.direction), textOrNull(record.summary ?? record.taskName), finite(record.value) ?? 0,
          textOrNull(record.rewardBand), textOrNull(record.rewardRarity), Math.max(0, Math.trunc(Number(record.rewardCoins) || 0)),
          textOrNull(record.playerNameSnapshot), textOrNull(record.goalNameSnapshot), textOrNull(record.taskName ?? record.summary),
          textOrNull(record.createdAt) || timestamp, textOrNull(record.completedAt),
          Number.isFinite(Number(record.inGameTimestamp)) ? Math.trunc(Number(record.inGameTimestamp)) : null,
          loc.latitude, loc.longitude, boundedJson(omitKeys(record, CONTRIBUTION_KEYS))], result: 'changes',
      });
    }

    const counts = {
      events: inputs.events.selected.length, customEvents: inputs.customEvents.selected.length,
      eventLogs: inputs.eventLogs.selected.length, eventBuffs: inputs.eventBuffs.selected.length,
      contributions: inputs.contributions.selected.length, diagnostics: diagnostics.length,
    };
    const effectiveRunId = runId || `events:${sourceFingerprint.slice(0, 24)}`;
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId, domain: 'events', sourceFingerprint, importerVersion: IMPORTER_VERSION,
      startedAt: timestamp, finishedAt: timestamp, counts, diagnostics,
    }));
    await this.client.executeAtomic({ commandId: `shadow-import:${effectiveRunId}`, label: 'events-shadow-import', statements });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default EventsShadowImporter;
