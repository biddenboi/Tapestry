export const REMOVE_TASK_RECOMMENDER_SQL = `
DROP TRIGGER IF EXISTS sync_reference_mobile_ml_model_insert;
DROP TRIGGER IF EXISTS sync_reference_mobile_ml_model_update;
DROP TRIGGER IF EXISTS sync_reference_mobile_ml_model_delete;

DELETE FROM sync_reference_outbox
WHERE record_type='ml-model' OR store_name='taskRecommendations';

DELETE FROM document_app_settings
WHERE uuid LIKE 'task-recommender%';

DELETE FROM document_task_recommendations;
DELETE FROM recommendation_events;
DELETE FROM model_settings;

DELETE FROM source_versions WHERE source_key='recommender';

PRAGMA optimize;
`.trim();

export const migration058 = Object.freeze({
  id: '058_remove_task_recommender',
  description: 'Remove Task Recommender records, portable models, and sync capture.',
  sourceApplicationVersion: 'remove-task-recommender',
  sql: REMOVE_TASK_RECOMMENDER_SQL,
  checksum: '4ea710e47d8c315194b336817951762ba39d0647ca6e5ccdf9e80033239e2dcc',
});

export default migration058;
