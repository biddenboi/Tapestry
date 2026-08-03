export const JOURNAL_FILE_OPS_SCHEMA_SQL = `
CREATE TABLE journal_file_ops (
  operation_id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES journals(id),
  operation_type TEXT NOT NULL CHECK (operation_type IN ('create','update','move','delete','external-import')),
  state TEXT NOT NULL CHECK (state IN ('prepared','published','indexed','quarantined','cancelled')),
  expected_path TEXT,
  expected_hash TEXT CHECK (expected_hash IS NULL OR length(expected_hash) = 64),
  expected_revision INTEGER CHECK (expected_revision IS NULL OR expected_revision >= 1),
  target_path TEXT,
  target_hash TEXT CHECK (target_hash IS NULL OR length(target_hash) = 64),
  target_revision INTEGER CHECK (target_revision IS NULL OR target_revision >= 1),
  target_markdown TEXT,
  prepared_at TEXT NOT NULL,
  published_at TEXT,
  indexed_at TEXT,
  error_code TEXT,
  error_detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(error_detail_json)),
  CHECK (
    (operation_type = 'delete' AND target_markdown IS NULL)
    OR (operation_type <> 'delete' AND target_markdown IS NOT NULL AND target_path IS NOT NULL AND target_hash IS NOT NULL)
  )
) STRICT;

CREATE INDEX journal_file_ops_state_idx
ON journal_file_ops(state, prepared_at, operation_id);
CREATE INDEX journal_file_ops_journal_idx
ON journal_file_ops(journal_id, state, prepared_at, operation_id);

CREATE TABLE journal_file_tombstones (
  journal_id TEXT PRIMARY KEY,
  last_path TEXT,
  last_hash TEXT CHECK (last_hash IS NULL OR length(last_hash) = 64),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  tombstoned_at TEXT NOT NULL,
  purge_after TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE REFERENCES journal_file_ops(operation_id)
) STRICT;

CREATE TABLE journal_reconciliation_issues (
  id TEXT PRIMARY KEY,
  issue_type TEXT NOT NULL,
  journal_id TEXT,
  operation_id TEXT,
  path TEXT,
  expected_hash TEXT,
  actual_hash TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT
) STRICT;

CREATE INDEX journal_reconciliation_open_idx
ON journal_reconciliation_issues(resolved_at, issue_type, detected_at, id);

CREATE TABLE journal_file_garbage_candidates (
  path TEXT PRIMARY KEY,
  journal_id TEXT,
  content_hash TEXT CHECK (content_hash IS NULL OR length(content_hash) = 64),
  reason TEXT NOT NULL,
  eligible_after TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
`.trim();

export const migration007 = Object.freeze({
  id: '007_journal_file_ops',
  description: 'Add durable cross-store journal intents, tombstones, issues, and deferred garbage candidates.',
  sourceApplicationVersion: 'batch15',
  sql: JOURNAL_FILE_OPS_SCHEMA_SQL,
  checksum: '8ac05be85fd9c4958b1aa0df41a12bbe430c6139291642995b93d8c22c4ebce0',
});

export default migration007;
