import { bumpSourceVersionStatements, readSourceVersions } from '../sqlite/sourceVersionUtils.js';
import { deserializeProfilePictureValue } from '../profilePictureValue.js';

export const DOJO_STANDINGS_UPDATED_EVENT = 'tapestry:dojo-standings-updated';
const ROW_SELECT = `
SELECT d.session_id AS sessionId,d.player_id AS playerId,
       d.presence_interval_id AS presenceIntervalId,d.started_igt AS startedIGT,
       d.ended_igt AS endedIGT,d.focused_ms AS focusedMs,d.points,d.task_count AS taskCount,
       d.status,d.boundary_claim AS boundaryClaim,d.last_activity_at AS lastActivityAt,
       r.position,r.source_version AS rankSourceVersion,r.computed_at AS computedAt,
       p.username,p.profile_picture AS profilePicture,p.elo,
       (SELECT pt.title_id FROM player_titles pt
        WHERE pt.player_id=p.id AND pt.active=1 ORDER BY pt.title_id LIMIT 1) AS title,
       (SELECT pc.value_json FROM player_cosmetics pc
        WHERE pc.player_id=p.id AND pc.slot IN ('profileFrame','cardFrame','frame')
        ORDER BY CASE pc.slot WHEN 'profileFrame' THEN 0 WHEN 'cardFrame' THEN 1 ELSE 2 END LIMIT 1) AS frameJson,
       (SELECT pc.value_json FROM player_cosmetics pc
        WHERE pc.player_id=p.id AND pc.slot='theme' LIMIT 1) AS themeJson
FROM dojo_session_rollups d
LEFT JOIN dojo_session_ranks r ON r.session_id=d.session_id
JOIN players p ON p.id=d.player_id
`.trim();

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function cleanId(value) {
  const id = String(value || '').trim();
  return id || null;
}

function parseJson(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hydrateRow(row) {
  if (!row) return null;
  return Object.freeze({
    sessionId: String(row.sessionId),
    playerId: String(row.playerId),
    presenceIntervalId: row.presenceIntervalId || null,
    startedIGT: row.startedIGT == null ? null : Number(row.startedIGT),
    endedIGT: row.endedIGT == null ? null : Number(row.endedIGT),
    focusedMs: Number(row.focusedMs || 0),
    points: Math.floor(Number(row.points || 0)),
    taskCount: Number(row.taskCount || 0),
    status: row.status,
    boundaryClaim: row.boundaryClaim,
    lastActivityAt: row.lastActivityAt || null,
    position: row.position == null ? null : Number(row.position),
    rankSourceVersion: row.rankSourceVersion == null ? null : Number(row.rankSourceVersion),
    computedAt: row.computedAt || null,
    identity: Object.freeze({
      profileId: String(row.playerId),
      username: row.username || 'Unknown profile',
      profilePicture: deserializeProfilePictureValue(row.profilePicture),
      elo: Number(row.elo || 0),
      title: row.title || null,
      frame: parseJson(row.frameJson),
      theme: parseJson(row.themeJson) || 'minimalist',
    }),
  });
}

function defaultScheduler(callback) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: 1000 });
  }
  return setTimeout(callback, 0);
}

function announceStandingsUpdate() {
  if (typeof window === 'undefined'
    || typeof window.dispatchEvent !== 'function'
    || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DOJO_STANDINGS_UPDATED_EVENT));
}

export class DojoStandingsService {
  constructor({ client, now = () => new Date(), schedule = defaultScheduler } = {}) {
    if (!client?.query || !client?.executeAtomic) {
      throw new Error('DojoStandingsService requires a SQLite client.');
    }
    this.client = client;
    this.now = now;
    this.schedule = schedule;
    this.materializationPromise = null;
    this.materializationScheduled = false;
  }

  async recordTaskCompletion({ task, event } = {}) {
    const sessionId = cleanId(task?.dojoSessionUUID);
    const playerId = cleanId(task?.parent);
    const taskId = cleanId(task?.UUID);
    if (!sessionId || !playerId || !taskId || task?.source !== 'dojo') return { updated: false };
    const at = task.completedAt || event?.completedAt || this.now().toISOString();
    const result = await this.client.executeAtomic({
      commandId: `dojo-rollup-task:${taskId}`,
      label: 'dojo-rollup-task-completion',
      statements: [{
        sql: `INSERT INTO dojo_session_rollups(
                session_id,player_id,presence_interval_id,started_igt,ended_igt,focused_ms,
                points,task_count,status,boundary_claim,last_activity_at,source_version
              ) VALUES(
                ?,?,NULL,NULL,NULL,0,
                CASE WHEN EXISTS(
                  SELECT 1 FROM tasks WHERE source='dojo'
                    AND json_extract(extra_json,'$.dojoSessionUUID')=?
                ) THEN (
                  SELECT COALESCE(SUM(
                    CASE
                      WHEN points_base>0 OR points=0 THEN points_base
                      ELSE points
                    END
                  ),0) FROM tasks WHERE source='dojo'
                    AND json_extract(extra_json,'$.dojoSessionUUID')=?
                ) ELSE ? END,
                CASE WHEN EXISTS(
                  SELECT 1 FROM tasks WHERE source='dojo'
                    AND json_extract(extra_json,'$.dojoSessionUUID')=?
                ) THEN (
                  SELECT COUNT(*) FROM tasks WHERE source='dojo'
                    AND json_extract(extra_json,'$.dojoSessionUUID')=?
                ) ELSE 1 END,
                'complete','partial',?,1
              )
              ON CONFLICT(session_id) DO UPDATE SET
                player_id=excluded.player_id,
                points=excluded.points,
                task_count=excluded.task_count,
                status=CASE
                  WHEN dojo_session_rollups.boundary_claim='exact' AND dojo_session_rollups.ended_igt IS NULL
                    THEN 'provisional'
                  ELSE 'complete'
                END,
                last_activity_at=MAX(COALESCE(dojo_session_rollups.last_activity_at,''),excluded.last_activity_at),
                source_version=dojo_session_rollups.source_version+1`,
        bind: [
          sessionId, playerId,
          sessionId, sessionId, Math.max(0, Math.floor(Number(task.pointsBase ?? task.points) || 0)),
          sessionId, sessionId,
          at,
        ],
        result: 'changes',
      }, ...bumpSourceVersionStatements(['dojoStandings', 'leaderboards'], at)],
    });
    if (!result.duplicate) this.scheduleRankMaterialization();
    return { updated: !result.duplicate, duplicate: result.duplicate };
  }

