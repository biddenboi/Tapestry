const CHRONICLE_DOCUMENT_TABLES = [
  'document_chronicle_entry_metadata',
  'document_chronicle_stories',
  'document_chronicle_story_entries',
  'document_chronicle_entry_links',
  'document_chronicle_drafts',
  'document_chronicle_reactions',
  'document_chronicle_feed_view_states',
  'document_chronicle_story_read_states',
  'document_chronicle_resurface_states',
];

const documentSql = CHRONICLE_DOCUMENT_TABLES.map((table) => `
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

export const FEED_CHRONICLE_SCHEMA_SQL = `
${documentSql}

CREATE TABLE chronicle_entry_metadata (
  journal_id TEXT PRIMARY KEY REFERENCES journals(id) ON DELETE CASCADE,
  entry_kind TEXT NOT NULL DEFAULT 'entry'
    CHECK (entry_kind IN ('moment','entry','essay')),
  lifecycle_state TEXT NOT NULL DEFAULT 'published'
    CHECK (lifecycle_state IN ('draft','published','archived')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','fellows')),
  occurrence_at TEXT NOT NULL,
  occurrence_igt INTEGER,
  published_at TEXT,
  subtitle TEXT NOT NULL DEFAULT '',
  context_snapshot_json TEXT NOT NULL DEFAULT '{"version":1,"private":{},"shared":{}}'
    CHECK (json_valid(context_snapshot_json) AND length(context_snapshot_json)<=262144),
  resurface_policy TEXT NOT NULL DEFAULT 'normal'
    CHECK (resurface_policy IN ('normal','manual_only','never')),
  standalone_in_feed INTEGER NOT NULL DEFAULT 0 CHECK (standalone_in_feed IN (0,1)),
  reactions_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reactions_enabled IN (0,1)),
  responses_enabled INTEGER NOT NULL DEFAULT 1 CHECK (responses_enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  CHECK (
    (lifecycle_state='published' AND published_at IS NOT NULL)
    OR lifecycle_state!='published'
  )
) STRICT;

CREATE INDEX chronicle_entry_feed_idx
ON chronicle_entry_metadata(visibility,lifecycle_state,published_at DESC,journal_id DESC);

CREATE INDEX chronicle_entry_occurrence_idx
ON chronicle_entry_metadata(occurrence_at DESC,journal_id DESC);

CREATE TABLE chronicle_stories (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  description TEXT NOT NULL DEFAULT '',
  cover_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cover_json)),
  status TEXT NOT NULL DEFAULT 'ongoing'
    CHECK (status IN ('ongoing','completed','paused','archived')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','fellows')),
  start_at TEXT,
  end_at TEXT,
  resurface_policy TEXT NOT NULL DEFAULT 'normal'
    CHECK (resurface_policy IN ('normal','manual_only','never')),
  closing_reflection TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX chronicle_story_owner_idx
ON chronicle_stories(player_id,status,updated_at DESC,id);

CREATE TABLE chronicle_story_entries (
  story_id TEXT NOT NULL REFERENCES chronicle_stories(id) ON DELETE CASCADE,
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal>=1),
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','related')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (story_id,journal_id)
) STRICT;

CREATE UNIQUE INDEX chronicle_story_ordinal_idx
ON chronicle_story_entries(story_id,ordinal);

CREATE UNIQUE INDEX chronicle_primary_story_per_entry_idx
ON chronicle_story_entries(journal_id) WHERE role='primary';

CREATE TABLE chronicle_entry_links (
  source_journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (
    target_type IN ('journal','area','project','milestone','match','player','daybook_event')
  ),
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN ('context','continues','addendum_to','reflects_on','mentions','occurred_during')
  ),
  snapshot_label TEXT NOT NULL DEFAULT '',
  shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_journal_id,target_type,target_id,relation_type)
) STRICT;

CREATE INDEX chronicle_link_target_idx
ON chronicle_entry_links(target_type,target_id,created_at DESC);

