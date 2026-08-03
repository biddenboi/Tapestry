export const SOCIAL_WORLD_PRESENCE_CAST_SQL = `
CREATE TABLE semantic_presence_intervals (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  location TEXT NOT NULL CHECK (location IN (
    'planning','task-session','dojo','match-arena','marketplace','commons'
  )),
  source_type TEXT,
  source_id TEXT,
  started_igt INTEGER NOT NULL CHECK (started_igt >= 0),
  ended_igt INTEGER CHECK (ended_igt IS NULL OR ended_igt >= started_igt),
  entered_at TEXT NOT NULL,
  exited_at TEXT,
  active_elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (active_elapsed_ms >= 0),
  active_anchor_at TEXT,
  close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN (
    'surface-exit','completed','profile-switch','backgrounded',
    'interrupted','reconciled-after-close'
  )),
  metadata_version INTEGER NOT NULL DEFAULT 1 CHECK (metadata_version >= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(metadata_json)
    AND json_type(metadata_json)='object'
    AND length(metadata_json) <= 65536
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((ended_igt IS NULL AND exited_at IS NULL AND close_reason IS NULL)
      OR (ended_igt IS NOT NULL AND exited_at IS NOT NULL AND close_reason IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX semantic_presence_one_open_per_player_idx
ON semantic_presence_intervals(player_id) WHERE ended_igt IS NULL;

CREATE INDEX semantic_presence_player_igt_idx
ON semantic_presence_intervals(player_id, started_igt DESC, ended_igt, id);

CREATE INDEX semantic_presence_location_igt_idx
ON semantic_presence_intervals(location, started_igt, ended_igt, player_id);

CREATE TABLE social_cast_assignments (
  viewer_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('near-peer','horizon')),
  subject_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  algorithm_version INTEGER NOT NULL CHECK (algorithm_version >= 1),
  assigned_at_igt INTEGER NOT NULL CHECK (assigned_at_igt >= 0),
  review_after_igt INTEGER NOT NULL CHECK (review_after_igt >= assigned_at_igt),
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json)
    AND json_type(evidence_json)='object'
    AND length(evidence_json) <= 65536
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(viewer_player_id, role),
  UNIQUE(viewer_player_id, subject_player_id),
  CHECK (viewer_player_id <> subject_player_id)
) STRICT;

CREATE INDEX social_cast_subject_idx
ON social_cast_assignments(subject_player_id, viewer_player_id);

INSERT INTO source_versions(source_key,version,updated_at) VALUES
  ('presence',0,'1970-01-01T00:00:00.000Z'),
  ('socialWorld',0,'1970-01-01T00:00:00.000Z');
`;

export const migration019 = Object.freeze({
  id: '019_social_world_presence_cast',
  description: 'Persist authoritative semantic presence intervals and dynamic social cast assignments.',
  sourceApplicationVersion: 'social-world-batch3',
  sql: SOCIAL_WORLD_PRESENCE_CAST_SQL,
  checksum: '9891dadc84d58ccdf5e26f80d7ff0bca583e213247577d7ab16ac7a85795a96b',
});

export default migration019;
