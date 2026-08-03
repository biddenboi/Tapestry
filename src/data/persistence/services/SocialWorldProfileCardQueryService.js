import { DAY } from '../../../domain/constants.js';
import { buildProfilePresenceCard } from '../../../domain/social-world/ProfilePresenceCard.js';
import { resolveProfileVisibility } from '../../../domain/social-world/ProfileVisibility.js';
import {
  CAST_ROLE,
  PRESENCE_STATE,
  SEMANTIC_LOCATION,
} from '../../../domain/social-world/SocialWorldContracts.js';
import { deserializeProfilePictureValue } from '../profilePictureValue.js';
import {
  hydrateRankProjection,
  visibleRatingProjectionAtIGTSql,
} from './RankVisibilityProjection.js';

function asId(value) {
  return value == null ? '' : String(value);
}

function parseJson(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); } catch { return null; }
}

export class SocialWorldProfileCardQueryService {
  constructor({
    residencyService,
    presenceQueryService,
    client,
    encounterService = null,
    profileContextProjectionService = null,
  } = {}) {
    if (!residencyService || !presenceQueryService || !client?.query) {
      throw new Error('SocialWorldProfileCardQueryService requires residency, presence, and SQLite query services.');
    }
    this.residencyService = residencyService;
    this.presenceQueryService = presenceQueryService;
    this.client = client;
    this.encounterService = encounterService;
    this.profileContextProjectionService = profileContextProjectionService;
  }

  async getProfileCard({ viewerId, profileId, viewerIGT, nowMs = Date.now() } = {}) {
    const viewer = asId(viewerId);
    const subject = asId(profileId);
    if (!viewer || !subject) return null;
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    const residency = await this.residencyService.getResidency({ viewerId: viewer, viewerIGT: cursor });
    if (!residency) return null;
    const dynamic = residency.dynamic.find((entry) => asId(entry.subjectId) === subject);
    const isFriend = residency.friendIds.includes(subject);
    const role = subject === viewer
      ? CAST_ROLE.self
      : isFriend
        ? CAST_ROLE.friend
        : dynamic?.role || null;
    const access = resolveProfileVisibility({
      viewerId: viewer,
      profileId: subject,
      friendIds: residency.friendIds,
      dynamicProfileIds: residency.dynamic.map((entry) => entry.subjectId),
      friendCount: residency.friendCount,
    });
    // Apply the visibility policy before any subject-detail query.
    if (!role || access.tier === 'outside') return null;

    const identity = await this._identity(subject, cursor);
    if (!identity) return null;
    const contextPromise = this.profileContextProjectionService?.getProjection({
      viewerId: viewer,
      subjectId: subject,
      relationshipTier: access.tier,
      viewerIGT: cursor,
    }) || null;
    if (subject !== viewer) {
      const [presence, context] = await Promise.all([
        this.presenceQueryService.getProfilePresence({
          profileId: subject,
          viewerIGT: cursor,
          isActiveProfile: false,
          nowMs,
        }),
        contextPromise,
      ]);
      const activityLabel = await this._activityLabel(subject, presence, { allowExact: false });
      return buildProfilePresenceCard({
        identity,
        role,
        access,
        presence,
        activityLabel,
        today: null,
        past: [],
        thread: null,
        next: [],
        changeMemory: null,
        context,
        viewerIGT: cursor,
      });
    }
    const dayIndex = Math.floor(cursor / DAY);
    const dayStart = dayIndex * DAY;
    const recentStart = Math.max(0, cursor - (7 * DAY));
    const pastStart = Math.max(0, cursor - (14 * DAY));
    const [presence, today, past, taskThread, upcoming, changeMemory, trajectory, context] = await Promise.all([
      this.presenceQueryService.getProfilePresence({
        profileId: subject,
        viewerIGT: cursor,
        isActiveProfile: subject === viewer,
        nowMs,
      }),
      this._today(subject, dayStart, cursor),
      this._past(subject, pastStart, cursor),
      this._thread(subject, recentStart, cursor),
      this._next(subject, cursor),
      this.encounterService?.getSinceLastSaw({
        viewerId: viewer,
        subjectId: subject,
        viewerIGT: cursor,
      }) || null,
      this.encounterService?.getTrajectory({
        viewerId: viewer,
        subjectId: subject,
        viewerIGT: cursor,
      }) || null,
      contextPromise,
    ]);
    const activityLabel = await this._activityLabel(subject, presence, { allowExact: true });
    return buildProfilePresenceCard({
      identity,
      role,
      access,
      presence,
      activityLabel,
      today,
      past,
      thread: trajectory?.strongestThread || taskThread,
      next: [...new Map([
        ...(trajectory?.next || []),
        ...upcoming,
      ].map((entry) => [`${entry.type}:${entry.id}`, entry])).values()],
      changeMemory,
      context,
      viewerIGT: cursor,
    });
  }

