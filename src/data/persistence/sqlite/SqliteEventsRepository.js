import { parseJson, stableJson } from './shadowDomainUtils.js';

const SPECIAL_EVENTS = Object.freeze([
  ['special-wake-time','Wake Up Time','wake_time',25,'#38bdf8'],
  ['special-sleep-time','Sleep Time','sleep_time',25,'#a78bfa'],
  ['special-first-match','First Match of the Day','first_match',12,null],
  ['special-entertainment','Work Day Discipline','entertainment',5,null],
]);

export class SqliteEventsRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteEventsRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async listCustomEvents({ ownerId = undefined, includeArchived = false } = {}) {
    const clauses = [];
    const bind = [];
    if (ownerId !== undefined) { clauses.push('owner_player_id IS ?'); bind.push(ownerId); }
    if (!includeArchived) clauses.push('archived_at IS NULL');
    const rows = await this.client.query({
      sql: `SELECT id,owner_player_id AS ownerUUID,event_type AS type,special_kind AS specialKind,name,description,
                   daily_target AS dailyTarget,unit,max_bonus_pct AS maxBonusPct,accent_color AS accentColor,
                   banner_color AS bannerColor,banner_resource_hash AS bannerResourceHash,
                   created_at AS createdAt,updated_at AS updatedAt,archived_at AS archivedAt,extra_json AS extraJson
            FROM custom_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY name,id`, bind, result: 'all',
    });
    return rows.map((row) => ({ ...parseJson(row.extraJson, {}), ...row, UUID: row.id }));
  }

  async getEventLogsForEvent(eventId, { playerId = null, viewerIGT = Infinity } = {}) {
    const clauses = ['event_id=?'];
    const bind = [eventId];
    if (playerId) { clauses.push('player_id=?'); bind.push(playerId); }
    if (Number.isFinite(Number(viewerIGT))) { clauses.push('(in_game_timestamp IS NULL OR in_game_timestamp<=?)'); bind.push(Math.trunc(Number(viewerIGT))); }
    const rows = await this.client.query({
      sql: `SELECT id,player_id AS parent,event_id AS eventUUID,event_type AS type,status,value,
                   logged_at AS loggedAt,logged_date AS loggedDate,created_at AS createdAt,
                   in_game_timestamp AS inGameTimestamp,
                   extra_json AS extraJson
            FROM event_logs WHERE ${clauses.join(' AND ')} ORDER BY logged_at,id`, bind, result: 'all',
    });
    return rows.map((row) => ({ ...parseJson(row.extraJson, {}), ...row, UUID: row.id }));
  }

  async getActiveBuffs(playerId, { at = this.now() } = {}) {
    const timestamp = (at instanceof Date ? at : new Date(at)).toISOString();
    const rows = await this.client.query({
      sql: `SELECT id,player_id AS parent,event_id AS eventUUID,multiplier_value AS multiplierValue,
                   accumulated_value AS accumulatedValue,created_at AS createdAt,updated_at AS updatedAt,
                   expires_at AS expiresAt,extra_json AS extraJson
            FROM event_buffs WHERE player_id=? AND (expires_at IS NULL OR expires_at>?)
            ORDER BY created_at,id`, bind: [playerId, timestamp], result: 'all',
    });
    return rows.map((row) => ({ ...parseJson(row.extraJson, {}), ...row, UUID: row.id, multiplierValue: Number(row.multiplierValue) }));
  }

  async clearBuffs(playerId, { operationId }) {
    return this.client.executeAtomic({
      commandId: `event-buffs-clear:${operationId}`,
      label: 'event-buffs-clear',
      statements: [{ sql: 'DELETE FROM event_buffs WHERE player_id=?', bind: [playerId], result: 'changes' }],
    });
  }

  async getContributionsForGoal(goalId, { playerId = null } = {}) {
    const bind = [goalId];
    const playerClause = playerId ? 'AND player_id=?' : '';
    if (playerId) bind.push(playerId);
    const rows = await this.client.query({
      sql: `SELECT id,player_id AS parent,goal_id AS goalUUID,task_id AS taskUUID,todo_id AS todoUUID,
                   completion_event_id AS completionEventUUID,source,direction,summary,value,
                   reward_band AS rewardBand,reward_rarity AS rewardRarity,reward_coins AS rewardCoins,
                   player_name_snapshot AS playerNameSnapshot,goal_name_snapshot AS goalNameSnapshot,
                   task_name_snapshot AS taskName,created_at AS createdAt,completed_at AS completedAt,
                   in_game_timestamp AS inGameTimestamp,extra_json AS extraJson
            FROM contributions WHERE goal_id=? ${playerClause} ORDER BY created_at,id`, bind, result: 'all',
    });
    return rows.map((row) => ({ ...parseJson(row.extraJson, {}), ...row, UUID: row.id, value: Number(row.value), rewardCoins: Number(row.rewardCoins) }));
  }

  async getContributionForTask(taskId) {
    const row = await this.client.query({
      sql: 'SELECT id FROM contributions WHERE task_id=? ORDER BY created_at,id LIMIT 1', bind: [taskId], result: 'one',
    });
    if (!row) return null;
    const result = await this.client.query({
      sql: `SELECT id,player_id AS parent,goal_id AS goalUUID,task_id AS taskUUID,todo_id AS todoUUID,
                   completion_event_id AS completionEventUUID,source,direction,summary,value,
                   created_at AS createdAt,completed_at AS completedAt FROM contributions WHERE id=?`,
      bind: [row.id], result: 'one',
    });
    return { ...result, UUID: result.id, value: Number(result.value) };
  }

  async recordContribution(record, { operationId }) {
    const timestamp = this.now().toISOString();
    const id = String(record.UUID || `contribution:${operationId}`);
    await this.client.executeAtomic({
      commandId: `contribution:${operationId}`,
      label: 'contribution-record',
      statements: [{
        sql: `INSERT INTO contributions(
                id,player_id,goal_id,task_id,todo_id,completion_event_id,source,direction,summary,value,
                reward_band,reward_rarity,reward_coins,player_name_snapshot,goal_name_snapshot,task_name_snapshot,
                created_at,completed_at,in_game_timestamp,extra_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(completion_event_id) DO NOTHING`,
        bind: [id, record.parent || null, record.goalUUID || record.projectId || null, record.taskUUID || null, record.todoUUID || null,
          record.completionEventUUID || null, record.source || 'manual', record.direction || null,
          record.summary || record.taskName || null, Number(record.value) || 0,
          record.rewardBand || null, record.rewardRarity || null, Math.max(0, Math.trunc(Number(record.rewardCoins) || 0)),
          record.playerNameSnapshot || null, record.goalNameSnapshot || null, record.taskName || null,
          record.createdAt || timestamp, record.completedAt || timestamp,
          Number.isFinite(Number(record.inGameTimestamp)) ? Math.trunc(Number(record.inGameTimestamp)) : null,
          stableJson(record.extra || {})], result: 'changes',
      }],
    });
    if (record.completionEventUUID) {
      return this.client.query({
        sql: `SELECT id AS UUID,player_id AS parent,goal_id AS goalUUID,task_id AS taskUUID,
                     completion_event_id AS completionEventUUID,value,created_at AS createdAt
              FROM contributions WHERE completion_event_id=?`, bind: [record.completionEventUUID], result: 'one',
      });
    }
    return this.getContributionForTask(record.taskUUID);
  }

  async seedSpecialEvents({ operationId = 'seed-special-events' } = {}) {
    const timestamp = this.now().toISOString();
    const statements = SPECIAL_EVENTS.map(([id, name, specialKind, maxBonusPct, accentColor]) => ({
      sql: `INSERT INTO custom_events(
              id,owner_player_id,event_type,special_kind,name,description,max_bonus_pct,accent_color,created_at,updated_at,extra_json
            ) VALUES(NULLIF(?,''),NULL,'special',?,?,?, ?,?,?,?,'{}')
            ON CONFLICT(id) DO UPDATE SET
              event_type='special',special_kind=excluded.special_kind,name=excluded.name,
              max_bonus_pct=excluded.max_bonus_pct,accent_color=COALESCE(custom_events.accent_color,excluded.accent_color),
              updated_at=excluded.updated_at`,
      bind: [id, specialKind, name, `System event: ${name}`, maxBonusPct, accentColor, timestamp, timestamp], result: 'changes',
    }));
    return this.client.executeAtomic({ commandId: `events:${operationId}`, label: 'special-events-seed', statements });
  }
}

export default SqliteEventsRepository;