  async getStandings({ playerId, currentSessionId = null, topLimit = 10, aroundRadius = 2 } = {}) {
    const ownerId = cleanId(playerId);
    if (!ownerId) return { current: null, around: [], top: [], updating: false, sourceVersion: 0, rankVersion: 0 };
    const limit = boundedInteger(topLimit, 10, 1, 25);
    const radius = boundedInteger(aroundRadius, 2, 1, 5);
    const currentId = cleanId(currentSessionId) || '';
    const [versions, currentRow, aroundRows, topRows] = await Promise.all([
      readSourceVersions(this.client, ['dojoStandings', 'dojoRanks']),
      this.client.query({
        sql: `${ROW_SELECT}
              WHERE d.player_id=?
              ORDER BY CASE WHEN d.session_id=? THEN 0 WHEN d.status='provisional' THEN 1 ELSE 2 END,
                       d.started_igt DESC,d.session_id
              LIMIT 1`,
        bind: [ownerId, currentId],
        result: 'one',
      }),
      this.client.query({
        sql: `WITH mine AS (
                SELECT r.position
                FROM dojo_session_ranks r
                JOIN dojo_session_rollups d ON d.session_id=r.session_id
                WHERE d.player_id=?
                ORDER BY CASE WHEN d.session_id=? THEN 0 WHEN d.status='provisional' THEN 1 ELSE 2 END,
                         d.started_igt DESC,d.session_id
                LIMIT 1
              )
              ${ROW_SELECT}
              CROSS JOIN mine
              WHERE r.position BETWEEN MAX(1,mine.position-?) AND mine.position+?
              ORDER BY r.position
              LIMIT ?`,
        bind: [ownerId, currentId, radius, radius, (radius * 2) + 1],
        result: 'all',
      }),
      this.client.query({
        sql: `${ROW_SELECT} WHERE r.position IS NOT NULL ORDER BY r.position LIMIT ?`,
        bind: [limit],
        result: 'all',
      }),
    ]);
    const sourceVersion = Number(versions.dojoStandings || 0);
    const rankVersion = Number(versions.dojoRanks || 0);
    const updating = rankVersion < sourceVersion;
    if (updating) this.scheduleRankMaterialization();
    return Object.freeze({
      current: hydrateRow(currentRow),
      around: Object.freeze(aroundRows.map(hydrateRow)),
      top: Object.freeze(topRows.map(hydrateRow)),
      updating,
      sourceVersion,
      rankVersion,
    });
  }

  scheduleRankMaterialization() {
    if (this.materializationScheduled || this.materializationPromise) return;
    this.materializationScheduled = true;
    this.schedule(() => {
      this.materializationScheduled = false;
      this.materializeRanks().catch((error) => (
        console.warn('[DojoStandings] rank materialization failed:', error)
      ));
    });
  }

  async materializeRanks() {
    if (this.materializationPromise) return this.materializationPromise;
    this.materializationPromise = this._materializeRanks().finally(() => {
      this.materializationPromise = null;
    });
    return this.materializationPromise;
  }

  async _materializeRanks() {
    const versions = await readSourceVersions(this.client, ['dojoStandings', 'dojoRanks']);
    const sourceVersion = Number(versions.dojoStandings || 0);
    if (Number(versions.dojoRanks || 0) >= sourceVersion) {
      return { updated: false, sourceVersion };
    }
    const at = this.now().toISOString();
    const result = await this.client.executeAtomic({
      commandId: `dojo-rank-materialize:${sourceVersion}`,
      label: 'dojo-rank-materialization',
      statements: [
        { sql: 'DELETE FROM dojo_session_ranks', result: 'changes' },
        {
          sql: `INSERT INTO dojo_session_ranks(session_id,position,source_version,computed_at)
                SELECT session_id,
                       ROW_NUMBER() OVER (ORDER BY points DESC,ended_igt DESC,session_id),
                       ?,?
                FROM dojo_session_rollups
                ORDER BY points DESC,ended_igt DESC,session_id`,
          bind: [sourceVersion, at],
          result: 'changes',
        },
        {
          sql: `UPDATE source_versions SET version=?,updated_at=? WHERE source_key='dojoRanks'`,
          bind: [sourceVersion, at],
          result: 'changes',
        },
      ],
    });
    announceStandingsUpdate();
    return { updated: !result.duplicate, sourceVersion };
  }
}

export default DojoStandingsService;