  async _identity(profileId, viewerIGT) {
    const row = await this.client.query({
      sql: `SELECT p.id AS profileId,p.username,p.profile_picture AS profilePicture,p.elo,
                   ${visibleRatingProjectionAtIGTSql('p.id')} AS ratingResultJson,
                   (SELECT pt.title_id FROM player_titles pt
                    WHERE pt.player_id=p.id AND pt.active=1 ORDER BY pt.title_id LIMIT 1) AS title,
                   (SELECT pc.value_json FROM player_cosmetics pc
                    WHERE pc.player_id=p.id AND pc.slot IN ('profileFrame','cardFrame','frame')
                    ORDER BY CASE pc.slot WHEN 'profileFrame' THEN 0 WHEN 'cardFrame' THEN 1 ELSE 2 END
                    LIMIT 1) AS frameJson,
                   (SELECT pc.value_json FROM player_cosmetics pc
                    WHERE pc.player_id=p.id AND pc.slot='theme' LIMIT 1) AS themeJson
            FROM players p WHERE p.id=? LIMIT 1`,
      bind: [viewerIGT, profileId],
      result: 'one',
    });
    return row ? {
      ...hydrateRankProjection(row),
      profilePicture: deserializeProfilePictureValue(row.profilePicture),
      frame: parseJson(row.frameJson),
      theme: parseJson(row.themeJson) || 'minimalist',
    } : null;
  }

  async _today(profileId, dayStart, viewerIGT) {
    const row = await this.client.query({
      sql: `SELECT COUNT(*) AS tasks,CAST(COALESCE(SUM(
                     CASE WHEN points_base>0 OR points=0 THEN points_base ELSE points END
                   ),0) AS INTEGER) AS points,
                   COALESCE(SUM(actual_duration_ms),0) AS activeMs
            FROM tasks
            WHERE player_id=? AND completed_at IS NOT NULL
              AND completed_in_game_timestamp IS NOT NULL
              AND completed_in_game_timestamp>=?
              AND completed_in_game_timestamp<=?`,
      bind: [profileId, dayStart, viewerIGT],
      result: 'one',
    });
    return {
      tasks: Number(row?.tasks || 0),
      points: Math.max(0, Math.floor(Number(row?.points) || 0)),
      activeMs: Number(row?.activeMs || 0),
    };
  }

  async _thread(profileId, recentStart, viewerIGT) {
    const row = await this.client.query({
      sql: `SELECT p.id AS projectId,p.name AS label,COUNT(t.id) AS evidenceCount,
                   MAX(t.completed_in_game_timestamp) AS lastEvidenceIGT
            FROM projects p
            JOIN tasks t ON t.project_id=p.id AND t.player_id=p.player_id
            WHERE p.player_id=? AND p.completed_at IS NULL AND p.archived_at IS NULL
              AND COALESCE(p.status,'active') NOT IN ('complete','completed','closed','archived')
              AND t.completed_at IS NOT NULL
              AND t.completed_in_game_timestamp>=?
              AND t.completed_in_game_timestamp<=?
            GROUP BY p.id,p.name
            HAVING COUNT(t.id)>=2
            ORDER BY evidenceCount DESC,lastEvidenceIGT DESC,p.id
            LIMIT 1`,
      bind: [profileId, recentStart, viewerIGT],
      result: 'one',
    });
    return row ? {
      projectId: row.projectId,
      label: row.label,
      evidenceCount: Number(row.evidenceCount),
    } : null;
  }

