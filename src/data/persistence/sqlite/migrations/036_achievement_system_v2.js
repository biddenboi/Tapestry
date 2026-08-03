export const ACHIEVEMENT_V2_SCHEMA_SQL = `
CREATE TABLE migration_safety_receipts (
  id TEXT PRIMARY KEY,
  source_schema_version TEXT,
  target_schema_version TEXT NOT NULL,
  source_application_version TEXT,
  manifest_checksum TEXT NOT NULL,
  snapshot_byte_length INTEGER NOT NULL CHECK (snapshot_byte_length>=0),
  record_counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(record_counts_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('prepared','completed','failed')),
  error_message TEXT
) STRICT;

CREATE INDEX migration_safety_outcome_idx
ON migration_safety_receipts(outcome,started_at DESC,id);

CREATE TABLE save_verification_reports (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  integrity_status TEXT NOT NULL,
  foreign_key_status TEXT NOT NULL,
  record_counts_json TEXT NOT NULL CHECK (json_valid(record_counts_json)),
  orphan_counts_json TEXT NOT NULL CHECK (json_valid(orphan_counts_json)),
  missing_resources_json TEXT NOT NULL CHECK (json_valid(missing_resources_json)),
  cache_status_json TEXT NOT NULL CHECK (json_valid(cache_status_json)),
  technical_json TEXT NOT NULL CHECK (json_valid(technical_json)),
  verified_at TEXT NOT NULL
) STRICT;

CREATE TABLE achievement_v2_definitions (
  achievement_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version>=1),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  permanence TEXT NOT NULL CHECK (permanence IN ('permanent','record')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public','private','selectable')),
  secret INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0,1)),
  evidence_rule_id TEXT NOT NULL,
  progress_rule_id TEXT,
  reward_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(reward_json)),
  retired_at TEXT,
  replacement_id TEXT,
  PRIMARY KEY(achievement_id,version)
) STRICT;

CREATE TABLE achievement_v2_progress (
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  achievement_version INTEGER NOT NULL,
  progress_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(progress_json) AND json_type(progress_json)='object'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id,achievement_id,achievement_version)
) STRICT;

CREATE TABLE achievement_evidence_receipts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  achievement_version INTEGER NOT NULL CHECK (achievement_version>=1),
  source_event_ids_json TEXT NOT NULL CHECK (json_valid(source_event_ids_json) AND json_type(source_event_ids_json)='array'),
  evidence_snapshot_json TEXT NOT NULL CHECK (json_valid(evidence_snapshot_json) AND json_type(evidence_snapshot_json)='object'),
  earned_at TEXT NOT NULL,
  processor_version INTEGER NOT NULL CHECK (processor_version>=1),
  migration_source TEXT,
  UNIQUE(profile_id,achievement_id,achievement_version)
) STRICT;

CREATE INDEX achievement_evidence_profile_time_idx
ON achievement_evidence_receipts(profile_id,earned_at DESC,id);

CREATE TABLE achievement_legacy_awards (
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  legacy_key TEXT NOT NULL,
  title_snapshot TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json)),
  migration_source TEXT NOT NULL,
  preserved_selected INTEGER NOT NULL DEFAULT 0 CHECK (preserved_selected IN (0,1)),
  PRIMARY KEY(profile_id,legacy_key)
) STRICT;

CREATE TABLE achievement_records (
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  achieved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_event_id TEXT,
  PRIMARY KEY(profile_id,record_id)
) STRICT;

CREATE TABLE achievement_v2_migration_receipts (
  profile_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  migration_id TEXT NOT NULL,
  legacy_count INTEGER NOT NULL DEFAULT 0 CHECK (legacy_count>=0),
  mapped_count INTEGER NOT NULL DEFAULT 0 CHECK (mapped_count>=0),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count>=0),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json))
) STRICT;

INSERT INTO achievement_legacy_awards(
  profile_id,legacy_key,title_snapshot,earned_at,evidence_json,migration_source,preserved_selected
)
SELECT
  d.uuid,
  legacy.key,
  legacy.key,
  COALESCE(json_extract(legacy.value,'$.earnedAt'),d.updated_at,d.created_at,'1970-01-01T00:00:00.000Z'),
  json_object('legacyValue',json(legacy.value)),
  '036_achievement_system_v2',
  CASE WHEN EXISTS(
    SELECT 1 FROM json_each(COALESCE(json_extract(d.record_json,'$.selectedAchievements'),'[]')) selected
    WHERE selected.value=legacy.key
  ) THEN 1 ELSE 0 END
FROM document_players d, json_each(COALESCE(json_extract(d.record_json,'$.achievements'),'{}')) legacy
WHERE EXISTS(SELECT 1 FROM players p WHERE p.id=d.uuid)
ON CONFLICT(profile_id,legacy_key) DO NOTHING;

INSERT INTO achievement_v2_migration_receipts(
  profile_id,migration_id,legacy_count,mapped_count,evidence_count,started_at,completed_at,provenance_json
)
SELECT
  p.id,
  '036_achievement_system_v2',
  (SELECT COUNT(*) FROM achievement_legacy_awards legacy WHERE legacy.profile_id=p.id),
  0,
  0,
  COALESCE(p.updated_at,p.created_at,'1970-01-01T00:00:00.000Z'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  '{"strategy":"preserve-without-unsafe-inference"}'
FROM players p
WHERE 1=1
ON CONFLICT(profile_id) DO NOTHING;
`.trim();

export const migration036 = Object.freeze({
  id: '036_achievement_system_v2',
  description: 'Separate permanent achievements, mutable records, collections, and preserved Legacy awards with explainable evidence receipts.',
  sourceApplicationVersion: 'ia-achievements-v2',
  sql: ACHIEVEMENT_V2_SCHEMA_SQL,
  checksum: 'b1e1264c55b2ee29c2620d6ae038dc4a160f0eddf101ba564d35ee9caabff258',
});

export default migration036;
