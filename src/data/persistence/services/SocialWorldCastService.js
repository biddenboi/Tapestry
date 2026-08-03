import {
  DYNAMIC_CAST_ALGORITHM_VERSION,
  buildDynamicCastReview,
  inspectDynamicCastIncumbents,
  isDynamicCastReviewDue,
} from '../../../domain/social-world/DynamicCastSelection.js';
import { VISIBILITY_TIER } from '../../../domain/social-world/SocialWorldContracts.js';
import { deserializeProfilePictureValue } from '../profilePictureValue.js';

function asCursor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError('viewerIGT must be a non-negative number.');
  return Math.trunc(numeric);
}

function addToSetMap(map, key, value) {
  if (!key || !value) return;
  if (!map.has(String(key))) map.set(String(key), new Set());
  map.get(String(key)).add(String(value));
}

function countMap(rows, key = 'count') {
  return new Map(rows.map((row) => [String(row.playerId), Math.max(0, Math.trunc(Number(row[key]) || 0))]));
}

function stableCommandId(viewerId, review) {
  const subjects = review.assignments.map((entry) => `${entry.role}=${entry.subjectId}`).sort().join(',') || 'empty';
  return [viewerId, review.review.algorithmVersion, review.review.reviewedAtIGT, review.review.outcome, subjects]
    .map((value) => encodeURIComponent(String(value)))
    .join(':');
}

export class SocialWorldCastService {
  constructor({ repository, client, readiness, now = () => new Date() } = {}) {
    if (!repository?.getCastState || !repository?.replaceCastState || !client?.query
        || !readiness?.assertReady) {
      throw new Error('SocialWorldCastService requires a cast repository, SQLite client, and source readiness.');
    }
    this.repository = repository;
    this.client = client;
    this.readiness = readiness;
    this.now = now;
  }

  async getDynamicCast({ viewerId, viewerIGT, committedAt = this.now() } = {}) {
    if (!viewerId) return null;
    this.readiness.assertReady(['coreProfiles', 'planning', 'matches', 'social']);
    const cursor = asCursor(viewerIGT);
    const [snapshot, state] = await Promise.all([
      this._selectionSnapshot(String(viewerId), cursor),
      this.repository.getCastState(String(viewerId)),
    ]);
    if (!snapshot.viewer) return null;

    const inspected = inspectDynamicCastIncumbents({
      viewer: snapshot.viewer,
      candidates: snapshot.candidates,
      friendIds: snapshot.friendIds,
      incumbents: state.assignments,
    });
    const reviewDue = isDynamicCastReviewDue(state.review, cursor);
    const hasInvalidIncumbent = inspected.invalid.length > 0;
    const currentSubjects = new Map(state.assignments.map((assignment) => [assignment.role, assignment.subjectId]));
    const expectedSubjects = state.review?.diagnostics?.assignedRoles || {};
    const hasEvictedIncumbent = Object.entries(expectedSubjects)
      .some(([role, subjectId]) => String(currentSubjects.get(role) || '') !== String(subjectId || ''));
    if (!reviewDue && !hasInvalidIncumbent && !hasEvictedIncumbent) {
      return this._present(state, { unchanged: true });
    }

    const reviewReason = !state.review
      ? 'initial'
      : Number(state.review.algorithmVersion) !== DYNAMIC_CAST_ALGORITHM_VERSION
        ? 'algorithm-upgrade'
        : hasInvalidIncumbent || hasEvictedIncumbent
          ? 'role-invalidation'
          : 'scheduled';
    const next = buildDynamicCastReview({
      viewer: snapshot.viewer,
      candidates: snapshot.candidates,
      friendIds: snapshot.friendIds,
      incumbents: state.assignments,
      viewerIGT: cursor,
      reviewReason,
    });
    const committed = await this.repository.replaceCastState({
      viewerId: String(viewerId),
      assignments: next.assignments,
      review: next.review,
      commandId: stableCommandId(viewerId, next),
      committedAt,
    });
    return this._present(committed, { unchanged: false, duplicate: committed.duplicate });
  }

