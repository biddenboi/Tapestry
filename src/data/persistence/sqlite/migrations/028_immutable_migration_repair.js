const ORIGINAL_CORE_PROFILE_CHECKSUM = 'caa3d8069653c0e36788973eca19782c01c1ef0b87f8111b8e06e78ef883c039';
const EDITED_PLANNING_CHECKSUM = 'eecda968484bef407639576ba67fd8fe61ff9e231621837e1108cbfc957b68b5';

const ADD_LATE_CORE_PROFILE_COLUMNS_SQL = `
ALTER TABLE players ADD COLUMN money_minor INTEGER NOT NULL DEFAULT 0
  CHECK (money_minor >= 0);
ALTER TABLE players ADD COLUMN utc_time_at_start TEXT;
ALTER TABLE players ADD COLUMN legacy_bootstrap INTEGER NOT NULL DEFAULT 0
  CHECK (legacy_bootstrap IN (0,1));
`.trim();

const ADD_MISSING_PLANNING_COLUMNS_SQL = `
ALTER TABLE projects ADD COLUMN in_game_timestamp INTEGER NOT NULL DEFAULT 0
  CHECK (in_game_timestamp >= 0);
CREATE INDEX projects_player_igt_idx ON projects(player_id, in_game_timestamp, id);

ALTER TABLE todos ADD COLUMN in_game_timestamp INTEGER NOT NULL DEFAULT 0
  CHECK (in_game_timestamp >= 0);
DROP INDEX todos_player_due_idx;
CREATE INDEX todos_player_due_idx
ON todos(player_id, in_game_timestamp, due_at, created_at, id);

ALTER TABLE tasks ADD COLUMN points_base REAL NOT NULL DEFAULT 0
  CHECK (points_base >= 0);
UPDATE tasks SET points_base=points;

ALTER TABLE reminders ADD COLUMN in_game_timestamp INTEGER NOT NULL DEFAULT 0
  CHECK (in_game_timestamp >= 0);
DROP INDEX reminders_player_schedule_idx;
CREATE INDEX reminders_player_schedule_idx
ON reminders(player_id, in_game_timestamp, completed_at, dismissed_at, snoozed_until, remind_at, created_at, id);
`.trim();

export const IMMUTABLE_MIGRATION_REPAIR_SQL = `
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

export const migration028 = Object.freeze({
  id: '028_immutable_migration_repair',
  description: 'Bridge both registered historical schema variants, then repair derived SQLite objects forward-only.',
  sourceApplicationVersion: 'sqlite-integrity-repair-v2',
  compatibilityRepairs: Object.freeze([
    Object.freeze({
      migrationId: '003_core_profiles',
      checksums: Object.freeze([ORIGINAL_CORE_PROFILE_CHECKSUM]),
      sql: ADD_LATE_CORE_PROFILE_COLUMNS_SQL,
    }),
    Object.freeze({
      migrationId: '004_planning',
      checksums: Object.freeze([EDITED_PLANNING_CHECKSUM]),
      sql: ADD_MISSING_PLANNING_COLUMNS_SQL,
    }),
  ]),
  sql: IMMUTABLE_MIGRATION_REPAIR_SQL,
  checksum: 'e9ad15d77f5816ea07c51fcd8f81d32103db432297d6b03a0a9bdb14650f5101',
  compatibleChecksums: Object.freeze([
    'ece94120a33dc072d7dfbeef3ad8748c04f19ca00cf933041ae7200de99e144a',
  ]),
});

export default migration028;
