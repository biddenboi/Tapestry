export const PLANNING_SCHEMA_SQL = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  created_at TEXT,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0),
  updated_at TEXT,
  completed_at TEXT,
  archived_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
) STRICT;

CREATE INDEX projects_player_status_idx ON projects(player_id, status, created_at DESC);
CREATE INDEX projects_player_igt_idx ON projects(player_id, in_game_timestamp, id);

CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  plan_notes TEXT,
  estimated_duration_minutes REAL CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0),
  due_at TEXT,
  aversion REAL CHECK (aversion IS NULL OR aversion >= 0),
  created_at TEXT,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0),
  updated_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
) STRICT;

CREATE INDEX todos_player_due_idx ON todos(player_id, in_game_timestamp, due_at, created_at, id);
CREATE INDEX todos_project_idx ON todos(project_id, created_at, id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL,
  previous_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  plan_notes TEXT,
  reason_to_select TEXT,
  estimated_duration_minutes REAL CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0),
  actual_duration_ms INTEGER CHECK (actual_duration_ms IS NULL OR actual_duration_ms >= 0),
  points REAL NOT NULL DEFAULT 0 CHECK (points >= 0),
  points_base REAL NOT NULL DEFAULT 0 CHECK (points_base >= 0),
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT,
  in_game_timestamp INTEGER,
  completed_in_game_timestamp INTEGER,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  CHECK (previous_task_id IS NULL OR previous_task_id <> id)
) STRICT;

CREATE INDEX tasks_player_completed_idx ON tasks(player_id, completed_at DESC, id);
CREATE INDEX tasks_player_igt_idx ON tasks(player_id, completed_in_game_timestamp, in_game_timestamp, id);
CREATE INDEX tasks_project_idx ON tasks(project_id, completed_at DESC, id);
CREATE INDEX tasks_previous_idx ON tasks(previous_task_id);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  remind_at TEXT,
  snoozed_until TEXT,
  completed_at TEXT,
  dismissed_at TEXT,
  created_at TEXT,
  in_game_timestamp INTEGER NOT NULL DEFAULT 0 CHECK (in_game_timestamp >= 0),
  updated_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
) STRICT;

CREATE INDEX reminders_player_schedule_idx
ON reminders(player_id, in_game_timestamp, completed_at, dismissed_at, snoozed_until, remind_at, created_at, id);
`.trim();

export const migration004 = Object.freeze({
  id: '004_planning',
  description: 'Create normalized projects, todos, tasks, and reminders with distinct work and competition points.',
  sourceApplicationVersion: 'batch12',
  sql: PLANNING_SCHEMA_SQL,
  checksum: 'a41c07884fc03784c62e098c7cce6e02416705e3832a5118ea5d8dce2370a8d9',
  compatibleChecksums: Object.freeze([
    'eecda968484bef407639576ba67fd8fe61ff9e231621837e1108cbfc957b68b5',
  ]),
});

export default migration004;
