export const WORKSPACE_PLANNING_SCOPE_SQL = `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE workspace_profiles (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,player_id)
) STRICT;

INSERT INTO workspaces(id,created_at,updated_at)
VALUES('workspace:default','1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z');

INSERT INTO workspace_profiles(workspace_id,player_id,joined_at)
SELECT 'workspace:default',id,COALESCE(created_at,'1970-01-01T00:00:00.000Z')
FROM players
WHERE archived_at IS NULL AND banned_at IS NULL;

ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE projects ADD COLUMN created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
UPDATE projects SET workspace_id='workspace:default',created_by_player_id=player_id;

ALTER TABLE todos ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE todos ADD COLUMN created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
UPDATE todos SET workspace_id='workspace:default',created_by_player_id=player_id;

ALTER TABLE reminders ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE reminders ADD COLUMN created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
UPDATE reminders SET workspace_id='workspace:default',created_by_player_id=player_id;

ALTER TABLE tasks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT;
UPDATE tasks SET workspace_id='workspace:default';

ALTER TABLE goal_areas ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE goal_areas ADD COLUMN created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
UPDATE goal_areas SET workspace_id='workspace:default',created_by_player_id=player_id;

ALTER TABLE goal_milestones ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE goal_milestones ADD COLUMN created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
UPDATE goal_milestones SET workspace_id='workspace:default',created_by_player_id=player_id;

ALTER TABLE goal_links ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE goal_links ADD COLUMN created_by_player_id TEXT REFERENCES players(id) ON DELETE SET NULL;
UPDATE goal_links SET workspace_id='workspace:default',created_by_player_id=player_id;

ALTER TABLE sync_operations ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX workspace_profiles_player_idx ON workspace_profiles(player_id,workspace_id);
CREATE INDEX projects_workspace_status_idx ON projects(workspace_id,status,created_at DESC,id);
CREATE INDEX todos_workspace_due_idx ON todos(workspace_id,in_game_timestamp,due_at,created_at,id);
CREATE INDEX reminders_workspace_schedule_idx
ON reminders(workspace_id,in_game_timestamp,completed_at,dismissed_at,snoozed_until,remind_at,created_at,id);
CREATE INDEX tasks_workspace_completed_idx ON tasks(workspace_id,completed_at DESC,id);
CREATE INDEX goal_areas_workspace_idx ON goal_areas(workspace_id,archived_at,sort_order,id);
CREATE INDEX goal_milestones_workspace_idx ON goal_milestones(workspace_id,status,goal_id,position,id);
CREATE INDEX goal_links_workspace_idx ON goal_links(workspace_id,goal_id,entity_type,entity_id);
CREATE INDEX sync_operations_workspace_idx ON sync_operations(workspace_id,status,device_sequence);

UPDATE document_projects
SET record_json=json_set(
  record_json,
  '$.workspaceId',COALESCE(json_extract(record_json,'$.workspaceId'),'workspace:default'),
  '$.createdByPlayerId',COALESCE(json_extract(record_json,'$.createdByPlayerId'),json_extract(record_json,'$.parent'))
);
UPDATE document_todos
SET record_json=json_set(
  record_json,
  '$.workspaceId',COALESCE(json_extract(record_json,'$.workspaceId'),'workspace:default'),
  '$.createdByPlayerId',COALESCE(json_extract(record_json,'$.createdByPlayerId'),json_extract(record_json,'$.parent'))
);
UPDATE document_reminders
SET record_json=json_set(
  record_json,
  '$.workspaceId',COALESCE(json_extract(record_json,'$.workspaceId'),'workspace:default'),
  '$.createdByPlayerId',COALESCE(json_extract(record_json,'$.createdByPlayerId'),json_extract(record_json,'$.parent'))
);
UPDATE document_tasks
SET record_json=json_set(
  record_json,
  '$.workspaceId',COALESCE(json_extract(record_json,'$.workspaceId'),'workspace:default')
);
UPDATE document_goal_areas
SET record_json=json_set(
  record_json,
  '$.workspaceId',COALESCE(json_extract(record_json,'$.workspaceId'),'workspace:default'),
  '$.createdByPlayerId',COALESCE(json_extract(record_json,'$.createdByPlayerId'),json_extract(record_json,'$.parent'))
);
UPDATE document_goal_milestones
SET record_json=json_set(
  record_json,
  '$.workspaceId',COALESCE(json_extract(record_json,'$.workspaceId'),'workspace:default'),
  '$.createdByPlayerId',COALESCE(json_extract(record_json,'$.createdByPlayerId'),json_extract(record_json,'$.parent'))
);
UPDATE document_goal_links
SET record_json=json_set(
  record_json,
  '$.workspaceId',COALESCE(json_extract(record_json,'$.workspaceId'),'workspace:default'),
  '$.createdByPlayerId',COALESCE(json_extract(record_json,'$.createdByPlayerId'),json_extract(record_json,'$.parent'))
);

CREATE TRIGGER preserve_workspace_planning_before_player_delete
BEFORE DELETE ON players
BEGIN
  SELECT CASE WHEN (
    EXISTS(SELECT 1 FROM projects WHERE player_id=OLD.id)
    OR EXISTS(SELECT 1 FROM todos WHERE player_id=OLD.id)
    OR EXISTS(SELECT 1 FROM reminders WHERE player_id=OLD.id)
    OR EXISTS(SELECT 1 FROM goal_areas WHERE player_id=OLD.id)
    OR EXISTS(SELECT 1 FROM goal_milestones WHERE player_id=OLD.id)
    OR EXISTS(SELECT 1 FROM goal_links WHERE player_id=OLD.id)
  ) AND NOT EXISTS(
    SELECT 1 FROM workspace_profiles candidate
    JOIN players p ON p.id=candidate.player_id
    WHERE candidate.workspace_id IN (
      SELECT workspace_id FROM workspace_profiles WHERE player_id=OLD.id
    ) AND candidate.player_id<>OLD.id AND p.archived_at IS NULL AND p.banned_at IS NULL
  ) THEN RAISE(ABORT,'workspace-planning-requires-live-profile') END;

  UPDATE projects SET player_id=(
    SELECT candidate.player_id FROM workspace_profiles candidate
    JOIN players p ON p.id=candidate.player_id
    WHERE candidate.workspace_id=projects.workspace_id AND candidate.player_id<>OLD.id
      AND p.archived_at IS NULL AND p.banned_at IS NULL
    ORDER BY p.created_at DESC,p.id LIMIT 1
  ) WHERE player_id=OLD.id;
  UPDATE todos SET player_id=(
    SELECT candidate.player_id FROM workspace_profiles candidate
    JOIN players p ON p.id=candidate.player_id
    WHERE candidate.workspace_id=todos.workspace_id AND candidate.player_id<>OLD.id
      AND p.archived_at IS NULL AND p.banned_at IS NULL
    ORDER BY p.created_at DESC,p.id LIMIT 1
  ) WHERE player_id=OLD.id;
  UPDATE reminders SET player_id=(
    SELECT candidate.player_id FROM workspace_profiles candidate
    JOIN players p ON p.id=candidate.player_id
    WHERE candidate.workspace_id=reminders.workspace_id AND candidate.player_id<>OLD.id
      AND p.archived_at IS NULL AND p.banned_at IS NULL
    ORDER BY p.created_at DESC,p.id LIMIT 1
  ) WHERE player_id=OLD.id;
  UPDATE goal_areas SET player_id=(
    SELECT candidate.player_id FROM workspace_profiles candidate
    JOIN players p ON p.id=candidate.player_id
    WHERE candidate.workspace_id=goal_areas.workspace_id AND candidate.player_id<>OLD.id
      AND p.archived_at IS NULL AND p.banned_at IS NULL
    ORDER BY p.created_at DESC,p.id LIMIT 1
  ) WHERE player_id=OLD.id;
  UPDATE goal_milestones SET player_id=(
    SELECT candidate.player_id FROM workspace_profiles candidate
    JOIN players p ON p.id=candidate.player_id
    WHERE candidate.workspace_id=goal_milestones.workspace_id AND candidate.player_id<>OLD.id
      AND p.archived_at IS NULL AND p.banned_at IS NULL
    ORDER BY p.created_at DESC,p.id LIMIT 1
  ) WHERE player_id=OLD.id;
  UPDATE goal_links SET player_id=(
    SELECT candidate.player_id FROM workspace_profiles candidate
    JOIN players p ON p.id=candidate.player_id
    WHERE candidate.workspace_id=goal_links.workspace_id AND candidate.player_id<>OLD.id
      AND p.archived_at IS NULL AND p.banned_at IS NULL
    ORDER BY p.created_at DESC,p.id LIMIT 1
  ) WHERE player_id=OLD.id;
END;

PRAGMA optimize;
`.trim();

export const migration050 = Object.freeze({
  id: '050_workspace_planning_scope',
  description: 'Add workspace-scoped planning definitions while retaining legacy creator and attribution fields.',
  sourceApplicationVersion: 'tapestry-mobile-phase-1',
  sql: WORKSPACE_PLANNING_SCOPE_SQL,
  checksum: '2daa19a7083158cf1f32eebae64615371cb6c26a24c6825c2f42b53367f02581',
});

export default migration050;
