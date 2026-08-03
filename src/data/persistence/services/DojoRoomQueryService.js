import { MAX_DOJO_ROOM_OCCUPANTS } from '../../../domain/social-world/DojoRoom.js';

function asId(value) {
  return value == null ? '' : String(value);
}

function normalizeOccupants(occupants = []) {
  const seen = new Set();
  return occupants.flatMap((occupant) => {
    const profileId = asId(occupant?.profileId);
    if (!profileId || seen.has(profileId) || seen.size >= MAX_DOJO_ROOM_OCCUPANTS) return [];
    seen.add(profileId);
    return [{
      profileId,
      sessionId: asId(occupant?.sessionId) || null,
    }];
  });
}

export class DojoRoomQueryService {
  constructor({ client } = {}) {
    if (!client?.query) throw new Error('DojoRoomQueryService requires a SQLite query client.');
    this.client = client;
  }

  async getRoomFacts({ occupants = [], viewerIGT } = {}) {
    const requested = normalizeOccupants(occupants);
    if (!requested.length) return [];
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    const rows = await this.client.query({
      sql: `WITH requested AS (
              SELECT json_extract(value,'$.profileId') AS profileId,
                     json_extract(value,'$.sessionId') AS sessionId
              FROM json_each(?)
            ), eligible_tasks AS (
              SELECT r.profileId,r.sessionId,t.id AS taskId,t.name AS taskLabel,
                     CAST(CASE
                       WHEN t.points_base>0 OR t.points=0 THEN t.points_base
                       ELSE t.points
                     END AS INTEGER) AS points,
                     COALESCE(NULLIF(t.completed_in_game_timestamp,0),t.in_game_timestamp,t.completed_in_game_timestamp,0) AS completedIGT,
                     ROW_NUMBER() OVER (
                       PARTITION BY r.profileId,r.sessionId
                       ORDER BY COALESCE(NULLIF(t.completed_in_game_timestamp,0),t.in_game_timestamp,t.completed_in_game_timestamp,0) DESC,
                                t.completed_at DESC,t.id
                     ) AS recencyRank
              FROM requested r
              JOIN tasks t ON t.player_id=r.profileId
               AND r.sessionId IS NOT NULL
               AND json_extract(t.extra_json,'$.dojoSessionUUID')=r.sessionId
               AND t.completed_at IS NOT NULL
               AND COALESCE(NULLIF(t.completed_in_game_timestamp,0),t.in_game_timestamp,t.completed_in_game_timestamp,0)<=?
            )
            SELECT r.profileId,r.sessionId,
                   COALESCE(SUM(e.points),0) AS sessionPoints,
                   MAX(CASE WHEN e.recencyRank=1 THEN e.taskLabel END) AS taskLabel,
                   MAX(CASE WHEN e.recencyRank=1 THEN e.taskId END) AS taskId,
                   MAX(CASE WHEN e.recencyRank=1 THEN e.completedIGT END) AS taskCompletedIGT
            FROM requested r
            LEFT JOIN eligible_tasks e
              ON e.profileId=r.profileId AND e.sessionId=r.sessionId
            GROUP BY r.profileId,r.sessionId
            ORDER BY r.profileId`,
      bind: [JSON.stringify(requested), cursor],
      result: 'all',
    });
    return rows.map((row) => Object.freeze({
      profileId: asId(row.profileId),
      sessionId: asId(row.sessionId) || null,
      sessionPoints: Math.max(0, Math.floor(Number(row.sessionPoints) || 0)),
      taskId: asId(row.taskId) || null,
      taskLabel: row.taskLabel ? String(row.taskLabel) : null,
      taskCompletedIGT: row.taskCompletedIGT == null ? null : Number(row.taskCompletedIGT),
    }));
  }
}

export default DojoRoomQueryService;
