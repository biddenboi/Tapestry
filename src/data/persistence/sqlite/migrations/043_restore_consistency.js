export const RESTORE_CONSISTENCY_SQL = `
DROP VIEW profile_summary_view;
CREATE VIEW profile_summary_view AS
SELECT
  p.id AS player_id,
  p.username,
  p.profile_picture,
  p.elo,
  p.created_at,
  COALESCE((SELECT COUNT(*) FROM tasks t WHERE t.player_id=p.id AND t.completed_at IS NOT NULL),0) AS completed_tasks,
  COALESCE((SELECT SUM(t.points_base) FROM tasks t WHERE t.player_id=p.id AND t.completed_at IS NOT NULL),0) AS task_points,
  COALESCE((SELECT COUNT(*) FROM journals j WHERE j.player_id=p.id AND j.deleted_at IS NULL),0) AS journals,
  COALESCE((SELECT COUNT(*) FROM match_participants mp JOIN matches m ON m.id=mp.match_id WHERE mp.player_id=p.id AND m.status='complete'),0) AS completed_matches,
  COALESCE((SELECT COUNT(*) FROM friendship_members fm JOIN friendships f ON f.id=fm.friendship_id WHERE fm.player_id=p.id AND f.status='accepted'),0) AS accepted_friends,
  COALESCE((SELECT SUM(c.value) FROM contributions c WHERE c.player_id=p.id),0) AS contribution_total,
  COALESCE((SELECT SUM(i.quantity) FROM inventory_items i WHERE i.player_id=p.id),0) AS inventory_quantity
FROM players p;

INSERT OR IGNORE INTO friendship_members(friendship_id,player_id,member_role,joined_at)
SELECT id,requester_player_id,'requester',created_at FROM friendships;
INSERT OR IGNORE INTO friendship_members(friendship_id,player_id,member_role,joined_at)
SELECT id,recipient_player_id,'recipient',created_at FROM friendships;

DROP TRIGGER friendships_refresh_members;
CREATE TRIGGER friendships_refresh_members
AFTER UPDATE OF requester_player_id,recipient_player_id ON friendships
WHEN OLD.requester_player_id IS NOT NEW.requester_player_id
  OR OLD.recipient_player_id IS NOT NEW.recipient_player_id
BEGIN
  DELETE FROM friendship_members WHERE friendship_id=NEW.id;
  INSERT INTO friendship_members(friendship_id,player_id,member_role,joined_at)
  VALUES(NEW.id,NEW.requester_player_id,'requester',NEW.created_at);
  INSERT INTO friendship_members(friendship_id,player_id,member_role,joined_at)
  VALUES(NEW.id,NEW.recipient_player_id,'recipient',NEW.created_at);
END;

DROP TRIGGER social_cast_assignment_validate_eligibility;
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
      AND p.legacy_bootstrap=0
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

DROP TABLE IF EXISTS dojo_rollup_backfill_state;
`.trim();

export const migration043 = Object.freeze({
  id: '043_restore_consistency',
  description: 'Reconcile restore-time profile, friendship, social-cast, and derived-view consistency.',
  sourceApplicationVersion: 'restore-consistency-v1',
  sql: RESTORE_CONSISTENCY_SQL,
  checksum: 'b0593474a2ce117b6e0811c70ea9a0740cfc0f58257e75b1e7e07279e361d844',
});

export default migration043;
