import {
  createImportLedgerStatements,
  deterministicRows,
  fingerprintShadowSource,
  numberOrNull,
  omitKeys,
  stableJson,
  textOrNull,
} from './shadowDomainUtils.js';

const IMPORTER_VERSION = 'batch19-pair-matches-v1';
const MATCH_KEYS = [
  'UUID','parent','status','duration','rulesetId','lockedAt','rulesSnapshot','contextSnapshot',
  'legacyRules','createdAt','inGameTimestamp','completedInGameTimestamp','teams','participantUUIDs',
  'participantSnapshot','result',
];
const JOB_KEYS = ['UUID','type','jobType','status','idempotencyKey','matchUUID','matchId','payload','attempts','createdAt','updatedAt','completedAt','lastError'];

function boundedJson(value, max = 131072) {
  const text = stableJson(value ?? {});
  return new TextEncoder().encode(text).byteLength <= max ? text : '{}';
}

function status(value) {
  return ['pending','active','complete','cancelled','failed'].includes(value) ? value : 'pending';
}

function participantKey(record, index) {
  return textOrNull(record?.UUID ?? record?.uuid ?? record?.playerUUID) || `generated-${index}`;
}

export class MatchesShadowImporter {
  constructor({ client, now = () => new Date() } = {}) {
    if (!client) throw new Error('MatchesShadowImporter requires a SQLite client.');
    this.client = client;
    this.now = now;
  }

