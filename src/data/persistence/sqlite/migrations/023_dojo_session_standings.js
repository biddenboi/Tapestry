export const DOJO_SESSION_STANDINGS_SQL = `
CREATE TABLE dojo_session_rollups (
  session_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  presence_interval_id TEXT REFERENCES semantic_presence_intervals(id) ON DELETE SET NULL,
  started_igt INTEGER CHECK (started_igt IS NULL OR started_igt >= 0),
  ended_igt INTEGER CHECK (
    ended_igt IS NULL OR (ended_igt >= 0 AND (started_igt IS NULL OR ended_igt >= started_igt))
  ),
  focused_ms INTEGER NOT NULL DEFAULT 0 CHECK (focused_ms >= 0),
  points REAL NOT NULL DEFAULT 0 CHECK (points >= 0),
  task_count INTEGER NOT NULL DEFAULT 0 CHECK (task_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('provisional','complete')),
  boundary_claim TEXT NOT NULL CHECK (boundary_claim IN ('exact','partial')),
  last_activity_at TEXT,
  source_version INTEGER NOT NULL DEFAULT 0 CHECK (source_version >= 0)
) STRICT;

CREATE INDEX dojo_session_rank_idx
ON dojo_session_rollups(points DESC,ended_igt DESC,session_id);

CREATE INDEX dojo_session_player_idx
ON dojo_session_rollups(player_id,started_igt DESC,session_id);

CREATE TABLE dojo_session_ranks (
  session_id TEXT PRIMARY KEY REFERENCES dojo_session_rollups(session_id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  source_version INTEGER NOT NULL CHECK (source_version >= 0),
  computed_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX dojo_session_ranks_position_idx
ON dojo_session_ranks(position);

INSERT INTO dojo_session_rollups(
  session_id,player_id,presence_interval_id,started_igt,ended_igt,focused_ms,
  points,task_count,status,boundary_claim,last_activity_at,source_version
)
SELECT
  source_id,
  player_id,
  (
    SELECT recent.id FROM semantic_presence_intervals recent
    WHERE recent.location='dojo' AND recent.source_id=intervals.source_id
    ORDER BY recent.started_igt DESC,recent.id DESC LIMIT 1
  ),
  MIN(started_igt),
  CASE WHEN SUM(CASE WHEN ended_igt IS NULL THEN 1 ELSE 0 END)>0 THEN NULL ELSE MAX(ended_igt) END,
  CAST(SUM(active_elapsed_ms) AS INTEGER),
  0,
  0,
  CASE WHEN SUM(CASE WHEN ended_igt IS NULL THEN 1 ELSE 0 END)>0 THEN 'provisional' ELSE 'complete' END,
  'exact',
  MAX(COALESCE(exited_at,entered_at)),
  1
FROM semantic_presence_intervals intervals
WHERE location='dojo' AND source_id IS NOT NULL AND length(trim(source_id))>0
GROUP BY source_id,player_id;

INSERT INTO dojo_session_rollups(
  session_id,player_id,presence_interval_id,started_igt,ended_igt,focused_ms,
  points,task_count,status,boundary_claim,last_activity_at,source_version
)
SELECT
  json_extract(extra_json,'$.dojoSessionUUID'),
  player_id,
  NULL,NULL,NULL,0,
  SUM(points),COUNT(*),'complete','partial',MAX(completed_at),1
FROM tasks
WHERE source='dojo'
  AND json_type(extra_json,'$.dojoSessionUUID')='text'
  AND length(trim(json_extract(extra_json,'$.dojoSessionUUID')))>0
GROUP BY json_extract(extra_json,'$.dojoSessionUUID'),player_id
ON CONFLICT(session_id) DO UPDATE SET
  points=excluded.points,
  task_count=excluded.task_count,
  last_activity_at=MAX(COALESCE(dojo_session_rollups.last_activity_at,''),COALESCE(excluded.last_activity_at,'')),
  source_version=dojo_session_rollups.source_version+1;

INSERT INTO source_versions(source_key,version,updated_at) VALUES
  ('dojoStandings',(SELECT CASE WHEN EXISTS(SELECT 1 FROM dojo_session_rollups) THEN 1 ELSE 0 END),'1970-01-01T00:00:00.000Z'),
  ('dojoRanks',(SELECT CASE WHEN EXISTS(SELECT 1 FROM dojo_session_rollups) THEN 1 ELSE 0 END),'1970-01-01T00:00:00.000Z');

INSERT INTO dojo_session_ranks(session_id,position,source_version,computed_at)
SELECT
  session_id,
  ROW_NUMBER() OVER (ORDER BY points DESC,ended_igt DESC,session_id),
  (SELECT version FROM source_versions WHERE source_key='dojoStandings'),
  '1970-01-01T00:00:00.000Z'
FROM dojo_session_rollups
ORDER BY points DESC,ended_igt DESC,session_id;
`.trim();

export const migration023 = Object.freeze({
  id: '023_dojo_session_standings',
  description: 'Materialize indexed Dojo session rollups and deterministic bounded standings.',
  sourceApplicationVersion: 'social-world-batch14',
  sql: DOJO_SESSION_STANDINGS_SQL,
  checksum: 'e6c5c8725a8aafbee5bcb4e35c4dcf70b561bcbcc944bc79cfaed8cdbfa54d88',
  compatibleChecksums: Object.freeze([
    'b66831c3fa33e840b78c21aed788c284279da06ac08f167f836117aad21d25a4',
  ]),
});

export default migration023;
