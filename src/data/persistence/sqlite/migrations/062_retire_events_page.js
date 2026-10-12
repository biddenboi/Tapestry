// Habit definitions and optional ritual steps become ordinary repeating todos.
// Past lifecycle/log records remain in save bundles; the removed UI has no writer.
export const RETIRE_EVENTS_PAGE_SQL = `
CREATE TEMP TABLE imported_event_habits(id TEXT PRIMARY KEY,player_id TEXT,name TEXT,minutes INTEGER);
INSERT OR IGNORE INTO imported_event_habits
SELECT 'event-habit:'||e.uuid,
  COALESCE(e.parent_uuid,(SELECT active_player_id FROM app_state WHERE singleton_id=1),(SELECT id FROM players WHERE archived_at IS NULL ORDER BY created_at LIMIT 1)),
  COALESCE(json_extract(e.record_json,'$.name'),'Imported habit'),
  CASE WHEN json_extract(e.record_json,'$.type')='duration'
    THEN MAX(1,CAST(COALESCE(json_extract(e.record_json,'$.dailyTarget'),5) AS INTEGER)) ELSE 5 END
FROM document_custom_events e
WHERE json_extract(e.record_json,'$.type') IN ('one_time','quantity','duration')
  AND json_extract(e.record_json,'$.archivedAt') IS NULL;

INSERT OR IGNORE INTO imported_event_habits
SELECT 'ritual-habit:'||p.uuid||':'||steps.key||':'||item.key,p.uuid,trim(item.value),5
FROM document_players p,json_each(p.record_json) steps,json_each(steps.value) item
WHERE steps.key IN ('wakeChecklist','sleepChecklist') AND steps.type='array'
  AND item.type='text' AND length(trim(item.value))>0;

DELETE FROM imported_event_habits WHERE player_id IS NULL OR player_id NOT IN (SELECT id FROM players);
INSERT OR IGNORE INTO document_todos(uuid,record_json,parent_uuid,created_at,updated_at,sort_key,sequence)
SELECT h.id,json_object('UUID',h.id,'parent',h.player_id,'createdByPlayerId',h.player_id,
  'workspaceId','workspace:default','name',h.name,'isHabit',json('true'),
  'habitMinMinutes',h.minutes,'estimatedDuration',h.minutes,
  'recurrence',json_object('frequency','day','interval',1),
  'dueDate',strftime('%Y-%m-%dT23:59:59','now','localtime'),
  'createdAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'updatedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  h.player_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),h.id,
  (SELECT COALESCE(MAX(sequence),0) FROM document_todos)+row_number() OVER(ORDER BY h.id)
FROM imported_event_habits h;

INSERT OR IGNORE INTO todos(id,player_id,name,estimated_duration_minutes,due_at,created_at,updated_at,extra_json,workspace_id,created_by_player_id)
SELECT d.uuid,d.parent_uuid,json_extract(d.record_json,'$.name'),
  json_extract(d.record_json,'$.estimatedDuration'),json_extract(d.record_json,'$.dueDate'),
  d.created_at,d.updated_at,d.record_json,'workspace:default',d.parent_uuid
FROM document_todos d JOIN imported_event_habits h ON h.id=d.uuid;
DROP TABLE imported_event_habits;

-- Keep capture enabled while deleting definitions, so other devices receive tombstones.
DELETE FROM document_custom_events;
DELETE FROM document_rhythm_opportunities;
DELETE FROM document_rhythm_definitions;
DELETE FROM rhythm_opportunities;
DELETE FROM rhythm_definitions;
DELETE FROM custom_events;
DELETE FROM routine_step_receipts;
DELETE FROM routine_runs;
UPDATE document_players SET record_json=json_remove(record_json,'$.wakeChecklist','$.sleepChecklist');
UPDATE players SET extra_json=json_remove(extra_json,'$.wakeChecklist','$.sleepChecklist');
PRAGMA optimize;
`.trim();

export default Object.freeze({
  id: '062_retire_events_page',
  description: 'Import Event habits and ritual steps into R1 todos and retire their definitions.',
  sourceApplicationVersion: 'v2-pruning',
  sql: RETIRE_EVENTS_PAGE_SQL,
  checksum: 'f0e6f9cf68cc41f024b93fef4abec6ba5b4cf40a3d0e92421b54ff148580f5df',
});
