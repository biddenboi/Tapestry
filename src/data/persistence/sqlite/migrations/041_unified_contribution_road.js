import { buildDocumentSchemaSql } from '../documentStores.js';

const roadDocumentSql = buildDocumentSchemaSql({
  includeContributionRoadStores: true,
  onlyContributionRoadStores: true,
});

export const UNIFIED_CONTRIBUTION_ROAD_SCHEMA_SQL = `
${roadDocumentSql}

CREATE TABLE contribution_road_catalog_versions (
  catalog_version INTEGER PRIMARY KEY CHECK (catalog_version>=1),
  catalog_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

INSERT INTO contribution_road_catalog_versions(
  catalog_version,catalog_id,activated_at,metadata_json
) VALUES(
  1,'unified-contribution-road-v1',CURRENT_TIMESTAMP,
  '{"branches":["compass","forge","chronicle","fellowship"],"openingTrailSteps":10}'
);

CREATE TABLE achievement_stage_receipts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  achievement_version INTEGER NOT NULL CHECK (achievement_version>=1),
  stage INTEGER NOT NULL CHECK (stage>=1),
  threshold_value REAL NOT NULL,
  source_event_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(source_event_ids_json) AND json_type(source_event_ids_json)='array'),
  evidence_snapshot_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(evidence_snapshot_json) AND json_type(evidence_snapshot_json)='object'),
  earned_at TEXT NOT NULL,
  migration_source TEXT,
  UNIQUE(profile_id,achievement_id,achievement_version,stage)
) STRICT;

CREATE INDEX achievement_stage_profile_time_idx
ON achievement_stage_receipts(profile_id,earned_at DESC,id);

CREATE TABLE contribution_road_stat_source_receipts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  stat_id TEXT NOT NULL,
  source_store TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount>=0),
  source_recorded_at TEXT,
  projection_version INTEGER NOT NULL CHECK (projection_version>=1),
  created_at TEXT NOT NULL,
  UNIQUE(profile_id,stat_id,source_store,source_record_id)
) STRICT;

CREATE INDEX contribution_road_stat_source_profile_idx
ON contribution_road_stat_source_receipts(profile_id,stat_id,source_recorded_at,id);

CREATE TABLE contribution_road_commit_receipts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  selected_nodes_json TEXT NOT NULL
    CHECK (json_valid(selected_nodes_json) AND json_type(selected_nodes_json)='array'),
  excluded_nodes_json TEXT NOT NULL
    CHECK (json_valid(excluded_nodes_json) AND json_type(excluded_nodes_json)='array'),
  contribution_spent INTEGER NOT NULL CHECK (contribution_spent>=0),
  inventory_grants_json TEXT NOT NULL
    CHECK (json_valid(inventory_grants_json) AND json_type(inventory_grants_json)='array'),
  catalog_version INTEGER NOT NULL REFERENCES contribution_road_catalog_versions(catalog_version),
  committed_at TEXT NOT NULL,
  UNIQUE(profile_id,chapter_id)
) STRICT;

CREATE INDEX contribution_road_commit_profile_idx
ON contribution_road_commit_receipts(profile_id,committed_at,id);
`.trim();

export const migration041 = Object.freeze({
  id: '041_unified_contribution_road',
  description: 'Unify achievements, stat gates, Contribution choices, interface reveals, and durable rank-era recognition metadata.',
  sourceApplicationVersion: 'unified-contribution-road-v1',
  sql: UNIFIED_CONTRIBUTION_ROAD_SCHEMA_SQL,
  checksum: '3ca97bedcdde75ed3de0bab05bc07c32a87ee959bdcab06d96e0fb19eb99cfa0',
});

export default migration041;
