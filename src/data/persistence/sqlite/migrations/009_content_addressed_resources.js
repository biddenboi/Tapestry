export const CONTENT_ADDRESSED_RESOURCES_SCHEMA_SQL = `
CREATE TABLE resources (
  content_hash TEXT PRIMARY KEY CHECK (length(content_hash) = 64),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/gif','image/webp','application/octet-stream')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  extension TEXT NOT NULL CHECK (extension IN ('png','jpg','gif','webp','bin')),
  storage_path TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','quarantined','garbage')),
  created_at TEXT NOT NULL,
  verified_at TEXT,
  quarantined_at TEXT,
  quarantine_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536)
) STRICT;

CREATE INDEX resources_state_idx ON resources(state, created_at, content_hash);

CREATE TABLE resource_references (
  id TEXT PRIMARY KEY,
  resource_hash TEXT NOT NULL REFERENCES resources(content_hash) ON DELETE RESTRICT,
  owner_type TEXT NOT NULL CHECK (length(owner_type) BETWEEN 1 AND 64),
  owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 256),
  role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536)
) STRICT;

CREATE UNIQUE INDEX resource_references_live_owner_role_idx
ON resource_references(owner_type, owner_id, role)
WHERE deleted_at IS NULL;
CREATE INDEX resource_references_hash_idx
ON resource_references(resource_hash, deleted_at, owner_type, owner_id);

CREATE TABLE resource_file_ops (
  operation_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('promote','dereference','quarantine')),
  state TEXT NOT NULL CHECK (state IN ('prepared','published','indexed','quarantined','cancelled')),
  resource_hash TEXT,
  staging_path TEXT,
  target_path TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  reference_id TEXT,
  owner_type TEXT,
  owner_id TEXT,
  role TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536),
  prepared_at TEXT NOT NULL,
  published_at TEXT,
  indexed_at TEXT,
  error_code TEXT,
  error_detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(error_detail_json) AND length(error_detail_json) <= 65536)
) STRICT;

CREATE INDEX resource_file_ops_state_idx ON resource_file_ops(state, prepared_at, operation_id);
CREATE INDEX resource_file_ops_hash_idx ON resource_file_ops(resource_hash, state, operation_id);

CREATE TABLE resource_reconciliation_issues (
  id TEXT PRIMARY KEY,
  issue_type TEXT NOT NULL,
  resource_hash TEXT,
  operation_id TEXT,
  path TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 65536),
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
) STRICT;
CREATE INDEX resource_reconciliation_open_idx
ON resource_reconciliation_issues(resolved_at, issue_type, detected_at, id);

CREATE TABLE resource_reference_tombstones (
  reference_id TEXT PRIMARY KEY,
  resource_hash TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL,
  tombstoned_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE resource_gc_candidates (
  resource_hash TEXT PRIMARY KEY REFERENCES resources(content_hash) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  eligible_after TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX resource_gc_eligible_idx ON resource_gc_candidates(eligible_after, resource_hash);

CREATE TABLE resource_backup_pins (
  backup_id TEXT NOT NULL,
  resource_hash TEXT NOT NULL REFERENCES resources(content_hash) ON DELETE CASCADE,
  retained_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(backup_id, resource_hash)
) STRICT;
CREATE INDEX resource_backup_pins_retention_idx
ON resource_backup_pins(resource_hash, retained_until, backup_id);
`.trim();

export const migration009 = Object.freeze({
  id: '009_content_addressed_resources',
  description: 'Add validated content-addressed resources, durable file intents, quarantine, references, and backup-aware garbage collection.',
  sourceApplicationVersion: 'batch17',
  sql: CONTENT_ADDRESSED_RESOURCES_SCHEMA_SQL,
  checksum: 'f106aae25054d71b64e4fc1ba488fb2408add4403ea86ce93141f74b9a74b9c3',
});

export default migration009;
