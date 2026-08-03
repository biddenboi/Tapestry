export const JOURNAL_RELATIONS_SCHEMA_SQL = `
CREATE TABLE journal_feed_metadata (
  journal_id TEXT PRIMARY KEY REFERENCES journals(id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  sort_at TEXT,
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible','hidden','draft')),
  feed_state_json TEXT NOT NULL DEFAULT '{"version":1}'
    CHECK (json_valid(feed_state_json) AND length(feed_state_json) <= 65536),
  updated_at TEXT
) STRICT;

CREATE INDEX journal_feed_sort_idx
ON journal_feed_metadata(visibility, pinned DESC, sort_at DESC, journal_id);

CREATE TABLE journal_tags (
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 128),
  normalized_tag TEXT NOT NULL CHECK (length(normalized_tag) BETWEEN 1 AND 128),
  PRIMARY KEY(journal_id, normalized_tag)
) STRICT;

CREATE INDEX journal_tags_lookup_idx ON journal_tags(normalized_tag, journal_id);

CREATE TABLE journal_votes (
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(journal_id, voter_id)
) STRICT;

CREATE INDEX journal_votes_journal_idx ON journal_votes(journal_id, value, voter_id);

CREATE TABLE journal_comments (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  text TEXT NOT NULL CHECK (length(text) <= 65536),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  in_game_timestamp INTEGER,
  deleted_at TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json))
) STRICT;

CREATE INDEX journal_comments_journal_igt_idx
ON journal_comments(journal_id, in_game_timestamp, created_at, id);
CREATE INDEX journal_comments_author_idx ON journal_comments(author_id, created_at, id);

CREATE TABLE journal_comment_votes (
  comment_id TEXT NOT NULL REFERENCES journal_comments(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(comment_id, voter_id)
) STRICT;

CREATE INDEX journal_comment_votes_comment_idx
ON journal_comment_votes(comment_id, value, voter_id);
`.trim();

export const migration008 = Object.freeze({
  id: '008_journal_relations',
  description: 'Normalize journal feed state, tags, votes, comments, and comment votes.',
  sourceApplicationVersion: 'batch16',
  sql: JOURNAL_RELATIONS_SCHEMA_SQL,
  checksum: 'c3016b6078b78dacbf311508a077f878c7a4c14b1a10e20f7cb3ff6e2ace3df4',
});

export default migration008;