CREATE TABLE chronicle_drafts (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('moment','entry','essay')),
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '' CHECK (length(body)<=1048576),
  images_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(images_json)),
  composer_state_json TEXT NOT NULL DEFAULT '{"version":1}' CHECK (
    json_valid(composer_state_json) AND length(composer_state_json)<=262144
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX chronicle_draft_owner_idx
ON chronicle_drafts(player_id,updated_at DESC,id);

CREATE TABLE chronicle_reactions (
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  reactor_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('acknowledge','celebrate','support')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (journal_id,reactor_id)
) STRICT;

CREATE TABLE chronicle_feed_view_state (
  viewer_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  last_seen_published_at TEXT,
  last_seen_journal_id TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE chronicle_story_read_state (
  viewer_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  story_id TEXT NOT NULL REFERENCES chronicle_stories(id) ON DELETE CASCADE,
  last_visible_journal_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (viewer_id,story_id)
) STRICT;

CREATE TABLE chronicle_resurface_state (
  viewer_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('entry','story')),
  subject_id TEXT NOT NULL,
  last_shown_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (viewer_id,subject_type,subject_id)
) STRICT;

INSERT INTO chronicle_entry_metadata(
  journal_id,entry_kind,lifecycle_state,visibility,occurrence_at,occurrence_igt,
  published_at,subtitle,context_snapshot_json,resurface_policy,standalone_in_feed,
  reactions_enabled,responses_enabled,updated_at
)
SELECT
  j.id,
  'entry',
  CASE WHEN COALESCE(f.visibility,'visible')='draft' THEN 'draft' ELSE 'published' END,
  CASE WHEN COALESCE(f.visibility,'visible')='visible' THEN 'fellows' ELSE 'private' END,
  j.created_at,
  j.in_game_timestamp,
  CASE WHEN COALESCE(f.visibility,'visible')='draft' THEN NULL ELSE COALESCE(f.sort_at,j.created_at) END,
  '',
  '{"version":1,"private":{},"shared":{}}',
  'normal',
  0,
  1,
  1,
  COALESCE(j.updated_at,j.created_at)
FROM journals j
LEFT JOIN journal_feed_metadata f ON f.journal_id=j.id
WHERE j.deleted_at IS NULL
ON CONFLICT(journal_id) DO NOTHING;

INSERT INTO document_chronicle_entry_metadata(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  m.journal_id,
  json_object(
    'UUID',m.journal_id,
    'journalUUID',m.journal_id,
    'parent',j.player_id,
    'playerUUID',j.player_id,
    'entryKind',m.entry_kind,
    'lifecycleState',m.lifecycle_state,
    'visibility',m.visibility,
    'occurrenceAt',m.occurrence_at,
    'occurrenceIGT',m.occurrence_igt,
    'publishedAt',m.published_at,
    'subtitle',m.subtitle,
    'contextSnapshot',json(m.context_snapshot_json),
    'resurfacePolicy',m.resurface_policy,
    'standaloneInFeed',json(CASE WHEN m.standalone_in_feed=1 THEN 'true' ELSE 'false' END),
    'reactionsEnabled',json(CASE WHEN m.reactions_enabled=1 THEN 'true' ELSE 'false' END),
    'responsesEnabled',json(CASE WHEN m.responses_enabled=1 THEN 'true' ELSE 'false' END),
    'updatedAt',m.updated_at
  ),
  j.player_id,
  m.occurrence_at,
  m.updated_at,
  m.occurrence_igt,
  COALESCE(m.published_at,m.occurrence_at),
  ROW_NUMBER() OVER (ORDER BY m.journal_id)
FROM chronicle_entry_metadata m
JOIN journals j ON j.id=m.journal_id
ON CONFLICT(uuid) DO NOTHING;
`.trim();

export const migration035 = Object.freeze({
  id: '035_feed_chronicle',
  description: 'Make Chronicle entries canonical, add Stories, drafts, semantic reactions, finite Feed cursors, and resurfacing controls while preserving Journal files and legacy votes.',
  sourceApplicationVersion: 'feed-chronicle-v1',
  sql: FEED_CHRONICLE_SCHEMA_SQL,
  checksum: '02937a40f6dbf4b523bf5c4292e81550c05a56bb820cb49a1c27d349488a5c1a',
  // A development build registered the pre-canonical manifest checksum.
  // Its SQL is the same schema, so preserve those databases without rewriting
  // their migration history.
  compatibleChecksums: Object.freeze([
    '49f0ab9d2384297ce674e0cd9d2c6e51d8ea054070ffd34af57ce4644146875d',
  ]),
});

export default migration035;
