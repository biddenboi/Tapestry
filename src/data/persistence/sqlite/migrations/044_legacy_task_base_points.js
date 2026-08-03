export const LEGACY_TASK_BASE_POINTS_SQL = `
UPDATE tasks
SET points_base=points
WHERE completed_at IS NOT NULL
  AND points>0
  AND points_base=0
  AND (
    NOT EXISTS(SELECT 1 FROM document_tasks d WHERE d.uuid=tasks.id)
    OR EXISTS(
      SELECT 1 FROM document_tasks d
      WHERE d.uuid=tasks.id
        AND json_type(d.record_json,'$.pointsBase') IS NULL
    )
  );

UPDATE document_tasks
SET record_json=json_set(
  record_json,
  '$.pointsBase',
  CAST(json_extract(record_json,'$.points') AS REAL)
)
WHERE json_type(record_json,'$.pointsBase') IS NULL
  AND json_type(record_json,'$.completedAt') IS NOT NULL
  AND CAST(json_extract(record_json,'$.points') AS REAL)>0;
`.trim();

export const migration044 = Object.freeze({
  id: '044_legacy_task_base_points',
  description: 'Recover canonical base points omitted by legacy task documents and restore points leaderboards.',
  sourceApplicationVersion: 'legacy-task-base-points-v1',
  sql: LEGACY_TASK_BASE_POINTS_SQL,
  checksum: 'a9be955375ca18f2852425ffe612832de2559fda44d6d090cf4aaa232f58892c',
});

export default migration044;
