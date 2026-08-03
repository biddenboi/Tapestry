const CONTINUITY_DOCUMENT_TABLES = [
  'document_action_plans',
  'document_action_sessions',
  'document_handoffs',
  'document_rhythm_definitions',
  'document_rhythm_opportunities',
  'document_intervention_decisions',
  'document_reward_provenance',
  'document_world_consequence_receipts',
  'document_match_score_events',
];

const documentTablesSql = CONTINUITY_DOCUMENT_TABLES.map((table) => `
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

export const CONTINUITY_SYSTEM_SCHEMA_SQL = `
${documentTablesSql}

CREATE TABLE action_plans (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'todo','habit','event','goal-next-action','match'
  )),
  target_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'time','window','app-open','event-end','location','manual'
  )),
  trigger_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(trigger_json) AND json_type(trigger_json)='object'
  ),
  planned_window_start TEXT,
  planned_window_end TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'active','consumed','dismissed','expired','superseded'
  )),
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE INDEX action_plans_player_status_window_idx
ON action_plans(player_id,status,planned_window_start,planned_window_end,id);

CREATE TABLE action_sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'todo','habit','event','goal-action'
  )),
  target_id TEXT NOT NULL,
  goal_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES goal_milestones(id) ON DELETE SET NULL,
  match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  dojo_session_id TEXT,
  source TEXT NOT NULL CHECK (source IN (
    'arrival','recommender','manual','notification','shared','match'
  )),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  active_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (active_duration_ms >= 0),
  paused_duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (paused_duration_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'active','completed','progressed','blocked','stopped'
  )),
  blocker_type TEXT,
  next_step TEXT,
  outcome_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX action_sessions_one_active_per_player_idx
ON action_sessions(player_id) WHERE outcome='active';

CREATE INDEX action_sessions_player_time_idx
ON action_sessions(player_id,started_at DESC,id);

CREATE INDEX action_sessions_match_idx
ON action_sessions(match_id,started_at,id) WHERE match_id IS NOT NULL;

CREATE TABLE handoffs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source_session_id TEXT REFERENCES action_sessions(id) ON DELETE SET NULL,
  resume_target_type TEXT,
  resume_target_id TEXT,
  goal_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES goal_milestones(id) ON DELETE SET NULL,
  next_step TEXT,
  unresolved_context TEXT,
  generated_summary TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'active','consumed','expired','superseded'
  )),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  consumed_at TEXT
) STRICT;

CREATE INDEX handoffs_player_status_time_idx
ON handoffs(player_id,status,created_at DESC,id);

CREATE TABLE rhythm_definitions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN (
    'habit','review','task-template'
  )),
  target_id TEXT NOT NULL,
  cadence_type TEXT NOT NULL CHECK (cadence_type IN (
    'daily','weekdays','times-per-week','duration-per-week','event-triggered'
  )),
  opportunities_per_period INTEGER,
  eligible_weekdays_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(eligible_weekdays_json) AND json_type(eligible_weekdays_json)='array'
  ),
  minimum_quantity REAL,
  timezone TEXT NOT NULL,
  active_from TEXT NOT NULL,
  active_until TEXT,
  streak_visible INTEGER NOT NULL DEFAULT 0 CHECK (streak_visible IN (0,1))
) STRICT;

CREATE INDEX rhythm_definitions_player_active_idx
ON rhythm_definitions(player_id,active_from,active_until,id);

CREATE TABLE rhythm_opportunities (
  id TEXT PRIMARY KEY,
  rhythm_id TEXT NOT NULL REFERENCES rhythm_definitions(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending','completed','skipped','blocked','expired','rescheduled'
  )),
  evidence_id TEXT,
  resolution_reason TEXT,
  resolved_at TEXT
) STRICT;

CREATE UNIQUE INDEX rhythm_opportunities_window_idx
ON rhythm_opportunities(rhythm_id,window_start,window_end);

CREATE INDEX rhythm_opportunities_player_window_idx
ON rhythm_opportunities(player_id,window_start,window_end,status,id);

CREATE TABLE intervention_decisions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  decision_point TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK (
    json_valid(context_json) AND json_type(context_json)='object'
  ),
  candidate_type TEXT NOT NULL,
  candidate_target_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('deliver','suppress')),
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json) AND json_type(reason_codes_json)='array'
  ),
  delivered_at TEXT,
  dismissed_at TEXT,
  opened_at TEXT,
  action_started_at TEXT,
  user_rating TEXT CHECK (
    user_rating IS NULL OR user_rating IN ('useful','neutral','unhelpful')
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX intervention_decisions_player_time_idx
ON intervention_decisions(player_id,created_at DESC,id);

CREATE INDEX intervention_decisions_candidate_idx
ON intervention_decisions(player_id,candidate_type,candidate_target_id,created_at DESC);

CREATE TABLE reward_provenance (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  reward_type TEXT NOT NULL CHECK (reward_type IN (
    'points','coins','contribution','elo','cosmetic'
  )),
  amount REAL,
  item_id TEXT,
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  explanation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL
) STRICT;

CREATE INDEX reward_provenance_player_time_idx
ON reward_provenance(player_id,issued_at DESC,id);

CREATE INDEX reward_provenance_source_idx
ON reward_provenance(source_event_id,reward_type,id);

CREATE TABLE world_consequence_receipts (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  consequence_type TEXT NOT NULL,
  consequence_json TEXT NOT NULL CHECK (
    json_valid(consequence_json) AND json_type(consequence_json)='object'
  ),
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  created_at TEXT NOT NULL,
  revealed_at TEXT,
  applied_at TEXT
) STRICT;

CREATE UNIQUE INDEX world_consequence_source_policy_idx
ON world_consequence_receipts(source_event_id,consequence_type,policy_version);

CREATE INDEX world_consequence_player_reveal_idx
ON world_consequence_receipts(player_id,revealed_at,created_at,id);

CREATE TABLE match_score_events (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  action_session_id TEXT REFERENCES action_sessions(id) ON DELETE SET NULL,
  task_completion_event_id TEXT,
  eligible_rule_id TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  occurred_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(evidence_json) AND json_type(evidence_json)='object'
  )
) STRICT;

CREATE UNIQUE INDEX match_score_events_evidence_idx
ON match_score_events(match_id,participant_id,action_session_id,task_completion_event_id);

CREATE INDEX match_score_events_match_time_idx
ON match_score_events(match_id,occurred_at,participant_id,id);

ALTER TABLE semantic_presence_intervals
ADD COLUMN visibility_policy TEXT NOT NULL DEFAULT 'state-only'
CHECK (visibility_policy IN ('state-only','goal','task','private'));

ALTER TABLE semantic_presence_intervals
ADD COLUMN expires_at TEXT;

UPDATE document_custom_events
SET record_json=json_set(record_json,'$.rewardPolicy','legacy-context-only')
WHERE json_extract(record_json,'$.specialKind') IN ('wake_time','sleep_time','first_match');
`.trim();

export const migration031 = Object.freeze({
  id: '031_continuity_system',
  description: 'Add continuity sessions, Handoffs, Rhythms, intervention policy, reward provenance, Match score audit, and world receipts.',
  sourceApplicationVersion: 'continuity-system-v1',
  sql: CONTINUITY_SYSTEM_SCHEMA_SQL,
  checksum: '0416421f8024c8f0b3afc2c8730639692035b9186d148fa9c631800481c47476',
});

export default migration031;
