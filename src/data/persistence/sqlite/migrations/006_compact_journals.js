export const COMPACT_JOURNAL_SCHEMA_SQL = `
CREATE TABLE journals (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  title_projection TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  in_game_timestamp INTEGER,
  document_revision INTEGER NOT NULL DEFAULT 1 CHECK (document_revision >= 1),
  document_state TEXT NOT NULL DEFAULT 'staged'
    CHECK (document_state IN ('staged','indexed','deleted','quarantined')),
  source_path TEXT,
  imported_at TEXT NOT NULL,
  deleted_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
) STRICT;

CREATE INDEX journals_player_created_idx ON journals(player_id, created_at DESC, id);
CREATE INDEX journals_player_igt_idx ON journals(player_id, in_game_timestamp, created_at, id);
CREATE INDEX journals_hash_idx ON journals(content_hash);
CREATE INDEX journals_state_idx ON journals(document_state, created_at, id);

CREATE TABLE journal_import_staging (
  journal_id TEXT PRIMARY KEY REFERENCES journals(id) ON DELETE CASCADE,
  source_path TEXT,
  target_path TEXT NOT NULL,
  compact_markdown TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged','published','indexed','quarantined')),
  staged_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX journal_import_staging_status_idx
ON journal_import_staging(status, staged_at, journal_id);

CREATE TABLE journal_import_quarantine (
  id TEXT PRIMARY KEY,
  journal_id TEXT,
  source_path TEXT,
  reason TEXT NOT NULL,
  diagnostic_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(diagnostic_json)),
  raw_markdown TEXT,
  quarantined_at TEXT NOT NULL
) STRICT;

CREATE INDEX journal_import_quarantine_journal_idx
ON journal_import_quarantine(journal_id, quarantined_at, id);
`.trim();

export const migration006 = Object.freeze({
  id: '006_compact_journals',
  description: 'Create the hash-bound journal index, staged compact documents, and explicit import quarantine.',
  sourceApplicationVersion: 'batch14',
  sql: COMPACT_JOURNAL_SCHEMA_SQL,
  checksum: '538adcec511adc00bdf4f00c57c9f63a87c6146dc8cb8727cc114f52f1e20406',
});

export default migration006;
