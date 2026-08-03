export const DYNAMIC_SOCIAL_CAST_SQL = `
CREATE TABLE social_cast_reviews (
  viewer_player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  algorithm_version INTEGER NOT NULL CHECK (algorithm_version >= 1),
  reviewed_at_igt INTEGER NOT NULL CHECK (reviewed_at_igt >= 0),
  review_after_igt INTEGER NOT NULL CHECK (review_after_igt >= reviewed_at_igt),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'initial','scheduled','role-invalidation','algorithm-upgrade'
  )),
  diagnostics_json TEXT NOT NULL CHECK (
    json_valid(diagnostics_json)
    AND json_type(diagnostics_json)='object'
    AND length(diagnostics_json) <= 65536
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX tasks_cast_history_igt_idx
ON tasks(COALESCE(completed_in_game_timestamp,in_game_timestamp),player_id)
WHERE completed_at IS NOT NULL;

CREATE TRIGGER social_cast_assignment_validate_eligibility
BEFORE INSERT ON social_cast_assignments
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM players p
    WHERE p.id=NEW.viewer_player_id AND p.archived_at IS NULL AND p.banned_at IS NULL
  ) THEN RAISE(ABORT,'social-cast-viewer-unavailable') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM players p
    WHERE p.id=NEW.subject_player_id AND p.archived_at IS NULL AND p.banned_at IS NULL
  ) THEN RAISE(ABORT,'social-cast-subject-unavailable') END;
  SELECT CASE WHEN EXISTS(
    SELECT 1 FROM friendships f
    WHERE f.status='accepted'
      AND (
        (f.requester_player_id=NEW.viewer_player_id AND f.recipient_player_id=NEW.subject_player_id)
        OR (f.requester_player_id=NEW.subject_player_id AND f.recipient_player_id=NEW.viewer_player_id)
      )
  ) THEN RAISE(ABORT,'social-cast-subject-is-friend') END;
END;

CREATE TRIGGER social_cast_friend_insert_evict
AFTER INSERT ON friendships
WHEN NEW.status='accepted'
BEGIN
  UPDATE social_cast_reviews
  SET review_after_igt=reviewed_at_igt,updated_at=NEW.accepted_at
  WHERE viewer_player_id IN (
    SELECT viewer_player_id FROM social_cast_assignments
    WHERE (viewer_player_id=NEW.requester_player_id AND subject_player_id=NEW.recipient_player_id)
       OR (viewer_player_id=NEW.recipient_player_id AND subject_player_id=NEW.requester_player_id)
  );
  DELETE FROM social_cast_assignments
  WHERE (viewer_player_id=NEW.requester_player_id AND subject_player_id=NEW.recipient_player_id)
     OR (viewer_player_id=NEW.recipient_player_id AND subject_player_id=NEW.requester_player_id);
END;

CREATE TRIGGER social_cast_friend_accept_evict
AFTER UPDATE OF status ON friendships
WHEN OLD.status<>'accepted' AND NEW.status='accepted'
BEGIN
  UPDATE social_cast_reviews
  SET review_after_igt=reviewed_at_igt,updated_at=NEW.accepted_at
  WHERE viewer_player_id IN (
    SELECT viewer_player_id FROM social_cast_assignments
    WHERE (viewer_player_id=NEW.requester_player_id AND subject_player_id=NEW.recipient_player_id)
       OR (viewer_player_id=NEW.recipient_player_id AND subject_player_id=NEW.requester_player_id)
  );
  DELETE FROM social_cast_assignments
  WHERE (viewer_player_id=NEW.requester_player_id AND subject_player_id=NEW.recipient_player_id)
     OR (viewer_player_id=NEW.recipient_player_id AND subject_player_id=NEW.requester_player_id);
END;

CREATE TRIGGER social_cast_unavailable_profile_evict
AFTER UPDATE OF archived_at,banned_at ON players
WHEN (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
  OR (OLD.banned_at IS NULL AND NEW.banned_at IS NOT NULL)
BEGIN
  UPDATE social_cast_reviews
  SET review_after_igt=reviewed_at_igt,
      updated_at=COALESCE(NEW.updated_at,'1970-01-01T00:00:00.000Z')
  WHERE viewer_player_id IN (
    SELECT viewer_player_id FROM social_cast_assignments WHERE subject_player_id=NEW.id
  );
  DELETE FROM social_cast_assignments
  WHERE viewer_player_id=NEW.id OR subject_player_id=NEW.id;
  DELETE FROM social_cast_reviews WHERE viewer_player_id=NEW.id;
END;
`;

export const migration020 = Object.freeze({
  id: '020_dynamic_social_cast',
  description: 'Persist dynamic-cast review cadence, sparse outcomes, and immediate eligibility eviction.',
  sourceApplicationVersion: 'social-world-batch4',
  sql: DYNAMIC_SOCIAL_CAST_SQL,
  checksum: '18bb94cfe44bc21ef7a6e02797a70e9689dd3a0ce079a23d625319a007139a9c',
  compatibleChecksums: Object.freeze([
    '7164fe0bcf1b002e25256894c917fc82fe6e712fc62be66d05453c212585f78d',
  ]),
});

export default migration020;