  async import({ matches = [], backgroundJobs = [], backgroundJobReceipts = [], runId = null } = {}) {
    const source = { matches, backgroundJobs, backgroundJobReceipts };
    const sourceFingerprint = await fingerprintShadowSource(source);
    const existing = await this.client.query({
      sql: `SELECT run_id AS runId,counts_json AS countsJson,diagnostics_json AS diagnosticsJson
            FROM shadow_import_runs WHERE domain='matches' AND source_fingerprint=? AND importer_version=?`,
      bind: [sourceFingerprint, IMPORTER_VERSION], result: 'one',
    });
    if (existing) return {
      duplicate: true, runId: existing.runId, sourceFingerprint,
      counts: JSON.parse(existing.countsJson), diagnostics: JSON.parse(existing.diagnosticsJson),
    };

    const playerIds = new Set(await this.client.query({ sql: 'SELECT id FROM players', result: 'values' }));
    const matchInput = deterministicRows(matches, { kind: 'match' });
    const jobInput = deterministicRows(backgroundJobs, { kind: 'background-job' });
    const receiptInput = deterministicRows(backgroundJobReceipts, {
      id: (record) => record?.idempotencyKey ?? record?.UUID, kind: 'background-job-receipt',
    });
    const diagnostics = [
      ...matchInput.rejected, ...matchInput.conflicts,
      ...jobInput.rejected, ...jobInput.conflicts,
      ...receiptInput.rejected, ...receiptInput.conflicts,
    ];
    const statements = [];
    const timestamp = this.now().toISOString();
    let teamCount = 0;
    let participantCount = 0;
    let knownParticipants = 0;

    for (const match of matchInput.selected) {
      const id = String(match.UUID);
      const result = match.result && typeof match.result === 'object' ? match.result : {};
      const owner = textOrNull(match.parent);
      const ownerId = owner && playerIds.has(owner) ? owner : null;
      if (owner && !ownerId) diagnostics.push({ kind: 'match', recordId: id, reason: 'unknown-owner', playerId: owner });
      const aggregateResult = { ...result };
      delete aggregateResult.playerEloChanges;
      const rulesetId = textOrNull(match.rulesetId ?? match.rulesSnapshot?.rulesetId)
        || 'legacy_configurable_v2';
      const rulesDurationMs = Number(match.rulesSnapshot?.durationMs);
      const durationHours = Number(match.duration ?? match.rulesSnapshot?.durationHours);
      const durationMs = Number.isFinite(rulesDurationMs)
        ? Math.max(0, Math.round(rulesDurationMs))
        : Number.isFinite(durationHours)
          ? Math.max(0, Math.round(durationHours * 3600000))
          : null;
      const legacyRules = rulesetId === 'pair_match_v1'
        ? {}
        : match.legacyRules || {
            mode: match.mode ?? match.rulesSnapshot?.mode ?? null,
            ratingMode: match.ratingMode ?? match.rulesSnapshot?.ratingMode ?? null,
            scoreVisibility: match.scoreVisibility ?? match.rulesSnapshot?.scoreVisibility ?? null,
            checkpointIntervalMs: match.checkpointIntervalMs ?? match.rulesSnapshot?.checkpointIntervalMs ?? null,
          };
      statements.push({
        sql: `INSERT INTO matches(
                id,owner_player_id,status,duration_ms,created_at,in_game_timestamp,completed_in_game_timestamp,
                winner_team_no,team1_total,team2_total,owner_won,was_forfeited,concluded_at,result_json,extra_json,
                ruleset_id,locked_at,rules_snapshot_json,context_snapshot_json,legacy_rules_json
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                owner_player_id=excluded.owner_player_id,status=excluded.status,duration_ms=excluded.duration_ms,
                created_at=excluded.created_at,in_game_timestamp=excluded.in_game_timestamp,
                completed_in_game_timestamp=excluded.completed_in_game_timestamp,winner_team_no=excluded.winner_team_no,
                team1_total=excluded.team1_total,team2_total=excluded.team2_total,owner_won=excluded.owner_won,
                was_forfeited=excluded.was_forfeited,concluded_at=excluded.concluded_at,
                result_json=excluded.result_json,extra_json=excluded.extra_json,
                ruleset_id=excluded.ruleset_id,locked_at=excluded.locked_at,
                rules_snapshot_json=excluded.rules_snapshot_json,
                context_snapshot_json=excluded.context_snapshot_json,
                legacy_rules_json=excluded.legacy_rules_json`,
        bind: [id, ownerId, status(match.status), durationMs,
          textOrNull(match.createdAt) || timestamp,
          numberOrNull(match.inGameTimestamp, { min: 0, integer: true }),
          numberOrNull(match.completedInGameTimestamp, { min: 0, integer: true }),
          Number.isFinite(Number(result.winner)) ? Math.trunc(Number(result.winner)) : null,
          Number.isFinite(Number(result.team1Total)) ? Number(result.team1Total) : null,
          Number.isFinite(Number(result.team2Total)) ? Number(result.team2Total) : null,
          typeof result.iWon === 'boolean' ? (result.iWon ? 1 : 0) : null,
          result.wasForfeited ? 1 : 0, textOrNull(result.concludedAt),
          boundedJson(aggregateResult), boundedJson(omitKeys(match, MATCH_KEYS)),
          rulesetId, textOrNull(match.lockedAt), boundedJson(match.rulesSnapshot || {}),
          boundedJson(match.contextSnapshot || {}), boundedJson(legacyRules)],
        result: 'changes',
      }, {
        sql: 'DELETE FROM match_teams WHERE match_id=?', bind: [id], result: 'changes',
      });
      const teams = Array.isArray(match.teams) ? match.teams : [];
      for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
        const teamNo = teamIndex + 1;
        const team = Array.isArray(teams[teamIndex]) ? teams[teamIndex] : [];
        const score = Number(result[`team${teamNo}Total`]);
        statements.push({
          sql: 'INSERT INTO match_teams(match_id,team_no,display_name,score,result) VALUES(?,?,?,?,?)',
          bind: [id, teamNo, `Team ${teamNo}`, Number.isFinite(score) ? score : null,
            Number(result.winner) === teamNo ? 'win' : Number.isFinite(Number(result.winner)) ? 'loss' : null], result: 'changes',
        });
        teamCount += 1;
        for (let index = 0; index < team.length; index += 1) {
          const participant = team[index] || {};
          const key = participantKey(participant, index);
          const playerId = playerIds.has(key) ? key : null;
          if (playerId) knownParticipants += 1;
          const change = result.playerEloChanges?.[key] || null;
          const participantId = `${id}:team:${teamNo}:${key}`;
          statements.push({
            sql: `INSERT INTO match_participants(
                    id,match_id,player_id,participant_key,team_no,display_name_at_match,elo_at_match,power_at_match,
                    profile_picture_resource_hash,result,elo_delta,metadata_json
                  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
            bind: [participantId, id, playerId, key, teamNo,
              textOrNull(participant.username ?? participant.displayName ?? participant.name),
              Number.isFinite(Number(change?.oldElo ?? participant.elo)) ? Number(change?.oldElo ?? participant.elo) : null,
              Number.isFinite(Number(participant.power)) ? Number(participant.power) : null,
              /^[0-9a-f]{64}$/.test(String(participant.profilePictureResourceHash || '')) ? participant.profilePictureResourceHash : null,
              Number(result.winner) === teamNo ? 'win' : Number.isFinite(Number(result.winner)) ? 'loss' : null,
              Number.isFinite(Number(change?.change)) ? Number(change.change) : null,
              boundedJson({
                sourceParticipantKey: key,
                generated: !playerId,
                matchRole: participant.matchRole || null,
                matchContext: participant.matchContext || null,
                generatedSeed: participant.generatedSeed ?? null,
                estimatedTotal: Number(participant.estimatedTotal) || 0,
                pointsPerMs: Number(participant.pointsPerMs) || 0,
                replayTrace: participant.replayTrace || null,
                recentTaskNames: Array.isArray(participant.recentTaskNames)
                  ? participant.recentTaskNames.slice(0, 15)
                  : [],
                playerTheme: participant.playerTheme || participant.theme || null,
                cardBanner: participant.cardBanner || null,
                activeTitle: participant.activeTitle || participant.title || null,
                frame: participant.frame || null,
                selectedAchievements: Array.isArray(participant.selectedAchievements)
                  ? participant.selectedAchievements
                  : [],
              }, 65536)],
            result: 'changes',
          });
          participantCount += 1;
        }
      }
    }

    const knownMatches = new Set(matchInput.selected.map((match) => String(match.UUID)));
    for (const job of jobInput.selected) {
      const id = String(job.UUID);
      const matchId = textOrNull(job.matchUUID ?? job.matchId);
      const normalizedMatchId = matchId && knownMatches.has(matchId) ? matchId : null;
      if (matchId && !normalizedMatchId) diagnostics.push({ kind: 'background-job', recordId: id, reason: 'unknown-match', matchId });
      const jobStatus = ['pending','running','complete','failed','cancelled'].includes(job.status) ? job.status : 'pending';
      statements.push({
        sql: `INSERT INTO background_jobs(
                id,job_type,status,idempotency_key,match_id,payload_json,attempts,created_at,updated_at,completed_at,last_error
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                job_type=excluded.job_type,status=excluded.status,idempotency_key=excluded.idempotency_key,
                match_id=excluded.match_id,payload_json=excluded.payload_json,attempts=excluded.attempts,
                updated_at=excluded.updated_at,completed_at=excluded.completed_at,last_error=excluded.last_error`,
        bind: [id, textOrNull(job.jobType ?? job.type) || 'post-match', jobStatus,
          textOrNull(job.idempotencyKey) || id, normalizedMatchId,
          boundedJson(job.payload ?? omitKeys(job, JOB_KEYS), 262144),
          Math.max(0, Math.trunc(Number(job.attempts) || 0)), textOrNull(job.createdAt) || timestamp,
          textOrNull(job.updatedAt) || timestamp, textOrNull(job.completedAt), textOrNull(job.lastError)], result: 'changes',
      });
    }

    const jobIds = new Set(jobInput.selected.map((job) => String(job.UUID)));
    for (const receipt of receiptInput.selected) {
      const key = textOrNull(receipt.idempotencyKey ?? receipt.UUID);
      if (!key) continue;
      const jobId = textOrNull(receipt.jobUUID ?? receipt.jobId);
      const matchId = textOrNull(receipt.matchUUID ?? receipt.matchId);
      statements.push({
        sql: `INSERT INTO background_job_receipts(idempotency_key,job_id,match_id,outcome_json,committed_at)
              VALUES(?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING`,
        bind: [key, jobId && jobIds.has(jobId) ? jobId : null, matchId && knownMatches.has(matchId) ? matchId : null,
          boundedJson(receipt.outcome ?? receipt.result ?? {}, 262144), textOrNull(receipt.committedAt ?? receipt.createdAt) || timestamp], result: 'changes',
      });
    }

    const counts = {
      matches: matchInput.selected.length, teams: teamCount, participants: participantCount,
      knownParticipants, backgroundJobs: jobInput.selected.length,
      backgroundJobReceipts: receiptInput.selected.length, diagnostics: diagnostics.length,
    };
    const effectiveRunId = runId || `matches:${sourceFingerprint.slice(0, 24)}`;
    statements.push(...createImportLedgerStatements({
      runId: effectiveRunId, domain: 'matches', sourceFingerprint, importerVersion: IMPORTER_VERSION,
      startedAt: timestamp, finishedAt: timestamp, counts, diagnostics,
    }));
    await this.client.executeAtomic({ commandId: `shadow-import:${effectiveRunId}`, label: 'matches-shadow-import', statements });
    return { duplicate: false, runId: effectiveRunId, sourceFingerprint, counts, diagnostics };
  }
}

export default MatchesShadowImporter;