  async _selectionSnapshot(viewerId, viewerIGT) {
    const [players, friendships, tasks, taskKinds, goals, matches] = await Promise.all([
      this.client.query({
        sql: `SELECT id,elo,archived_at AS archivedAt,banned_at AS bannedAt
              FROM players ORDER BY id`,
        result: 'all',
      }),
      this.client.query({
        sql: `SELECT requester_player_id AS requesterId,recipient_player_id AS recipientId
              FROM friendships
              WHERE status='accepted'
                AND (requester_player_id=? OR recipient_player_id=?)
              ORDER BY id`,
        bind: [viewerId, viewerId],
        result: 'all',
      }),
      this.client.query({
        sql: `SELECT player_id AS playerId,COUNT(*) AS completedTaskCount
              FROM tasks
              WHERE completed_at IS NOT NULL
                AND COALESCE(NULLIF(completed_in_game_timestamp,0),in_game_timestamp,completed_in_game_timestamp) IS NOT NULL
                AND COALESCE(NULLIF(completed_in_game_timestamp,0),in_game_timestamp,completed_in_game_timestamp)<=?
              GROUP BY player_id ORDER BY player_id`,
        bind: [viewerIGT],
        result: 'all',
      }),
      this.client.query({
        sql: `SELECT DISTINCT player_id AS playerId,LOWER(TRIM(source)) AS actionKind
              FROM tasks
              WHERE completed_at IS NOT NULL AND source IS NOT NULL AND TRIM(source)<>''
                AND COALESCE(NULLIF(completed_in_game_timestamp,0),in_game_timestamp,completed_in_game_timestamp) IS NOT NULL
                AND COALESCE(NULLIF(completed_in_game_timestamp,0),in_game_timestamp,completed_in_game_timestamp)<=?
              ORDER BY player_id,actionKind`,
        bind: [viewerIGT],
        result: 'all',
      }),
      this.client.query({
        sql: `SELECT player_id AS playerId,LOWER(TRIM(name)) AS goalName
              FROM projects
              WHERE archived_at IS NULL AND TRIM(name)<>''
              ORDER BY player_id,goalName,id`,
        result: 'all',
      }),
      this.client.query({
        sql: `SELECT playerId,COUNT(*) AS completedMatchCount FROM (
                SELECT mp.player_id AS playerId,m.id AS matchId
                FROM match_participants mp
                JOIN matches m ON m.id=mp.match_id
                WHERE mp.player_id IS NOT NULL AND m.status='complete'
                  AND COALESCE(NULLIF(m.completed_in_game_timestamp,0),NULLIF(CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0),m.in_game_timestamp,m.completed_in_game_timestamp,CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER)) IS NOT NULL
                  AND COALESCE(NULLIF(m.completed_in_game_timestamp,0),NULLIF(CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0),m.in_game_timestamp,m.completed_in_game_timestamp,CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER))<=?
                UNION
                SELECT m.owner_player_id AS playerId,m.id AS matchId
                FROM matches m
                WHERE m.owner_player_id IS NOT NULL AND m.status='complete'
                  AND COALESCE(NULLIF(m.completed_in_game_timestamp,0),NULLIF(CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0),m.in_game_timestamp,m.completed_in_game_timestamp,CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER)) IS NOT NULL
                  AND COALESCE(NULLIF(m.completed_in_game_timestamp,0),NULLIF(CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0),m.in_game_timestamp,m.completed_in_game_timestamp,CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER))<=?
              ) completed_matches
              GROUP BY playerId ORDER BY playerId`,
        bind: [viewerIGT, viewerIGT],
        result: 'all',
      }),
    ]);

    const taskCounts = countMap(tasks, 'completedTaskCount');
    const matchCounts = countMap(matches, 'completedMatchCount');
    const actionKinds = new Map();
    const explicitGoals = new Map();
    for (const row of tasks) {
      if (Number(row.completedTaskCount) > 0) addToSetMap(actionKinds, row.playerId, 'task');
    }
    for (const row of taskKinds) addToSetMap(actionKinds, row.playerId, row.actionKind);
    for (const row of matches) {
      if (Number(row.completedMatchCount) > 0) addToSetMap(actionKinds, row.playerId, 'match');
    }
    for (const row of goals) addToSetMap(explicitGoals, row.playerId, row.goalName);
    const selectionProfiles = players.map((player) => ({
      id: String(player.id),
      elo: Number(player.elo || 0),
      archivedAt: player.archivedAt || null,
      bannedAt: player.bannedAt || null,
      completedTaskCount: taskCounts.get(String(player.id)) || 0,
      completedMatchCount: matchCounts.get(String(player.id)) || 0,
      explicitGoals: [...(explicitGoals.get(String(player.id)) || [])],
      actionKinds: [...(actionKinds.get(String(player.id)) || [])],
    }));
    const friendIds = friendships.map((friendship) => (
      String(friendship.requesterId) === viewerId ? friendship.recipientId : friendship.requesterId
    )).map(String);
    return Object.freeze({
      viewer: selectionProfiles.find((player) => player.id === viewerId) || null,
      candidates: Object.freeze(selectionProfiles),
      friendIds: Object.freeze(friendIds),
    });
  }

  async _present(state, { unchanged = false, duplicate = false } = {}) {
    const ids = state.assignments.map((assignment) => assignment.subjectId);
    let identities = [];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      identities = await this.client.query({
        sql: `SELECT id,username,description,profile_picture AS profilePicture,elo
              FROM players WHERE id IN (${placeholders}) ORDER BY id`,
        bind: ids,
        result: 'all',
      });
    }
    const byId = new Map(identities.map((profile) => [String(profile.id), Object.freeze({
      id: String(profile.id),
      UUID: String(profile.id),
      username: profile.username || '',
      description: profile.description || '',
      profilePicture: deserializeProfilePictureValue(profile.profilePicture),
      elo: Number(profile.elo || 0),
      visibilityTier: VISIBILITY_TIER.dynamic,
    })]));
    return Object.freeze({
      assignments: Object.freeze(state.assignments.map((assignment) => Object.freeze({
        ...assignment,
        profile: byId.get(String(assignment.subjectId)) || null,
      }))),
      review: state.review,
      unchanged,
      duplicate,
      invalidatedDomains: state.invalidatedDomains || [],
    });
  }
}

export default SocialWorldCastService;
