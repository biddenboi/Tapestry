export const MATCHES_AND_JOBS_SCHEMA_SQL = `
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  owner_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','complete','cancelled','failed')),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER,
  completed_in_game_timestamp INTEGER,
  winner_team_no INTEGER,
  team1_total REAL,
  team2_total REAL,
  owner_won INTEGER CHECK (owner_won IS NULL OR owner_won IN (0,1)),
  was_forfeited INTEGER NOT NULL DEFAULT 0 CHECK (was_forfeited IN (0,1)),
  concluded_at TEXT,
  result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json) AND length(result_json) <= 131072),
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 131072)
) STRICT;
CREATE INDEX matches_owner_igt_idx ON matches(owner_player_id, completed_in_game_timestamp DESC, created_at DESC, id);
CREATE INDEX matches_status_idx ON matches(status, created_at, id);

CREATE TABLE match_teams (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_no INTEGER NOT NULL CHECK (team_no >= 0),
  display_name TEXT,
  score REAL,
  result TEXT,
  PRIMARY KEY(match_id, team_no)
) STRICT;

CREATE TABLE match_participants (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  participant_key TEXT NOT NULL,
  team_no INTEGER NOT NULL CHECK (team_no >= 0),
  display_name_at_match TEXT,
  elo_at_match REAL,
  power_at_match REAL,
  profile_picture_resource_hash TEXT REFERENCES resources(content_hash) ON DELETE SET NULL,
  result TEXT,
  elo_delta REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536),
  UNIQUE(match_id, participant_key),
  FOREIGN KEY(match_id, team_no) REFERENCES match_teams(match_id, team_no) ON DELETE CASCADE
) STRICT;
CREATE INDEX match_participants_player_idx ON match_participants(player_id, match_id, team_no);
CREATE INDEX match_participants_match_team_idx ON match_participants(match_id, team_no, id);

CREATE TABLE match_elo_receipts (
  operation_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  player_key TEXT NOT NULL,
  old_elo REAL NOT NULL,
  new_elo REAL NOT NULL,
  delta REAL NOT NULL,
  committed_at TEXT NOT NULL,
  UNIQUE(match_id, player_key)
) STRICT;

CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','complete','failed','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  match_id TEXT REFERENCES matches(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json) AND length(payload_json) <= 262144),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT
) STRICT;
CREATE INDEX background_jobs_status_idx ON background_jobs(status, updated_at, id);
CREATE INDEX background_jobs_match_idx ON background_jobs(match_id, job_type, status);

CREATE TABLE background_job_receipts (
  idempotency_key TEXT PRIMARY KEY,
  job_id TEXT REFERENCES background_jobs(id) ON DELETE SET NULL,
  match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  outcome_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(outcome_json) AND length(outcome_json) <= 262144),
  committed_at TEXT NOT NULL
) STRICT;

CREATE TABLE post_match_commands (
  operation_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES background_jobs(id) ON DELETE SET NULL,
  changes_json TEXT NOT NULL CHECK (json_valid(changes_json) AND json_type(changes_json)='array'),
  outcome_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(outcome_json) AND length(outcome_json) <= 262144),
  committed_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER post_match_commands_validate
BEFORE INSERT ON post_match_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM matches WHERE id=NEW.match_id)
    THEN RAISE(ABORT, 'post-match-missing-match') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.changes_json) c
    LEFT JOIN players p ON p.id=json_extract(c.value,'$.playerId')
    WHERE p.id IS NULL
       OR json_type(c.value,'$.oldElo') NOT IN ('integer','real')
       OR json_type(c.value,'$.newElo') NOT IN ('integer','real')
       OR ABS(p.elo - CAST(json_extract(c.value,'$.oldElo') AS REAL)) > 0.000001
  ) THEN RAISE(ABORT, 'post-match-stale-elo') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM json_each(NEW.changes_json)
  ) <> (
    SELECT COUNT(DISTINCT json_extract(value,'$.playerId')) FROM json_each(NEW.changes_json)
  ) THEN RAISE(ABORT, 'post-match-duplicate-player') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM json_each(NEW.changes_json) c
    JOIN match_elo_receipts r
      ON r.match_id=NEW.match_id AND r.player_key=json_extract(c.value,'$.playerId')
  ) THEN RAISE(ABORT, 'post-match-already-applied') END;
END;

CREATE TRIGGER post_match_commands_apply
AFTER INSERT ON post_match_commands
BEGIN
  INSERT INTO match_elo_receipts(operation_id,match_id,player_id,player_key,old_elo,new_elo,delta,committed_at)
  SELECT NEW.operation_id || ':' || json_extract(value,'$.playerId'),
         NEW.match_id,
         json_extract(value,'$.playerId'),
         json_extract(value,'$.playerId'),
         CAST(json_extract(value,'$.oldElo') AS REAL),
         CAST(json_extract(value,'$.newElo') AS REAL),
         CAST(json_extract(value,'$.newElo') AS REAL) - CAST(json_extract(value,'$.oldElo') AS REAL),
         NEW.committed_at
  FROM json_each(NEW.changes_json);

  UPDATE players
  SET elo=(
    SELECT CAST(json_extract(c.value,'$.newElo') AS REAL)
    FROM json_each(NEW.changes_json) c
    WHERE json_extract(c.value,'$.playerId')=players.id
  ), updated_at=NEW.committed_at
  WHERE id IN (SELECT json_extract(value,'$.playerId') FROM json_each(NEW.changes_json));

  UPDATE background_jobs
  SET status='complete',attempts=attempts+1,updated_at=NEW.committed_at,completed_at=NEW.committed_at,last_error=NULL
  WHERE id=NEW.job_id;

  INSERT INTO background_job_receipts(idempotency_key,job_id,match_id,outcome_json,committed_at)
  SELECT idempotency_key,id,NEW.match_id,NEW.outcome_json,NEW.committed_at
  FROM background_jobs WHERE id=NEW.job_id
  ON CONFLICT(idempotency_key) DO NOTHING;
END;

`.trim();

export const migration010 = Object.freeze({
  id: '010_matches_and_jobs',
  description: 'Normalize matches, teams, historical participants, Elo receipts, and replay-safe background jobs.',
  sourceApplicationVersion: 'batch18',
  sql: MATCHES_AND_JOBS_SCHEMA_SQL,
  checksum: 'a95686af69432d2559e40b89a95a10edde47eeb0cec11b7cf1e8a9558f1ce8d6',
});
export default migration010;
