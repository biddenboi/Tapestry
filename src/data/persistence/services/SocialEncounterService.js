import { buildTrajectory } from '../../../domain/social-world/ProfileTrajectory.js';
import { stableSocialHash } from '../../../domain/social-world/SocialActivityFacts.js';
import { bumpSourceVersionStatements } from '../sqlite/sourceVersionUtils.js';
import { hydrateSocialActivityFact } from './SocialActivityIndexService.js';

const CATEGORY_ORDER = Object.freeze([
  'Tasks', 'Goals', 'Rank', 'Matches', 'Dojo', 'Commitments', 'Location',
]);

const SURFACES = new Set([
  'profile-drawer', 'since-last-saw', 'tavern-roster', 'profile-daybook',
]);

function asId(value) {
  return value == null ? '' : String(value);
}

function encounterModel(row) {
  return row ? Object.freeze({
    id: row.id,
    surface: row.surface,
    viewerIGT: Number(row.viewerIGT),
    visibleFactCount: Number(row.visibleFactCount || 0),
    encounteredAt: row.encounteredAt,
  }) : null;
}

function changeModel(row) {
  const fact = hydrateSocialActivityFact(row);
  return Object.freeze({
    ...fact,
    changeState: row.changeState,
    priorVersionToken: row.priorVersionToken || null,
    encounterId: row.encounterId || null,
  });
}

export class SocialEncounterService {
  constructor({ client, activityIndex, now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic || !activityIndex) {
      throw new Error('SocialEncounterService requires SQLite and social activity index services.');
    }
    this.client = client;
    this.activityIndex = activityIndex;
    this.now = now;
  }

  async getSinceLastSaw({ viewerId, subjectId, viewerIGT, limit = 24 } = {}) {
    const viewer = asId(viewerId);
    const subject = asId(subjectId);
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    if (!viewer || !subject || viewer === subject) return Object.freeze({
      count: 0,
      preview: Object.freeze([]),
      groups: Object.freeze([]),
      facts: Object.freeze([]),
      previousEncounter: null,
    });
    await this.activityIndex.ensureSubjectIndexed({ subjectId: subject });
    const [rows, previousEncounter] = await Promise.all([
      this.client.query({
        sql: `SELECT a.subject_player_id AS subjectId,a.event_kind AS kind,a.event_id AS id,
                     a.occurred_igt AS occurredIGT,a.category,a.label,a.project_id AS projectId,
                     a.project_name AS projectName,a.version_token AS versionToken,a.visible_json AS visibleJson,
                     r.seen_version_token AS priorVersionToken,r.encounter_id AS encounterId,
                     CASE WHEN r.event_id IS NULL THEN 'new' ELSE 'updated' END AS changeState,
                     COUNT(*) OVER() AS totalCount
              FROM social_activity_index a
              LEFT JOIN social_event_receipts r
                ON r.viewer_player_id=? AND r.subject_player_id=a.subject_player_id
               AND r.event_kind=a.event_kind AND r.event_id=a.event_id
              WHERE a.subject_player_id=? AND a.occurred_igt<=?
                AND (r.event_id IS NULL OR r.seen_version_token<>a.version_token)
              ORDER BY a.occurred_igt DESC,a.event_kind,a.event_id LIMIT ?`,
        bind: [viewer, subject, cursor, Math.max(1, Math.min(100, Math.trunc(Number(limit) || 24)))],
        result: 'all',
      }),
      this.client.query({
        sql: `SELECT id,surface,viewer_igt AS viewerIGT,visible_fact_count AS visibleFactCount,
                     encountered_at AS encounteredAt
              FROM social_encounters WHERE viewer_player_id=? AND subject_player_id=?
              ORDER BY viewer_igt DESC,encountered_at DESC,id DESC LIMIT 1`,
        bind: [viewer, subject], result: 'one',
      }),
    ]);
    const facts = rows.map(changeModel);
    const groups = CATEGORY_ORDER.map((category) => Object.freeze({
      category,
      facts: Object.freeze(facts.filter((fact) => fact.category === category)),
    })).filter((group) => group.facts.length);
    return Object.freeze({
      count: Number(rows[0]?.totalCount || 0),
      preview: Object.freeze(facts.slice(0, 3)),
      groups: Object.freeze(groups),
      facts: Object.freeze(facts),
      previousEncounter: encounterModel(previousEncounter),
    });
  }

