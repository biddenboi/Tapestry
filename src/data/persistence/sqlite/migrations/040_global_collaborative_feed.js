const COLLABORATION_DOCUMENT_TABLES = [
  'document_chronicle_entry_access',
  'document_chronicle_entry_revisions',
  'document_chronicle_entry_operation_receipts',
  'document_chronicle_entry_conflicts',
  'document_chronicle_collaboration_outbox',
  'document_chronicle_legacy_note_mappings',
];

const documentSql = COLLABORATION_DOCUMENT_TABLES.map((table) => `
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

export const GLOBAL_COLLABORATIVE_FEED_SCHEMA_SQL = `
${documentSql}

CREATE UNIQUE INDEX chronicle_revision_entry_number_idx
ON document_chronicle_entry_revisions(
  json_extract(record_json,'$.entryUUID'),
  CAST(json_extract(record_json,'$.revisionNumber') AS INTEGER)
);

CREATE UNIQUE INDEX chronicle_revision_operation_idx
ON document_chronicle_entry_revisions(json_extract(record_json,'$.clientOperationId'))
WHERE json_extract(record_json,'$.clientOperationId') IS NOT NULL;

CREATE INDEX chronicle_revision_entry_created_idx
ON document_chronicle_entry_revisions(
  json_extract(record_json,'$.entryUUID'),
  json_extract(record_json,'$.createdAt') DESC
);

CREATE INDEX chronicle_conflict_entry_state_idx
ON document_chronicle_entry_conflicts(
  json_extract(record_json,'$.entryUUID'),
  json_extract(record_json,'$.resolvedAt'),
  json_extract(record_json,'$.createdAt') DESC
);

CREATE INDEX chronicle_outbox_state_created_idx
ON document_chronicle_collaboration_outbox(
  json_extract(record_json,'$.state'),
  json_extract(record_json,'$.createdAt'),
  uuid
);

DROP INDEX chronicle_entry_feed_idx;
DROP INDEX chronicle_entry_occurrence_idx;
ALTER TABLE chronicle_entry_metadata RENAME TO chronicle_entry_metadata_schema39;

CREATE TABLE chronicle_entry_metadata (
  journal_id TEXT PRIMARY KEY REFERENCES journals(id) ON DELETE CASCADE,
  entry_kind TEXT NOT NULL DEFAULT 'entry'
    CHECK (entry_kind IN ('moment','entry','essay')),
  lifecycle_state TEXT NOT NULL DEFAULT 'published'
    CHECK (lifecycle_state IN ('draft','published','archived')),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','fellows','global')),
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

INSERT INTO chronicle_entry_metadata(
  journal_id,entry_kind,lifecycle_state,visibility,occurrence_at,occurrence_igt,
  published_at,subtitle,context_snapshot_json,resurface_policy,standalone_in_feed,
  reactions_enabled,responses_enabled,updated_at
)
SELECT journal_id,entry_kind,lifecycle_state,visibility,occurrence_at,occurrence_igt,
       published_at,subtitle,context_snapshot_json,resurface_policy,standalone_in_feed,
       reactions_enabled,responses_enabled,updated_at
FROM chronicle_entry_metadata_schema39;

DROP TABLE chronicle_entry_metadata_schema39;

CREATE INDEX chronicle_entry_feed_idx
ON chronicle_entry_metadata(visibility,lifecycle_state,published_at DESC,journal_id DESC);

CREATE INDEX chronicle_entry_occurrence_idx
ON chronicle_entry_metadata(occurrence_at DESC,journal_id DESC);

CREATE TABLE chronicle_legacy_note_mapping (
  legacy_note_id TEXT PRIMARY KEY,
  journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL,
  migration_state TEXT NOT NULL CHECK (migration_state IN ('imported','tombstone','conflict')),
  legacy_revision INTEGER NOT NULL CHECK (legacy_revision>=1),
  legacy_content_hash TEXT NOT NULL CHECK (length(legacy_content_hash)=64),
  migrated_at TEXT NOT NULL
) STRICT;

INSERT INTO journals(
  id,player_id,file_path,content_hash,title_projection,created_at,updated_at,
  in_game_timestamp,document_revision,document_state,source_path,imported_at,
  deleted_at,extra_json
)
SELECT
  'legacy-note:' || n.id,
  n.player_id,
  'journals/legacy-note-' || lower(hex(n.id)) || '.md',
  n.content_hash,
  '',
  n.created_at,
  n.updated_at,
  NULL,
  n.revision,
  'indexed',
  'legacy-notes/' || n.id,
  n.updated_at,
  NULL,
  json_object(
    'legacyNoteUUID',n.id,
    'legacyRevision',n.revision,
    'legacyContentHash',n.content_hash,
    'migration','040_global_collaborative_feed'
  )
FROM notes n
WHERE n.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM chronicle_legacy_note_mapping m WHERE m.legacy_note_id=n.id
  )
ON CONFLICT(id) DO NOTHING;

INSERT INTO document_journals(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  'legacy-note:' || n.id,
  json_object(
    'UUID','legacy-note:' || n.id,
    'parent',n.player_id,
    'title','',
    'entry',n.content,
    'images',json('[]'),
    'tags',json('[]'),
    'createdAt',n.created_at,
    'editedAt',n.updated_at,
    'inGameTimestamp',NULL,
    'revisionContentHash',n.content_hash,
    'migrationMetadata',json_object(
      'legacyNoteUUID',n.id,
      'legacyRevision',n.revision,
      'legacyContentHash',n.content_hash,
      'source','quick-notes'
    )
  ),
  n.player_id,
  n.created_at,
  n.updated_at,
  NULL,
  n.updated_at,
  (SELECT COALESCE(MAX(sequence),0) FROM document_journals)
    + ROW_NUMBER() OVER (ORDER BY n.id)
FROM notes n
WHERE n.deleted_at IS NULL
ON CONFLICT(uuid) DO NOTHING;

INSERT INTO chronicle_entry_metadata(
  journal_id,entry_kind,lifecycle_state,visibility,occurrence_at,occurrence_igt,
  published_at,subtitle,context_snapshot_json,resurface_policy,standalone_in_feed,
  reactions_enabled,responses_enabled,updated_at
)
SELECT
  'legacy-note:' || n.id,
  'moment',
  'published',
  'private',
  n.created_at,
  NULL,
  n.created_at,
  '',
  json_object(
    'version',1,
    'private',json_object('legacyNoteUUID',n.id),
    'shared',json('{}')
  ),
  'normal',
  0,
  1,
  1,
  n.updated_at
FROM notes n
WHERE n.deleted_at IS NULL
ON CONFLICT(journal_id) DO NOTHING;

INSERT INTO document_chronicle_entry_metadata(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  'legacy-note:' || n.id,
  json_object(
    'UUID','legacy-note:' || n.id,
    'journalUUID','legacy-note:' || n.id,
    'parent',n.player_id,
    'playerUUID',n.player_id,
    'entryKind','moment',
    'lifecycleState','published',
    'visibility','private',
    'occurrenceAt',n.created_at,
    'occurrenceIGT',NULL,
    'publishedAt',n.created_at,
    'subtitle','',
    'contextSnapshot',json_object(
      'version',1,
      'private',json_object('legacyNoteUUID',n.id),
      'shared',json('{}')
    ),
    'resurfacePolicy','normal',
    'standaloneInFeed',json('false'),
    'reactionsEnabled',json('true'),
    'responsesEnabled',json('true'),
    'updatedAt',n.updated_at
  ),
  n.player_id,
  n.created_at,
  n.updated_at,
  NULL,
  n.updated_at,
  (SELECT COALESCE(MAX(sequence),0) FROM document_chronicle_entry_metadata)
    + ROW_NUMBER() OVER (ORDER BY n.id)
FROM notes n
WHERE n.deleted_at IS NULL
ON CONFLICT(uuid) DO NOTHING;

INSERT INTO chronicle_legacy_note_mapping(
  legacy_note_id,journal_id,migration_state,legacy_revision,legacy_content_hash,migrated_at
)
SELECT
  n.id,
  CASE WHEN n.deleted_at IS NULL THEN 'legacy-note:' || n.id ELSE NULL END,
  CASE WHEN n.deleted_at IS NULL THEN 'imported' ELSE 'tombstone' END,
  n.revision,
  COALESCE(n.deleted_content_hash,n.content_hash),
  COALESCE(n.updated_at,n.created_at)
FROM notes n
WHERE 1=1
ON CONFLICT(legacy_note_id) DO NOTHING;

INSERT INTO document_chronicle_legacy_note_mappings(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  m.legacy_note_id,
  json_object(
    'UUID',m.legacy_note_id,
    'legacyNoteUUID',m.legacy_note_id,
    'journalUUID',m.journal_id,
    'migrationState',m.migration_state,
    'legacyRevision',m.legacy_revision,
    'legacyContentHash',m.legacy_content_hash,
    'migratedAt',m.migrated_at
  ),
  n.player_id,
  n.created_at,
  m.migrated_at,
  NULL,
  m.migrated_at,
  ROW_NUMBER() OVER (ORDER BY m.legacy_note_id)
FROM chronicle_legacy_note_mapping m
JOIN notes n ON n.id=m.legacy_note_id;

INSERT INTO document_chronicle_entry_access(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  m.journal_id,
  json_object(
    'UUID',m.journal_id,
    'journalUUID',m.journal_id,
    'ownerUUID',j.player_id,
    'parent',j.player_id,
    'visibility',m.visibility,
    'editPolicy','owner',
    'collaborationState','local',
    'authorityRevision',1,
    'authorityScope','local',
    'lockedAt',NULL,
    'lockedBy',NULL,
    'createdAt',j.created_at,
    'updatedAt',m.updated_at
  ),
  j.player_id,
  j.created_at,
  m.updated_at,
  m.occurrence_igt,
  m.updated_at,
  ROW_NUMBER() OVER (ORDER BY m.journal_id)
FROM chronicle_entry_metadata m
JOIN journals j ON j.id=m.journal_id
WHERE j.deleted_at IS NULL;

INSERT INTO document_chronicle_entry_revisions(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  'migration:revision:' || m.journal_id,
  json_object(
    'UUID','migration:revision:' || m.journal_id,
    'entryUUID',m.journal_id,
    'revisionNumber',1,
    'baseRevisionNumber',0,
    'ownerUUID',j.player_id,
    'editorUUID',j.player_id,
    'parent',j.player_id,
    'title',COALESCE(json_extract(dj.record_json,'$.title'),j.title_projection,''),
    'subtitle',m.subtitle,
    'body',COALESCE(json_extract(dj.record_json,'$.entry'),''),
    'images',json(COALESCE(json_extract(dj.record_json,'$.images'),'[]')),
    'entryKind',m.entry_kind,
    'contentHash',j.content_hash,
    'editSummary','Initial revision backfill',
    'clientOperationId','migration:040:' || m.journal_id,
    'origin','migration',
    'createdAt',COALESCE(j.updated_at,j.created_at),
    'authoritativeAt',COALESCE(j.updated_at,j.created_at)
  ),
  j.player_id,
  j.created_at,
  COALESCE(j.updated_at,j.created_at),
  m.occurrence_igt,
  COALESCE(j.updated_at,j.created_at),
  ROW_NUMBER() OVER (ORDER BY m.journal_id)
FROM chronicle_entry_metadata m
JOIN journals j ON j.id=m.journal_id
LEFT JOIN document_journals dj ON dj.uuid=m.journal_id
WHERE j.deleted_at IS NULL;

INSERT INTO document_chronicle_entry_operation_receipts(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  'migration:040:' || m.journal_id,
  json_object(
    'UUID','migration:040:' || m.journal_id,
    'operationId','migration:040:' || m.journal_id,
    'commandType','migration_backfill',
    'actorUUID',j.player_id,
    'parent',j.player_id,
    'entryUUID',m.journal_id,
    'resultingRevision',1,
    'resultStatus','accepted',
    'authoritativeAt',COALESCE(j.updated_at,j.created_at),
    'responseMetadata',json_object('schemaVersion',40)
  ),
  j.player_id,
  j.created_at,
  COALESCE(j.updated_at,j.created_at),
  m.occurrence_igt,
  COALESCE(j.updated_at,j.created_at),
  ROW_NUMBER() OVER (ORDER BY m.journal_id)
FROM chronicle_entry_metadata m
JOIN journals j ON j.id=m.journal_id
WHERE j.deleted_at IS NULL;

INSERT INTO document_chronicle_entry_conflicts(
  uuid,record_json,parent_uuid,created_at,updated_at,in_game_timestamp,sort_key,sequence
)
SELECT
  'legacy-note-conflict:' || c.id,
  json_object(
    'UUID','legacy-note-conflict:' || c.id,
    'entryUUID','legacy-note:' || c.note_id,
    'legacyConflictUUID',c.id,
    'baseRevisionNumber',c.based_on_revision,
    'currentRevisionNumber',c.canonical_revision,
    'proposedRevisionNumber',c.attempted_revision,
    'proposedBody',c.attempted_content,
    'proposedContentHash',c.attempted_hash,
    'currentContentHash',c.canonical_hash,
    'clientOperationId',c.operation_id,
    'reason',c.reason,
    'source','legacy-quick-notes',
    'createdAt',c.detected_at,
    'resolvedAt',c.resolved_at,
    'resolution',c.resolution
  ),
  n.player_id,
  c.detected_at,
  COALESCE(c.resolved_at,c.detected_at),
  NULL,
  c.detected_at,
  ROW_NUMBER() OVER (ORDER BY c.id)
FROM note_conflicts c
LEFT JOIN notes n ON n.id=c.note_id;

INSERT INTO navigation_preferences(
  profile_id,section_id,page_id,selected_entity_id,filters_json,scroll_json,
  preference_version,updated_at
)
SELECT
  profile_id,
  'feed-yours',
  CASE page_id
    WHEN 'revisit' THEN 'revisit'
    WHEN 'archive' THEN 'archive'
    ELSE 'active'
  END,
  selected_entity_id,
  filters_json,
  scroll_json,
  preference_version,
  updated_at
FROM navigation_preferences
WHERE section_id='chronicle'
ON CONFLICT(profile_id,section_id) DO NOTHING;

INSERT INTO navigation_preference_migrations(
  profile_id,section_id,legacy_page_id,mapped_page_id,migration_id,migrated_at
)
SELECT
  profile_id,
  'feed-yours',
  page_id,
  CASE page_id
    WHEN 'revisit' THEN 'revisit'
    WHEN 'archive' THEN 'archive'
    ELSE 'active'
  END,
  '040_global_collaborative_feed',
  updated_at
FROM navigation_preferences
WHERE section_id='chronicle'
ON CONFLICT(profile_id,section_id,migration_id) DO NOTHING;
`.trim();

export const migration040 = Object.freeze({
  id: '040_global_collaborative_feed',
  description: 'Consolidate Feed writing around canonical Entries with Global-ready access, immutable revisions, idempotent commands, conflict recovery, and private Quick Notes migration.',
  sourceApplicationVersion: 'global-collaborative-feed-v1',
  sql: GLOBAL_COLLABORATIVE_FEED_SCHEMA_SQL,
  checksum: '1b2ff435228ac3027d898e34427a110dcad609f203f751cc50dfc60f755b799f',
});

export default migration040;
