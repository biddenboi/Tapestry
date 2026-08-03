export const ROUTINE_RUNS_SQL = `
CREATE TABLE routine_runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  routine_type TEXT NOT NULL CHECK(routine_type IN ('day','night')),
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','active','completed','skipped')),
  current_step_id TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(steps_json) AND json_type(steps_json)='array'),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(player_id,routine_type,scheduled_for)
) STRICT;

CREATE TABLE routine_step_receipts (
  id TEXT PRIMARY KEY,
  routine_run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  UNIQUE(routine_run_id,step_id)
) STRICT;

CREATE INDEX routine_runs_player_status_idx
ON routine_runs(player_id,status,updated_at DESC);

CREATE INDEX routine_step_receipts_run_idx
ON routine_step_receipts(routine_run_id,completed_at,step_id);

PRAGMA optimize;
`.trim();

export const migration048 = Object.freeze({
  id: '048_routine_runs',
  description: 'Add normalized resumable day/night routine runs and idempotent step receipts.',
  sourceApplicationVersion: 'mobile-routines-v1',
  sql: ROUTINE_RUNS_SQL,
  checksum: 'a7039fe9486e7ae9a19eea264ffd52cd4cb93831280473a6a43d32f5deb9da80',
});

export default migration048;
