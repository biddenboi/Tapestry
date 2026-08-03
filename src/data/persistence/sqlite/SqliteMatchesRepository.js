import { parseJson, stableJson } from './shadowDomainUtils.js';

function matchBase(row) {
  return {
    UUID: row.id,
    parent: row.ownerPlayerId || undefined,
    status: row.status,
    duration: row.durationMs == null ? undefined : Number(row.durationMs) / 3600000,
    rulesetId: row.rulesetId || undefined,
    lockedAt: row.lockedAt || undefined,
    rulesSnapshot: parseJson(row.rulesSnapshotJson, {}),
    contextSnapshot: parseJson(row.contextSnapshotJson, {}),
    legacyRules: parseJson(row.legacyRulesJson, {}),
    createdAt: row.createdAt,
    inGameTimestamp: row.inGameTimestamp == null ? undefined : Number(row.inGameTimestamp),
    completedInGameTimestamp: row.completedInGameTimestamp == null ? undefined : Number(row.completedInGameTimestamp),
  };
}

export class SqliteMatchesRepository {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('SqliteMatchesRepository requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async getMatch(id) {
    const row = await this.client.query({
      sql: `SELECT id,owner_player_id AS ownerPlayerId,status,duration_ms AS durationMs,created_at AS createdAt,
                   in_game_timestamp AS inGameTimestamp,completed_in_game_timestamp AS completedInGameTimestamp,
                   winner_team_no AS winnerTeamNo,team1_total AS team1Total,team2_total AS team2Total,
                   owner_won AS ownerWon,was_forfeited AS wasForfeited,concluded_at AS concludedAt,
                   result_json AS resultJson,extra_json AS extraJson,
                   ruleset_id AS rulesetId,locked_at AS lockedAt,
                   rules_snapshot_json AS rulesSnapshotJson,
                   context_snapshot_json AS contextSnapshotJson,
                   legacy_rules_json AS legacyRulesJson
            FROM matches WHERE id=?`, bind: [id], result: 'one',
    });
    if (!row) return null;
    const [teams, participants, receipts] = await Promise.all([
      this.client.query({ sql: 'SELECT team_no AS teamNo,display_name AS displayName,score,result FROM match_teams WHERE match_id=? ORDER BY team_no', bind: [id], result: 'all' }),
      this.client.query({
        sql: `SELECT id,player_id AS playerId,participant_key AS participantKey,team_no AS teamNo,
                     display_name_at_match AS displayName,elo_at_match AS eloAtMatch,power_at_match AS powerAtMatch,
                     profile_picture_resource_hash AS profilePictureResourceHash,result,elo_delta AS eloDelta,metadata_json AS metadataJson
              FROM match_participants WHERE match_id=? ORDER BY team_no,id`, bind: [id], result: 'all',
      }),
      this.client.query({
        sql: `SELECT COALESCE(player_id,player_key) AS playerId,old_elo AS oldElo,new_elo AS newElo,delta
              FROM match_elo_receipts WHERE match_id=? ORDER BY player_key`, bind: [id], result: 'all',
      }),
    ]);
    const byTeam = new Map(teams.map((team) => [Number(team.teamNo), []]));
    for (const participant of participants) {
      byTeam.get(Number(participant.teamNo))?.push({
        UUID: participant.playerId || participant.participantKey,
        participantKey: participant.participantKey,
        username: participant.displayName || undefined,
        elo: participant.eloAtMatch == null ? undefined : Number(participant.eloAtMatch),
        power: participant.powerAtMatch == null ? undefined : Number(participant.powerAtMatch),
        profilePictureResourceHash: participant.profilePictureResourceHash || undefined,
        result: participant.result || undefined,
        eloDelta: participant.eloDelta == null ? undefined : Number(participant.eloDelta),
        ...parseJson(participant.metadataJson, {}),
      });
    }
    const aggregate = parseJson(row.resultJson, {});
    const importedChanges = {};
    for (const participant of participants) {
      if (participant.eloDelta == null) continue;
      const key = participant.playerId || participant.participantKey;
      const oldElo = participant.eloAtMatch == null ? null : Number(participant.eloAtMatch);
      importedChanges[key] = { oldElo, newElo: oldElo == null ? null : oldElo + Number(participant.eloDelta), change: Number(participant.eloDelta) };
    }
    for (const receipt of receipts) importedChanges[receipt.playerId] = {
      oldElo: Number(receipt.oldElo), newElo: Number(receipt.newElo), change: Number(receipt.delta),
    };
    return {
      ...matchBase(row),
      ...parseJson(row.extraJson, {}),
      teams: teams.map((team) => byTeam.get(Number(team.teamNo)) || []),
      participantUUIDs: participants.map((participant) => participant.playerId || participant.participantKey),
      result: {
        ...aggregate,
        winner: row.winnerTeamNo == null ? aggregate.winner : Number(row.winnerTeamNo),
        team1Total: row.team1Total == null ? aggregate.team1Total : Number(row.team1Total),
        team2Total: row.team2Total == null ? aggregate.team2Total : Number(row.team2Total),
        iWon: row.ownerWon == null ? aggregate.iWon : Boolean(row.ownerWon),
        wasForfeited: Boolean(row.wasForfeited),
        concludedAt: row.concludedAt || aggregate.concludedAt,
        playerEloChanges: importedChanges,
      },
    };
  }

