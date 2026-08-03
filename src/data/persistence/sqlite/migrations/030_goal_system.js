const DOCUMENT_GOAL_TABLES = [
  'document_goal_areas',
  'document_goal_milestones',
  'document_goal_updates',
  'document_goal_links',
  'document_goal_participants',
];

const documentTablesSql = DOCUMENT_GOAL_TABLES.map((table) => `
CREATE TABLE IF NOT EXISTS ${table} (
  uuid TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  parent_uuid TEXT,
  created_at TEXT,
  updated_at TEXT,
  in_game_timestamp INTEGER,
  sort_key TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1)
) STRICT;

CREATE INDEX IF NOT EXISTS ${table}_parent_timeline_idx
ON ${table}(parent_uuid, in_game_timestamp, sort_key, uuid);

CREATE INDEX IF NOT EXISTS ${table}_sort_idx
ON ${table}(sort_key, uuid);

CREATE UNIQUE INDEX IF NOT EXISTS ${table}_sequence_idx
ON ${table}(sequence);
`.trim()).join('\n\n');

export const GOAL_SYSTEM_SCHEMA_SQL = `
${documentTablesSql}

CREATE TABLE goal_areas (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  accent_color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0)
) STRICT;

CREATE UNIQUE INDEX goal_areas_player_name_idx
ON goal_areas(player_id, name COLLATE NOCASE)
WHERE archived_at IS NULL;

CREATE TABLE goal_milestones (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('milestone','learning_stage')),
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('not_started','active','blocked','completed','skipped')),
  target_date TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0),
  completed_in_game_timestamp INTEGER CHECK (
    completed_in_game_timestamp IS NULL OR completed_in_game_timestamp >= 0
  )
) STRICT;

CREATE INDEX goal_milestones_goal_position_idx
ON goal_milestones(goal_id, position, id);

CREATE INDEX goal_milestones_player_igt_idx
ON goal_milestones(player_id, in_game_timestamp, id);

CREATE TABLE goal_updates (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  health_status_snapshot TEXT,
  lifecycle_status_snapshot TEXT,
  source_type TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0)
) STRICT;

CREATE INDEX goal_updates_goal_time_idx
ON goal_updates(goal_id, in_game_timestamp DESC, created_at DESC, id);

CREATE UNIQUE INDEX goal_updates_source_receipt_idx
ON goal_updates(goal_id, source_type, source_id, kind)
WHERE source_id IS NOT NULL;

CREATE TABLE goal_links (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id TEXT REFERENCES goal_milestones(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('supports','evidence','next_action')),
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0)
) STRICT;

CREATE UNIQUE INDEX goal_links_unique_idx
ON goal_links(goal_id, entity_type, entity_id, relation);

CREATE INDEX goal_links_entity_idx
ON goal_links(entity_type, entity_id, goal_id);

CREATE TABLE goal_participants (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','contributor','viewer')),
  joined_at TEXT NOT NULL,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0),
  UNIQUE(goal_id, player_id)
) STRICT;

UPDATE projects
SET extra_json = json_set(
  extra_json,
  '$.finishCondition', COALESCE(json_extract(extra_json, '$.finishCondition'), description, ''),
  '$.progressType', COALESCE(json_extract(extra_json, '$.progressType'), 'milestones'),
  '$.lifecycleStatus', COALESCE(
    json_extract(extra_json, '$.lifecycleStatus'),
    CASE
      WHEN archived_at IS NOT NULL OR status='archived' THEN 'archived'
      WHEN completed_at IS NOT NULL OR status='completed' THEN 'completed'
      ELSE 'active'
    END
  ),
  '$.healthStatus', COALESCE(json_extract(extra_json, '$.healthStatus'), 'unset'),
  '$.participationMode', COALESCE(json_extract(extra_json, '$.participationMode'), 'collaborative'),
  '$.visibility', COALESCE(json_extract(extra_json, '$.visibility'), 'participants'),
  '$.reviewIntervalDays', COALESCE(json_extract(extra_json, '$.reviewIntervalDays'), 7),
  '$.needsGoalDefinition', CASE
    WHEN TRIM(COALESCE(json_extract(extra_json, '$.finishCondition'), ''))='' THEN 1
    ELSE COALESCE(json_extract(extra_json, '$.needsGoalDefinition'), 0)
  END
);

INSERT OR IGNORE INTO goal_participants(
  id,goal_id,player_id,role,joined_at,in_game_timestamp
)
SELECT
  'goal-participant:' || id || ':' || player_id,
  id,
  player_id,
  'owner',
  COALESCE(created_at, updated_at, '1970-01-01T00:00:00.000Z'),
  in_game_timestamp
FROM projects;
`.trim();

export const migration030 = Object.freeze({
  id: '030_goal_system',
  description: 'Add Areas, typed Goal progress, milestones, updates, links, participants, and compact canonical stores.',
  sourceApplicationVersion: 'goals-system-v1',
  sql: GOAL_SYSTEM_SCHEMA_SQL,
  checksum: '6b701bc7c427cd6cca7960afec233abcfc1951154e28d92bfb4301f6d5e11fa4',
});

export default migration030;