  async getTrajectory({ viewerId, subjectId, viewerIGT } = {}) {
    const subject = asId(subjectId);
    const viewer = asId(viewerId);
    if (!subject) return buildTrajectory({ viewerIGT });
    await this.activityIndex.ensureSubjectIndexed({ subjectId: subject });
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    const [factRows, projectRows, todoRows] = await Promise.all([
      this.client.query({
        sql: `SELECT a.subject_player_id AS subjectId,a.event_kind AS kind,a.event_id AS id,
                     a.occurred_igt AS occurredIGT,a.category,a.label,a.project_id AS projectId,
                     a.project_name AS projectName,a.version_token AS versionToken,a.visible_json AS visibleJson,
                     r.encounter_id AS encounterId,
                     CASE WHEN r.event_id IS NULL THEN 'new'
                          WHEN r.seen_version_token<>a.version_token THEN 'updated'
                          ELSE 'unchanged' END AS changeState
              FROM social_activity_index a
              LEFT JOIN social_event_receipts r
                ON r.viewer_player_id=? AND r.subject_player_id=a.subject_player_id
               AND r.event_kind=a.event_kind AND r.event_id=a.event_id
              WHERE a.subject_player_id=? AND a.occurred_igt<=?
              ORDER BY a.occurred_igt DESC,a.event_kind,a.event_id LIMIT 96`,
        bind: [viewer, subject, cursor], result: 'all',
      }),
      this.client.query({
        sql: `SELECT id,name,status,completed_at AS completedAt,archived_at AS archivedAt
              FROM projects WHERE player_id=? AND in_game_timestamp<=? ORDER BY in_game_timestamp,id`,
        bind: [subject, cursor], result: 'all',
      }),
      this.client.query({
        sql: `SELECT td.id,td.name AS label,td.due_at AS dueAt,td.project_id AS projectId,
                     p.name AS projectLabel
              FROM todos td LEFT JOIN projects p ON p.id=td.project_id
              WHERE td.player_id=? AND td.in_game_timestamp<=?
                AND td.due_at IS NOT NULL AND td.due_at<>''
              ORDER BY td.due_at,td.created_at,td.id LIMIT 8`,
        bind: [subject, cursor], result: 'all',
      }),
    ]);
    const facts = factRows.map((row) => ({
      ...hydrateSocialActivityFact(row),
      encounterId: row.encounterId || null,
      changeState: row.changeState,
    }));
    const projectsById = new Map(projectRows.map((project) => [String(project.id), project]));
    return buildTrajectory({
      facts,
      projectsById,
      openTodos: todoRows.map((todo) => ({ ...todo, explicitCommitment: true })),
      rankChanges: facts.filter((fact) => fact.kind === 'rank'),
      viewerIGT: cursor,
    });
  }

