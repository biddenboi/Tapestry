const PROFILE_CONTEXT_DOCUMENT_TABLES = [
  'document_profile_context_items',
  'document_profile_context_recipients',
  'document_profile_context_suggestions',
  'document_profile_context_preferences',
  'document_profile_context_audit',
];

const documentTablesSql = PROFILE_CONTEXT_DOCUMENT_TABLES.map((table) => `
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

export const PROFILE_CONTEXT_SCHEMA_SQL = `
${documentTablesSql}

CREATE TABLE profile_context_items (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN (
    'now','near','recent','chapter','show-up','goal','availability'
  )),
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 280),
  detail TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','derived')),
  source_type TEXT,
  source_id TEXT,
  source_visibility TEXT CHECK (
    source_visibility IS NULL OR source_visibility IN (
      'private','selected','collaborators','fellows','cast'
    )
  ),
  audience TEXT NOT NULL CHECK (audience IN (
    'private','selected','collaborators','fellows','cast'
  )),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('low','personal','private')),
  status TEXT NOT NULL CHECK (status IN ('draft','active','expired','revoked')),
  tentative INTEGER NOT NULL DEFAULT 0 CHECK (tentative IN (0,1)),
  action_target_json TEXT CHECK (action_target_json IS NULL OR json_valid(action_target_json)),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(evidence_json) AND json_type(evidence_json)='array'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  created_igt INTEGER,
  expires_igt INTEGER
) STRICT;

CREATE INDEX profile_context_items_projection_idx
ON profile_context_items(player_id,status,context_type,expires_at,updated_at DESC,id);

CREATE INDEX profile_context_items_source_idx
ON profile_context_items(player_id,source_type,source_id,status,id);

CREATE TABLE profile_context_recipients (
  item_id TEXT NOT NULL REFERENCES profile_context_items(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id,recipient_id)
) WITHOUT ROWID, STRICT;

CREATE INDEX profile_context_recipients_recipient_idx
ON profile_context_recipients(recipient_id,item_id);

CREATE TABLE profile_context_suggestions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  context_type TEXT NOT NULL CHECK (context_type IN (
    'now','near','recent','chapter','show-up','goal','availability'
  )),
  text TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(evidence_json) AND json_type(evidence_json)='array'
  ),
  tentative INTEGER NOT NULL DEFAULT 0 CHECK (tentative IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','dismissed','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  resolved_at TEXT
) STRICT;

CREATE UNIQUE INDEX profile_context_suggestions_dedupe_idx
ON profile_context_suggestions(player_id,dedupe_key);

CREATE INDEX profile_context_suggestions_inbox_idx
ON profile_context_suggestions(player_id,status,created_at DESC,id);

CREATE TABLE profile_context_preferences (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  default_audience TEXT NOT NULL CHECK (default_audience IN (
    'private','selected','collaborators','fellows','cast'
  )),
  default_ttl_hours INTEGER NOT NULL CHECK (default_ttl_hours BETWEEN 1 AND 8760),
  allow_availability INTEGER NOT NULL DEFAULT 0 CHECK (allow_availability IN (0,1)),
  show_activity_details INTEGER NOT NULL DEFAULT 0 CHECK (show_activity_details IN (0,1)),
  suggestion_kinds_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(suggestion_kinds_json) AND json_type(suggestion_kinds_json)='array'
  ),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE profile_context_audit (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  item_id TEXT,
  viewer_id TEXT,
  policy_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(metadata_json) AND json_type(metadata_json)='object'
  ),
  created_at TEXT NOT NULL,
  in_game_timestamp INTEGER
) STRICT;

CREATE INDEX profile_context_audit_player_time_idx
ON profile_context_audit(player_id,created_at DESC,id);
`.trim();

export const migration032 = Object.freeze({
  id: '032_profile_context',
  description: 'Add owner-authored Profile Context, selected recipients, safe suggestions, preferences, and disclosure audit.',
  sourceApplicationVersion: 'profile-context-v1',
  sql: PROFILE_CONTEXT_SCHEMA_SQL,
  checksum: '873a0a599d282002b3285784c8eca6e48e66d0219c8ca20d1daed4df6c0d6f2a',
});

export default migration032;
