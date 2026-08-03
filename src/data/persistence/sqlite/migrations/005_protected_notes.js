export const PROTECTED_NOTES_SCHEMA_SQL = `
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_content_hash TEXT CHECK (deleted_content_hash IS NULL OR length(deleted_content_hash) = 64),
  last_operation_id TEXT NOT NULL UNIQUE,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  CHECK (deleted_at IS NULL OR content='')
) STRICT;

CREATE INDEX notes_player_updated_idx ON notes(player_id, deleted_at, updated_at DESC, id);
CREATE UNIQUE INDEX notes_id_revision_idx ON notes(id, revision);

CREATE TABLE note_conflicts (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  based_on_revision INTEGER,
  attempted_revision INTEGER,
  canonical_revision INTEGER,
  attempted_content TEXT NOT NULL,
  attempted_hash TEXT NOT NULL,
  canonical_hash TEXT,
  operation_id TEXT UNIQUE,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
) STRICT;

CREATE INDEX note_conflicts_note_idx ON note_conflicts(note_id, resolved_at, detected_at DESC);

CREATE TABLE note_write_receipts (
  operation_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','resolve')),
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 1),
  resulting_hash TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX note_write_receipts_note_idx ON note_write_receipts(note_id, committed_at DESC);
`.trim();

export const migration005 = Object.freeze({
  id: '005_protected_notes',
  description: 'Create revisioned protected Quick Notes, conflicts, and idempotent write receipts.',
  sourceApplicationVersion: 'batch13',
  sql: PROTECTED_NOTES_SCHEMA_SQL,
  checksum: '52ff61dcccd0106ff3263264e9096966ae622690a31331851c8c2394261cc400',
});

export default migration005;
