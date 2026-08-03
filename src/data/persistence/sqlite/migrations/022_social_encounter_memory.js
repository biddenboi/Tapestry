export const SOCIAL_ENCOUNTER_MEMORY_SQL = `
CREATE TABLE social_activity_index (
  subject_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'task','goal','rank','match','dojo','commitment','location'
  )),
  event_id TEXT NOT NULL,
  occurred_igt INTEGER NOT NULL CHECK (occurred_igt >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'Tasks','Goals','Rank','Matches','Dojo','Commitments','Location'
  )),
  label TEXT NOT NULL,
  project_id TEXT,
  project_name TEXT,
  version_token TEXT NOT NULL,
  visible_json TEXT NOT NULL CHECK (
    json_valid(visible_json)
    AND json_type(visible_json)='object'
    AND length(visible_json) <= 65536
  ),
  rebuild_revision INTEGER NOT NULL CHECK (rebuild_revision >= 0),
  indexed_at TEXT NOT NULL,
  PRIMARY KEY(subject_player_id,event_kind,event_id)
) STRICT;

CREATE INDEX social_activity_subject_igt_idx
ON social_activity_index(subject_player_id,occurred_igt DESC,event_kind,event_id);

CREATE INDEX social_activity_project_idx
ON social_activity_index(subject_player_id,project_id,occurred_igt DESC)
WHERE project_id IS NOT NULL;

CREATE TABLE social_activity_dirty_subjects (
  subject_player_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  changed_at TEXT NOT NULL
) STRICT;

CREATE TABLE social_activity_rebuild_state (
  subject_player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  indexed_revision INTEGER NOT NULL CHECK (indexed_revision >= 0),
  indexed_at TEXT NOT NULL
) STRICT;

CREATE TABLE social_encounters (
  id TEXT PRIMARY KEY,
  viewer_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  surface TEXT NOT NULL CHECK (surface IN (
    'profile-drawer','since-last-saw','tavern-roster','profile-daybook'
  )),
  viewer_igt INTEGER NOT NULL CHECK (viewer_igt >= 0),
  visible_fact_count INTEGER NOT NULL DEFAULT 0 CHECK (visible_fact_count >= 0),
  operation_id TEXT NOT NULL UNIQUE,
  encountered_at TEXT NOT NULL,
  CHECK (viewer_player_id <> subject_player_id)
) STRICT;

CREATE INDEX social_encounters_pair_idx
ON social_encounters(viewer_player_id,subject_player_id,viewer_igt DESC,encountered_at DESC,id);

CREATE TABLE social_event_receipts (
  viewer_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL,
  event_id TEXT NOT NULL,
  seen_version_token TEXT NOT NULL,
  seen_at_igt INTEGER NOT NULL CHECK (seen_at_igt >= 0),
  encounter_id TEXT REFERENCES social_encounters(id) ON DELETE SET NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY(viewer_player_id,subject_player_id,event_kind,event_id),
  FOREIGN KEY(subject_player_id,event_kind,event_id)
    REFERENCES social_activity_index(subject_player_id,event_kind,event_id)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX social_event_receipts_pair_idx
ON social_event_receipts(viewer_player_id,subject_player_id,seen_at_igt DESC,event_kind,event_id);

INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
SELECT id,1,COALESCE(updated_at,created_at,'1970-01-01T00:00:00.000Z') FROM players;

INSERT INTO source_versions(source_key,version,updated_at) VALUES
  ('socialActivity',0,'1970-01-01T00:00:00.000Z'),
  ('encounters',0,'1970-01-01T00:00:00.000Z');

CREATE TRIGGER social_activity_player_delete_cleanup AFTER DELETE ON players BEGIN
  DELETE FROM social_activity_dirty_subjects WHERE subject_player_id=OLD.id;
END;

CREATE TRIGGER social_activity_task_insert_dirty AFTER INSERT ON tasks BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,COALESCE(NEW.updated_at,NEW.completed_at,NEW.created_at,'1970-01-01T00:00:00.000Z'))
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_task_update_dirty AFTER UPDATE ON tasks BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,COALESCE(NEW.updated_at,NEW.completed_at,NEW.created_at,'1970-01-01T00:00:00.000Z'))
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_task_delete_dirty AFTER DELETE ON tasks BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(OLD.player_id,1,'1970-01-01T00:00:00.000Z')
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;

CREATE TRIGGER social_activity_project_insert_dirty AFTER INSERT ON projects BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,COALESCE(NEW.updated_at,NEW.completed_at,NEW.created_at,'1970-01-01T00:00:00.000Z'))
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_project_update_dirty AFTER UPDATE ON projects BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,COALESCE(NEW.updated_at,NEW.completed_at,NEW.created_at,'1970-01-01T00:00:00.000Z'))
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_project_delete_dirty AFTER DELETE ON projects BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(OLD.player_id,1,'1970-01-01T00:00:00.000Z')
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;

CREATE TRIGGER social_activity_todo_insert_dirty AFTER INSERT ON todos BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,COALESCE(NEW.updated_at,NEW.created_at,'1970-01-01T00:00:00.000Z'))
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_todo_update_dirty AFTER UPDATE ON todos BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,COALESCE(NEW.updated_at,NEW.created_at,'1970-01-01T00:00:00.000Z'))
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_todo_delete_dirty AFTER DELETE ON todos BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(OLD.player_id,1,'1970-01-01T00:00:00.000Z')
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;

CREATE TRIGGER social_activity_presence_insert_dirty AFTER INSERT ON semantic_presence_intervals BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,NEW.updated_at)
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_presence_update_dirty AFTER UPDATE ON semantic_presence_intervals BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,NEW.updated_at)
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_presence_delete_dirty AFTER DELETE ON semantic_presence_intervals BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(OLD.player_id,1,OLD.updated_at)
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;

CREATE TRIGGER social_activity_match_insert_dirty AFTER INSERT ON matches WHEN NEW.owner_player_id IS NOT NULL BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.owner_player_id,1,COALESCE(NEW.concluded_at,NEW.created_at))
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_match_update_dirty AFTER UPDATE ON matches BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  SELECT NEW.owner_player_id,1,COALESCE(NEW.concluded_at,NEW.created_at) WHERE NEW.owner_player_id IS NOT NULL
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  SELECT player_id,1,COALESCE(NEW.concluded_at,NEW.created_at)
  FROM match_participants WHERE match_id=NEW.id AND player_id IS NOT NULL
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_participant_insert_dirty AFTER INSERT ON match_participants WHEN NEW.player_id IS NOT NULL BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,'1970-01-01T00:00:00.000Z')
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_participant_update_dirty AFTER UPDATE ON match_participants WHEN NEW.player_id IS NOT NULL BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,'1970-01-01T00:00:00.000Z')
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
CREATE TRIGGER social_activity_elo_insert_dirty AFTER INSERT ON match_elo_receipts WHEN NEW.player_id IS NOT NULL BEGIN
  INSERT INTO social_activity_dirty_subjects(subject_player_id,revision,changed_at)
  VALUES(NEW.player_id,1,NEW.committed_at)
  ON CONFLICT(subject_player_id) DO UPDATE SET revision=revision+1,changed_at=excluded.changed_at;
END;
`.trim();

export const migration022 = Object.freeze({
  id: '022_social_encounter_memory',
  description: 'Persist derived social activity facts and exact viewer-subject encounter version receipts.',
  sourceApplicationVersion: 'social-world-batch9',
  sql: SOCIAL_ENCOUNTER_MEMORY_SQL,
  checksum: '469824ecbdb03f2ca24c0b7dd2bc98936c9c9fe93668173baed10990fc474169',
});

export default migration022;