  async recordEncounter({
    viewerId,
    subjectId,
    surface = 'profile-drawer',
    viewerIGT,
    visibleFacts = [],
    operationId,
    encounteredAt = this.now(),
  } = {}) {
    const viewer = asId(viewerId);
    const subject = asId(subjectId);
    if (!viewer || !subject || viewer === subject) {
      return { recorded: false, duplicate: false, reason: 'self-or-missing-subject', invalidatedDomains: [] };
    }
    if (!operationId || !SURFACES.has(surface)) {
      throw new Error('A meaningful social encounter requires a supported surface and operation ID.');
    }
    await this.activityIndex.ensureSubjectIndexed({ subjectId: subject });
    const cursor = Math.max(0, Math.trunc(Number(viewerIGT) || 0));
    const at = new Date(encounteredAt).toISOString();
    const candidates = [...new Map((visibleFacts || []).filter((fact) => (
      fact?.kind && fact?.id && fact?.versionToken
    )).map((fact) => [`${fact.kind}:${fact.id}`, fact])).values()];
    const validated = await Promise.all(candidates.map(async (fact) => {
      const exists = await this.client.query({
        sql: `SELECT COUNT(*) FROM social_activity_index
              WHERE subject_player_id=? AND event_kind=? AND event_id=?
                AND version_token=? AND occurred_igt<=?`,
        bind: [subject, fact.kind, fact.id, fact.versionToken, cursor],
        result: 'value',
      });
      return Number(exists || 0) > 0 ? fact : null;
    }));
    const facts = validated.filter(Boolean);
    const encounterId = `encounter:${stableSocialHash({ viewer, subject, surface, operationId })}`;
    const statements = [{
      sql: `INSERT INTO social_encounters(
              id,viewer_player_id,subject_player_id,surface,viewer_igt,
              visible_fact_count,operation_id,encountered_at
            ) VALUES(?,?,?,?,?,?,?,?)`,
      bind: [encounterId, viewer, subject, surface, cursor, facts.length, String(operationId), at],
      result: 'changes',
    }];
    for (const fact of facts) statements.push({
      sql: `INSERT INTO social_event_receipts(
              viewer_player_id,subject_player_id,event_kind,event_id,seen_version_token,
              seen_at_igt,encounter_id,seen_at
            )
            SELECT ?,?,event_kind,event_id,version_token,?,?,?
            FROM social_activity_index
            WHERE subject_player_id=? AND event_kind=? AND event_id=?
              AND version_token=? AND occurred_igt<=?
            ON CONFLICT(viewer_player_id,subject_player_id,event_kind,event_id) DO UPDATE SET
              seen_version_token=excluded.seen_version_token,seen_at_igt=excluded.seen_at_igt,
              encounter_id=excluded.encounter_id,seen_at=excluded.seen_at`,
      bind: [
        viewer, subject, cursor, encounterId, at,
        subject, fact.kind, fact.id, fact.versionToken, cursor,
      ],
      result: 'changes',
    });
    statements.push(...bumpSourceVersionStatements(['encounters'], at));
    const result = await this.client.executeAtomic({
      commandId: `social-encounter:${operationId}`,
      label: 'social-encounter-record',
      statements,
    });
    return {
      recorded: true,
      duplicate: result.duplicate,
      encounterId,
      visibleFactCount: facts.length,
      invalidatedDomains: ['encounters'],
    };
  }

  async clearMemories({ viewerId, subjectId = null } = {}) {
    const viewer = asId(viewerId);
    const subject = asId(subjectId);
    if (!viewer) throw new Error('Deleting encounter memories requires a viewer profile.');
    const at = this.now().toISOString();
    const filter = subject ? ' AND subject_player_id=?' : '';
    const bind = subject ? [viewer, subject] : [viewer];
    const result = await this.client.executeAtomic({
      commandId: `social-memory-delete:${viewer}:${subject || 'all'}:${at}`,
      label: 'delete-social-encounter-memories',
      statements: [
        { sql: `DELETE FROM social_event_receipts WHERE viewer_player_id=?${filter}`, bind, result: 'changes' },
        { sql: `DELETE FROM social_encounters WHERE viewer_player_id=?${filter}`, bind, result: 'changes' },
        ...bumpSourceVersionStatements(['encounters'], at),
      ],
    });
    return Object.freeze({
      deleted: result.statementResults.slice(0, 2).reduce((sum, row) => sum + Number(row?.changes || 0), 0),
      viewerId: viewer,
      subjectId: subject || null,
      invalidatedDomains: ['encounters'],
    });
  }
}

export default SocialEncounterService;