  async _past(profileId, recentStart, viewerIGT) {
    const rows = await this.client.query({
      sql: `SELECT t.id,t.name AS label,t.completed_in_game_timestamp AS completedIGT,
                   CAST(CASE
                     WHEN t.points_base>0 OR t.points=0 THEN t.points_base
                     ELSE t.points
                   END AS INTEGER) AS basePoints,t.actual_duration_ms AS activeMs,
                   t.project_id AS projectId,p.name AS projectLabel
            FROM tasks t
            LEFT JOIN projects p ON p.id=t.project_id
            WHERE t.player_id=? AND t.completed_at IS NOT NULL
              AND t.completed_in_game_timestamp IS NOT NULL
              AND t.completed_in_game_timestamp>=?
              AND t.completed_in_game_timestamp<=?
            ORDER BY t.completed_in_game_timestamp DESC,t.completed_at DESC,t.id
            LIMIT 4`,
      bind: [profileId, recentStart, viewerIGT],
      result: 'all',
    });
    return rows.map((row) => ({
      type: 'task',
      id: row.id,
      label: row.label,
      completedIGT: Number(row.completedIGT),
      basePoints: Math.max(0, Math.floor(Number(row.basePoints) || 0)),
      activeMs: Number(row.activeMs || 0),
      projectId: row.projectId || null,
      projectLabel: row.projectLabel || null,
    }));
  }

  async _next(profileId, viewerIGT) {
    const rows = await this.client.query({
      sql: `SELECT type,id,label,dueAt,projectId,projectLabel FROM (
              SELECT 'todo' AS type,td.id,td.name AS label,td.due_at AS dueAt,
                     td.project_id AS projectId,p.name AS projectLabel,td.created_at AS createdAt
              FROM todos td LEFT JOIN projects p ON p.id=td.project_id
              WHERE td.player_id=? AND td.in_game_timestamp<=?
                AND td.due_at IS NOT NULL AND td.due_at<>''
              UNION ALL
              SELECT 'reminder' AS type,r.id,r.title AS label,
                     COALESCE(NULLIF(r.snoozed_until,''),r.remind_at) AS dueAt,
                     NULL AS projectId,NULL AS projectLabel,r.created_at AS createdAt
              FROM reminders r
              WHERE r.player_id=? AND r.in_game_timestamp<=?
                AND r.completed_at IS NULL AND r.dismissed_at IS NULL
            ) commitments
            ORDER BY CASE WHEN dueAt IS NULL OR dueAt='' THEN 1 ELSE 0 END,dueAt,createdAt,id
            LIMIT 4`,
      bind: [profileId, viewerIGT, profileId, viewerIGT],
      result: 'all',
    });
    return rows.map((row) => ({
      type: row.type,
      id: row.id,
      label: row.label,
      dueAt: row.dueAt || null,
      projectId: row.projectId || null,
      projectLabel: row.projectLabel || null,
      explicitCommitment: true,
    }));
  }

  async _activityLabel(profileId, presence, { allowExact = false } = {}) {
    if (![PRESENCE_STATE.current, PRESENCE_STATE.projected].includes(presence?.state)) {
      return presence?.presentation?.primary || 'No current activity';
    }
    if (
      presence.location === SEMANTIC_LOCATION.taskSession
      && presence.sourceId
      && presence.visibilityPolicy === 'task'
      && allowExact
    ) {
      const row = await this.client.query({
        sql: `SELECT label FROM (
                SELECT name AS label,0 AS priority FROM todos WHERE id=? AND player_id=?
                UNION ALL
                SELECT name AS label,1 AS priority FROM tasks WHERE id=? AND player_id=?
              ) source ORDER BY priority LIMIT 1`,
        bind: [presence.sourceId, profileId, presence.sourceId, profileId],
        result: 'one',
      });
      return row?.label ? `Working on ${row.label}` : 'Task in progress';
    }
    const labels = {
      [SEMANTIC_LOCATION.planning]: 'Reviewing the task plan',
      [SEMANTIC_LOCATION.taskSession]: 'Task in progress',
      [SEMANTIC_LOCATION.dojo]: 'Focused Dojo session',
      [SEMANTIC_LOCATION.matchArena]: 'Match in progress',
      [SEMANTIC_LOCATION.marketplace]: 'Browsing the marketplace',
      [SEMANTIC_LOCATION.commons]: 'Present in the Commons',
    };
    return labels[presence.location] || presence.presentation?.primary || 'Active now';
  }
}

export default SocialWorldProfileCardQueryService;
