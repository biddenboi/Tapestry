const NEXT_MOVE_DOCUMENT_TABLES = [
  'document_task_plan_receipts',
  'document_next_move_decisions',
  'document_next_move_feedback',
  'document_next_move_surface_preferences',
];

const documentTablesSql = NEXT_MOVE_DOCUMENT_TABLES.map((table) => `
CREATE TABLE ${table} (
  uuid TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  parent_uuid TEXT,
  created_at TEXT,
  updated_at TEXT,
  in_game_timestamp INTEGER,
  sort_key TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1)
) STRICT;

CREATE INDEX ${table}_parent_timeline_idx
ON ${table}(parent_uuid, in_game_timestamp, sort_key, uuid);

CREATE INDEX ${table}_sort_idx
ON ${table}(sort_key, uuid);

CREATE UNIQUE INDEX ${table}_sequence_idx
ON ${table}(sequence);
`.trim()).join('\n\n');

export const NEXT_MOVE_PHASE_NAVIGATOR_SCHEMA_SQL = `
${documentTablesSql}

ALTER TABLE todos ADD COLUMN plan_eligible INTEGER NOT NULL DEFAULT 0
CHECK (plan_eligible IN (0,1));
ALTER TABLE todos ADD COLUMN task_revision_hash TEXT;
ALTER TABLE todos ADD COLUMN blocker_type TEXT;
ALTER TABLE todos ADD COLUMN clarification_failures INTEGER NOT NULL DEFAULT 0
CHECK (clarification_failures >= 0);

UPDATE todos
SET description=COALESCE(NULLIF(trim(description),''),NULLIF(trim(plan_notes),'')),
    plan_eligible=CASE
      WHEN instr(lower(COALESCE(NULLIF(description,''),plan_notes,'')),'#plan')>0 THEN 1
      ELSE plan_eligible
    END;

UPDATE document_todos
SET record_json=json_set(
  record_json,
  '$.description',
  COALESCE(
    NULLIF(trim(json_extract(record_json,'$.description')),''),
    NULLIF(trim(json_extract(record_json,'$.efficiency')),''),
    ''
  ),
  '$.planEligible',
  CASE
    WHEN json_extract(record_json,'$.planEligible')=1
      OR instr(lower(COALESCE(
        json_extract(record_json,'$.description'),
        json_extract(record_json,'$.efficiency'),
        ''
      )),'#plan')>0
    THEN json('true')
    ELSE json('false')
  END
);

CREATE TABLE task_plan_receipts (
  id TEXT PRIMARY KEY,
  player_uuid TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  task_uuid TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  task_revision_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  next_action TEXT NOT NULL CHECK (length(trim(next_action)) BETWEEN 1 AND 500),
  intended_trigger_type TEXT CHECK (
    intended_trigger_type IS NULL OR intended_trigger_type IN ('time','event','location','manual')
  ),
  intended_trigger_value TEXT,
  optional_steps_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(optional_steps_json) AND json_type(optional_steps_json)='array'
  ),
  estimated_remaining_minutes INTEGER CHECK (
    estimated_remaining_minutes IS NULL OR estimated_remaining_minutes >= 0
  ),
  blocker_type TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','consumed','invalidated')),
  invalidated_at TEXT,
  consumed_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
) STRICT;

CREATE INDEX task_plan_receipts_active_idx
ON task_plan_receipts(player_uuid,task_uuid,status,created_at DESC,id);

CREATE TABLE next_move_decisions (
  id TEXT PRIMARY KEY,
  player_uuid TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ruleset_version TEXT NOT NULL CHECK (ruleset_version='next_move_v1'),
  decision_point TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result_type TEXT NOT NULL CHECK (result_type IN (
    'active','commitment','continue','execute','clarify','reorient-day',
    'reorient-goal','reflect','recover','ask','none'
  )),
  destination_json TEXT CHECK (destination_json IS NULL OR json_valid(destination_json)),
  primary_action_json TEXT CHECK (primary_action_json IS NULL OR json_valid(primary_action_json)),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json)='array'
  ),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  source_entity_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(source_entity_refs_json) AND json_type(source_entity_refs_json)='array'
  ),
  invalidation_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(invalidation_keys_json) AND json_type(invalidation_keys_json)='array'
  ),
  shown_at TEXT,
  accepted_at TEXT,
  dismissed_at TEXT,
  corrected_at TEXT,
  resulting_action_started_at TEXT,
  outcome TEXT
) STRICT;

CREATE INDEX next_move_decisions_player_time_idx
ON next_move_decisions(player_uuid,created_at DESC,id);

CREATE TABLE next_move_feedback (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES next_move_decisions(id) ON DELETE CASCADE,
  player_uuid TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN (
    'already-handled','not-possible-now','not-important','wrong-context',
    'need-shorter','need-plan','manual-choice','not-now','other'
  )),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(payload_json) AND json_type(payload_json)='object'
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX next_move_feedback_decision_idx
ON next_move_feedback(decision_id,created_at,id);

CREATE TABLE next_move_surface_preferences (
  player_uuid TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  placement_mode TEXT NOT NULL CHECK (placement_mode IN ('docked','floating')),
  dock_edge TEXT CHECK (dock_edge IS NULL OR dock_edge IN ('left','right')),
  normalized_x REAL CHECK (normalized_x IS NULL OR normalized_x BETWEEN 0 AND 1),
  normalized_y REAL CHECK (normalized_y IS NULL OR normalized_y BETWEEN 0 AND 1),
  width INTEGER CHECK (width IS NULL OR width BETWEEN 320 AND 520),
  updated_at TEXT NOT NULL
) STRICT;
`.trim();

export const migration034 = Object.freeze({
  id: '034_next_move_phase_navigator',
  description: 'Add deterministic Next Move decisions, Plan Receipts, correction history, accessible placement, and canonical task descriptions.',
  sourceApplicationVersion: 'next-move-v1',
  sql: NEXT_MOVE_PHASE_NAVIGATOR_SCHEMA_SQL,
  checksum: '6e8c983ba604fd53f82ddf8d8683b231955ebfba9fa47eead4a0165db674751b',
});

export default migration034;