  async listMatchesForPlayer(playerId, { viewerIGT = Infinity, limit = 100 } = {}) {
    const bind = [playerId, playerId];
    let igtClause = '';
    if (Number.isFinite(Number(viewerIGT))) {
      igtClause = "AND COALESCE(NULLIF(m.completed_in_game_timestamp,0),NULLIF(CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0),m.in_game_timestamp,m.completed_in_game_timestamp,CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0)<=?";
      bind.push(Math.trunc(Number(viewerIGT)));
    }
    bind.push(Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100))));
    const ids = await this.client.query({
      sql: `SELECT DISTINCT m.id FROM matches m
            LEFT JOIN match_participants p ON p.match_id=m.id
            WHERE (m.owner_player_id=? OR p.player_id=?) ${igtClause}
            ORDER BY COALESCE(NULLIF(m.completed_in_game_timestamp,0),NULLIF(CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0),m.in_game_timestamp,m.completed_in_game_timestamp,CAST(json_extract(m.result_json,'$.inGameTimestamp') AS INTEGER),0) DESC,m.created_at DESC,m.id
            LIMIT ?`, bind, result: 'values',
    });
    return Promise.all(ids.map((id) => this.getMatch(id)));
  }

  async explainPlayerHistory(playerId) {
    return this.client.query({
      sql: `EXPLAIN QUERY PLAN SELECT m.id FROM matches m
            JOIN match_participants p ON p.match_id=m.id
            WHERE p.player_id=? ORDER BY m.created_at DESC LIMIT 20`,
      bind: [playerId], result: 'all',
    });
  }

  async enqueuePostMatchJob({ id, matchId, idempotencyKey, payload = {}, jobType = 'post-match' }) {
    const timestamp = this.now().toISOString();
    return this.client.executeAtomic({
      commandId: `match-job-enqueue:${idempotencyKey}`,
      label: 'match-job-enqueue',
      statements: [{
        sql: `INSERT INTO background_jobs(id,job_type,status,idempotency_key,match_id,payload_json,attempts,created_at,updated_at)
              VALUES(?,?,'pending',?,?,?,0,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
        bind: [id, jobType, idempotencyKey, matchId, stableJson(payload), timestamp, timestamp], result: 'changes',
      }],
    });
  }

  async applyPostMatch({ matchId, operationId, jobId = null, eloChanges = [], outcome = {} } = {}) {
    if (!matchId || !operationId) throw new Error('Post-match application requires matchId and operationId.');
    const normalized = [...eloChanges].map((change) => ({
      playerId: String(change.playerId), oldElo: Number(change.oldElo), newElo: Number(change.newElo),
    })).sort((a, b) => a.playerId.localeCompare(b.playerId));
    const existing = await this.client.query({
      sql: 'SELECT operation_id FROM post_match_commands WHERE operation_id=?', bind: [operationId], result: 'one',
    });
    if (existing) return { status: 'applied', duplicate: true, match: await this.getMatch(matchId) };
    await this.client.executeAtomic({
      commandId: `post-match:${operationId}`,
      label: 'post-match-apply',
      statements: [{
        sql: `INSERT INTO post_match_commands(operation_id,match_id,job_id,changes_json,outcome_json,committed_at)
              VALUES(?,?,?,?,?,?)`,
        bind: [operationId, matchId, jobId, stableJson(normalized), stableJson(outcome), this.now().toISOString()], result: 'changes',
      }],
    });
    return { status: 'applied', duplicate: false, match: await this.getMatch(matchId) };
  }
}

export default SqliteMatchesRepository;
