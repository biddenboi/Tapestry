export const RECOVERY_MODEL_DERIVED_SCHEMA_SQL = `
CREATE TABLE achievement_events (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  player_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_id TEXT,
  event_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (event_schema_version >= 1),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json) AND json_type(payload_json)='object' AND length(payload_json)<=262144),
  idempotency_key TEXT NOT NULL UNIQUE
) STRICT;
CREATE INDEX achievement_events_player_time_idx ON achievement_events(player_id,occurred_at,id);
CREATE INDEX achievement_events_type_time_idx ON achievement_events(event_type,occurred_at,id);

CREATE TABLE achievement_states (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  counter_version INTEGER NOT NULL DEFAULT 1 CHECK (counter_version >= 1),
  counters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counters_json) AND json_type(counters_json)='object' AND length(counters_json)<=524288),
  applied_events_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(applied_events_json) AND json_type(applied_events_json)='object' AND length(applied_events_json)<=524288),
  event_awards_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(event_awards_json) AND json_type(event_awards_json)='object' AND length(event_awards_json)<=524288),
  needs_reconciliation INTEGER NOT NULL DEFAULT 1 CHECK (needs_reconciliation IN (0,1)),
  reconciled_at TEXT,
  reconciliation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE achievement_receipts (
  event_id TEXT PRIMARY KEY REFERENCES achievement_events(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  player_key TEXT NOT NULL,
  processor_version INTEGER NOT NULL CHECK (processor_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  earned_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(earned_keys_json) AND json_type(earned_keys_json)='array'),
  removed_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(removed_keys_json) AND json_type(removed_keys_json)='array'),
  issued_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(issued_keys_json) AND json_type(issued_keys_json)='array'),
  reward_issued_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  last_error TEXT
) STRICT;
CREATE INDEX achievement_receipts_status_idx ON achievement_receipts(status,updated_at,event_id);

CREATE TABLE achievement_process_commands (
  operation_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES achievement_events(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  processor_version INTEGER NOT NULL CHECK (processor_version >= 1),
  counter_version INTEGER NOT NULL CHECK (counter_version >= 1),
  counters_json TEXT NOT NULL CHECK (json_valid(counters_json) AND json_type(counters_json)='object'),
  applied_events_json TEXT NOT NULL CHECK (json_valid(applied_events_json) AND json_type(applied_events_json)='object'),
  event_awards_json TEXT NOT NULL CHECK (json_valid(event_awards_json) AND json_type(event_awards_json)='object'),
  earned_keys_json TEXT NOT NULL CHECK (json_valid(earned_keys_json) AND json_type(earned_keys_json)='array'),
  removed_keys_json TEXT NOT NULL CHECK (json_valid(removed_keys_json) AND json_type(removed_keys_json)='array'),
  completed_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER achievement_process_commands_validate
BEFORE INSERT ON achievement_process_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM achievement_events e WHERE e.id=NEW.event_id AND e.player_id=NEW.player_id
  ) THEN RAISE(ABORT,'achievement-event-player-mismatch') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM achievement_receipts r WHERE r.event_id=NEW.event_id AND r.status='completed'
  ) THEN RAISE(ABORT,'achievement-event-already-completed') END;
END;

CREATE TRIGGER achievement_process_commands_apply
AFTER INSERT ON achievement_process_commands
BEGIN
  INSERT INTO achievement_states(
    player_id,counter_version,counters_json,applied_events_json,event_awards_json,
    needs_reconciliation,reconciled_at,reconciliation_reason,created_at,updated_at
  ) VALUES(
    NEW.player_id,NEW.counter_version,NEW.counters_json,NEW.applied_events_json,NEW.event_awards_json,
    0,NULL,NULL,NEW.completed_at,NEW.completed_at
  )
  ON CONFLICT(player_id) DO UPDATE SET
    counter_version=excluded.counter_version,counters_json=excluded.counters_json,
    applied_events_json=excluded.applied_events_json,event_awards_json=excluded.event_awards_json,
    needs_reconciliation=0,updated_at=excluded.updated_at;
  INSERT INTO achievement_receipts(
    event_id,player_id,player_key,processor_version,status,earned_keys_json,removed_keys_json,
    issued_keys_json,reward_issued_at,created_at,completed_at,updated_at,last_error
  )
  SELECT NEW.event_id,NEW.player_id,e.player_key,NEW.processor_version,'completed',
         NEW.earned_keys_json,NEW.removed_keys_json,'[]',NULL,NEW.completed_at,NEW.completed_at,NEW.completed_at,NULL
  FROM achievement_events e WHERE e.id=NEW.event_id
  ON CONFLICT(event_id) DO UPDATE SET
    player_id=excluded.player_id,player_key=excluded.player_key,processor_version=excluded.processor_version,
    status='completed',earned_keys_json=excluded.earned_keys_json,removed_keys_json=excluded.removed_keys_json,
    completed_at=excluded.completed_at,updated_at=excluded.updated_at,last_error=NULL;
  UPDATE source_versions SET version=version+1,updated_at=NEW.completed_at
  WHERE source_key IN ('achievements','profiles','profileSummaries');
END;

CREATE TABLE recommendation_events (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL,
  protocol_family TEXT NOT NULL,
  protocol_schema_version INTEGER NOT NULL CHECK (protocol_schema_version >= 1),
  record_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  sequence INTEGER CHECK (sequence IS NULL OR sequence >= 1),
  source TEXT,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'user',
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json) AND json_type(payload_json)='object' AND length(payload_json)<=524288),
  UNIQUE(decision_id,event_key)
) STRICT;
CREATE INDEX recommendation_events_player_time_idx ON recommendation_events(player_id,occurred_at,id);
CREATE INDEX recommendation_events_decision_order_idx ON recommendation_events(decision_id,sequence,occurred_at,id);

CREATE TABLE model_settings (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  value_json TEXT NOT NULL CHECK (json_valid(value_json) AND length(value_json)<=1048576),
  source_version INTEGER NOT NULL DEFAULT 0 CHECK (source_version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(player_id,setting_key)
) STRICT;
CREATE INDEX model_settings_key_idx ON model_settings(setting_key,player_id,id);

CREATE TABLE analytics_events (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_version INTEGER NOT NULL DEFAULT 1 CHECK (event_version >= 1),
  event_name TEXT NOT NULL CHECK (length(event_name) BETWEEN 1 AND 256),
  surface TEXT NOT NULL CHECK (length(surface) BETWEEN 1 AND 128),
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR (json_valid(metadata_json) AND json_type(metadata_json)='object' AND length(metadata_json)<=131072)),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX analytics_events_player_time_idx ON analytics_events(player_id,created_at,id);
CREATE INDEX analytics_events_dedupe_idx ON analytics_events(player_id,event_name,surface,target_type,target_id,created_at);

CREATE TABLE derived_cache_entries (
  cache_key TEXT PRIMARY KEY,
  cache_kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  required_sources_json TEXT NOT NULL CHECK (json_valid(required_sources_json) AND json_type(required_sources_json)='array'),
  source_versions_json TEXT NOT NULL CHECK (json_valid(source_versions_json) AND json_type(source_versions_json)='object'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json)<=2097152),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  invalidated_at TEXT
) STRICT;
CREATE INDEX derived_cache_kind_idx ON derived_cache_entries(cache_kind,invalidated_at,created_at DESC,cache_key);

CREATE VIEW profile_summary_view AS
SELECT
  p.id AS player_id,
  p.username,
  p.profile_picture,
  p.elo,
  p.created_at,
  COALESCE((SELECT COUNT(*) FROM tasks t WHERE t.player_id=p.id AND t.completed_at IS NOT NULL),0) AS completed_tasks,
  COALESCE((SELECT SUM(t.points_base) FROM tasks t WHERE t.player_id=p.id AND t.completed_at IS NOT NULL),0) AS task_points,
  COALESCE((SELECT COUNT(*) FROM journals j WHERE j.player_id=p.id AND j.deleted_at IS NULL),0) AS journals,
  COALESCE((SELECT COUNT(*) FROM match_participants mp JOIN matches m ON m.id=mp.match_id WHERE mp.player_id=p.id AND m.status='complete'),0) AS completed_matches,
  COALESCE((SELECT COUNT(*) FROM friendship_members fm JOIN friendships f ON f.id=fm.friendship_id WHERE fm.player_id=p.id AND f.status='accepted'),0) AS accepted_friends,
  COALESCE((SELECT SUM(c.value) FROM contributions c WHERE c.player_id=p.id),0) AS contribution_total,
  COALESCE((SELECT SUM(i.quantity) FROM inventory_items i WHERE i.player_id=p.id),0) AS inventory_quantity
FROM players p;

CREATE VIEW match_leaderboard_view AS
SELECT
  p.id AS player_id,p.username,p.profile_picture,p.elo,
  COALESCE((SELECT COUNT(*) FROM match_participants mp JOIN matches m ON m.id=mp.match_id WHERE mp.player_id=p.id AND m.status='complete'),0) AS completed_matches,
  COALESCE((SELECT COUNT(*) FROM match_participants mp JOIN matches m ON m.id=mp.match_id WHERE mp.player_id=p.id AND m.status='complete' AND mp.result='win'),0) AS wins
FROM players p;

CREATE VIEW contribution_leaderboard_view AS
SELECT p.id AS player_id,p.username,p.profile_picture,COALESCE(SUM(c.value),0) AS contribution_total
FROM players p LEFT JOIN contributions c ON c.player_id=p.id
GROUP BY p.id,p.username,p.profile_picture;
`.trim();

export const migration014 = Object.freeze({
  id: '014_recovery_model_derived',
  description: 'Persist replay-safe achievement/model events and analytics while replacing copied summaries with views and disposable caches.',
  sourceApplicationVersion: 'batch22',
  sql: RECOVERY_MODEL_DERIVED_SCHEMA_SQL,
  checksum: '6a6073f1ecb28346383ee60f926ab0237753b6c9f2d6e713e2d15b9e029df7f6',
  compatibleChecksums: Object.freeze([
    '9e719dcf56caa58fd810db7642d3b8a4e95cff3dc0f181e8d4a4ff8aa0717def',
  ]),
});

export default migration014;
