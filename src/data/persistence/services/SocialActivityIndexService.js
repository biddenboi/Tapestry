import {
  canonicalizeActivityFact,
  stableSocialHash,
  stableSocialJson,
} from '../../../domain/social-world/SocialActivityFacts.js';
import {
  SOCIAL_WORLD_PERFORMANCE_OPERATION,
  measureSocialWorldOperation,
} from '../../../domain/social-world/SocialWorldPerformance.js';
import { bumpSourceVersionStatements } from '../sqlite/sourceVersionUtils.js';

const LOCATION_LABELS = Object.freeze({
  planning: 'Left Planning',
  'task-session': 'Left a Task Session',
  dojo: 'Completed a Dojo visit',
  'match-arena': 'Left the Match Arena',
  marketplace: 'Left the Marketplace',
  commons: 'Left the Commons',
});

function asId(value) {
  return value == null ? '' : String(value);
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

function outcomeLabel(result) {
  const normalized = String(result || '').toLowerCase();
  if (['win', 'won', 'winner'].includes(normalized)) return 'Match won';
  if (['loss', 'lost', 'loser'].includes(normalized)) return 'Match completed';
  return 'Match completed';
}

function goalState(row) {
  const status = String(row.status || '').toLowerCase();
  if (row.completedAt || ['complete', 'completed', 'closed', 'archived'].includes(status)) return 'completed';
  if (status === 'paused') return 'paused';
  return 'active';
}

function dirtyCommandId(subjectId, revision, facts) {
  const token = stableSocialHash(facts.map((fact) => [fact.key, fact.versionToken]));
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return `social-activity-rebuild:${subjectId}:${revision}:${token}:${nonce}`;
}

function factUpsertStatement(fact, revision, indexedAt) {
  return {
    sql: `INSERT INTO social_activity_index(
            subject_player_id,event_kind,event_id,occurred_igt,category,label,
            project_id,project_name,version_token,visible_json,rebuild_revision,indexed_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(subject_player_id,event_kind,event_id) DO UPDATE SET
            occurred_igt=excluded.occurred_igt,category=excluded.category,label=excluded.label,
            project_id=excluded.project_id,project_name=excluded.project_name,
            version_token=excluded.version_token,visible_json=excluded.visible_json,
            rebuild_revision=excluded.rebuild_revision,indexed_at=excluded.indexed_at`,
    bind: [
      fact.subjectId,
      fact.kind,
      fact.id,
      fact.occurredIGT,
      fact.category,
      fact.label,
      fact.projectId,
      fact.projectName,
      fact.versionToken,
      stableSocialJson(fact),
      revision,
      indexedAt,
    ],
    result: 'changes',
  };
}

export function hydrateSocialActivityFact(row) {
  if (!row) return null;
  const visible = parseJson(row.visibleJson, {});
  return Object.freeze({
    ...visible,
    subjectId: row.subjectId,
    kind: row.kind,
    id: row.id,
    key: `${row.kind}:${row.id}`,
    occurredIGT: Number(row.occurredIGT),
    category: row.category,
    label: row.label,
    projectId: row.projectId || null,
    projectName: row.projectName || null,
    versionToken: row.versionToken,
  });
}

export class SocialActivityIndexService {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client?.query || !client?.executeAtomic) {
      throw new Error('SocialActivityIndexService requires a SQLite client.');
    }
    this.client = client;
    this.now = now;
    this.inflight = new Map();
  }

  async ensureSubjectIndexed({ subjectId } = {}) {
    const subject = asId(subjectId);
    if (!subject) return { rebuilt: false, revision: 0, facts: [] };
    if (this.inflight.has(subject)) return this.inflight.get(subject);
    const pending = this._ensureSubjectIndexed(subject).finally(() => this.inflight.delete(subject));
    this.inflight.set(subject, pending);
    return pending;
  }

  async _ensureSubjectIndexed(subject) {
    return measureSocialWorldOperation(SOCIAL_WORLD_PERFORMANCE_OPERATION.activityRebuild, async () => {
    const status = await this.client.query({
      sql: `SELECT d.revision,s.indexed_revision AS indexedRevision
            FROM players p
            LEFT JOIN social_activity_dirty_subjects d ON d.subject_player_id=p.id
            LEFT JOIN social_activity_rebuild_state s ON s.subject_player_id=p.id
            WHERE p.id=?`,
      bind: [subject],
      result: 'one',
    });
    if (!status) return { rebuilt: false, revision: 0, facts: [] };
    if (status.revision == null && status.indexedRevision != null) {
      return { rebuilt: false, revision: Number(status.indexedRevision) };
    }
    const revision = Math.max(1, Number(status.revision || status.indexedRevision || 1));
    const facts = await this._loadAuthoritativeFacts(subject);
    const indexedAt = this.now().toISOString();
    const statements = facts.map((fact) => factUpsertStatement(fact, revision, indexedAt));
    statements.push({
      sql: 'DELETE FROM social_activity_index WHERE subject_player_id=? AND rebuild_revision<>?',
      bind: [subject, revision],
      result: 'changes',
    }, {
      sql: `INSERT INTO social_activity_rebuild_state(subject_player_id,indexed_revision,indexed_at)
            VALUES(?,?,?) ON CONFLICT(subject_player_id) DO UPDATE SET
            indexed_revision=excluded.indexed_revision,indexed_at=excluded.indexed_at`,
      bind: [subject, revision, indexedAt],
      result: 'changes',
    }, {
      sql: 'DELETE FROM social_activity_dirty_subjects WHERE subject_player_id=? AND revision=?',
      bind: [subject, revision],
      result: 'changes',
    }, ...bumpSourceVersionStatements(['socialActivity'], indexedAt));
    await this.client.executeAtomic({
      commandId: dirtyCommandId(subject, revision, facts),
      label: 'social-activity-subject-rebuild',
      statements,
    });
    return { rebuilt: true, revision, facts };
    }, { metadata: { subjectId: subject } });
  }

  async upsertFact(record, { operationId, indexedAt = this.now() } = {}) {
    const fact = canonicalizeActivityFact(record);
    if (!fact || !operationId) throw new Error('Social activity UPSERT requires one canonical fact and operation ID.');
    const at = new Date(indexedAt).toISOString();
    const state = await this.client.query({
      sql: 'SELECT indexed_revision AS revision FROM social_activity_rebuild_state WHERE subject_player_id=?',
      bind: [fact.subjectId],
      result: 'one',
    });
    const revision = Math.max(0, Number(state?.revision || 0));
    const result = await this.client.executeAtomic({
      commandId: `social-activity-fact:${operationId}`,
      label: 'social-activity-fact-upsert',
      statements: [
        factUpsertStatement(fact, revision, at),
        ...bumpSourceVersionStatements(['socialActivity'], at),
      ],
    });
    return { fact, duplicate: result.duplicate };
  }

  async listFacts({ subjectId, throughIGT = Infinity, limit = 64 } = {}) {
    const subject = asId(subjectId);
    if (!subject) return [];
    await this.ensureSubjectIndexed({ subjectId: subject });
    const cursor = Number.isFinite(Number(throughIGT)) ? Math.max(0, Math.trunc(Number(throughIGT))) : Number.MAX_SAFE_INTEGER;
    const rows = await this.client.query({
      sql: `SELECT subject_player_id AS subjectId,event_kind AS kind,event_id AS id,
                   occurred_igt AS occurredIGT,category,label,project_id AS projectId,
                   project_name AS projectName,version_token AS versionToken,visible_json AS visibleJson
            FROM social_activity_index
            WHERE subject_player_id=? AND occurred_igt<=?
            ORDER BY occurred_igt DESC,event_kind,event_id LIMIT ?`,
      bind: [subject, cursor, Math.max(1, Math.min(200, Math.trunc(Number(limit) || 64)))],
      result: 'all',
    });
    return rows.map(hydrateSocialActivityFact);
  }

  async _loadAuthoritativeFacts(subjectId) {
    const [tasks, projects, todos, matches, ranks, intervals] = await Promise.all([
      this.client.query({
        sql: `SELECT t.id,t.name AS label,t.completed_in_game_timestamp AS occurredIGT,
                     t.points,t.actual_duration_ms AS durationMs,t.project_id AS projectId,p.name AS projectName
              FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
              WHERE t.player_id=? AND t.completed_at IS NOT NULL
              ORDER BY occurredIGT,t.id`,
        bind: [subjectId], result: 'all',
      }),
      this.client.query({
        sql: `SELECT p.id,p.name AS label,p.name AS projectName,p.status,p.completed_at AS completedAt,
                     p.archived_at AS archivedAt,
                     COALESCE(
                       NULLIF(CAST(json_extract(p.extra_json,'$.completedInGameTimestamp') AS INTEGER),0),
                       CAST(json_extract(p.extra_json,'$.inGameTimestamp') AS INTEGER),
                       CAST(json_extract(p.extra_json,'$.completedInGameTimestamp') AS INTEGER),
                       MAX(t.completed_in_game_timestamp),0
                     ) AS occurredIGT
              FROM projects p LEFT JOIN tasks t ON t.project_id=p.id AND t.completed_at IS NOT NULL
              WHERE p.player_id=? GROUP BY p.id ORDER BY occurredIGT,p.id`,
        bind: [subjectId], result: 'all',
      }),
      this.client.query({
        sql: `SELECT id,name AS label,due_at AS dueAt,project_id AS projectId,
                     (SELECT name FROM projects p WHERE p.id=todos.project_id) AS projectName,
                     COALESCE(CAST(json_extract(extra_json,'$.inGameTimestamp') AS INTEGER),0) AS occurredIGT,
                     'open' AS state
              FROM todos WHERE player_id=? AND due_at IS NOT NULL AND due_at<>''
              UNION ALL
              SELECT t.todo_id AS id,t.name AS label,NULL AS dueAt,t.project_id AS projectId,
                     p.name AS projectName,t.completed_in_game_timestamp AS occurredIGT,
                     'completed' AS state
              FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
              WHERE t.player_id=? AND t.completed_at IS NOT NULL AND t.todo_id IS NOT NULL
              ORDER BY occurredIGT,id`,
        bind: [subjectId, subjectId], result: 'all',
      }),
      this.client.query({
        sql: `SELECT m.id,m.completed_in_game_timestamp AS occurredIGT,
                     m.owner_player_id AS ownerId,m.owner_won AS ownerWon,m.team1_total AS team1Total,
                     m.team2_total AS team2Total,
                     (SELECT mp.result FROM match_participants mp
                      WHERE mp.match_id=m.id AND mp.player_id=? LIMIT 1) AS participantResult
              FROM matches m WHERE m.status='complete' AND (
                m.owner_player_id=? OR EXISTS(
                  SELECT 1 FROM match_participants mp WHERE mp.match_id=m.id AND mp.player_id=?
                )
              ) ORDER BY occurredIGT,m.id`,
        bind: [subjectId, subjectId, subjectId], result: 'all',
      }),
      this.client.query({
        sql: `SELECT r.match_id AS id,r.match_id AS matchId,r.old_elo AS oldElo,
                     r.new_elo AS newElo,r.delta,
                     m.completed_in_game_timestamp AS occurredIGT
              FROM match_elo_receipts r JOIN matches m ON m.id=r.match_id
              WHERE r.player_id=? ORDER BY occurredIGT,r.match_id`,
        bind: [subjectId], result: 'all',
      }),
      this.client.query({
        sql: `SELECT id,location,started_igt AS startedIGT,ended_igt AS endedIGT,
                     ended_igt AS occurredIGT,active_elapsed_ms AS activeMs,close_reason AS closeReason
              FROM semantic_presence_intervals
              WHERE player_id=? AND ended_igt IS NOT NULL ORDER BY ended_igt,id`,
        bind: [subjectId], result: 'all',
      }),
    ]);

    const facts = [];
    for (const row of tasks) facts.push(canonicalizeActivityFact({
      ...row, subjectId, kind: 'task', state: 'completed',
    }));
    for (const row of projects) facts.push(canonicalizeActivityFact({
      ...row, subjectId, kind: 'goal', projectId: row.id, state: goalState(row),
    }));
    const commitmentById = new Map();
    for (const row of todos) {
      const prior = commitmentById.get(String(row.id));
      if (!prior || row.state === 'completed' || Number(row.occurredIGT) > Number(prior.occurredIGT)) {
        commitmentById.set(String(row.id), row);
      }
    }
    for (const row of commitmentById.values()) facts.push(canonicalizeActivityFact({
      ...row, subjectId, kind: 'commitment',
    }));
    for (const row of matches) {
      const result = row.participantResult || (row.ownerId === subjectId
        ? (Number(row.ownerWon) === 1 ? 'win' : Number(row.ownerWon) === 0 ? 'loss' : null)
        : null);
      facts.push(canonicalizeActivityFact({
        ...row, subjectId, kind: 'match', outcome: result || 'recorded', label: outcomeLabel(result),
      }));
    }
    for (const row of ranks) facts.push(canonicalizeActivityFact({
      ...row,
      subjectId,
      kind: 'rank',
      label: `${Number(row.delta) >= 0 ? '+' : ''}${Math.round(Number(row.delta) || 0)} ELO`,
    }));
    for (const row of intervals) {
      facts.push(canonicalizeActivityFact({
        ...row,
        subjectId,
        kind: 'location',
        state: 'completed',
        label: LOCATION_LABELS[row.location] || 'Location visit completed',
      }));
      if (row.location === 'dojo') facts.push(canonicalizeActivityFact({
        ...row,
        subjectId,
        kind: 'dojo',
        state: 'completed',
        label: 'Dojo session completed',
      }));
    }
    return facts.filter(Boolean).sort((left, right) => left.key.localeCompare(right.key));
  }
}

export default SocialActivityIndexService;
