export const CORE_PROFILE_SCHEMA_SQL = `
CREATE TABLE shadow_import_runs (
  run_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  importer_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','failed')),
  counts_json TEXT NOT NULL CHECK (json_valid(counts_json)),
  diagnostics_json TEXT NOT NULL CHECK (json_valid(diagnostics_json)),
  UNIQUE(domain, source_fingerprint, importer_version)
) STRICT;

CREATE INDEX shadow_import_runs_domain_idx
ON shadow_import_runs(domain, finished_at DESC);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  username TEXT,
  description TEXT,
  profile_picture TEXT,
  elo REAL NOT NULL DEFAULT 0 CHECK (elo >= 0),
  igt_base_elo REAL NOT NULL DEFAULT 0 CHECK (igt_base_elo >= 0),
  tokens REAL NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  minutes_cleared_today REAL NOT NULL DEFAULT 0,
  in_game_time INTEGER NOT NULL DEFAULT 0 CHECK (in_game_time >= 0),
  created_at TEXT,
  updated_at TEXT,
  archived_at TEXT,
  banned_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
) STRICT;

CREATE INDEX players_created_idx ON players(created_at DESC, id);
CREATE INDEX players_active_idx ON players(banned_at, archived_at, created_at DESC);

CREATE TABLE player_cosmetics (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  PRIMARY KEY(player_id, slot)
) STRICT;

CREATE TABLE player_titles (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  PRIMARY KEY(player_id, title_id)
) STRICT;

CREATE UNIQUE INDEX player_titles_one_active_idx
ON player_titles(player_id) WHERE active=1;

CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  setting_key TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  created_at TEXT,
  updated_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
) STRICT;

CREATE INDEX settings_player_key_idx ON settings(player_id, setting_key, id);

CREATE TABLE app_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  active_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  pending_customization_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(pending_customization_json)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE profile_violations (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  strikes INTEGER NOT NULL DEFAULT 0 CHECK (strikes >= 0),
  igt_day INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE profile_ban_pending (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  pending INTEGER NOT NULL DEFAULT 1 CHECK (pending=1),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE economy (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1),
  global_money_minor INTEGER NOT NULL DEFAULT 0 CHECK (global_money_minor >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE profile_deletion_audits (
  audit_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ban','wipe')),
  counts_json TEXT NOT NULL CHECK (json_valid(counts_json)),
  retained_json TEXT NOT NULL CHECK (json_valid(retained_json)),
  committed_at TEXT NOT NULL
) STRICT;
`.trim();

export const migration003 = Object.freeze({
  id: '003_core_profiles',
  description: 'Create typed core, profile, app-state, economy, cosmetics, and import-ledger tables.',
  sourceApplicationVersion: 'batch11',
  sql: CORE_PROFILE_SCHEMA_SQL,
  checksum: 'caa3d8069653c0e36788973eca19782c01c1ef0b87f8111b8e06e78ef883c039',
  compatibleChecksums: Object.freeze([
    'f20a1bf81e65c1a0dc3ab90f5ba8e6c649423fb1ea94ca083c062c343d654f3d',
  ]),
});

export default migration003;
