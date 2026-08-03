export const EVENTS_CONTRIBUTIONS_MAP_SCHEMA_SQL = `
CREATE TABLE lifecycle_events (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  name TEXT,
  category TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  location_accuracy REAL CHECK (location_accuracy IS NULL OR location_accuracy >= 0),
  location_captured_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 131072)
) STRICT;
CREATE INDEX lifecycle_events_player_igt_idx ON lifecycle_events(player_id, in_game_timestamp, created_at, id);
CREATE INDEX lifecycle_events_type_created_idx ON lifecycle_events(event_type, created_at DESC, id);
CREATE INDEX lifecycle_events_location_idx ON lifecycle_events(player_id, latitude, longitude, in_game_timestamp);

CREATE TABLE custom_events (
  id TEXT PRIMARY KEY,
  owner_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  special_kind TEXT,
  name TEXT NOT NULL,
  description TEXT,
  daily_target REAL,
  unit TEXT,
  max_bonus_pct REAL,
  accent_color TEXT,
  banner_color TEXT,
  banner_resource_hash TEXT REFERENCES resources(content_hash) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  archived_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 131072)
) STRICT;
CREATE INDEX custom_events_owner_type_idx ON custom_events(owner_player_id, event_type, archived_at, name, id);
CREATE INDEX custom_events_special_idx ON custom_events(special_kind, id);

CREATE TABLE event_logs (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  event_id TEXT REFERENCES custom_events(id) ON DELETE SET NULL,
  event_type TEXT,
  status TEXT,
  value REAL,
  logged_at TEXT NOT NULL,
  logged_date TEXT,
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  location_accuracy REAL CHECK (location_accuracy IS NULL OR location_accuracy >= 0),
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 131072)
) STRICT;
CREATE INDEX event_logs_event_time_idx ON event_logs(event_id, logged_at DESC, id);
CREATE INDEX event_logs_player_igt_idx ON event_logs(player_id, in_game_timestamp, logged_at, id);
CREATE INDEX event_logs_status_idx ON event_logs(status, event_type, logged_at, id);
CREATE INDEX event_logs_location_idx ON event_logs(player_id, latitude, longitude, in_game_timestamp);

CREATE TABLE event_buffs (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES custom_events(id) ON DELETE SET NULL,
  multiplier_value REAL NOT NULL DEFAULT 1 CHECK (multiplier_value >= 0),
  accumulated_value REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  expires_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 65536)
) STRICT;
CREATE INDEX event_buffs_player_expiry_idx ON event_buffs(player_id, expires_at, event_id, id);

CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  goal_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL,
  completion_event_id TEXT UNIQUE,
  source TEXT NOT NULL,
  direction TEXT,
  summary TEXT,
  value REAL NOT NULL DEFAULT 0,
  reward_band TEXT,
  reward_rarity TEXT,
  reward_coins INTEGER NOT NULL DEFAULT 0 CHECK (reward_coins >= 0),
  player_name_snapshot TEXT,
  goal_name_snapshot TEXT,
  task_name_snapshot TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  in_game_timestamp INTEGER,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 131072)
) STRICT;
CREATE INDEX contributions_player_igt_idx ON contributions(player_id, in_game_timestamp, created_at, id);
CREATE INDEX contributions_goal_created_idx ON contributions(goal_id, created_at, id);
CREATE INDEX contributions_task_idx ON contributions(task_id, id);

CREATE VIEW event_map_points AS
SELECT 'lifecycle' AS source_type,id AS source_id,player_id,event_type AS point_type,
       latitude,longitude,location_accuracy,in_game_timestamp,created_at
FROM lifecycle_events WHERE latitude IS NOT NULL AND longitude IS NOT NULL
UNION ALL
SELECT 'event-log',id,player_id,COALESCE(event_type,'event-log'),
       latitude,longitude,location_accuracy,in_game_timestamp,logged_at
FROM event_logs WHERE latitude IS NOT NULL AND longitude IS NOT NULL
UNION ALL
SELECT 'contribution',id,player_id,source,
       latitude,longitude,NULL,in_game_timestamp,created_at
FROM contributions WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
`.trim();

export const migration011 = Object.freeze({
  id: '011_events_contributions_map',
  description: 'Normalize lifecycle/custom events, logs, buffs, contributions, and indexed map source projections.',
  sourceApplicationVersion: 'batch19',
  sql: EVENTS_CONTRIBUTIONS_MAP_SCHEMA_SQL,
  checksum: 'd6ad42d765bd8b9d85034761cedb01e621986a8d4cd37da52abc7bca9c67b843',
});
export default migration011;
