export const RETROSPECTIVE_DIALOGUE_SCHEMA_SQL = `
CREATE TABLE chronicle_retrospective_dialogue (
  id TEXT PRIMARY KEY,
  source_journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  target_journal_id TEXT REFERENCES journals(id) ON DELETE SET NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (
    action IN ('write_back','later_reflection','carry_forward','what_happened_afterward')
  ),
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  occurrence_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  UNIQUE(source_journal_id,target_journal_id,action)
) STRICT;

CREATE INDEX chronicle_retrospective_source_idx
ON chronicle_retrospective_dialogue(source_journal_id,created_at DESC,id);

INSERT INTO chronicle_retrospective_dialogue(
  id,source_journal_id,target_journal_id,player_id,action,body,created_at,occurrence_at,metadata_json
)
SELECT
  'retrospective:' || l.source_journal_id || ':' || l.target_id || ':' || l.relation_type,
  l.source_journal_id,
  CASE WHEN l.target_type='journal' THEN l.target_id ELSE NULL END,
  j.player_id,
  CASE WHEN l.relation_type='addendum_to' THEN 'later_reflection' ELSE 'write_back' END,
  '',
  l.created_at,
  COALESCE(m.occurrence_at,j.created_at),
  json_object('migrationSource','039_retrospective_dialogue','legacyRelation',l.relation_type)
FROM chronicle_entry_links l
JOIN journals j ON j.id=l.source_journal_id
LEFT JOIN chronicle_entry_metadata m ON m.journal_id=l.source_journal_id
WHERE l.target_type='journal' AND l.relation_type IN ('addendum_to','reflects_on')
ON CONFLICT(id) DO NOTHING;
`.trim();

export const migration039 = Object.freeze({
  id: '039_retrospective_dialogue',
  description: 'Replace pressureless-response semantics with explicit Write Back, Later Reflection, Carry Forward, and Afterward relations.',
  sourceApplicationVersion: 'retrospective-dialogue-v1',
  sql: RETROSPECTIVE_DIALOGUE_SCHEMA_SQL,
  checksum: '99b93d0dba0fe4845c2a8a1ab57eb8550342944743ae5389cf7a2690faf3051d',
});

export default migration039;
