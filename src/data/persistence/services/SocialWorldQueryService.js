import { projectPresence } from '../../../domain/social-world/PresenceProjection.js';
import { buildPresencePresentation } from '../../../domain/social-world/PresencePresentation.js';

export class SocialWorldQueryService {
  constructor({ repository, client, now = () => new Date() } = {}) {
    if (!repository || !client?.query) {
      throw new Error('SocialWorldQueryService requires a presence repository and SQLite client.');
    }
    this.repository = repository;
    this.client = client;
    this.now = now;
  }

  async getProfilePresence({
    profileId,
    viewerIGT,
    isActiveProfile = false,
    nowMs = this.now().getTime(),
  } = {}) {
    if (!profileId) return null;
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    const [intervals, traces] = await Promise.all([
      this.repository.listIntervalsForPlayer(profileId, { throughIGT: cursor, limit: 64 }),
      this._meaningfulTraces(profileId, cursor),
    ]);
    const projection = projectPresence({
      intervals,
      traces,
      viewerIGT: cursor,
      isActiveProfile,
      nowMs,
    });
    return Object.freeze({
      ...projection,
      presentation: buildPresencePresentation(projection, cursor),
    });
  }

  async getProfilesPresence({
    profileIds = [],
    activeProfileId = null,
    viewerIGT,
    nowMs = this.now().getTime(),
  } = {}) {
    const ids = [...new Set(profileIds.filter(Boolean).map(String))];
    if (!ids.length) return new Map();
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    const [intervals, traces] = await Promise.all([
      this.repository.listIntervalsForPlayers(ids, { throughIGT: cursor, limitPerPlayer: 64 }),
      this._meaningfulTracesForProfiles(ids, cursor),
    ]);
    const intervalsByProfile = new Map(ids.map((id) => [id, []]));
    const tracesByProfile = new Map(ids.map((id) => [id, []]));
    for (const interval of intervals) intervalsByProfile.get(String(interval.playerId))?.push(interval);
    for (const trace of traces) tracesByProfile.get(String(trace.playerId))?.push(trace);
    return new Map(ids.map((profileId) => {
      const projection = projectPresence({
        intervals: intervalsByProfile.get(profileId),
        traces: tracesByProfile.get(profileId),
        viewerIGT: cursor,
        isActiveProfile: profileId === String(activeProfileId || ''),
        nowMs,
      });
      return [profileId, Object.freeze({
        ...projection,
        presentation: buildPresencePresentation(projection, cursor),
      })];
    }));
  }

  async _meaningfulTraces(profileId, viewerIGT) {
    const rows = await this.client.query({
      sql: `SELECT kind,id,location,inGameTimestamp FROM (
              SELECT 'task-session-completed' AS kind,t.id AS id,
                     CASE WHEN t.source='dojo'
                               OR json_extract(t.extra_json,'$.dojoSessionUUID') IS NOT NULL
                          THEN 'dojo' ELSE 'task-session' END AS location,
                     t.completed_in_game_timestamp AS inGameTimestamp
              FROM tasks t
              WHERE t.player_id=? AND t.completed_at IS NOT NULL
                AND t.completed_in_game_timestamp IS NOT NULL
                AND t.completed_in_game_timestamp<=?
              UNION ALL
              SELECT 'match-concluded' AS kind,m.id AS id,'match-arena' AS location,
                     m.completed_in_game_timestamp AS inGameTimestamp
              FROM matches m
              WHERE m.status='complete'
                AND (m.owner_player_id=? OR EXISTS(
                  SELECT 1 FROM match_participants mp WHERE mp.match_id=m.id AND mp.player_id=?
                ))
                AND m.completed_in_game_timestamp IS NOT NULL
                AND m.completed_in_game_timestamp<=?
            ) facts
            ORDER BY inGameTimestamp DESC,id
            LIMIT 64`,
      bind: [profileId, viewerIGT, profileId, profileId, viewerIGT],
      result: 'all',
    });
    return rows.map((row) => ({
      kind: row.kind,
      id: row.id,
      location: row.location,
      inGameTimestamp: Number(row.inGameTimestamp),
    }));
  }

  async _meaningfulTracesForProfiles(profileIds, viewerIGT) {
    const placeholders = profileIds.map(() => '?').join(',');
    const rows = await this.client.query({
      sql: `WITH facts AS (
              SELECT t.player_id AS playerId,'task-session-completed' AS kind,t.id,
                     CASE WHEN t.source='dojo'
                               OR json_extract(t.extra_json,'$.dojoSessionUUID') IS NOT NULL
                          THEN 'dojo' ELSE 'task-session' END AS location,
                     t.completed_in_game_timestamp AS inGameTimestamp
              FROM tasks t
              WHERE t.player_id IN (${placeholders}) AND t.completed_at IS NOT NULL
                AND t.completed_in_game_timestamp IS NOT NULL
                AND t.completed_in_game_timestamp<=?
              UNION
              SELECT mp.player_id AS playerId,'match-concluded' AS kind,m.id,
                     'match-arena' AS location,m.completed_in_game_timestamp AS inGameTimestamp
              FROM matches m
              JOIN match_participants mp ON mp.match_id=m.id
              WHERE mp.player_id IN (${placeholders}) AND m.status='complete'
                AND m.completed_in_game_timestamp IS NOT NULL
                AND m.completed_in_game_timestamp<=?
              UNION
              SELECT m.owner_player_id AS playerId,'match-concluded' AS kind,m.id,
                     'match-arena' AS location,m.completed_in_game_timestamp AS inGameTimestamp
              FROM matches m
              WHERE m.owner_player_id IN (${placeholders}) AND m.status='complete'
                AND m.completed_in_game_timestamp IS NOT NULL
                AND m.completed_in_game_timestamp<=?
            ), ranked AS (
              SELECT facts.*,
                     ROW_NUMBER() OVER (
                       PARTITION BY playerId ORDER BY inGameTimestamp DESC,id
                     ) AS traceRank
              FROM facts
            )
            SELECT playerId,kind,id,location,inGameTimestamp
            FROM ranked WHERE traceRank<=64
            ORDER BY playerId,inGameTimestamp DESC,id`,
      bind: [
        ...profileIds, viewerIGT,
        ...profileIds, viewerIGT,
        ...profileIds, viewerIGT,
      ],
      result: 'all',
    });
    return rows.map((row) => ({
      playerId: String(row.playerId),
      kind: row.kind,
      id: row.id,
      location: row.location,
      inGameTimestamp: Number(row.inGameTimestamp),
    }));
  }
}

export default SocialWorldQueryService;
